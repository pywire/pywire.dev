// Router for pywire.dev and nightly.pywire.dev: the landing site, the docs
// under /docs, the /cdn package mirror, and a few shortcut redirects. The
// Pages hostnames come from Terraform as plain-text bindings (LANDING_HOST,
// DOCS_HOST) and must never reach a client, not even in a redirect.

// Every response from this Worker. HSTS covers subdomains: docs, nightly, demo
// and www are all proxied through Cloudflare and serve HTTPS.
const BASE_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

// The landing site is a static Astro build. Astro inlines small scripts and
// styles, so those need 'unsafe-inline'; everything else is same-origin apart
// from remote images and the YouTube embed on the component showcase.
export const LANDING_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// The docs run the interactive tutorial: Pyodide from jsDelivr (WebAssembly),
// Monaco and Pyodide in (blob:) workers, a service worker, micropip installs
// from /cdn and PyPI, and a same-origin preview iframe. Only the directives
// that cannot break any of that are enforced; the full policy is report-only
// until a browser session through the tutorial shows no violations.
export const DOCS_CSP = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";
export const DOCS_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.jsdelivr.net https://pypi.org https://files.pythonhosted.org",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

// /cdn serves wheels and a PEP 503 index to micropip; nothing there is meant
// to render or run in a browser tab.
export const CDN_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

export const SECURITY_HEADERS = {
  landing: { ...BASE_HEADERS, "Content-Security-Policy": LANDING_CSP, "X-Frame-Options": "DENY" },
  docs: {
    ...BASE_HEADERS,
    "Content-Security-Policy": DOCS_CSP,
    "Content-Security-Policy-Report-Only": DOCS_CSP_REPORT_ONLY,
    "X-Frame-Options": "SAMEORIGIN",
  },
  cdn: { ...BASE_HEADERS, "Content-Security-Policy": CDN_CSP, "X-Frame-Options": "DENY" },
  redirect: BASE_HEADERS,
};

export function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function redirect(location, status) {
  return new Response(null, { status, headers: { ...SECURITY_HEADERS.redirect, Location: location } });
}

// Pages redirects name its own host: "/guides/forms" gets a 308 to
// "https://<project>.pages.dev/guides/forms/". Send the client to the same
// path on the public origin instead, under the mount the upstream is served
// from ("/docs" for the docs, "" for the landing site). Any pages.dev host is
// rewritten, so branch aliases never leak either.
export function rewriteLocation(response, upstreamHost, mount) {
  const location = response.headers.get("Location");
  if (response.status < 300 || response.status >= 400 || !location) return response;
  const target = new URL(location, `https://${upstreamHost}/`);
  if (target.hostname !== upstreamHost && !target.hostname.endsWith(".pages.dev")) return response;
  const headers = new Headers(response.headers);
  headers.set("Location", `${mount}${target.pathname}${target.search}${target.hash}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Forward to a Pages project, always over HTTPS: over plain HTTP, Pages
// answers with its own redirect to https://<project>.pages.dev.
function proxy(request, host, pathname) {
  const upstream = new URL(request.url);
  upstream.protocol = "https:";
  upstream.hostname = host;
  upstream.port = "";
  upstream.pathname = pathname;
  const upstreamRequest = new Request(upstream, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
  });
  // Pages routes on Host, so it must name the project, not pywire.dev.
  upstreamRequest.headers.set("Host", host);
  return fetch(upstreamRequest);
}

async function serveCdn(path, env) {
  if (path.startsWith("/cdn/simple/")) {
    const pkgName = path.slice("/cdn/simple/".length).replace(/\/$/, "");
    if (!pkgName) return new Response("Not Found", { status: 404 });
    const listed = await env.CDN_BUCKET.list({ prefix: `${pkgName}/` });
    if (listed.objects.length === 0)
      return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    const links = listed.objects
      .map((obj) => {
        const filename = obj.key.split("/").pop();
        return `<a href="/cdn/${obj.key}">${filename}</a>`;
      })
      .join("\n");
    return new Response(
      `<!DOCTYPE html><html><head><title>Links for ${pkgName}</title></head>` +
        `<body><h1>Links for ${pkgName}</h1>\n${links}\n</body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } },
    );
  }

  const key = path.slice("/cdn/".length);
  if (!key) return new Response("Not Found", { status: 404 });
  const obj = await env.CDN_BUCKET.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });
  const contentType = obj.httpMetadata?.contentType ?? "application/octet-stream";
  return new Response(obj.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const SHORTCUTS = {
  "/github": "https://github.com/pywire/pywire",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- 0. CANONICAL ORIGIN: HTTPS, no www ---
    if (url.protocol === "http:" || url.hostname.startsWith("www.")) {
      url.protocol = "https:";
      url.port = "";
      if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice("www.".length);
      return redirect(url.toString(), 301);
    }

    if (!env.LANDING_HOST || !env.DOCS_HOST) {
      return new Response("Router misconfigured: LANDING_HOST and DOCS_HOST must be bound", { status: 500 });
    }
    const isNightly = url.hostname.startsWith("nightly.");
    const landingHost = isNightly ? `nightly.${env.LANDING_HOST}` : env.LANDING_HOST;
    const docsHost = isNightly ? `nightly.${env.DOCS_HOST}` : env.DOCS_HOST;
    const path = url.pathname;

    // --- 1. CDN (R2 bucket proxy + PEP 503 simple index) ---
    if (path.startsWith("/cdn/")) {
      return withHeaders(await serveCdn(path, env), SECURITY_HEADERS.cdn);
    }

    // --- 2. SHORTCUT REDIRECTS ---
    if (Object.hasOwn(SHORTCUTS, path)) return redirect(SHORTCUTS[path], 302);

    // --- 3. DOCS (the origin sees "/_astro/..." or "/") ---
    if (path === "/docs" || path.startsWith("/docs/")) {
      const upstream = await proxy(request, docsHost, path.replace(/^\/docs/, "") || "/");
      return withHeaders(rewriteLocation(upstream, docsHost, "/docs"), SECURITY_HEADERS.docs);
    }

    // --- 4. LANDING ---
    const upstream = await proxy(request, landingHost, path);
    return withHeaders(rewriteLocation(upstream, landingHost, ""), SECURITY_HEADERS.landing);
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- 0. DETERMINE ENVIRONMENT ---
    const hostname = url.hostname;
    const isNightly = hostname.startsWith("nightly.");

    // Define base targets based on environment
    const landingTarget = isNightly ? "nightly.pywire-landing.pages.dev" : "pywire-landing.pages.dev";
    const docsTarget = isNightly ? "nightly.pywire-docs.pages.dev" : "pywire-docs.pages.dev";

    // --- 1. CDN (R2 bucket proxy + PEP 503 simple index) ---
    if (path.startsWith('/cdn/simple/')) {
      const pkgName = path.slice('/cdn/simple/'.length).replace(/\/$/, '')
      if (!pkgName) return new Response('Not Found', { status: 404 })
      const listed = await env.CDN_BUCKET.list({ prefix: `${pkgName}/` })
      const links = listed.objects
        .map(obj => {
          const filename = obj.key.split('/').pop()
          return `<a href="/cdn/${obj.key}">${filename}</a>`
        })
        .join('\n')
      return new Response(
        `<!DOCTYPE html><html><head><title>Links for ${pkgName}</title></head>` +
        `<body><h1>Links for ${pkgName}</h1>\n${links}\n</body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    if (path.startsWith('/cdn/')) {
      const key = path.slice('/cdn/'.length)
      if (!key) return new Response('Not Found', { status: 404 })
      const obj = await env.CDN_BUCKET.get(key)
      if (!obj) return new Response('Not Found', { status: 404 })
      const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream'
      return new Response(obj.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    // --- 2. HANDLE SHORTCUT REDIRECTS ---
    const redirects = {
      // "/discord": "https://discord.gg/pywire", // Update this!
      "/github": "https://github.com/pywire/pywire",
    };
    if (redirects[path]) return Response.redirect(redirects[path], 302);

    // --- 3. DEFINE PROXY FUNCTION ---
    // This helper strips the 'Host' header so Pages accepts the request
    async function proxy(targetOrigin, pathOverride) {
      const newUrl = new URL(request.url);
      newUrl.hostname = targetOrigin;

      // Apply path override if provided (for stripping /docs)
      if (pathOverride !== undefined) {
        newUrl.pathname = pathOverride;
      }

      // ⚠️ CRITICAL: Create a clean request to avoid Host header mismatch
      const newRequest = new Request(newUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      });

      // Force the Host header to match the target origin
      newRequest.headers.set("Host", targetOrigin);

      return fetch(newRequest);
    }

    // --- 4. ROUTE TO DOCS ---
    if (path.startsWith("/docs")) {
      // Strip "/docs" so the origin sees "/_astro/..." or "/"
      const newPath = path.replace(/^\/docs/, "") || "/";
      return proxy(docsTarget, newPath);
    }

    // --- 5. ROUTE TO LANDING ---
    return proxy(landingTarget);
  },
};

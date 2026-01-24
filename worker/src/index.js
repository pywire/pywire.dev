// worker/src/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Docs Route
    // Matches /docs, /docs/, /docs/guide/getting-started
    if (path.startsWith("/docs")) {
      // Points to the build from Repo A
      const DOCS_ORIGIN = "https://pywire-docs.pages.dev";
      const newUrl = new URL(request.url);
      newUrl.hostname = "pywire-docs.pages.dev";
      return fetch(new Request(newUrl, request));
    }

    // 2. Landing Route (Catch-all)
    // Points to the build from Repo B
    const LANDING_ORIGIN = "https://pywire-landing.pages.dev";
    const newUrl = new URL(request.url);
    newUrl.hostname = "pywire-landing.pages.dev";
    return fetch(new Request(newUrl, request));
  },
};

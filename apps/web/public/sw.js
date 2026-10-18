// NIGHTSHIFT app shell. Pages: fresh when online, the last copy when offline. Hashed bundles and art: cached.
// Never cached: /api (prices, sessions, payments), downloads, anything not GET or from another origin.
const CACHE = "ns-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ns-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (/^\/(api|mcp|files|d|download|buy|sites)(\/|$)/.test(u.pathname)) return;
  if (e.request.mode === "navigate") {
    // only the app's own page becomes the offline copy, never a bought file or a company site
    e.respondWith(fetch(e.request).then((r) => { if (r.ok && (r.headers.get("content-type") ?? "").startsWith("text/html")) { const c = r.clone(); void caches.open(CACHE).then((x) => x.put("/", c)); } return r; }).catch(() => caches.match("/")));
    return;
  }
  if (u.pathname.startsWith("/assets/") || /\.(webp|png|svg|woff2)$/.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); void caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })));
  }
});

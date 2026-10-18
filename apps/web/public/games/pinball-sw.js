// Space Pinball offline cache. Scope: /games/pinball only. The API is never cached.
const CACHE = "pinball-v1";
const ART = ["playfield.webp", "blackhole.webp", "planet-0.webp", "planet-1.webp", "planet-2.webp", "planet-3.webp", "frog-0.webp", "frog-1.webp", "frog-2.webp", "frog-3.webp", "frog-4.webp"].map((f) => `/games/pinball/${f}`);
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/games/pinball", ...ART])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("pinball-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // the page: fresh when online, the cached copy when not
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); void caches.open(CACHE).then((x) => x.put("/games/pinball", c)); return r; }).catch(() => caches.match("/games/pinball")));
    return;
  }
  // hashed bundles and the game art never change under the same name
  if (u.pathname.startsWith("/assets/") || u.pathname.startsWith("/games/pinball/") || u.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); void caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })));
  }
});

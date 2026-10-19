// Offline-first app shell. The build stamps the cache name below with a content hash and writes precache.json (all files),
// so the first visit caches everything; later visits use the network when available and fall back to the cache.
const CACHE = "openink-__BUILD__";
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const list = await (await fetch("./precache.json", { cache: "no-store" })).json();
        const cache = await caches.open(CACHE);
        await cache.addAll(list.files);
      } catch { /* dev server or offline: lazy caching below still works */ }
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith("openink-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html") || caches.match("./"))),
  );
});

const CACHE = "sonidos-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./mantras.json",
  "./manifest.json",
  "./mantras.html",
  "./sonidos_sagrados.html",
  "./sound_generator.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const fetcher = fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || fetcher;
    })
  );
});

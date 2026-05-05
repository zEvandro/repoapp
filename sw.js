const CACHE = "repoapp-v3.8";
const FILES = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Sempre busca da rede — Firebase precisa de internet
  // Usa cache só como fallback se offline
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

const CACHE = "repoapp-v3.23";
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
  // no-cache: sempre valida com o servidor, nunca serve arquivo velho do cache HTTP
  // Fallback para cache próprio do SW só se estiver offline
  const req = e.request;
  const isSameOrigin = new URL(req.url).origin === self.location.origin;
  e.respondWith(
    fetch(req, isSameOrigin ? {cache: "no-cache"} : {})
      .catch(() => caches.match(req))
  );
});

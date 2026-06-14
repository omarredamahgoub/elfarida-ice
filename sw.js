/* Elfarida Ice — Service Worker
   Strategy:
   - Navigation/HTML: network-first (pages never served stale), offline fallback.
   - Static assets (css/js/img/fonts): stale-while-revalidate.
   - Same-origin GET only; analytics/forms/cross-origin bypass the SW.
*/
const VERSION = "v1-2026-06-14";
const STATIC_CACHE = `efi-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accept.includes("text/html");

  if (isHtml) {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))
      )
    );
    return;
  }

  if (/\.(css|js|mjs|webp|png|jpe?g|gif|svg|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((resp) => {
              if (resp && resp.status === 200 && resp.type === "basic") {
                cache.put(req, resp.clone());
              }
              return resp;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});

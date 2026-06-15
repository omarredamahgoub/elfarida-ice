/* Elfarida Ice — Service Worker KILL-SWITCH.
   The site no longer uses a Service Worker. This build purges all caches and
   unregisters any previously-installed worker so returning visitors always get
   fresh content (HTML is no-cache; JS/CSS are version-fingerprinted).
*/
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});

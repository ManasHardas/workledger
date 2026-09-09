/*
 * The minimum a PWA needs: precache the shell on install, serve it from cache when the network is
 * gone, and never let a stale bundle outlive a deploy. Every build writes new hashed asset names,
 * so a version bump here is what evicts the previous shell.
 *
 * There is deliberately no runtime caching of `/api/**`: the ledger is files on this machine and a
 * cached read would show a session that has already moved on.
 */
const CACHE = "workledger-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((hit) => hit ?? caches.match("./index.html"))
          .then((hit) => hit ?? Response.error()),
      ),
  );
});

const CACHE_NAME = "haniaion-shell-v8-1-english-route-map";

const APP_SHELL = [
  "/",
  "/static/style.css",
  "/static/app.js",
  "/static/icons/icon.svg",
  "/wind",
  "/static/wind.css",
  "/static/wind.js",
  "/manifest.webmanifest",
];

self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(cache => cache.addAll(APP_SHELL))
    );

    self.skipWaiting();
  }
);

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key => key !== CACHE_NAME)
              .map(key => caches.delete(key))
          )
        )
    );

    self.clients.claim();
  }
);

self.addEventListener(
  "fetch",
  event => {
    if (event.request.method !== "GET") {
      return;
    }

    if (new URL(event.request.url).pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache =>
              cache.put(
                event.request,
                copy
              )
            );

          return response;
        })
        .catch(() =>
          caches.match(event.request)
        )
    );
  }
);

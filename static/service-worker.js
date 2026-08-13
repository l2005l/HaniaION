const CACHE_NAME = "haniaion-v2-23-k69-alerts";

const APP_SHELL = [
  "/",
  "/wind",
  "/satellite",
  "/static/style.css?v=55",
  "/static/app.js?v=58",
  "/static/wind.css?v=45",
  "/static/wind.js?v=45",
  "/static/satellite.css?v=21",
  "/static/satellite.js?v=21",
  "/static/data-status.css?v=4",
  "/static/data-status.js?v=4",
  "/static/icons/icon.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API — always live
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Pages — network first
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put("/", copy);
          });

          return response;
        })
        .catch(() => caches.match("/"))
    );

    return;
  }

  // JS/CSS — network first so updates are received immediately
  if (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });

          return response;
        })
        .catch(() => caches.match(request))
    );

    return;
  }

  // Other static assets — cache first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, copy);
        });

        return response;
      });
    })
  );
});

self.addEventListener("push", event => {
  let payload = {
    title: "HaniaION",
    body: "New BRDC data is available",
    url: "/"
  };

  try {
    payload = {
      ...payload,
      ...event.data.json()
    };
  } catch (_) {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil((async () => {
    const windows = await clients.matchAll({type: "window", includeUncontrolled: true});
    const visibleClient = windows.find(client => client.visibilityState === "visible");

    // K-69 alerts must still create a real system notification when the
    // installed PWA is visible. SpeechSynthesis from a push event is not
    // guaranteed to have user activation, so forwarding only to the page can
    // result in no audible/visible alert at all. We therefore ALWAYS show the
    // system notification, and additionally notify the visible page so it can
    // attempt spoken Hebrew while foregrounded.
    if (payload.data?.type === "k69-alert" && visibleClient) {
      visibleClient.postMessage({
        type: "k69-alert",
        seconds_before: Number(payload.data.seconds_before) || 0,
        cycle_at: payload.data.cycle_at || ""
      });
    }

    await self.registration.showNotification(
      payload.title,
      {
        body: payload.body,
        icon: "/static/icons/icon.svg",
        badge: "/static/icons/icon.svg",
        tag: payload.tag || "haniaion-v2-update",
        renotify: true,
        silent: false,
        vibrate: [250, 100, 250],
        requireInteraction: false,
        data: {
          url: payload.url || "/",
          ...(payload.data || {})
        }
      }
    );
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  ).href;

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true
      })
      .then(windows => {
        for (const client of windows) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(target);
            return client.focus();
          }
        }

        return clients.openWindow(target);
      })
  );
});

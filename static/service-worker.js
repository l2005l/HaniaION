const CACHE_NAME = "haniaion-v2.2.1";
const APP_SHELL = ["/", "/wind", "/satellite", "/static/style.css?v=46", "/static/app.js?v=46", "/static/wind.css?v=45", "/static/wind.js?v=45", "/static/satellite.css?v=3", "/static/satellite.js?v=3", "/static/data-status.css?v=2", "/static/data-status.js?v=2", "/static/icons/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) { event.respondWith(fetch(request)); return; }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put("/", copy)); return response; }).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); return response; })));
});

self.addEventListener("push", event => {
  let payload = {title: "HaniaION", body: "New BRDC data is available", url: "/"};
  try { payload = {...payload, ...event.data.json()}; } catch (_) { if (event.data) payload.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/static/icons/icon.svg",
    badge: "/static/icons/icon.svg",
    tag: payload.tag || "haniaion-v2-update",
    data: {url: payload.url || "/", ...(payload.data || {})},
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(windows => {
    for (const client of windows) { if (client.url.startsWith(self.location.origin) && "focus" in client) { client.navigate(target); return client.focus(); } }
    return clients.openWindow(target);
  }));
});

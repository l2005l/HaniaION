const CACHE_NAME = "haniaion-v2-27-k69-armed-push";

const APP_SHELL = [
  "/",
  "/wind",
  "/satellite",
  "/static/style.css?v=55",
  "/static/app.js?v=62",
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

const k69ArmedCycles = new Map();

function k69NotificationText(seconds) {
  if (seconds === 0) return "המפתח הגיע עכשיו 🔔";
  if (seconds === 60) return "בעוד דקה יגיע המפתח 🔔";
  return `בעוד ${seconds} שניות יגיע המפתח 🔔`;
}

async function showK69Notification(seconds, cycleAt) {
  const title = seconds === 0
    ? "HaniaION — K-69"
    : "HaniaION — התראת K-69";

  await self.registration.showNotification(title, {
    body: k69NotificationText(seconds),
    icon: "/static/icons/icon.svg",
    badge: "/static/icons/icon.svg",
    tag: `haniaion-k69-${cycleAt}-${seconds}`,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: {
      url: "/#k69-live-target",
      type: "k69-alert",
      cycle_at: cycleAt,
      seconds_before: seconds,
    },
  });

  const windows = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const visibleClient = windows.find(client => client.visibilityState === "visible");
  if (visibleClient) {
    visibleClient.postMessage({
      type: "k69-alert",
      seconds_before: seconds,
      cycle_at: cycleAt,
    });
  }
}

async function armK69Alerts(payload) {
  const cycleAt = String(payload.data?.cycle_at || "");
  const alerts = Array.isArray(payload.data?.alerts) ? payload.data.alerts : [];
  if (!cycleAt || !alerts.length) return;

  // If the user schedules again, only the newest K cycle remains armed.
  for (const [oldCycle, timers] of k69ArmedCycles) {
    if (oldCycle === cycleAt) continue;
    for (const timer of timers) clearTimeout(timer);
    k69ArmedCycles.delete(oldCycle);
  }

  const timers = [];
  const now = Date.now();

  for (const alert of alerts) {
    const seconds = Number(alert.seconds_before);
    const dueAt = Date.parse(alert.due_at);
    if (!Number.isFinite(seconds) || !Number.isFinite(dueAt)) continue;

    const delay = Math.max(0, dueAt - now);
    const timer = setTimeout(() => {
      showK69Notification(seconds, cycleAt).catch(() => {});
    }, delay);
    timers.push(timer);
  }

  k69ArmedCycles.set(cycleAt, timers);

  // Confirm receipt to the server. Once acknowledged, the server will not
  // send duplicate per-alert pushes for this cycle.
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/k69/arm-ack", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          schedule_ids: alerts.map(alert => Number(alert.schedule_id)).filter(Number.isFinite),
        }),
      });
    }
  } catch (_) {
    // If the acknowledgement fails, the server-side scheduler remains the
    // fallback while the service is alive.
  }

  // Keep this push event alive until the latest short countdown finishes.
  // This is intentionally capped to the current K cycle, never a recurring
  // background job.
  const maxDelay = Math.max(...alerts.map(alert => {
    const dueAt = Date.parse(alert.due_at);
    return Number.isFinite(dueAt) ? Math.max(0, dueAt - now) : 0;
  }), 0);

  await new Promise(resolve => setTimeout(resolve, Math.min(maxDelay + 1500, 75_000)));
}

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
    if (payload.data?.type === "k69-arm") {
      await armK69Alerts(payload);
      return;
    }

    const windows = await clients.matchAll({type: "window", includeUncontrolled: true});
    const visibleClient = windows.find(client => client.visibilityState === "visible");

    // Always create a real system notification. The foreground page may also
    // receive the event and attempt Hebrew speech, but it must never suppress
    // the OS notification.
    await self.registration.showNotification(
      payload.title,
      {
        body: payload.body,
        icon: "/static/icons/icon.svg",
        badge: "/static/icons/icon.svg",
        tag: payload.tag || "haniaion-v2-update",
        renotify: true,
        requireInteraction: false,
        data: {
          url: payload.url || "/",
          ...(payload.data || {})
        }
      }
    );

    if (payload.data?.type === "k69-alert" && visibleClient) {
      visibleClient.postMessage({
        type: "k69-alert",
        seconds_before: Number(payload.data.seconds_before) || 0,
        cycle_at: payload.data.cycle_at || ""
      });
    }
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

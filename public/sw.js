const CACHE_NAME = "herd-rabbit-v1.0.0";
const APP_SHELL = [
  "/",
  "/styles.css?v=1.0.0",
  "/theme.js?v=1.0.0",
  "/app.js?v=1.0.0",
  "/vendor/simplewebauthn-browser.js?v=1.0.0",
  "/ansi.js?v=1.0.0",
  "/ui-model.js?v=1.0.0",
  "/pane-preference.js?v=1.0.0",
  "/workspace-preference.js?v=1.0.0",
  "/terminal-preference.js?v=1.0.0",
  "/completion-preference.js?v=1.0.0",
  "/input-history-preference.js?v=1.0.0",
  "/launch-session.js?v=1.0.0",
  "/push-notifications.js?v=1.0.0",
  "/manifest.webmanifest",
  "/icons/rabbit-outline-v33.svg",
  "/icons/app-icon.svg",
  "/icons/rabbit-outline-32-v33.png",
  "/icons/rabbit-outline-app-192-v35.png",
  "/icons/rabbit-outline-app-512-v35.png",
  "/icons/notification-icon-192.png",
  "/icons/notification-badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function fetchAndRefreshCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch {
      // A cache write failure must not hide a successful network response.
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/")),
    );
    return;
  }

  event.respondWith(
    fetchAndRefreshCache(event.request).catch(() => caches.match(event.request)),
  );
});

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data?.json() || {};
  } catch {
    message = {};
  }
  const title = typeof message.title === "string" && message.title
    ? message.title
    : "HerdRabbit";
  const body = typeof message.body === "string"
    ? message.body
    : "Agent status changed.";
  const tag = typeof message.tag === "string" ? message.tag : undefined;
  const data = message.data && typeof message.data === "object" ? message.data : {};
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data,
    icon: "/icons/notification-icon-192.png",
    badge: "/icons/notification-badge-96.png",
    renotify: Boolean(tag),
  }));
});

function notificationUrl(value) {
  try {
    const target = new URL(value || "/", self.location.origin);
    return target.origin === self.location.origin
      ? target.href
      : self.location.origin;
  } catch {
    return self.location.origin;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = notificationUrl(event.notification.data?.url);
  event.waitUntil(self.clients.openWindow(targetUrl).then((client) =>
    client && typeof client.focus === "function" ? client.focus() : client
  ));
});

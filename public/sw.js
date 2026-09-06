const CACHE_NAME = "herdr-web-local-v74";
const APP_SHELL = [
  "/",
  "/styles.css?v=69",
  "/theme.js?v=36",
  "/app.js?v=67",
  "/ansi.js?v=40",
  "/ui-model.js?v=58",
  "/pane-preference.js?v=40",
  "/workspace-preference.js?v=40",
  "/terminal-preference.js?v=1",
  "/completion-preference.js?v=1",
  "/launch-session.js?v=1",
  "/push-notifications.js?v=1",
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
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
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
    : "에이전트 상태가 변경되었습니다.";
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
  event.waitUntil(self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  }).then(async (windows) => {
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});

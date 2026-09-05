const CACHE_NAME = "herdr-web-local-v36";
const APP_SHELL = [
  "/",
  "/styles.css?v=36",
  "/theme.js?v=36",
  "/app.js?v=36",
  "/ansi.js?v=36",
  "/ui-model.js?v=36",
  "/pane-preference.js?v=36",
  "/workspace-preference.js?v=36",
  "/manifest.webmanifest",
  "/icons/rabbit-outline-v33.svg",
  "/icons/rabbit-outline-32-v33.png",
  "/icons/rabbit-outline-app-192-v35.png",
  "/icons/rabbit-outline-app-512-v35.png",
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workerSource = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function loadNotificationClickHandler(clients, registration = { showNotification() {} }) {
  const handlers = new Map();
  const self = {
    location: { origin: "https://rabbit.example" },
    clients,
    registration,
    skipWaiting() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  };
  vm.runInNewContext(workerSource, {
    self,
    URL,
    Promise,
    Boolean,
    caches: {},
    fetch() {},
  });
  return handlers.get("notificationclick");
}

test("notification clicks launch and focus the installed app on Android", async () => {
  const calls = [];
  const unrelatedBrowserClient = {
    url: "https://rabbit.example/",
    async navigate(url) {
      calls.push(["navigate-browser", url]);
      return this;
    },
    async focus() {
      calls.push(["focus-browser"]);
      return this;
    },
  };
  const openedAppClient = {
    async focus() {
      calls.push(["focus-app"]);
      return this;
    },
  };
  const clients = {
    async matchAll() {
      return [unrelatedBrowserClient];
    },
    async openWindow(url) {
      calls.push(["open-app", url]);
      return openedAppClient;
    },
  };
  const handler = loadNotificationClickHandler(clients);
  let lifetime;

  handler({
    notification: {
      data: { url: "/?pane=hs_default~w1%3Ap1" },
      close() {
        calls.push(["close-notification"]);
      },
    },
    waitUntil(promise) {
      lifetime = promise;
    },
  });
  await lifetime;

  assert.deepEqual(calls, [
    ["close-notification"],
    ["open-app", "https://rabbit.example/?pane=hs_default~w1%3Ap1"],
    ["focus-app"],
  ]);
});

test("clears the notifications left over for the pane being opened", async () => {
  const closed = [];
  const notificationFor = (paneId, id) => ({
    data: { paneId },
    close() {
      closed.push(id);
    },
  });
  const clients = {
    async matchAll() {
      return [];
    },
    async openWindow() {
      return null;
    },
  };
  const registration = {
    showNotification() {},
    async getNotifications() {
      return [
        notificationFor("hs_default~w1:p1", "same-pane-duplicate"),
        notificationFor("hs_default~w2:p1", "other-pane"),
      ];
    },
  };
  const handler = loadNotificationClickHandler(clients, registration);
  let lifetime;

  handler({
    notification: {
      data: { paneId: "hs_default~w1:p1", url: "/?pane=hs_default~w1%3Ap1" },
      close() {
        closed.push("clicked");
      },
    },
    waitUntil(promise) {
      lifetime = promise;
    },
  });
  await lifetime;

  assert.deepEqual(closed, ["clicked", "same-pane-duplicate"]);
});

test("opens the app even when notifications cannot be enumerated", async () => {
  const opened = [];
  const clients = {
    async matchAll() {
      return [];
    },
    async openWindow(url) {
      opened.push(url);
      return null;
    },
  };
  const registration = {
    showNotification() {},
    async getNotifications() {
      throw new Error("not available");
    },
  };
  const handler = loadNotificationClickHandler(clients, registration);
  let lifetime;

  handler({
    notification: {
      data: { paneId: "hs_default~w1:p1", url: "/" },
      close() {},
    },
    waitUntil(promise) {
      lifetime = promise;
    },
  });
  await lifetime;

  assert.deepEqual(opened, ["https://rabbit.example/"]);
});

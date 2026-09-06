import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workerSource = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function loadNotificationClickHandler(clients) {
  const handlers = new Map();
  const self = {
    location: { origin: "https://rabbit.example" },
    clients,
    registration: { showNotification() {} },
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

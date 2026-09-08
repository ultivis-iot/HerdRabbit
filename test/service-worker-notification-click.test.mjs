import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { BroadcastChannel, MessageChannel } from "node:worker_threads";

const workerSource = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function loadNotificationClickHandler(clients, registration = { showNotification() {} }, extras = {}) {
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
    MessageChannel,
    setTimeout,
    clearTimeout,
    caches: {},
    fetch() {},
    ...extras,
  });
  return handlers.get("notificationclick");
}

test("notification clicks reuse an open app without navigation or a new login context", async () => {
  const calls = [];
  const unrelatedBrowserClient = {
    postMessage(message, ports) {
      calls.push(["message", message.type, message.url]);
      ports[0].postMessage({ accepted: true });
    },
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
    ["focus-browser"],
    ["message", "open-notification-pane", "https://rabbit.example/?pane=hs_default~w1%3Ap1"],
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

test("an older open app that ignores pane messages navigates in the same window", async () => {
  const calls = [];
  const client = {
    url: "https://rabbit.example/",
    async focus() { return this; },
    postMessage() {},
    async navigate(url) { calls.push(url); return this; },
  };
  const handler = loadNotificationClickHandler({
    async matchAll() { return [client]; },
    async openWindow() { assert.fail("must preserve the existing login context"); },
  });
  let lifetime;
  handler({ notification: { data: { url: "/?pane=w2%3Ap1" }, close() {} }, waitUntil(p) { lifetime = p; } });
  await lifetime;
  assert.deepEqual(calls, ["https://rabbit.example/?pane=w2%3Ap1"]);
});

test("a focus failure does not open a duplicate when the app accepts the target", async () => {
  const client = {
    url: "https://rabbit.example/",
    async focus() { throw new Error("focus temporarily unavailable"); },
    postMessage(_message, ports) { ports[0].postMessage({ accepted: true }); },
  };
  const handler = loadNotificationClickHandler({
    async matchAll() { return [client]; },
    async openWindow() { assert.fail("must not duplicate a responding app"); },
  });
  let lifetime;
  handler({ notification: { data: { url: "/?pane=w2%3Ap1" }, close() {} }, waitUntil(p) { lifetime = p; } });
  await lifetime;
});


test("a visible app can accept the target even when Android enumerates zero windows", async () => {
  const channel = new BroadcastChannel("herdr-notification-navigation");
  try {
    channel.onmessage = ({ data }) => channel.postMessage({ type: "notification-target-applied", id: data.id, visible: true });
    const handler = loadNotificationClickHandler({
      async matchAll() { return []; },
      async openWindow() { assert.fail("a visible app already applied the notification target"); },
    }, undefined, { BroadcastChannel });
    let lifetime;
    handler({ notification: { data: { paneId: "w2:p1", url: "/?pane=w2%3Ap1" }, close() {} }, waitUntil(p) { lifetime = p; } });
    await lifetime;
  } finally { channel.close(); }
});

test("does not refocus a visible app when delivering an alert target", async () => {
  let focusCount = 0;
  const clients = {async matchAll(){return [{url:'https://rabbit.example/',visibilityState:'visible',async focus(){focusCount++;},postMessage(_m,ports){ports[0].postMessage({accepted:true});}}];}};
  const click = loadNotificationClickHandler(clients);
  let lifetime;
  click({ notification: { data: { url: '/?pane=w2%3Ap1' }, close() {} }, waitUntil(p){lifetime=p;} });
  await lifetime;
  assert.equal(focusCount,0);
});

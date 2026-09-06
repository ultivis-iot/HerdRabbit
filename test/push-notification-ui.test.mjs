import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applicationServerKeyBytes,
  pushButtonPresentation,
} from "../public/push-notifications.js";

const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("renders an accessible notification toggle in the sidebar footer", () => {
  assert.match(page, /id="notification-toggle"/);
  assert.match(page, /aria-label="상태 알림 켜기"/);
  assert.match(page, /class="notification-icon"/);
});

test("describes enabled, disabled, denied, and unavailable push states", () => {
  assert.deepEqual(
    pushButtonPresentation({ supported: true, permission: "granted", subscribed: true }),
    { hidden: false, disabled: false, pressed: true, label: "상태 알림 끄기", state: "enabled" },
  );
  assert.deepEqual(
    pushButtonPresentation({ supported: true, permission: "default", subscribed: false }),
    { hidden: false, disabled: false, pressed: false, label: "상태 알림 켜기", state: "disabled" },
  );
  assert.deepEqual(
    pushButtonPresentation({ supported: true, permission: "denied", subscribed: false }),
    { hidden: false, disabled: true, pressed: false, label: "브라우저 설정에서 알림을 허용하세요", state: "denied" },
  );
  assert.equal(
    pushButtonPresentation({ supported: false, permission: "default", subscribed: false }).hidden,
    true,
  );
});

test("decodes a URL-safe VAPID public key for PushManager", () => {
  assert.deepEqual(
    [...applicationServerKeyBytes("AQID-_8")],
    [1, 2, 3, 251, 255],
  );
});

test("the service worker receives pushes and opens the targeted pane", () => {
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /openWindow/);
});

test("subscribes on demand and restores the pane from a notification URL", () => {
  assert.match(app, /Notification\.requestPermission\(\)/);
  assert.match(app, /pushManager\.subscribe/);
  assert.match(app, /\/api\/push\/subscriptions/);
  assert.match(app, /searchParams\.get\("pane"\)/);
});

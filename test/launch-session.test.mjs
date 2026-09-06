import test from "node:test";
import assert from "node:assert/strict";
import {
  clearLaunchToken,
  readLaunchToken,
  writeLaunchToken,
} from "../public/launch-session.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("keeps a valid launch token only for the current browser session", () => {
  const storage = memoryStorage();
  const token = `${"a".repeat(32)}.1234567890.${"b".repeat(43)}`;

  assert.equal(writeLaunchToken(storage, token), token);
  assert.equal(readLaunchToken(storage), token);
  assert.equal(clearLaunchToken(storage), "");
  assert.equal(readLaunchToken(storage), "");
});

test("rejects malformed or unavailable launch-session storage", () => {
  const storage = memoryStorage();
  storage.setItem("herdr-bridge:launch-token", "not a token\n");
  assert.equal(readLaunchToken(storage), "");
  assert.equal(readLaunchToken({ getItem() { throw new Error("blocked"); } }), "");
  assert.equal(writeLaunchToken(null, "invalid"), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACKNOWLEDGED_COMPLETIONS_STORAGE_KEY,
  readAcknowledgedCompletions,
  writeAcknowledgedCompletions,
} from "../public/completion-preference.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("stores and restores viewed completion identities", () => {
  const storage = memoryStorage();
  writeAcknowledgedCompletions(storage, new Map([
    ["hs_ZGVmYXVsdA~w1:p1", "seq:41"],
  ]));
  assert.deepEqual(
    [...readAcknowledgedCompletions(storage).entries()],
    [["hs_ZGVmYXVsdA~w1:p1", "seq:41"]],
  );
});

test("ignores malformed viewed completion records", () => {
  const storage = memoryStorage({
    [ACKNOWLEDGED_COMPLETIONS_STORAGE_KEY]: JSON.stringify({
      "w1:p1": "wrong",
      "w2:p1": "revision:8",
    }),
  });
  assert.deepEqual(
    [...readAcknowledgedCompletions(storage).entries()],
    [["w2:p1", "revision:8"]],
  );
});

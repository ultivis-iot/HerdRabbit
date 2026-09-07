import assert from "node:assert/strict";
import test from "node:test";
import {
  readInputHistories,
  writeInputHistories,
} from "../public/input-history-preference.js";
import { nextInputHistory } from "../public/ui-model.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("restores the latest sent prompt after the app restarts", () => {
  const storage = memoryStorage();
  const paneId = "hs_ZGVmYXVsdA~w1:p1";
  const histories = new Map([[paneId, ["first prompt", "latest prompt"]]]);

  assert.equal(writeInputHistories(storage, histories), true);
  const restored = readInputHistories(storage);
  const previous = nextInputHistory({
    history: restored.get(paneId),
    cursor: null,
    draft: "",
    currentValue: "",
    direction: "previous",
  });

  assert.equal(previous.handled, true);
  assert.equal(previous.value, "latest prompt");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PANE_PREFERENCE_STORAGE_KEY,
  readPanePreference,
  writePanePreference,
} from "../public/pane-preference.js";
import { selectedPaneIdForSnapshot } from "../public/ui-model.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("restores a stored pane when it still exists in the snapshot", () => {
  const storage = memoryStorage({ [PANE_PREFERENCE_STORAGE_KEY]: "w2:p1" });
  const panes = [{ pane_id: "w1:p1" }, { pane_id: "w2:p1" }];

  assert.equal(
    selectedPaneIdForSnapshot(panes, readPanePreference(storage)),
    "w2:p1",
  );
});

test("stores a selected pane and ignores unavailable browser storage", () => {
  const storage = memoryStorage();
  assert.equal(writePanePreference(storage, "w3:p2"), true);
  assert.equal(readPanePreference(storage), "w3:p2");

  const unavailableStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readPanePreference(unavailableStorage), null);
  assert.equal(writePanePreference(unavailableStorage, "w3:p2"), false);
});

test("rejects malformed stored pane ids", () => {
  assert.equal(
    readPanePreference(memoryStorage({ [PANE_PREFERENCE_STORAGE_KEY]: "" })),
    null,
  );
  assert.equal(
    readPanePreference(memoryStorage({
      [PANE_PREFERENCE_STORAGE_KEY]: "x".repeat(513),
    })),
    null,
  );
});

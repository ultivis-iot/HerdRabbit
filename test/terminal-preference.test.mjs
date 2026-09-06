import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  adjustedTerminalFontSize,
  readTerminalFontSize,
  writeTerminalFontSize,
} from "../public/terminal-preference.js";

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

test("stores and restores the terminal font size", () => {
  const storage = memoryStorage();
  assert.equal(readTerminalFontSize(storage), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(writeTerminalFontSize(storage, 15), true);
  assert.equal(readTerminalFontSize(storage), 15);
});

test("bounds terminal font size adjustments", () => {
  assert.equal(adjustedTerminalFontSize(12, "smaller"), 11);
  assert.equal(adjustedTerminalFontSize(12, "larger"), 13);
  assert.equal(
    adjustedTerminalFontSize(MIN_TERMINAL_FONT_SIZE, "smaller"),
    MIN_TERMINAL_FONT_SIZE,
  );
  assert.equal(
    adjustedTerminalFontSize(MAX_TERMINAL_FONT_SIZE, "larger"),
    MAX_TERMINAL_FONT_SIZE,
  );
});

test("falls back safely for malformed or unavailable preferences", () => {
  assert.equal(
    readTerminalFontSize(memoryStorage({
      [TERMINAL_FONT_SIZE_STORAGE_KEY]: "not-a-size",
    })),
    DEFAULT_TERMINAL_FONT_SIZE,
  );
  assert.equal(readTerminalFontSize({ getItem() { throw new Error("blocked"); } }), 12);
  assert.equal(writeTerminalFontSize(null, 14), false);
});

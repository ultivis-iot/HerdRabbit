import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { terminalPinchDirection } from "../public/ui-model.js";

const appSource = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

test("shrinks and grows terminal text from a two-finger pinch", () => {
  assert.equal(terminalPinchDirection(120, 100), "smaller");
  assert.equal(terminalPinchDirection(100, 120), "larger");
  assert.equal(terminalPinchDirection(100, 104), null);
});

test("wires a non-passive two-finger gesture to the terminal", () => {
  assert.match(appSource, /terminalOutput\.addEventListener\("touchstart"/);
  assert.match(appSource, /terminalOutput\.addEventListener\("touchmove"/);
  assert.match(appSource, /\{ passive: false \}/);
});

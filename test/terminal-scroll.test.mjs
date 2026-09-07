import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nearTerminalBottom } from "../public/ui-model.js";

const appSource = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

test("treats the view as following the bottom within a line of the end", () => {
  assert.equal(
    nearTerminalBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }),
    true,
  );
  assert.equal(
    nearTerminalBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 100 }),
    false,
  );
});

test("scales the bottom threshold with zoomed terminal text", () => {
  // A single 40px line would fall outside a fixed 40px threshold and silently
  // switch following off.
  const zoomed = { scrollTop: 855, scrollHeight: 1000, clientHeight: 100, lineHeight: 40 };
  assert.equal(nearTerminalBottom(zoomed), true);
  assert.equal(nearTerminalBottom({ ...zoomed, lineHeight: 0 }), false);
});

test("ignores a nonsensical line height instead of following nothing", () => {
  const view = { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 };
  assert.equal(nearTerminalBottom({ ...view, lineHeight: Number.NaN }), true);
  assert.equal(nearTerminalBottom({ ...view, lineHeight: "tall" }), true);
});

test("keeps following the bottom as a state instead of re-deriving it per poll", () => {
  // A single mis-measured poll used to turn following off for good.
  assert.match(appSource, /terminalFollow: true,/);
  assert.match(appSource, /state\.terminalFollow = nearTerminalBottom\(/);
  assert.doesNotMatch(appSource, /const nearBottom =/);
});

test("restores the scroll position that replaceChildren clamps away", () => {
  const scrollHandling = appSource.match(
    /if \(loadOlder\) \{[\s\S]*?elements\.terminalOutput\.scrollTop = previousScrollTop;\s*\}/,
  )?.[0] || "";
  assert.match(scrollHandling, /\} else if \(state\.terminalFollow\) \{/);
  assert.match(
    scrollHandling,
    /elements\.terminalOutput\.scrollTop = elements\.terminalOutput\.scrollHeight;/,
  );
  assert.match(
    scrollHandling,
    /\} else \{[\s\S]*?scrollTop = previousScrollTop;/,
    "a mid-scroll view must keep its position across a re-render",
  );
});

test("returns to the bottom when the selected pane changes", () => {
  const matches = appSource.match(/state\.terminalFollow = true;/g) || [];
  assert.ok(
    matches.length >= 2,
    "both pane-selection paths must reset following",
  );
});

test("only the reader's own gestures stop the view following the bottom", () => {
  // An on-screen keyboard resizes the viewport, which scrolls the terminal
  // without anyone asking. Treating that as a scroll away from the bottom left
  // new output — including Claude's option prompts — off screen.
  assert.match(appSource, /const TERMINAL_USER_SCROLL_WINDOW_MS = 1_000;/);
  assert.match(appSource, /function markTerminalUserScroll\(\)/);
  assert.match(
    appSource,
    /for \(const gesture of \["wheel", "touchmove"\]\)/,
  );
  assert.match(
    appSource,
    /const readerDriven = state\.terminalPointerActive \|\|\s+Date\.now\(\) - state\.terminalUserScrollAt < TERMINAL_USER_SCROLL_WINDOW_MS;/,
  );
  assert.match(appSource, /if \(readerDriven\) \{\s+state\.terminalFollow = nearTerminalBottom\(/);
});

test("returns to the bottom after sending input", () => {
  // Whoever just sent something wants to see what it produced.
  assert.match(
    appSource,
    /state\.outputBurstUntil = Date\.now\(\) \+ OUTPUT_SUBMISSION_BURST_MS;\s+state\.terminalFollow = true;\s+state\.terminalScrollSettlesAt = 0;/,
  );
});

test("leaves the view alone until scrolling settles", () => {
  // Momentum scrolling keeps firing scroll events after the finger is gone;
  // re-rendering during that window yanks the view back.
  assert.match(appSource, /const TERMINAL_SCROLL_SETTLE_MS = 350;/);
  assert.match(
    appSource,
    /if \(!state\.terminalFollow\) \{\s+state\.terminalScrollSettlesAt = Date\.now\(\) \+ TERMINAL_SCROLL_SETTLE_MS;/,
    "only the reader's own scrolling should hold back rendering",
  );
  assert.match(
    appSource,
    /scrolling: Date\.now\(\) < state\.terminalScrollSettlesAt,/,
  );
});

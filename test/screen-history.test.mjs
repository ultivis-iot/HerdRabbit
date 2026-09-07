import test from "node:test";
import assert from "node:assert/strict";
import {
  ScreenHistoryStore,
  frameAlignment,
  screenRows,
  scrolledOffRows,
} from "../src/screen-history.mjs";

// A Claude frame: conversation rows above a fixed composer box at the bottom.
function frame(...rows) {
  return [...rows, "╭──────╮", "│ >    │", "╰──────╯"].join("\n");
}

test("aligns consecutive alternate-screen frames on the rows that moved up", () => {
  const previous = screenRows(frame("line 1", "line 2", "line 3"));
  const next = screenRows(frame("line 2", "line 3", "line 4"));

  // The composer box sits at the bottom of both frames, so the previous frame
  // is never a prefix of the next one.
  assert.deepEqual(frameAlignment(previous, next), { start: 1, matched: 2 });
  assert.deepEqual(scrolledOffRows(previous, next), ["line 1"]);
});

test("commits nothing while the screen is unchanged", () => {
  const rows = screenRows(frame("line 1", "line 2"));
  assert.deepEqual(scrolledOffRows(rows, rows), []);
});

test("commits nothing when two frames cannot be aligned", () => {
  // A screen switch and an out-of-order frame look identical from here.
  // Committing the previous frame would duplicate what the screen still shows.
  const previous = screenRows(frame("line 1", "line 2"));
  const next = screenRows("$ ls\nREADME.md");
  assert.deepEqual(scrolledOffRows(previous, next), []);
});

test("never commits the part of the frame that is still on screen", () => {
  // A burst of output can leave no overlapping conversation rows at all, but
  // the composer box is still there and must not pile up in the history.
  const store = new ScreenHistoryStore();
  store.observe("w1:p1", frame("line 1", "line 2"));
  const history = store.observe("w1:p1", frame("line 2", "line 3"));

  assert.deepEqual(history, ["line 1"]);
  assert.equal(history.filter((row) => row.startsWith("╭")).length, 0);
});

test("does not accept blank rows alone as an overlap", () => {
  assert.deepEqual(scrolledOffRows(["alpha", "", ""], ["", "", "beta"]), []);
});

test("ignores trailing spaces and ANSI styling when matching rows", () => {
  const previous = ["line 1", "[32mline 2[0m", "line 3   "];
  const next = ["line 2", "line 3", "line 4"];
  assert.deepEqual(scrolledOffRows(previous, next), ["line 1"]);
});

test("accumulates the scrollback Herdr cannot provide for a pane", () => {
  const store = new ScreenHistoryStore();

  assert.deepEqual(store.observe("w1:p1", frame("line 1", "line 2", "line 3")), []);
  assert.deepEqual(
    store.observe("w1:p1", frame("line 2", "line 3", "line 4")),
    ["line 1"],
  );
  assert.deepEqual(
    store.observe("w1:p1", frame("line 3", "line 4", "line 5")),
    ["line 1", "line 2"],
  );
  assert.deepEqual(store.historyRows("w1:p1"), ["line 1", "line 2"]);
});

test("keeps panes independent", () => {
  const store = new ScreenHistoryStore();
  store.observe("w1:p1", frame("a1", "a2"));
  store.observe("w2:p1", frame("b1", "b2"));
  store.observe("w1:p1", frame("a2", "a3"));

  assert.deepEqual(store.historyRows("w1:p1"), ["a1"]);
  assert.deepEqual(store.historyRows("w2:p1"), []);
});

test("drops the oldest rows past the per-pane limit", () => {
  const store = new ScreenHistoryStore({ maxRowsPerPane: 2 });
  for (let index = 1; index <= 5; index += 1) {
    store.observe("w1:p1", frame(`line ${index}`, `line ${index + 1}`));
  }
  assert.deepEqual(store.historyRows("w1:p1"), ["line 3", "line 4"]);
});

test("evicts the least recently polled pane", () => {
  const store = new ScreenHistoryStore({ maxPanes: 2 });
  store.observe("w1:p1", frame("a1", "a2"));
  store.observe("w2:p1", frame("b1", "b2"));
  store.observe("w1:p1", frame("a2", "a3"));
  store.observe("w3:p1", frame("c1", "c2"));

  assert.deepEqual(store.historyRows("w1:p1"), ["a1"]);
  assert.deepEqual(store.historyRows("w2:p1"), []);
});

test("never keeps rows in the history that the screen still shows", () => {
  const store = new ScreenHistoryStore();
  store.observe("w1:p1", frame("line 1", "line 2", "line 3"));
  const history = store.observe("w1:p1", frame("line 2", "line 3", "line 4"));

  const onScreen = new Set(
    frame("line 2", "line 3", "line 4").split("\n").filter((row) => row.trim() !== ""),
  );
  assert.deepEqual(history.filter((row) => onScreen.has(row)), []);
});

test("does not duplicate rows when frames arrive out of order", () => {
  // Two viewers polling the same pane can deliver an older frame after a newer
  // one. Without the on-screen check that used to leave the screen's own rows
  // sitting in the history, so the browser rendered them twice.
  const store = new ScreenHistoryStore();
  const older = frame("line 1", "line 2", "line 3");
  const newer = frame("line 2", "line 3", "line 4");

  store.observe("w1:p1", older);
  store.observe("w1:p1", newer);
  const history = store.observe("w1:p1", older);

  const currentRows = older.split("\n").filter((row) => row.trim() !== "");
  const combined = [...history, ...currentRows];
  const meaningful = combined.filter((row) => row.trim() !== "");
  assert.equal(
    meaningful.length,
    new Set(meaningful).size,
    `duplicated rows in ${JSON.stringify(combined)}`,
  );
});

test("commits nothing when the screen only grew", () => {
  // The previous frame is still fully visible, just with a row added below it.
  const store = new ScreenHistoryStore();
  store.observe("w1:p1", "alpha\nbravo\ncharlie");
  const history = store.observe("w1:p1", "alpha\nbravo\ncharlie\ndelta");

  assert.deepEqual(history, []);
});

test("stops reconstructing once a pane turns out to have real scrollback", () => {
  const store = new ScreenHistoryStore({ maxFrameRows: 10 });
  store.observe("w1:p1", frame("line 1", "line 2"));
  store.observe("w1:p1", frame("line 2", "line 3"));
  assert.deepEqual(store.historyRows("w1:p1"), ["line 1"]);

  // Herdr answered with a full scrollback window, so the reconstruction is both
  // redundant and would be prepended to output that already contains it.
  const scrollback = Array.from({ length: 40 }, (_, index) => `row ${index}`).join("\n");
  assert.deepEqual(store.observe("w1:p1", scrollback), []);
  assert.deepEqual(store.historyRows("w1:p1"), []);
});

test("does not block the event loop on an oversized frame", () => {
  // Aligning two frames is O(n*m). Without the frame cap, 100,000 uniform rows
  // took over twenty seconds of synchronous CPU time.
  const store = new ScreenHistoryStore();
  const huge = Array.from({ length: 100_000 }, () => "   ").join("\n");
  const startedAt = process.hrtime.bigint();
  store.observe("w1:p1", huge);
  store.observe("w1:p1", huge);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  assert.ok(elapsedMs < 1_000, `oversized frames took ${elapsedMs.toFixed(0)}ms`);
  assert.deepEqual(store.historyRows("w1:p1"), []);
});

test("reads rows without inventing a trailing blank line", () => {
  assert.deepEqual(screenRows(""), []);
  assert.deepEqual(screenRows("one\ntwo\n"), ["one", "two"]);
  assert.deepEqual(screenRows("one\r\n"), ["one"]);
});

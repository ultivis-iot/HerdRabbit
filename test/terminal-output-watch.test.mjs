import test from "node:test";
import assert from "node:assert/strict";
import { terminalOutputWatcher } from "../src/terminal-output-watch.mjs";
import { outputReadLines, outputWindow } from "../src/http-server.mjs";
import { scrollbackThatTrims } from "./fixtures/short-scrollback.mjs";

test("a watched window says older rows exist even when herdr answers short", async () => {
  const read = scrollbackThatTrims(1_000);
  const watcher = terminalOutputWatcher({
    herdr: { async readPane(_paneId, { lines }) { return read(lines); } },
    outputWindow, outputReadLines, activeMs: 5, idleMs: 10,
  });
  const frames = [];
  const close = watcher.watch("w1:p1", 200, frame => frames.push(frame), error => { throw error; });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(frames[0].hasMore, true);
  } finally { close(); }
});

test("viewers share output observation, unchanged reads send nothing, and closing stops observation", async () => {
  let text = "first";
  let reads = 0;
  const watcher = terminalOutputWatcher({ herdr: { async readPane() { reads++; return text; } },
    outputWindow, outputReadLines, activeMs: 5, idleMs: 10 });
  const first = [], second = [];
  const failure = error => { throw error; };
  const closeFirst = watcher.watch("w1:p1", 200, frame => first.push(frame), failure);
  const closeSecond = watcher.watch("w1:p1", 200, frame => second.push(frame), failure);
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(first.length, 1);
    assert.deepEqual(second, first);
    text = "first changed";
    watcher.input("w1:p1");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(first.length, 2);
    assert.deepEqual(second, first);
  } finally { closeFirst(); closeSecond(); }
  const stoppedAt = reads;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(reads, stoppedAt);
});

import test from "node:test";
import assert from "node:assert/strict";
import { compositionEdit, terminalInputQueue } from "../public/direct-terminal-input.js";

test("Hangul composition edits only the revised suffix and does not repeat committed text", () => {
  assert.equal(compositionEdit("", "ㅎ"), "ㅎ");
  assert.equal(compositionEdit("ㅎ", "하"), "\x7f하");
  assert.equal(compositionEdit("하", "한"), "\x7f한");
  assert.equal(compositionEdit("한", "한ㄱ"), "ㄱ");
  assert.equal(compositionEdit("한ㄱ", "한그"), "\x7f그");
  assert.equal(compositionEdit("한그", "한글"), "\x7f글");
  assert.equal(compositionEdit("한글", "한글"), "");
  assert.equal(compositionEdit("한글", "한"), "\x7f");
  assert.equal(compositionEdit("ㅎ", ""), "\x7f");
});

test("direct input preserves text/key order and batches only adjacent text for the same pane", async () => {
  const sent = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = terminalInputQueue({ async send(item) {
    sent.push(item);
    if (sent.length === 1) await gate;
  } });
  queue.enqueue({ paneId: "w1:p1", text: "/" });
  await Promise.resolve();
  queue.enqueue({ paneId: "w1:p1", text: "he" });
  queue.enqueue({ paneId: "w1:p1", text: "lp" });
  queue.enqueue({ paneId: "w1:p1", keys: ["tab"] });
  queue.enqueue({ paneId: "w2:p1", text: "한글" });
  assert.equal(sent.length, 1);
  release();
  await queue.idle();
  assert.deepEqual(sent, [
    { paneId: "w1:p1", text: "/" }, { paneId: "w1:p1", text: "help" },
    { paneId: "w1:p1", keys: ["tab"] }, { paneId: "w2:p1", text: "한글" },
  ]);
});

test("an uncertain write is not retried and discards following Enter until explicitly resumed", async () => {
  const sent = [];
  const errors = [];
  const queue = terminalInputQueue({ async send(item) {
    sent.push(item);
    if (sent.length === 1) throw new Error("disconnected");
  }, onError(error) { errors.push(error.message); } });
  queue.enqueue({ paneId: "w1:p1", text: "command" });
  queue.enqueue({ paneId: "w1:p1", keys: ["enter"] });
  await queue.idle();
  assert.equal(sent.length, 1);
  assert.deepEqual(errors, ["disconnected"]);
  assert.equal(queue.enqueue({ paneId: "w1:p1", text: "discarded" }), false);
  queue.resume();
  queue.enqueue({ paneId: "w2:p1", text: "new" });
  await queue.idle();
  assert.equal(sent.length, 2);
});

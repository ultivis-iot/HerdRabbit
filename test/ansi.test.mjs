import test from "node:test";
import assert from "node:assert/strict";
import { ansiToSegments } from "../public/ansi.js";

test("preserves standard, indexed and true-color SGR styles", () => {
  assert.deepEqual(ansiToSegments("plain \x1b[1;31mred\x1b[0m \x1b[38;5;2mgreen\x1b[38;2;1;2;3mrgb"), [
    { text: "plain ", bold: false, dim: false, italic: false, underline: false, inverse: false, foreground: null, background: null },
    { text: "red", bold: true, dim: false, italic: false, underline: false, inverse: false, foreground: "#ff8080", background: null },
    { text: " ", bold: false, dim: false, italic: false, underline: false, inverse: false, foreground: null, background: null },
    { text: "green", bold: false, dim: false, italic: false, underline: false, inverse: false, foreground: "#99ffe4", background: null },
    { text: "rgb", bold: false, dim: false, italic: false, underline: false, inverse: false, foreground: "#010203", background: null },
  ]);
});

test("drops non-SGR terminal controls and unsafe control bytes", () => {
  const segments = ansiToSegments("before\x1b]0;title\x07after\x1b[2J!\x00");
  assert.equal(segments.map((segment) => segment.text).join(""), "beforeafter!");
});

test("bounds segment count while retaining visible text", () => {
  const segments = ansiToSegments("a\x1b[31mb\x1b[32mc\x1b[33md", { maxSegments: 2 });
  assert.equal(segments.length, 2);
  assert.equal(segments.map((segment) => segment.text).join(""), "abcd");
});

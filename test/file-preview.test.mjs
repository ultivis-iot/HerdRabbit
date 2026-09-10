import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TEXT_PREVIEW_BYTES,
  inlineTypeFor,
  parseByteRange,
  previewFor,
} from "../public/file-preview.js";

test("hands the browser a type only for formats that cannot execute", () => {
  // The whole reason downloads are octet-stream attachments is that a stored
  // page or SVG rendered at this origin sits inside the session it could steal.
  // The viewer opens a second door, so the list it opens for is the point.
  assert.deepEqual(previewFor("shot.png"), { kind: "image", type: "image/png" });
  assert.deepEqual(previewFor("clip.MP4"), { kind: "video", type: "video/mp4" });
  assert.deepEqual(previewFor("note.m4a"), { kind: "audio", type: "audio/mp4" });

  // Absent on purpose: both are images to a browser and both can run script.
  assert.equal(inlineTypeFor("logo.svg"), null);
  assert.equal(inlineTypeFor("page.html"), null);
  assert.equal(inlineTypeFor("page.htm"), null);
});

test("shows markup as characters instead of refusing it", () => {
  // Text never asks for a content type -- it is read as bytes and written into
  // the page -- so the dangerous formats are still readable, just not runnable.
  assert.deepEqual(previewFor("logo.svg"), { kind: "text", type: null });
  assert.deepEqual(previewFor("page.html"), { kind: "text", type: null });
  assert.equal(previewFor("server.log").kind, "text");
  assert.equal(previewFor(".gitignore").kind, "text");
  assert.equal(previewFor("Dockerfile").kind, "text");
});

test("offers nothing for a file it has no name for", () => {
  assert.equal(previewFor("archive.zip"), null);
  assert.equal(previewFor("herdr"), null);
  assert.equal(previewFor(""), null);
  assert.equal(previewFor(null), null);
  // The last dot decides, so a name that ends in a known one still counts.
  assert.equal(previewFor("release.tar.gz"), null);
  assert.equal(previewFor("photo.tar.png").kind, "image");
});

test("keeps a text view from swallowing a file the tab cannot render", () => {
  assert.equal(previewFor("huge.log", MAX_TEXT_PREVIEW_BYTES + 1), null);
  assert.equal(previewFor("huge.log", MAX_TEXT_PREVIEW_BYTES).kind, "text");
  // A media file is streamed, not held, so its size is not this check's business.
  assert.equal(previewFor("film.mp4", 5e9).kind, "video");
});

test("reads the one range form a player actually sends", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-200", 1000), { start: 800, end: 999 });
  // Past the end is clamped, not refused: a player guessing long is normal.
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
});

test("separates a range it cannot satisfy from one it cannot read", () => {
  // Unsatisfiable earns a 416; unreadable is treated as no range at all, which
  // is what RFC 9110 asks for -- the whole file is a correct answer there.
  assert.deepEqual(parseByteRange("bytes=1000-", 1000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=300-100", 1000), { unsatisfiable: true });
  assert.equal(parseByteRange("bytes=0-99, 200-299", 1000), null);
  assert.equal(parseByteRange("items=0-99", 1000), null);
  assert.equal(parseByteRange("bytes=-", 1000), null);
  assert.equal(parseByteRange(undefined, 1000), null);
  // Nothing is known about the length, so nothing can be sliced out of it.
  assert.equal(parseByteRange("bytes=0-99", null), null);
});

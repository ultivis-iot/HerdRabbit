import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const iconUrl = new URL("../public/icons/favicon.svg", import.meta.url);
const appIconUrl = new URL("../public/icons/app-icon.svg", import.meta.url);

test("favicon fills its canvas and keeps a thin face-free rabbit outline", async () => {
  const svg = await readFile(iconUrl, "utf8");

  assert.match(svg, /<rect width="64" height="64" fill="#090c0f" \/>/);
  assert.doesNotMatch(svg, /\brx=/);
  assert.match(svg, /stroke-width="3"/);
  assert.doesNotMatch(svg, /<(?:circle|ellipse|line)\b/);
});

test("PWA icon keeps the rabbit inside a mask-safe scale", async () => {
  const svg = await readFile(appIconUrl, "utf8");

  assert.match(svg, /<rect width="64" height="64" fill="#090c0f" \/>/);
  assert.match(svg, /scale\(\.72\)/);
  assert.doesNotMatch(svg, /\brx=/);
  assert.doesNotMatch(svg, /<(?:circle|ellipse|line)\b/);
});

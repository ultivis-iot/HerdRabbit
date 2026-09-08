import test from "node:test";
import assert from "node:assert/strict";
import { ansiToSegments } from "../public/ansi.js";
import { linkTerminalSegments } from "../public/terminal-links.js";

const parse = (text) => linkTerminalSegments(ansiToSegments(text));

test("links complete URLs across ANSI styles while preserving text and color", () => {
  const parts = parse("Visit https://example.com/\x1b[32mpath?q=1&x=2\x1b[0m now");
  const links = parts.filter((part) => part.href);
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://example.com/path?q=1&x=2");
  assert.equal(links[1].href, links[0].href);
  assert.equal(links[1].linkStart, links[0].linkStart);
  assert.equal(links[1].foreground, "#99ffe4");
  assert.equal(parts.map((part) => part.text).join(""), "Visit https://example.com/path?q=1&x=2 now");
});

test("excludes surrounding punctuation and retains balanced URL parentheses", () => {
  const parts = parse("(https://example.com/wiki/Test_(one)). http://localhost:3000/a, https://[::1]:8080/");
  assert.deepEqual(parts.filter((part) => part.href).map((part) => part.href), [
    "https://example.com/wiki/Test_(one)", "http://localhost:3000/a", "https://[::1]:8080/",
  ]);
});

test("keeps executable schemes, HTML, and incomplete URLs as text", () => {
  const text = 'javascript:alert(1) data:text/html,test file:///tmp/test https:// <img src=x onerror=alert(1)>';
  const parts = parse(text);
  assert.equal(parts.some((part) => part.href), false);
  assert.equal(parts.map((part) => part.text).join(""), text);
});

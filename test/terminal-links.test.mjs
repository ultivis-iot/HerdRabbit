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

const viewable = (raw) => /\.(?:md|png|log|mjs|js)$/u.test(raw);
const paths = (text) => [...new Set(
  linkTerminalSegments(ansiToSegments(text), { isViewablePath: viewable })
    .filter((part) => part.path).map((part) => part.path),
)];

test("links the files an agent names, in the forms it names them", () => {
  // "wrote src/api.mjs" is how this gets written far more often than with a
  // leading ./, so the bare form has to count as a path.
  assert.deepEqual(paths("wrote src/api.mjs and ./docs/plan.md."), ["src/api.mjs", "./docs/plan.md"]);
  assert.deepEqual(paths("see /home/me/shot.png here"), ["/home/me/shot.png"]);
  assert.deepEqual(paths('"public/app.js" 를 고쳤다'), ["public/app.js"]);
  // A file and a line is one reference; the line number is not part of the name.
  assert.deepEqual(paths("test/ui-model.test.mjs:370 에서"), ["test/ui-model.test.mjs"]);
});

test("leaves alone the path-shaped words terminal output is full of", () => {
  // Underlining every one of these would underline half the screen. Needing a
  // name the viewer recognises is what keeps them plain.
  assert.deepEqual(paths("cd /usr/bin && ls node_modules/ build/"), []);
  assert.deepEqual(paths("README.md has no slash"), []);
  assert.deepEqual(paths("a/b/c.zip is not shown here"), []);
});

test("a URL that contains a path is still one address", () => {
  const parts = linkTerminalSegments(ansiToSegments("https://x.example/a.md 는 주소"), { isViewablePath: viewable });
  assert.deepEqual([...new Set(parts.filter((part) => part.path).map((part) => part.path))], []);
  assert.equal(parts.find((part) => part.href)?.href, "https://x.example/a.md");
});

test("finds no paths at all unless it is told what can be shown", () => {
  // The default keeps every existing caller -- and every test above this one --
  // seeing exactly the links it saw before.
  const parts = linkTerminalSegments(ansiToSegments("wrote src/api.mjs"));
  assert.equal(parts.some((part) => part.path), false);
});

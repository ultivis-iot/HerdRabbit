import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = (await Promise.all(["../public/ui/tokens.css", "../public/ui/base.css", "../public/styles.css"].map(
  (path) => readFile(new URL(path, import.meta.url), "utf8"),
))).join("\n");

test("the page is flat in both themes", () => {
  // A glow behind the page was transparent in the dark theme and green in the
  // light one, where it tinted the sidebar and the sign-in screen.
  assert.doesNotMatch(styles, /body-glow|radial-gradient/u);
  assert.match(styles, /body \{\s*margin: 0;\s*background: var\(--page\);\s*\}/u);
  assert.match(styles, /\.login-screen \{[^}]*background: var\(--page\);/u);
});

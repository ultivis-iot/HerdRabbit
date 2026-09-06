import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../public/styles.css", import.meta.url),
  "utf8",
);

test("starts the terminal composer at one line and grows it up to five lines", () => {
  assert.match(page, /id="terminal-input"[\s\S]*?rows="1"/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?max-height: calc\(7\.5em \+ 24px\)/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?resize: none/);
  assert.match(appSource, /function resizeTerminalInput\(\)/);
  assert.match(
    appSource,
    /terminalInput\.addEventListener\("input", \(\) => \{\s+resizeTerminalInput\(\)/,
  );
  assert.match(appSource, /contentHeight > nextHeight \? "auto" : "hidden"/);
});

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

test("grows the terminal composer without measuring layout inside the input event", () => {
  const scheduledResizeSource = appSource.match(
    /function scheduleTerminalInputResize\(\) \{[\s\S]*?\n\}\n\nfunction touchDistance/,
  )?.[0] || "";
  assert.match(page, /id="terminal-input"[\s\S]*?rows="1"/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?max-height: calc\(7\.5em \+ 24px\)/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?resize: none/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?field-sizing: content/);
  assert.match(styles, /\.input-form textarea \{[\s\S]*?overflow-y: auto/);
  assert.match(appSource, /function supportsNativeTerminalInputSizing\(\)/);
  assert.match(appSource, /function resizeTerminalInput\(\)/);
  assert.match(appSource, /function scheduleTerminalInputResize\(\)/);
  assert.match(
    appSource,
    /terminalInput\.addEventListener\("input", \(\) => \{[\s\S]*?scheduleTerminalInputResize\(\)/,
  );
  assert.doesNotMatch(
    appSource,
    /terminalInput\.addEventListener\("input", \(\) => \{\s+resizeTerminalInput\(\)/,
  );
  assert.match(
    appSource,
    /if \(usesTouchInputEnvironment\(\)\) \{\s+resizeTerminalInput\(\);\s+\} else \{[\s\S]*?scheduleTerminalInputResize\(\)/,
  );
  assert.match(appSource, /const COMPOSER_RESIZE_DELAY_MS = 300/);
  assert.match(
    appSource,
    /window\.setTimeout\([\s\S]*?COMPOSER_RESIZE_DELAY_MS\)/,
  );
  assert.doesNotMatch(
    scheduledResizeSource,
    /refreshOutput\(\)/,
  );
  // Typing must not hold back terminal output: the composer is a separate
  // element, so re-rendering the terminal does not disturb it.
  assert.doesNotMatch(appSource, /composerActive/);
  assert.match(appSource, /contentHeight > nextHeight \? "auto" : "hidden"/);
});

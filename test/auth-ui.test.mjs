import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(
  new URL("../public/styles.css", import.meta.url),
  "utf8",
);

test("keeps the password screen hidden when authentication is disabled", () => {
  assert.match(
    styles,
    /\.login-screen\[hidden\]\s*\{[\s\S]*?display:\s*none/,
  );
});

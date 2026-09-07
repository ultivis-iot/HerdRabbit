import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const themeSource = await readFile(
  new URL("../public/theme.js", import.meta.url),
  "utf8",
);

test("applies the stored terminal font size before the app module starts", () => {
  const properties = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
    },
  };
  const media = {
    matches: true,
    addEventListener() {},
  };
  const window = {
    localStorage: {
      getItem(key) {
        return key === "herdrbridge-terminal-font-size" ? "15" : null;
      },
    },
    matchMedia() {
      return media;
    },
    dispatchEvent() {},
  };
  const document = {
    documentElement: root,
    querySelector() {
      return null;
    },
  };

  vm.runInNewContext(themeSource, {
    window,
    document,
    CustomEvent: class CustomEvent {},
  });

  assert.equal(properties.get("--terminal-font-size"), "15px");
});

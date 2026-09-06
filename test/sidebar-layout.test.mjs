import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(
  new URL("../public/styles.css", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

function cssPixels(pattern, label) {
  const match = styles.match(pattern);
  assert.ok(match, `${label} CSS value must exist`);
  return Number(match[1]);
}

test("centers the connection indicator in the collapsed sidebar rail", () => {
  const navigatorWidth = cssPixels(
    /\.navigator \{[\s\S]*?width: ([0-9.]+)px/,
    "navigator width",
  );
  const collapsedShift = Math.abs(cssPixels(
    /body\.sidebar-collapsed \.navigator \{[\s\S]*?translateX\((-?[0-9.]+)px\)/,
    "collapsed navigator shift",
  ));
  const indicatorWidth = cssPixels(
    /\.connection \{[\s\S]*?width: ([0-9.]+)px/,
    "connection indicator width",
  );
  const footerRightPadding = cssPixels(
    /body\.sidebar-collapsed \.navigator-footer \{[\s\S]*?padding: [0-9.]+px ([0-9.]+)px/,
    "collapsed footer horizontal padding",
  );

  const railCenter = collapsedShift + (navigatorWidth - collapsedShift) / 2;
  const indicatorCenter = navigatorWidth - footerRightPadding - indicatorWidth / 2;
  assert.equal(indicatorCenter, railCenter);
});

test("uses the same fillable Herdr icon to toggle the sidebar", () => {
  assert.equal((page.match(/id="sidebar-toggle"/g) || []).length, 1);
  assert.doesNotMatch(page, /sidebar-toggle-symbol/);
  assert.match(page, /class="sidebar-toggle-mark"/);
  assert.match(
    styles,
    /\.sidebar-toggle:hover \.sidebar-toggle-mark path,[\s\S]*?fill: currentColor/,
  );
  assert.match(page, /class="mobile-sidebar-mark"/);
  assert.doesNotMatch(page, /M5 7h14M5 12h14M5 17h14/);
  assert.match(
    styles,
    /\.mobile-sidebar-open:hover \.mobile-sidebar-mark path,[\s\S]*?fill: currentColor/,
  );
});

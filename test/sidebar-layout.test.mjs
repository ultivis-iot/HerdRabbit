import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(
  new URL("../public/styles.css", import.meta.url),
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

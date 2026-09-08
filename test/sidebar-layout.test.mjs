import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = (await Promise.all(["../public/ui/components.css", "../public/styles.css"].map(
  path => readFile(new URL(path, import.meta.url), "utf8"),
))).join("\n");
const page = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const app = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

function cssPixels(pattern, label) {
  const match = styles.match(pattern);
  assert.ok(match, `${label} CSS value must exist`);
  return Number(match[1]);
}

test("centers the connection indicator in the collapsed sidebar rail", () => {
  const navigatorWidth = cssPixels(
    /:is\(\.navigator, \.ui-sidebar\) \{[\s\S]*?width: ([0-9.]+)px/,
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

test("removes the empty heading action slot when the sidebar is collapsed", () => {
  assert.match(
    styles,
    /body\.sidebar-collapsed \.navigator-heading-actions \{[\s\S]*?display: none/,
  );
});

test("emphasizes unread completions in session rows and collapsed projects", () => {
  assert.match(app, /button\.dataset\.status = currentAgentStatus/);
  assert.match(app, /group\.dataset\.hasCompletion/);
  assert.match(
    styles,
    /:is\(\.pane-button, \.ui-nav-item\)\[data-status="done"\] \{[\s\S]*?border-color:[\s\S]*?background:[\s\S]*?box-shadow:/,
  );
  assert.match(
    styles,
    /\.workspace-group\.is-collapsed\[data-has-completion="true"\] > \.workspace-heading/,
  );
});

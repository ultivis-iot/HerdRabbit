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
  // The sidebar width is adjustable now, so the rail is measured from its own
  // constant rather than from a fixed collapsed offset.
  const rail = cssPixels(/--sidebar-rail: ([0-9.]+)px/u, "sidebar rail width");
  const indicatorWidth = cssPixels(
    /\.connection \{[\s\S]*?width: ([0-9.]+)px/,
    "connection indicator width",
  );
  const footerRightPadding = cssPixels(
    /body\.sidebar-collapsed \.navigator-footer \{[\s\S]*?padding: [0-9.]+px ([0-9.]+)px/,
    "collapsed footer horizontal padding",
  );

  // Measured from the sidebar's right edge, which is where the rail sits after
  // the collapse shift, whatever the expanded width happens to be.
  assert.equal(footerRightPadding + indicatorWidth / 2, rail / 2);
});

test("slides the collapsed sidebar by its own width, not a fixed distance", () => {
  for (const pattern of [
    /body\.sidebar-collapsed \.navigator \{[\s\S]*?var\(--navigator-width/,
    /body\.sidebar-collapsed \.terminal-panel \{[\s\S]*?var\(--navigator-width/,
    /body\.sidebar-collapsed \.shell \{[\s\S]*?var\(--navigator-width/,
    /\.shell \{[\s\S]*?grid-template-columns: var\(--navigator-width/,
  ]) {
    assert.match(styles, pattern);
  }
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

test("shows the server row even when this machine is the only one", () => {
  // The row's menu is how a machine is managed, AI accounts included, so it
  // cannot wait for a second machine to be linked.
  assert.match(app, /const showServers = servers\.length > 0;/);
  assert.match(app, /label: "AI accounts"[\s\S]*?onSelect: \(\) => showAiAccounts\(server\)/);
});

test("the collapsed rail shows a server as its dot alone", () => {
  // With the server row always drawn, its toggle and menu would sit either
  // side of the dot in the narrow rail.
  const rule = styles.match(/(?:body\.sidebar-collapsed [^{]+,\s*)+body\.sidebar-collapsed \.server-empty \{ display: none; \}/u)?.[0];
  assert.ok(rule, "collapsed server rule must exist");
  for (const part of [".server-heading strong", ".server-heading small", ".server-heading .group-collapse", ".server-heading .server-action-menu"]) {
    assert.ok(rule.includes(`body.sidebar-collapsed ${part}`), `${part} is hidden in the rail`);
  }
  assert.match(styles, /body\.sidebar-collapsed \.server-heading \{ justify-content: center; \}/u);
});

test("the collapsed rail lines session markers up under the server's dot", () => {
  // Expanded, rows are indented under their server and Herdr session headings;
  // in the rail those headings are gone, so the indent must go too.
  assert.match(styles, /\.server-body \{ padding-left: 10px; \}/u);
  assert.match(styles, /\.herdr-session-body \{\s*padding-left: 10px;/u);
  assert.match(styles, /body\.sidebar-collapsed :is\(\.server-body, \.herdr-session-body\) \{ padding-left: 0; \}/u);
});

test("a machine list with nothing in it keeps its message off the border", () => {
  // "Looking…" and "Nothing ready to add yet." sit inside the bordered list,
  // where only rows carried padding.
  assert.match(app, /candidateList\.append\(createElement\("p", \{\s*className: "dialog-feedback"/u);
  assert.match(styles, /\.server-candidates > \.dialog-feedback \{ margin: 0; padding: 9px 11px; \}/u);
});

test("removes the empty heading action slot when the sidebar is collapsed", () => {
  assert.match(
    styles,
    /body\.sidebar-collapsed \.navigator-heading-actions \{[\s\S]*?display: none/,
  );
});

test("keeps sidebar scrolling without visible scrollbars or horizontal overflow", () => {
  assert.match(
    styles,
    /\.navigator-content \{[\s\S]*?overflow-x: hidden;[\s\S]*?scrollbar-width: none;/,
  );
  assert.match(
    styles,
    /\.navigator-content::\-webkit-scrollbar \{[\s\S]*?width: 0;[\s\S]*?height: 0;/,
  );
  assert.match(
    styles,
    /body\.sidebar-collapsed \.pane-copy \{[\s\S]*?display: none;/,
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

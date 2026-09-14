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

test("this machine's dot says whether the page is connected, instead of a footer dot", () => {
  // One dot for this machine, not two that mostly agree.
  assert.doesNotMatch(page, /id="connection-status"|id="connection-dot"/u);
  const set = app.match(/function setConnection\(kind, text\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(set, "setConnection must exist");
  assert.match(set, /state\.connection = \{ kind, text \};/u);
  assert.match(set, /\.server-heading\[data-server-id="local"\]/u);
  assert.match(app, /function serverConnection\(server\) \{\s*if \(server\.id === "local" && state\.connection\.kind === "error"\)/u);
  assert.match(app, /const connection = serverConnection\(server\);/u);
  assert.match(styles, /\.server-heading\.is-error \.server-icon \{ stroke: var\(--danger\); \}/u);
  // With the footer dot gone the rail has no footer at all; its height goes to
  // the sessions.
  assert.match(styles, /body\.sidebar-collapsed \.navigator-footer \{\s*display: none;\s*\}/u);
  // And the footer buttons stay together rather than spreading to both ends.
  assert.match(styles, /:is\(\.navigator-footer, \.ui-sidebar-footer\) \{[^}]*justify-content: space-between;/u);
  assert.match(styles, /\.navigator \.navigator-footer \{\s*grid-row: 4;\s*justify-content: flex-start;\s*\}/u);
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

test("a server's menu lines up with the project menus under it", () => {
  // Both headings end at the list's edge; right padding on one pushed its
  // menu inside the other's.
  // A zero is written without a unit, so the unit is optional on every value.
  const project = styles.match(/\.workspace-heading \{[^}]*padding: \d+(?:px)? (\d+)(?:px)?[ ;]/u);
  const server = styles.match(/\.server-heading \{ display: flex; align-items: center; gap: 8px; padding: \d+(?:px)? (\d+)(?:px)?[ ;]/u);
  assert.ok(project && server, "project and server headings must set their padding");
  assert.equal(server[1], project[1]);
});

test("the collapsed rail shows a server as its dot alone", () => {
  // With the server row always drawn, its toggle and menu would sit either
  // side of the dot in the narrow rail.
  const rule = styles.match(/(?:body\.sidebar-collapsed [^{]+,\s*)+body\.sidebar-collapsed \.server-empty \{ display: none; \}/u)?.[0];
  assert.ok(rule, "collapsed server rule must exist");
  for (const part of [".server-heading strong", ".server-heading small", ".server-heading .group-collapse", ".server-heading .server-action-menu"]) {
    assert.ok(rule.includes(`body.sidebar-collapsed ${part}`), `${part} is hidden in the rail`);
  }
  // The dot takes a session marker's slot, so the rail keeps one pitch.
  const pane = styles.match(/body\.sidebar-collapsed \.pane-button \{[^}]*height: (\d+)px;[^}]*margin: 0 auto (\d+)px;/u);
  const server = styles.match(/body\.sidebar-collapsed \.server-heading \{ justify-content: center; height: (\d+)px; margin-bottom: (\d+)px; padding: 0; \}/u);
  assert.ok(pane && server, "collapsed pane and server slots must be sized");
  assert.deepEqual([server[1], server[2]], [pane[1], pane[2]]);
});

test("the collapsed rail lines session markers up under the server's dot", () => {
  // Expanded, rows are indented under their server and Herdr session headings;
  // in the rail those headings are gone, so the indent must go too.
  assert.match(styles, /body\.sidebar-collapsed :is\(\.server-body, \.herdr-session-body, \.workspace-children-inner\) \{ padding-left: 0; \}/u);
});

test("the sidebar steps in one even level at a time, like the file tree", () => {
  // Every heading starts at the list's edge, so the indent under a heading is
  // the whole distance from its arrow to its children's.
  assert.match(styles, /\.server-heading \{ display: flex; align-items: center; gap: 8px; padding: \d+px 0; \}/u);
  assert.match(styles, /\.herdr-session-heading \{[^}]*padding: 0 \d+px 0 0;/u);
  assert.match(styles, /\.workspace-heading \{[^}]*padding: \d+px 0;/u);
  const step = 10;
  assert.equal(cssPixels(/\.server-body \{ padding-left: (\d+)px; \}/u, "server indent"), step);
  assert.equal(cssPixels(/\.herdr-session-body \{\s*padding-left: (\d+)px;/u, "session indent"), step);
  // A session's marker centres 1px border + 10px padding + half an 18px marker
  // in; a heading's arrow, half a 28px button. The rows make up the difference.
  const project = cssPixels(/\.workspace-children-inner \{[^}]*padding-left: (\d+)px;/u, "project indent");
  assert.equal(project + 1 + 10 + 18 / 2, 28 / 2 + step);
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

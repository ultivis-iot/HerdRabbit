import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY_LINES,
  agentStatus,
  agentStatusIcon,
  compactTerminalSeparators,
  detectTouchInput,
  displayRecordLabel,
  displayTabLabel,
  inputKeyAction,
  insertNewlineAtSelection,
  loginMethodPresentation,
  nextInputHistory,
  nextHistoryLineLimit,
  outputHistoryMode,
  outputPollingDecision,
  outputTextForUpdate,
  paneShortcutTarget,
  selectedPaneIdForSnapshot,
  shouldRenderTerminalUpdate,
  sidebarPresentation,
  terminalOutputForEnvironment,
} from "../public/ui-model.js";

test("cycles through panes with Ctrl+Tab and Ctrl+Shift+Tab", () => {
  const paneIds = ["pane-1", "pane-2", "pane-3"];

  assert.equal(
    paneShortcutTarget({
      key: "Tab",
      ctrlKey: true,
      paneIds,
      currentPaneId: "pane-2",
    }),
    "pane-3",
  );
  assert.equal(
    paneShortcutTarget({
      key: "Tab",
      ctrlKey: true,
      shiftKey: true,
      paneIds,
      currentPaneId: "pane-1",
    }),
    "pane-3",
  );
  assert.equal(
    paneShortcutTarget({
      key: "Tab",
      ctrlKey: true,
      paneIds,
      currentPaneId: "pane-3",
    }),
    "pane-1",
  );
});

test("selects a numbered pane with Ctrl+1 through Ctrl+9", () => {
  const paneIds = ["pane-1", "pane-2", "pane-3"];

  assert.equal(
    paneShortcutTarget({ key: "1", ctrlKey: true, paneIds }),
    "pane-1",
  );
  assert.equal(
    paneShortcutTarget({ key: "3", ctrlKey: true, paneIds }),
    "pane-3",
  );
  assert.equal(
    paneShortcutTarget({ key: "4", ctrlKey: true, paneIds }),
    null,
  );
  assert.equal(
    paneShortcutTarget({ key: "2", paneIds }),
    null,
  );
  assert.equal(
    paneShortcutTarget({ key: "2", ctrlKey: true, altKey: true, paneIds }),
    null,
  );
});

test("uses hybrid terminal history only for Claude agents", () => {
  assert.equal(outputHistoryMode("claude"), "hybrid");
  assert.equal(outputHistoryMode("Claude"), "hybrid");
  assert.equal(outputHistoryMode("codex"), "ansi");
  assert.equal(outputHistoryMode(null), "ansi");
});

test("applies terminal output replacements and ordered delta patches", () => {
  assert.equal(
    outputTextForUpdate("old", { update: "replace", output: "new" }),
    "new",
  );
  assert.equal(
    outputTextForUpdate("Working (30s)", {
      update: "delta",
      patches: [{ start: 10, deleteCount: 1, text: "1" }],
    }),
    "Working (31s)",
  );
  assert.equal(
    outputTextForUpdate("old\nalpha\nbeta", {
      update: "delta",
      patches: [
        { start: 14, deleteCount: 0, text: "\ngamma" },
        { start: 0, deleteCount: 4, text: "" },
      ],
    }),
    "alpha\nbeta\ngamma",
  );
  assert.equal(
    outputTextForUpdate("safe", {
      update: "delta",
      patches: [{ start: 99, deleteCount: 1, text: "broken" }],
    }),
    null,
  );
});

test("slows cellular working output polls and refreshes immediately when work stops", () => {
  assert.deepEqual(
    outputPollingDecision({
      baseIntervalMs: 1_000,
      currentStatus: "working",
      recentSubmission: true,
      connection: { type: "cellular" },
    }),
    { intervalMs: 1_000, refreshNow: false },
  );
  assert.deepEqual(
    outputPollingDecision({
      baseIntervalMs: 1_000,
      previousStatus: "working",
      currentStatus: "working",
      connection: { type: "cellular" },
    }),
    { intervalMs: 5_000, refreshNow: false },
  );
  assert.deepEqual(
    outputPollingDecision({
      baseIntervalMs: 1_000,
      previousStatus: "working",
      currentStatus: "done",
    }),
    { intervalMs: 1_000, refreshNow: true },
  );
  assert.deepEqual(
    outputPollingDecision({
      baseIntervalMs: 1_000,
      previousStatus: "idle",
      currentStatus: "idle",
    }),
    { intervalMs: 1_000, refreshNow: false },
  );
});

test("slows working polls only on a connection that says it is metered", () => {
  const interval = (connection) => outputPollingDecision({
    currentStatus: "working", connection,
  }).intervalMs;
  assert.equal(interval({ type: "wifi" }), 1000);
  assert.equal(interval({ type: "ethernet" }), 1000);
  assert.equal(interval({ type: "cellular" }), 5000);
  assert.equal(interval({ type: "wifi", saveData: true }), 5000);
  // Android rarely reports connection.type. Assuming cellular there left Wi-Fi
  // five seconds behind on every phone.
  assert.equal(interval(null), 1000);
  assert.equal(interval({ effectiveType: "4g" }), 1000);
  const connection = { type: "cellular" };
  assert.equal(interval(connection), 5000);
  connection.type = "wifi";
  assert.equal(interval(connection), 1000);
});

test("makes Passkey the default login method while retaining password fallback", () => {
  assert.deepEqual(
    loginMethodPresentation({ passkeyAvailable: true, passkeySupported: true }),
    {
      passkeyVisible: true,
      passkeyPrimary: true,
      passwordPrimary: false,
      focusTarget: "passkey",
      instruction: "Sign in with a passkey or use your password.",
      passwordLabel: "Password",
    },
  );
  assert.deepEqual(
    loginMethodPresentation({ passkeyAvailable: true, passkeySupported: false }),
    {
      passkeyVisible: false,
      passkeyPrimary: false,
      passwordPrimary: true,
      focusTarget: "password",
      instruction: "Enter your password.",
      passwordLabel: "Password",
    },
  );
});

test("detects phones when the primary pointer media query is unreliable", () => {
  assert.equal(
    detectTouchInput({
      primaryTouch: false,
      anyCoarsePointer: true,
      anyHover: false,
      maxTouchPoints: 5,
      compactViewport: true,
    }),
    true,
  );
  assert.equal(
    detectTouchInput({
      primaryTouch: false,
      anyCoarsePointer: false,
      anyHover: false,
      maxTouchPoints: 5,
      compactViewport: true,
    }),
    true,
  );
  assert.equal(
    detectTouchInput({
      primaryTouch: false,
      anyCoarsePointer: false,
      anyHover: false,
      maxTouchPoints: 0,
      compactViewport: true,
    }),
    false,
  );
  assert.equal(
    detectTouchInput({
      primaryTouch: false,
      anyCoarsePointer: true,
      anyHover: true,
      maxTouchPoints: 10,
      compactViewport: false,
    }),
    false,
  );
  assert.equal(detectTouchInput({ primaryTouch: true }), true);
});

test("compacts terminal box-drawing separators that would wrap on mobile", () => {
  const divider = "─".repeat(212);
  assert.equal(
    compactTerminalSeparators(`위\n${divider}\n아래`),
    `위\n${"─".repeat(24)}\n아래`,
  );
  assert.equal(compactTerminalSeparators("일반 - 텍스트와 짧은 ─── 선"), "일반 - 텍스트와 짧은 ─── 선");
});

test("preserves full terminal separators on desktop and compacts them on touch screens", () => {
  const divider = "─".repeat(212);
  const output = `위\n${divider}\n아래`;

  assert.equal(
    terminalOutputForEnvironment(output, { touchInput: false }),
    output,
  );
  assert.equal(
    terminalOutputForEnvironment(output, { touchInput: true }),
    `위\n${"─".repeat(24)}\n아래`,
  );
});

test("moves through sent input history and restores the current draft", () => {
  const history = ["첫 번째", "두 번째"];
  const previous = nextInputHistory({
    history,
    cursor: null,
    draft: "",
    currentValue: "작성 중",
    direction: "previous",
  });
  assert.deepEqual(previous, {
    handled: true,
    cursor: 1,
    draft: "작성 중",
    value: "두 번째",
  });

  const older = nextInputHistory({
    history,
    cursor: previous.cursor,
    draft: previous.draft,
    currentValue: previous.value,
    direction: "previous",
  });
  assert.equal(older.value, "첫 번째");
  assert.equal(older.cursor, 0);

  const newer = nextInputHistory({
    history,
    cursor: older.cursor,
    draft: older.draft,
    currentValue: older.value,
    direction: "next",
  });
  assert.equal(newer.value, "두 번째");
  assert.equal(newer.cursor, 1);

  const restored = nextInputHistory({
    history,
    cursor: newer.cursor,
    draft: newer.draft,
    currentValue: newer.value,
    direction: "next",
  });
  assert.deepEqual(restored, {
    handled: true,
    cursor: null,
    draft: "",
    value: "작성 중",
  });
});

test("does not consume arrow keys when no input history is available", () => {
  assert.deepEqual(
    nextInputHistory({
      history: [],
      cursor: null,
      draft: "",
      currentValue: "작성 중",
      direction: "previous",
    }),
    {
      handled: false,
      cursor: null,
      draft: "",
      value: "작성 중",
    },
  );
});

test("preserves terminal DOM while selecting or when output is unchanged", () => {
  const base = {
    renderedPaneId: "pane-a",
    nextPaneId: "pane-a",
    renderedOutput: "same output",
    nextOutput: "same output",
    hasSelection: false,
    pointerActive: false,
  };
  assert.equal(shouldRenderTerminalUpdate(base), false);
  assert.equal(
    shouldRenderTerminalUpdate({ ...base, nextOutput: "new output", hasSelection: true }),
    false,
  );
  assert.equal(
    shouldRenderTerminalUpdate({ ...base, nextOutput: "new output", pointerActive: true }),
    false,
  );
  assert.equal(
    shouldRenderTerminalUpdate({ ...base, nextOutput: "new output", composerActive: true }),
    true,
    "typing in the composer must not stop new output from rendering",
  );
  assert.equal(
    shouldRenderTerminalUpdate({ ...base, nextOutput: "new output", scrolling: true }),
    false,
    "re-rendering mid-scroll stops momentum scrolling dead",
  );
  assert.equal(shouldRenderTerminalUpdate({ ...base, nextOutput: "new output" }), true);
  assert.equal(shouldRenderTerminalUpdate({ ...base, nextPaneId: "pane-b" }), true);
});

test("selects the first pane on initial load and preserves a current selection", () => {
  const panes = [{ pane_id: "w1:p1" }, { pane_id: "w2:p1" }, { pane_id: "w3:p1" }];
  assert.equal(selectedPaneIdForSnapshot(panes, null), "w1:p1");
  assert.equal(selectedPaneIdForSnapshot(panes, "w2:p1"), "w2:p1");
  assert.equal(selectedPaneIdForSnapshot(panes, "missing"), "w1:p1");
  assert.equal(selectedPaneIdForSnapshot([], null), null);
});

test("migrates a stored legacy pane id into the default Herdr session", () => {
  const panes = [
    { pane_id: "hs_ZGVmYXVsdA~w2:p1" },
    { pane_id: "hs_cmV2aWV3~w2:p1" },
  ];
  assert.equal(
    selectedPaneIdForSnapshot(panes, "w2:p1", "hs_ZGVmYXVsdA"),
    "hs_ZGVmYXVsdA~w2:p1",
  );
});

test("hides Herdr's numeric default tab label but keeps named tabs", () => {
  assert.equal(displayTabLabel({ number: 1, label: "1" }), "");
  assert.equal(displayTabLabel({ number: 2, label: "Release" }), "Release");
  assert.equal(displayTabLabel({ number: 3 }), "");
});

test("uses Enter by pointer type and supports external keyboards on touch devices", () => {
  assert.equal(inputKeyAction({ key: "Enter" }), "submit");
  assert.equal(inputKeyAction({ key: "Enter", ctrlKey: true }), "newline");
  assert.equal(
    inputKeyAction({ key: "Enter", usesTouchInput: true }),
    "default",
  );
  assert.equal(
    inputKeyAction({ key: "Enter", ctrlKey: true, usesTouchInput: true }),
    "submit",
  );
  assert.equal(
    inputKeyAction({ key: "Enter", metaKey: true, usesTouchInput: true }),
    "submit",
  );
  assert.equal(inputKeyAction({ key: "Enter", isComposing: true }), "default");
  assert.equal(inputKeyAction({ key: "a" }), "default");
});

test("inserts a Ctrl+Enter newline at the current textarea selection", () => {
  assert.deepEqual(
    insertNewlineAtSelection("첫째 줄둘째 줄", 4, 4),
    { value: "첫째 줄\n둘째 줄", caret: 5 },
  );
  assert.deepEqual(
    insertNewlineAtSelection("앞교체뒤", 1, 3),
    { value: "앞\n뒤", caret: 2 },
  );
});

test("uses real Herdr agent names without exposing internal pane ids", () => {
  assert.equal(
    displayRecordLabel({ agent: "codex", terminal_title_stripped: "working" }, "터미널"),
    "codex",
  );
  assert.equal(displayRecordLabel({}, "터미널"), "터미널");
});

test("uses Herdr agent_status and native symbol indicators", () => {
  assert.equal(agentStatus({ agent_status: "working", state: "done" }), "working");
  assert.equal(agentStatus(null, { agent_status: "blocked" }), "blocked");
  assert.equal(agentStatus({ agent_status: "unexpected" }), "unknown");
  assert.deepEqual(
    ["blocked", "working", "done", "idle", "unknown"].map(agentStatusIcon),
    ["×", "◐", "✓", "○", "·"],
  );
});

test("derives accessible desktop and mobile sidebar states", () => {
  assert.deepEqual(
    sidebarPresentation({
      isDesktop: true,
      desktopCollapsed: true,
      mobileOpen: false,
    }),
    {
      collapsed: true,
      open: true,
      navigatorInert: false,
      toggleExpanded: false,
      toggleLabel: "Expand sidebar",
    },
  );
  assert.deepEqual(
    sidebarPresentation({
      isDesktop: false,
      desktopCollapsed: true,
      mobileOpen: false,
    }),
    {
      collapsed: false,
      open: false,
      navigatorInert: true,
      toggleExpanded: false,
      toggleLabel: "Close sidebar",
    },
  );
});

test("grows the requested history window one page at a time", () => {
  assert.equal(nextHistoryLineLimit(200), 400);
  assert.equal(nextHistoryLineLimit(99_900), MAX_HISTORY_LINES);
  assert.equal(nextHistoryLineLimit(MAX_HISTORY_LINES), MAX_HISTORY_LINES);
});

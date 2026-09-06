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
  nextInputHistory,
  nextHistoryLineLimit,
  selectedPaneIdForSnapshot,
  shouldRenderTerminalUpdate,
  sidebarPresentation,
} from "../public/ui-model.js";

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
      toggleLabel: "사이드바 펼치기",
      toggleSymbol: "",
      showToggleLogo: true,
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
      toggleLabel: "사이드바 닫기",
      toggleSymbol: "×",
      showToggleLogo: false,
    },
  );
});

test("grows the requested history window one page at a time", () => {
  assert.equal(nextHistoryLineLimit(200), 400);
  assert.equal(nextHistoryLineLimit(99_900), MAX_HISTORY_LINES);
  assert.equal(nextHistoryLineLimit(MAX_HISTORY_LINES), MAX_HISTORY_LINES);
});

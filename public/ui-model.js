export const HISTORY_PAGE_LINES = 200;
export const MAX_HISTORY_LINES = 100_000;
const KNOWN_AGENT_STATES = new Set(["idle", "working", "blocked", "done", "unknown"]);
const AGENT_STATUS_ICONS = Object.freeze({
  blocked: "×",
  working: "◐",
  done: "✓",
  idle: "○",
  unknown: "·",
});
const TERMINAL_DIVIDER_PATTERN = /[─━═╌╍┄┅┈┉⎯]{48,}/gu;
const COMPACT_TERMINAL_DIVIDER = "─".repeat(24);

export function compactTerminalSeparators(value) {
  return String(value).replace(
    TERMINAL_DIVIDER_PATTERN,
    COMPACT_TERMINAL_DIVIDER,
  );
}

export function sidebarPresentation({ isDesktop, desktopCollapsed, mobileOpen }) {
  if (isDesktop) {
    return {
      collapsed: desktopCollapsed === true,
      open: true,
      navigatorInert: false,
      toggleExpanded: desktopCollapsed !== true,
      toggleLabel: desktopCollapsed ? "사이드바 펼치기" : "사이드바 접기",
      toggleSymbol: desktopCollapsed ? "" : "‹",
      showToggleLogo: desktopCollapsed === true,
    };
  }

  return {
    collapsed: false,
    open: mobileOpen === true,
    navigatorInert: mobileOpen !== true,
    toggleExpanded: mobileOpen === true,
    toggleLabel: "사이드바 닫기",
    toggleSymbol: "×",
    showToggleLogo: false,
  };
}

export function inputKeyAction({
  key,
  ctrlKey = false,
  metaKey = false,
  isComposing = false,
  usesTouchInput = false,
}) {
  if (key !== "Enter" || isComposing) return "default";
  if (usesTouchInput) return ctrlKey || metaKey ? "submit" : "default";
  return ctrlKey ? "newline" : "submit";
}

export function insertNewlineAtSelection(value, selectionStart, selectionEnd) {
  const start = Number.isInteger(selectionStart) ? selectionStart : value.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  return {
    value: `${value.slice(0, start)}\n${value.slice(end)}`,
    caret: start + 1,
  };
}

export function nextInputHistory({
  history,
  cursor = null,
  draft = "",
  currentValue = "",
  direction,
}) {
  const entries = Array.isArray(history) ? history : [];
  if (entries.length === 0 || (direction !== "previous" && direction !== "next")) {
    return { handled: false, cursor, draft, value: currentValue };
  }

  if (direction === "previous") {
    const nextCursor = cursor === null
      ? entries.length - 1
      : Math.max(0, cursor - 1);
    return {
      handled: true,
      cursor: nextCursor,
      draft: cursor === null ? currentValue : draft,
      value: entries[nextCursor],
    };
  }

  if (cursor === null) {
    return { handled: false, cursor, draft, value: currentValue };
  }
  if (cursor < entries.length - 1) {
    const nextCursor = cursor + 1;
    return {
      handled: true,
      cursor: nextCursor,
      draft,
      value: entries[nextCursor],
    };
  }
  return { handled: true, cursor: null, draft: "", value: draft };
}

export function shouldRenderTerminalUpdate({
  renderedPaneId,
  nextPaneId,
  renderedOutput,
  nextOutput,
  hasSelection = false,
  pointerActive = false,
}) {
  if (renderedPaneId !== nextPaneId) return true;
  if (pointerActive || hasSelection) return false;
  return renderedOutput !== nextOutput;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(record, ...keys) {
  for (const key of keys) {
    if (typeof record?.[key] === "string") return record[key];
  }
  return "";
}

export function selectedPaneIdForSnapshot(panes, currentPaneId) {
  const paneIds = array(panes).map((pane) => idOf(pane, "pane_id", "id"));
  if (currentPaneId && paneIds.includes(currentPaneId)) return currentPaneId;
  return paneIds[0] || null;
}

export function displayRecordLabel(record, fallback) {
  const values = [
    record?.label,
    record?.display_agent,
    record?.agent,
    record?.name,
    record?.terminal_title_stripped,
    record?.title,
  ];
  return values.find((value) => typeof value === "string" && value.trim() !== "") || fallback;
}

export function displayTabLabel(tab) {
  const label = displayRecordLabel(tab, "");
  return /^\d+$/.test(label.trim()) ? "" : label;
}

export function nextHistoryLineLimit(currentLines) {
  const current = Number.isInteger(currentLines) && currentLines > 0
    ? currentLines
    : HISTORY_PAGE_LINES;
  return Math.min(current + HISTORY_PAGE_LINES, MAX_HISTORY_LINES);
}

export function agentStatus(agent, pane) {
  const value =
    agent?.agent_status ||
    agent?.state ||
    pane?.agent_status ||
    pane?.agent_state;
  return KNOWN_AGENT_STATES.has(value) ? value : "unknown";
}

export function agentStatusIcon(status) {
  return AGENT_STATUS_ICONS[status] || AGENT_STATUS_ICONS.unknown;
}

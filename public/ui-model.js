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

export function outputTextForUpdate(currentText, payload) {
  if (payload?.update === "replace") {
    return typeof payload.output === "string" ? payload.output : null;
  }
  if (
    payload?.update !== "delta" ||
    typeof currentText !== "string" ||
    !Array.isArray(payload.patches) ||
    payload.patches.length === 0 ||
    payload.patches.length > 8
  ) {
    return null;
  }

  let output = currentText;
  for (const patch of payload.patches) {
    if (
      !Number.isInteger(patch?.start) ||
      patch.start < 0 ||
      !Number.isInteger(patch.deleteCount) ||
      patch.deleteCount < 0 ||
      patch.start + patch.deleteCount > output.length ||
      typeof patch.text !== "string"
    ) {
      return null;
    }
    output = output.slice(0, patch.start) +
      patch.text +
      output.slice(patch.start + patch.deleteCount);
  }
  return output;
}

export function outputHistoryMode(agentName) {
  return String(agentName || "").trim().toLowerCase() === "claude"
    ? "hybrid"
    : "ansi";
}

export function outputPollingDecision({
  baseIntervalMs = 1_000,
  previousStatus = "unknown",
  currentStatus = "unknown",
  recentSubmission = false,
  connection = null,
  touchEnvironment = false,
} = {}) {
  const base = Number.isFinite(baseIntervalMs) && baseIntervalMs > 0
    ? baseIntervalMs
    : 1_000;
  const knownUnmetered = ["wifi", "ethernet"].includes(connection?.type);
  const conserveData = connection?.saveData === true || connection?.type === "cellular" ||
    (!knownUnmetered && touchEnvironment);
  return {
    intervalMs:
      currentStatus === "working" && !recentSubmission && conserveData
        ? Math.max(base, 5_000)
        : base,
    refreshNow:
      previousStatus === "working" &&
      ["done", "blocked", "idle"].includes(currentStatus),
  };
}

export function compactTerminalSeparators(value) {
  return String(value).replace(
    TERMINAL_DIVIDER_PATTERN,
    COMPACT_TERMINAL_DIVIDER,
  );
}

export function terminalOutputForEnvironment(value, { touchInput = false } = {}) {
  const output = String(value);
  return touchInput ? compactTerminalSeparators(output) : output;
}

export function terminalPinchDirection(
  previousDistance,
  currentDistance,
  threshold = 8,
) {
  if (
    !Number.isFinite(previousDistance) ||
    !Number.isFinite(currentDistance) ||
    previousDistance <= 0 ||
    currentDistance <= 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0
  ) {
    return null;
  }
  const delta = currentDistance - previousDistance;
  if (Math.abs(delta) < threshold) return null;
  return delta > 0 ? "larger" : "smaller";
}

export function sidebarPresentation({ isDesktop, desktopCollapsed, mobileOpen }) {
  if (isDesktop) {
    return {
      collapsed: desktopCollapsed === true,
      open: true,
      navigatorInert: false,
      toggleExpanded: desktopCollapsed !== true,
      toggleLabel: desktopCollapsed ? "Expand sidebar" : "Collapse sidebar",
    };
  }

  return {
    collapsed: false,
    open: mobileOpen === true,
    navigatorInert: mobileOpen !== true,
    toggleExpanded: mobileOpen === true,
    toggleLabel: "Close sidebar",
  };
}

export function detectTouchInput({
  primaryTouch = false,
  anyCoarsePointer = false,
  anyHover = false,
  maxTouchPoints = 0,
  compactViewport = false,
} = {}) {
  if (primaryTouch === true) return true;
  if (anyCoarsePointer === true && anyHover !== true) return true;
  return Number(maxTouchPoints) > 0 && compactViewport === true;
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

export function paneShortcutTarget({
  key,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  metaKey = false,
  isComposing = false,
  paneIds = [],
  currentPaneId = null,
} = {}) {
  const ids = Array.isArray(paneIds) ? paneIds : [];
  if (
    !ctrlKey ||
    altKey ||
    metaKey ||
    isComposing ||
    ids.length === 0
  ) return null;

  if (key === "Tab") {
    const currentIndex = ids.indexOf(currentPaneId);
    if (shiftKey) {
      return ids[currentIndex <= 0 ? ids.length - 1 : currentIndex - 1];
    }
    return ids[currentIndex < 0 ? 0 : (currentIndex + 1) % ids.length];
  }

  if (!shiftKey && /^[1-9]$/u.test(key)) {
    return ids[Number(key) - 1] || null;
  }
  return null;
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
  composerActive = false,
}) {
  if (renderedPaneId !== nextPaneId) return true;
  if (pointerActive || hasSelection || composerActive) return false;
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

export function selectedPaneIdForSnapshot(
  panes,
  currentPaneId,
  defaultHerdrSessionId = null,
) {
  const paneIds = array(panes).map((pane) => idOf(pane, "pane_id", "id"));
  if (currentPaneId && paneIds.includes(currentPaneId)) return currentPaneId;
  if (
    currentPaneId &&
    defaultHerdrSessionId &&
    !currentPaneId.includes("~")
  ) {
    const migratedPaneId = `${defaultHerdrSessionId}~${currentPaneId}`;
    if (paneIds.includes(migratedPaneId)) return migratedPaneId;
  }
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

export function agentCompletionIdentity(agent, pane) {
  for (const record of [agent, pane]) {
    const sequence = record?.state_change_seq;
    if (Number.isSafeInteger(sequence) && sequence >= 0) {
      return `seq:${sequence}`;
    }
  }
  for (const record of [agent, pane]) {
    const revision = record?.revision;
    if (Number.isSafeInteger(revision) && revision >= 0) {
      return `revision:${revision}`;
    }
  }
  return null;
}

export function visibleAgentStatus(agent, pane, acknowledgedCompletion = null) {
  const status = agentStatus(agent, pane);
  if (
    status === "done" &&
    acknowledgedCompletion !== null &&
    agentCompletionIdentity(agent, pane) === acknowledgedCompletion
  ) {
    return "idle";
  }
  return status;
}

export function agentStatusIcon(status) {
  return AGENT_STATUS_ICONS[status] || AGENT_STATUS_ICONS.unknown;
}

export function loginMethodPresentation({
  passkeyAvailable = false,
  passkeySupported = false,
} = {}) {
  const passkeyVisible = passkeyAvailable && passkeySupported;
  return passkeyVisible
    ? {
        passkeyVisible: true,
        passkeyPrimary: true,
        passwordPrimary: false,
        focusTarget: "passkey",
        instruction: "Sign in with a passkey or use your password.",
        passwordLabel: "Password",
      }
    : {
        passkeyVisible: false,
        passkeyPrimary: false,
        passwordPrimary: true,
        focusTarget: "password",
        instruction: "Enter your password.",
        passwordLabel: "Password",
      };
}

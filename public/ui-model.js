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

// Right after sending, the echo is what the reader is waiting for. Polling on
// the normal cadence leaves a gap of up to two seconds because the scheduler
// counts from the last request it started, not from the last answer.
const SUBMISSION_BURST_INTERVAL_MS = 300;

export function outputPollingDecision({
  baseIntervalMs = 1_000,
  previousStatus = "unknown",
  currentStatus = "unknown",
  recentSubmission = false,
  connection = null,
} = {}) {
  const base = Number.isFinite(baseIntervalMs) && baseIntervalMs > 0
    ? baseIntervalMs
    : 1_000;
  // Only back off when the connection says it is metered. Android rarely
  // reports connection.type, and treating "unknown" as cellular left Wi-Fi
  // five seconds behind.
  const conserveData = connection?.saveData === true || connection?.type === "cellular";
  return {
    intervalMs: recentSubmission
      ? Math.min(base, SUBMISSION_BURST_INTERVAL_MS)
      : currentStatus === "working" && conserveData
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

export function insertTextAtSelection(value, selectionStart, selectionEnd, text) {
  const start = Number.isInteger(selectionStart) ? selectionStart : value.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  return {
    value: `${value.slice(0, start)}${text}${value.slice(end)}`,
    caret: start + text.length,
  };
}

export function insertNewlineAtSelection(value, selectionStart, selectionEnd) {
  return insertTextAtSelection(value, selectionStart, selectionEnd, "\n");
}

// A pasted path has to survive sitting next to whatever is already typed, so it
// carries its own separation instead of relying on the caret being in a
// sensible spot.
export function insertPathAtSelection(value, selectionStart, selectionEnd, path) {
  const start = Number.isInteger(selectionStart) ? selectionStart : value.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  const before = /\s$/u.test(value.slice(0, start)) || start === 0 ? "" : " ";
  const after = /^\s/u.test(value.slice(end)) ? "" : " ";
  return insertTextAtSelection(value, start, end, `${before}${path}${after}`);
}

// The uploads folder only exists on the machine running HerdRabbit. A pane id carries
// a server prefix when it belongs to an SSH host, and a local path pasted into
// that pane would name a file the remote machine does not have.
export function paneUsesLocalFiles(paneId) {
  return typeof paneId === "string" && paneId !== "" && !paneId.includes("!");
}

// Records from an SSH host carry a "<serverId>!" prefix on their ids, so the
// pane itself says which machine its files live on.
export function paneServerId(paneId) {
  if (typeof paneId !== "string" || paneId === "") return null;
  const separator = paneId.indexOf("!");
  return separator < 0 ? "local" : paneId.slice(0, separator);
}

// The pane record carries the directory the session runs in. foreground_cwd
// tracks the running process and cwd is where the session started; either beats
// falling back to the home directory. Remote panes report a path on the SSH
// host, which does not exist on the machine serving these files, so they get no
// starting point at all.
export function paneStartDirectory(pane, { home = null } = {}) {
  if (!pane || !paneUsesLocalFiles(pane.pane_id ?? pane.id)) return home;
  for (const value of [pane.foreground_cwd, pane.cwd]) {
    if (typeof value === "string" && value.startsWith("/")) return value;
  }
  return home;
}

// A project's folder is whichever of its sessions reports one. Sessions in the
// same project normally share a directory, so the first answer is the project's.
export function workspaceStartDirectory(workspaceId, { tabs = [], panes = [] } = {}, options = {}) {
  const tabIds = new Set(
    tabs.filter((tab) => (tab?.workspace_id ?? tab?.workspaceId) === workspaceId)
      .map((tab) => tab?.tab_id ?? tab?.id),
  );
  for (const pane of panes) {
    const belongs = (pane?.workspace_id ?? pane?.workspaceId) === workspaceId ||
      tabIds.has(pane?.tab_id ?? pane?.tabId);
    if (!belongs) continue;
    const directory = paneStartDirectory(pane, { home: null });
    if (directory) return directory;
  }
  return options.home ?? null;
}

// The tree is drawn from a flat list because only expanded folders have been
// fetched; a folder nobody opened has no children to recurse into.
export function flattenTree(path, loaded, expanded, depth = 0) {
  const listing = loaded.get(path);
  if (!listing) return [];
  const rows = [];
  for (const entry of listing.entries) {
    const open = expanded.has(entry.path);
    rows.push({ entry, depth, expanded: open });
    if (open && entry.kind === "directory") {
      rows.push(...flattenTree(entry.path, loaded, expanded, depth + 1));
    }
  }
  return rows;
}

export function parentDirectory(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trimmed === "/") return null;
  const cut = trimmed.lastIndexOf("/");
  return cut === 0 ? "/" : trimmed.slice(0, cut);
}

// Breadcrumbs drop their middle on narrow screens: the root and the last few
// segments say where you are, and the elision stands in for the rest.
export function breadcrumbSegments(path, { maxSegments = 4 } = {}) {
  if (typeof path !== "string" || !path.startsWith("/")) return [];
  const names = path.split("/").filter(Boolean);
  const crumbs = [{ label: "/", path: "/" }];
  let walked = "";
  for (const name of names) {
    walked += `/${name}`;
    crumbs.push({ label: name, path: walked });
  }
  if (crumbs.length <= maxSegments) return crumbs;
  const tail = Math.max(1, maxSegments - 2);
  return [crumbs[0], { label: "…", path: null }, ...crumbs.slice(-tail)];
}

export function isInsideDirectory(path, directory) {
  if (typeof path !== "string" || typeof directory !== "string" || directory === "") return false;
  const root = directory.endsWith("/") ? directory.slice(0, -1) : directory;
  return path === root || path.startsWith(`${root}/`);
}

export function formatTransferSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
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

export function shouldBrowseInputHistory({ key, value, selectionStart, selectionEnd }) {
  if (selectionStart !== selectionEnd) return false;
  if (key === "ArrowUp") return selectionStart === 0;
  if (key === "ArrowDown") return selectionEnd === value.length;
  return false;
}

export function preferredLoginMethod({ lastMethod, touchInput = false, passkeyAvailable = false }) {
  const preferred = lastMethod === "password" || lastMethod === "passkey"
    ? lastMethod : touchInput ? "passkey" : "password";
  return preferred === "passkey" && passkeyAvailable ? "passkey" : "password";
}

// Re-rendering replaces the whole terminal, which drops a text selection,
// interrupts a drag, and stops momentum scrolling dead. Typing in the composer
// touches none of that, so it must not stop new output from appearing.
export function shouldRenderTerminalUpdate({
  renderedPaneId,
  nextPaneId,
  renderedOutput,
  nextOutput,
  hasSelection = false,
  pointerActive = false,
  scrolling = false,
  readingHistory = false,
}) {
  if (renderedPaneId !== nextPaneId) return true;
  if (pointerActive || hasSelection || scrolling || readingHistory) return false;
  return renderedOutput !== nextOutput;
}

// One line of a zoomed terminal can be taller than a fixed pixel threshold,
// which would silently turn following the bottom off.
export function nearTerminalBottom({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  lineHeight = 0,
} = {}) {
  const line = Number(lineHeight);
  const threshold = Math.max(40, Number.isFinite(line) ? line * 1.5 : 0);
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function terminalShowsOlderScreen(output) {
  // Claude renders this counter when its own viewport is away from live output.
  const text = String(output).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  return /\b[1-9]\d* new messages? \(ctrl\+End\)(?:\s*↓)?\s*$/im.test(text) ||
    /^\s*(?:[↓⌄∨]\s*)?jump to bottom(?:\s*\([^\r\n)]*\))?(?:\s*[↓⌄∨])?\s*$/im.test(text);
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

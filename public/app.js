import {
  HISTORY_PAGE_LINES,
  agentStatus,
  agentStatusIcon,
  displayRecordLabel,
  displayTabLabel,
  inputKeyAction,
  insertNewlineAtSelection,
  nextInputHistory,
  nextHistoryLineLimit,
  selectedPaneIdForSnapshot,
  shouldRenderTerminalUpdate,
  sidebarPresentation,
} from "./ui-model.js?v=36";
import { ansiToSegments } from "./ansi.js?v=36";
import {
  readPanePreference,
  writePanePreference,
} from "./pane-preference.js?v=36";
import {
  readCollapsedWorkspaceIds,
  writeCollapsedWorkspaceIds,
} from "./workspace-preference.js?v=36";

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const panePreferenceStorage = browserStorage();
const initialPanePreference = readPanePreference(panePreferenceStorage);
const initialCollapsedWorkspaceIds = readCollapsedWorkspaceIds(
  panePreferenceStorage,
);

const elements = {
  navigator: document.querySelector("#navigator"),
  navigatorContent: document.querySelector("#navigator-content"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarToggleSymbol: document.querySelector("#sidebar-toggle span"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  mobileSidebarOpen: document.querySelector("#mobile-sidebar-open"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionStatus: document.querySelector("#connection-status"),
  agentCount: document.querySelector("#agent-count"),
  workspaceList: document.querySelector("#workspace-list"),
  paneContext: document.querySelector("#pane-context"),
  paneTitle: document.querySelector("#pane-title"),
  paneState: document.querySelector("#pane-state"),
  themeToggle: document.querySelector("#theme-toggle"),
  historyStatus: document.querySelector("#history-status"),
  terminalOutput: document.querySelector("#terminal-output"),
  quickKeys: document.querySelector(".quick-keys"),
  inputForm: document.querySelector("#input-form"),
  terminalInput: document.querySelector("#terminal-input"),
  actionFeedback: document.querySelector("#action-feedback"),
};

const state = {
  csrfToken: "",
  pollIntervalMs: 1_000,
  snapshot: null,
  selectedPaneId: initialPanePreference,
  preferredPaneId: initialPanePreference,
  snapshotBusy: false,
  outputBusy: false,
  outputLineLimits: new Map(),
  outputHasMore: new Map(),
  historyRequested: new Set(),
  historyErrors: new Map(),
  historyLoadingPaneId: null,
  desktopSidebarCollapsed: false,
  mobileSidebarOpen: false,
  renderedPaneId: null,
  renderedOutput: null,
  terminalPointerActive: false,
  inputHistoryByPane: new Map(),
  inputHistoryCursor: null,
  inputHistoryDraft: "",
  collapsedWorkspaceIds: initialCollapsedWorkspaceIds,
  editingWorkspaceId: null,
};

const desktopMedia = window.matchMedia("(min-width: 761px)");
let sidebarAnimationTimer;

function clearSidebarAnimationState() {
  window.clearTimeout(sidebarAnimationTimer);
  document.body.classList.remove("sidebar-animating");
}

function markSidebarAnimating() {
  window.clearTimeout(sidebarAnimationTimer);
  document.body.classList.add("sidebar-animating");
  sidebarAnimationTimer = window.setTimeout(clearSidebarAnimationState, 400);
}

function syncSidebar() {
  const presentation = sidebarPresentation({
    isDesktop: desktopMedia.matches,
    desktopCollapsed: state.desktopSidebarCollapsed,
    mobileOpen: state.mobileSidebarOpen,
  });
  document.body.classList.toggle("sidebar-collapsed", presentation.collapsed);
  document.body.classList.toggle(
    "sidebar-open",
    !desktopMedia.matches && presentation.open,
  );
  elements.navigator.inert = presentation.navigatorInert;
  elements.sidebarToggle.setAttribute("aria-expanded", String(presentation.toggleExpanded));
  elements.sidebarToggle.setAttribute("aria-label", presentation.toggleLabel);
  elements.sidebarToggle.title = presentation.toggleLabel;
  elements.sidebarToggleSymbol.textContent = presentation.toggleSymbol;
  elements.mobileSidebarOpen.setAttribute("aria-expanded", String(presentation.open));
}

function closeMobileSidebar({ restoreFocus = false } = {}) {
  if (desktopMedia.matches || !state.mobileSidebarOpen) return;
  state.mobileSidebarOpen = false;
  syncSidebar();
  if (restoreFocus) elements.mobileSidebarOpen.focus();
}

function setConnection(kind, text) {
  elements.connectionDot.dataset.state = kind;
  elements.connectionStatus.setAttribute("aria-label", text);
  elements.connectionStatus.title = text;
}

function setFeedback(text, isError = false) {
  elements.actionFeedback.textContent = text;
  elements.actionFeedback.dataset.error = String(isError);
}

function syncThemeButton() {
  const currentTheme = window.herdrTheme?.current() || "dark";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  const label = nextTheme === "light" ? "라이트 모드로 전환" : "다크 모드로 전환";
  elements.themeToggle.dataset.nextTheme = nextTheme;
  elements.themeToggle.setAttribute("aria-label", label);
  elements.themeToggle.title = label;
}

function resetInputHistoryNavigation() {
  state.inputHistoryCursor = null;
  state.inputHistoryDraft = "";
}

function rememberSentInput(paneId, text) {
  const history = state.inputHistoryByPane.get(paneId) || [];
  if (history.at(-1) !== text) history.push(text);
  if (history.length > 100) history.splice(0, history.length - 100);
  state.inputHistoryByPane.set(paneId, history);
  resetInputHistoryNavigation();
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.method && options.method !== "GET") {
    headers.set("X-Herdr-CSRF", state.csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(record, ...keys) {
  for (const key of keys) {
    if (typeof record?.[key] === "string") {
      return record[key];
    }
  }
  return "";
}

function snapshotRecords() {
  const snapshot = state.snapshot || {};
  return {
    workspaces: array(snapshot.workspaces),
    tabs: array(snapshot.tabs),
    panes: array(snapshot.panes),
    agents: array(snapshot.agents),
  };
}

function agentForPane(paneId) {
  return snapshotRecords().agents.find(
    (agent) => idOf(agent, "pane_id", "paneId") === paneId,
  );
}

function createElement(tag, { className, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(paths, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);
  for (const pathData of array(paths)) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

function workspaceActionButton({ className = "", label, paths, type = "button" }) {
  const button = createElement("button", {
    className: `workspace-action ${className}`.trim(),
  });
  button.type = type;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createIcon(paths));
  return button;
}

function stopWorkspaceRename() {
  state.editingWorkspaceId = null;
  setFeedback("");
  renderNavigation();
}

function workspaceHeading(group, workspace, workspaceLabel, children) {
  const workspaceId = idOf(workspace, "workspace_id", "id");
  const collapsed = state.collapsedWorkspaceIds.has(workspaceId);
  const editing = state.editingWorkspaceId === workspaceId;
  const heading = createElement("div", {
    className: `workspace-heading${editing ? " is-editing" : ""}`,
  });
  const collapseButton = workspaceActionButton({
    className: "workspace-collapse",
    label: collapsed ? `${workspaceLabel} 펼치기` : `${workspaceLabel} 접기`,
    paths: ["M9 18l6-6-6-6"],
  });
  collapseButton.setAttribute("aria-expanded", String(!collapsed));
  collapseButton.setAttribute("aria-controls", children.id);
  collapseButton.addEventListener("click", () => {
    if (state.collapsedWorkspaceIds.has(workspaceId)) {
      state.collapsedWorkspaceIds.delete(workspaceId);
    } else {
      state.collapsedWorkspaceIds.add(workspaceId);
    }
    const isNowCollapsed = state.collapsedWorkspaceIds.has(workspaceId);
    group.classList.toggle("is-collapsed", isNowCollapsed);
    children.inert = isNowCollapsed;
    children.setAttribute("aria-hidden", String(isNowCollapsed));
    collapseButton.setAttribute("aria-expanded", String(!isNowCollapsed));
    const nextLabel = isNowCollapsed
      ? `${workspaceLabel} 펼치기`
      : `${workspaceLabel} 접기`;
    collapseButton.setAttribute("aria-label", nextLabel);
    collapseButton.title = nextLabel;
    writeCollapsedWorkspaceIds(
      panePreferenceStorage,
      state.collapsedWorkspaceIds,
    );
  });
  heading.append(collapseButton);

  if (editing) {
    const form = createElement("form", { className: "workspace-rename-form" });
    const input = createElement("input", { className: "workspace-rename-input" });
    input.type = "text";
    input.value = workspaceLabel;
    input.maxLength = 120;
    input.required = true;
    input.setAttribute("aria-label", `${workspaceLabel} 프로젝트 이름`);
    input.addEventListener("input", () => input.setCustomValidity(""));
    const saveButton = workspaceActionButton({
      className: "workspace-rename-save",
      label: "프로젝트 이름 저장",
      paths: ["M5 12l4 4L19 6"],
      type: "submit",
    });
    const cancelButton = workspaceActionButton({
      className: "workspace-rename-cancel",
      label: "이름 변경 취소",
      paths: ["M6 6l12 12M18 6 6 18"],
    });
    cancelButton.addEventListener("click", stopWorkspaceRename);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopWorkspaceRename();
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const label = input.value.trim();
      if (!label) {
        input.setCustomValidity("프로젝트 이름을 입력하세요.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      input.disabled = true;
      saveButton.disabled = true;
      cancelButton.disabled = true;
      setFeedback("");
      try {
        await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/rename`, {
          method: "POST",
          body: { label },
        });
        const currentWorkspace = snapshotRecords().workspaces.find(
          (item) => idOf(item, "workspace_id", "id") === workspaceId,
        );
        if (currentWorkspace) currentWorkspace.label = label;
        state.editingWorkspaceId = null;
        renderNavigation();
        const selected = selectedRecords();
        renderPaneHeading(selected.pane, selected.tab, selected.workspace);
      } catch (error) {
        input.disabled = false;
        saveButton.disabled = false;
        cancelButton.disabled = false;
        setFeedback(error.message, true);
        input.focus();
      }
    });
    form.append(input, saveButton, cancelButton);
    heading.append(form);
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  } else {
    heading.append(createElement("h3", { text: workspaceLabel }));
    const renameButton = workspaceActionButton({
      className: "workspace-rename",
      label: `${workspaceLabel} 프로젝트 이름 변경`,
      paths: [
        "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z",
        "M14.5 7.5l3 3",
      ],
    });
    renameButton.addEventListener("click", () => {
      state.editingWorkspaceId = workspaceId;
      setFeedback("");
      renderNavigation();
    });
    heading.append(renameButton);
  }
  return heading;
}

function paneButton(pane, tab, workspace) {
  const paneId = idOf(pane, "pane_id", "id");
  const agent = agentForPane(paneId);
  const currentAgentStatus = agentStatus(agent, pane);
  const workspaceLabel = displayRecordLabel(workspace, "워크스페이스");
  const tabLabel = displayTabLabel(tab);
  const agentLabel = displayRecordLabel(agent, displayRecordLabel(pane, "터미널"));
  const button = createElement("button", { className: "pane-button" });
  button.type = "button";
  button.dataset.paneId = paneId;
  button.setAttribute("aria-pressed", String(paneId === state.selectedPaneId));

  button.setAttribute(
    "aria-label",
    `${agentLabel}, ${currentAgentStatus}, ${[workspaceLabel, tabLabel].filter(Boolean).join(" / ")}`,
  );
  button.title = `${agentStatusIcon(currentAgentStatus)} ${agentLabel} · ${currentAgentStatus}`;

  const marker = createElement("span", {
    className: `agent-marker state-${currentAgentStatus}`,
    text: agentStatusIcon(currentAgentStatus),
  });
  marker.setAttribute("aria-hidden", "true");
  button.append(marker);

  const copy = createElement("span", { className: "pane-copy" });
  copy.append(
    createElement("strong", {
      text: agentLabel,
    }),
    createElement("small", {
      text: currentAgentStatus,
    }),
  );
  button.append(copy);

  button.addEventListener("click", () => {
    if (state.selectedPaneId !== paneId) resetInputHistoryNavigation();
    state.selectedPaneId = paneId;
    state.preferredPaneId = paneId;
    writePanePreference(panePreferenceStorage, paneId);
    setFeedback("");
    renderNavigation();
    renderPaneHeading(pane, tab, workspace);
    renderHistoryStatus();
    showTerminalMessage("출력을 불러오는 중입니다…");
    void refreshOutput();
    closeMobileSidebar();
  });

  return button;
}

function renderNavigation() {
  const { workspaces, tabs, panes, agents } = snapshotRecords();
  elements.agentCount.textContent = `${agents.length} agents`;
  elements.workspaceList.replaceChildren();

  if (workspaces.length === 0) {
    const empty = createElement("p", {
      className: "empty-state",
      text: "열린 워크스페이스가 없습니다.",
    });
    elements.workspaceList.append(empty);
    return;
  }

  for (const workspace of workspaces) {
    const workspaceId = idOf(workspace, "workspace_id", "id");
    const group = createElement("section", { className: "workspace-group" });
    const workspaceLabel = displayRecordLabel(workspace, "워크스페이스");
    const children = createElement("div", { className: "workspace-children" });
    children.id = `workspace-${workspaceId}-children`;
    const childrenInner = createElement("div", {
      className: "workspace-children-inner",
    });
    const collapsed = state.collapsedWorkspaceIds.has(workspaceId);
    group.classList.toggle("is-collapsed", collapsed);
    children.inert = collapsed;
    children.setAttribute("aria-hidden", String(collapsed));
    group.append(workspaceHeading(group, workspace, workspaceLabel, children));

    const workspaceTabs = tabs.filter(
      (tab) => idOf(tab, "workspace_id", "workspaceId") === workspaceId,
    );
    for (const tab of workspaceTabs) {
      const tabId = idOf(tab, "tab_id", "id");
      const tabGroup = createElement("div", { className: "tab-group" });
      const tabLabel = displayTabLabel(tab);
      const tabHeading = createElement("div", { className: "tab-heading" });
      if (tabLabel) {
        tabHeading.append(createElement("p", { className: "tab-label", text: tabLabel }));
      }
      if (tabHeading.childElementCount > 0) tabGroup.append(tabHeading);

      const tabPanes = panes.filter((pane) => idOf(pane, "tab_id", "tabId") === tabId);
      for (const pane of tabPanes) {
        tabGroup.append(paneButton(pane, tab, workspace));
      }
      childrenInner.append(tabGroup);
    }
    children.append(childrenInner);
    group.append(children);
    elements.workspaceList.append(group);
  }
}

function renderPaneHeading(pane, tab, workspace) {
  if (!pane) {
    elements.paneContext.textContent = "패인을 선택하세요";
    elements.paneTitle.textContent = "터미널";
    elements.paneState.textContent = "·";
    elements.paneState.className = "state-pill state-unknown";
    elements.paneState.setAttribute("aria-label", "상태: unknown");
    elements.paneState.title = "unknown";
    return;
  }

  const paneId = idOf(pane, "pane_id", "id");
  const agent = agentForPane(paneId);
  const currentAgentStatus = agentStatus(agent, pane);
  const workspaceLabel = displayRecordLabel(workspace, "워크스페이스");
  const tabLabel = displayTabLabel(tab);

  elements.paneContext.textContent = [workspaceLabel, tabLabel].filter(Boolean).join(" / ");
  elements.paneTitle.textContent = displayRecordLabel(
    agent,
    displayRecordLabel(pane, "터미널"),
  );
  elements.paneState.textContent = agentStatusIcon(currentAgentStatus);
  elements.paneState.className = `state-pill state-${currentAgentStatus}`;
  elements.paneState.setAttribute("aria-label", `상태: ${currentAgentStatus}`);
  elements.paneState.title = currentAgentStatus;
}

function renderAnsiOutput(value) {
  const fragment = document.createDocumentFragment();
  for (const segment of ansiToSegments(value)) {
    const hasStyle =
      segment.bold ||
      segment.dim ||
      segment.italic ||
      segment.underline ||
      segment.inverse ||
      segment.foreground ||
      segment.background;
    if (!hasStyle) {
      fragment.append(document.createTextNode(segment.text));
      continue;
    }
    const span = document.createElement("span");
    span.textContent = segment.text;
    span.classList.toggle("ansi-bold", segment.bold);
    span.classList.toggle("ansi-dim", segment.dim);
    span.classList.toggle("ansi-italic", segment.italic);
    span.classList.toggle("ansi-underline", segment.underline);
    let foreground = segment.foreground;
    let background = segment.background;
    if (segment.inverse) {
      [foreground, background] = [
        background || "var(--terminal-bg)",
        foreground || "var(--terminal-text)",
      ];
    }
    if (foreground) {
      span.classList.add("ansi-foreground");
      span.style.setProperty("--ansi-foreground", foreground);
    }
    if (background) {
      span.classList.add("ansi-background");
      span.style.setProperty("--ansi-background", background);
    }
    fragment.append(span);
  }
  elements.terminalOutput.replaceChildren(fragment);
}

function showTerminalMessage(message) {
  elements.terminalOutput.textContent = message;
  state.renderedPaneId = null;
  state.renderedOutput = null;
}

function terminalHasSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return (
    elements.terminalOutput.contains(selection.anchorNode) ||
    elements.terminalOutput.contains(selection.focusNode)
  );
}

function selectedRecords() {
  const { workspaces, tabs, panes } = snapshotRecords();
  const pane = panes.find((item) => idOf(item, "pane_id", "id") === state.selectedPaneId);
  const tabId = idOf(pane, "tab_id", "tabId");
  const tab = tabs.find((item) => idOf(item, "tab_id", "id") === tabId);
  const workspaceId = idOf(tab, "workspace_id", "workspaceId") || idOf(pane, "workspace_id");
  const workspace = workspaces.find(
    (item) => idOf(item, "workspace_id", "id") === workspaceId,
  );
  return { pane, tab, workspace };
}

function choosePane() {
  const { panes } = snapshotRecords();
  const nextPaneId = selectedPaneIdForSnapshot(
    panes,
    state.selectedPaneId || state.preferredPaneId,
  );
  if (state.selectedPaneId !== nextPaneId) resetInputHistoryNavigation();
  state.selectedPaneId = nextPaneId;
  if (nextPaneId) {
    state.preferredPaneId = nextPaneId;
    writePanePreference(panePreferenceStorage, nextPaneId);
  }
}

async function refreshSnapshot() {
  if (state.snapshotBusy || document.hidden) return;
  state.snapshotBusy = true;
  try {
    const payload = await api("/api/snapshot");
    state.snapshot = payload.snapshot || {};
    choosePane();
    const editingWorkspaceExists = snapshotRecords().workspaces.some(
      (workspace) =>
        idOf(workspace, "workspace_id", "id") === state.editingWorkspaceId,
    );
    if (state.editingWorkspaceId && !editingWorkspaceExists) {
      state.editingWorkspaceId = null;
    }
    if (!state.editingWorkspaceId) renderNavigation();
    const selected = selectedRecords();
    renderPaneHeading(selected.pane, selected.tab, selected.workspace);
    setConnection("online", "연결됨");
  } catch (error) {
    setConnection("error", error.message);
  } finally {
    state.snapshotBusy = false;
  }
}

function renderHistoryStatus() {
  const paneId = state.selectedPaneId;
  if (!paneId) {
    elements.historyStatus.textContent = "";
    return;
  }
  if (state.historyLoadingPaneId === paneId) {
    elements.historyStatus.textContent = "이전 기록을 불러오는 중…";
    return;
  }
  const error = state.historyErrors.get(paneId);
  if (error) {
    elements.historyStatus.textContent = `이전 기록을 불러오지 못했습니다: ${error}`;
    return;
  }
  if (state.outputHasMore.get(paneId) === true) {
    elements.historyStatus.textContent = "";
    return;
  }
  elements.historyStatus.textContent = state.historyRequested.has(paneId)
    ? "세션 기록의 시작입니다."
    : "";
}

async function refreshOutput({ loadOlder = false } = {}) {
  if (state.outputBusy || document.hidden || !state.selectedPaneId) return;
  state.outputBusy = true;
  const requestedPaneId = state.selectedPaneId;
  const currentLineLimit =
    state.outputLineLimits.get(requestedPaneId) || HISTORY_PAGE_LINES;
  const requestedLineLimit = loadOlder
    ? nextHistoryLineLimit(currentLineLimit)
    : currentLineLimit;
  if (loadOlder && requestedLineLimit === currentLineLimit) {
    state.outputHasMore.set(requestedPaneId, false);
    state.historyRequested.add(requestedPaneId);
    state.outputBusy = false;
    renderHistoryStatus();
    return;
  }
  if (loadOlder) {
    state.historyLoadingPaneId = requestedPaneId;
    state.historyErrors.delete(requestedPaneId);
    renderHistoryStatus();
  }
  const previousScrollHeight = elements.terminalOutput.scrollHeight;
  const previousScrollTop = elements.terminalOutput.scrollTop;
  const nearBottom =
    elements.terminalOutput.scrollHeight - elements.terminalOutput.scrollTop - elements.terminalOutput.clientHeight < 40;
  try {
    const payload = await api(
      `/api/panes/${encodeURIComponent(requestedPaneId)}/output?lines=${requestedLineLimit}`,
    );
    if (requestedPaneId === state.selectedPaneId) {
      state.outputLineLimits.set(
        requestedPaneId,
        Number(payload.requestedLines) || requestedLineLimit,
      );
      state.outputHasMore.set(requestedPaneId, payload.hasMore === true);
      state.historyErrors.delete(requestedPaneId);
      if (loadOlder) state.historyRequested.add(requestedPaneId);
      const nextOutput = payload.output || "(출력 없음)";
      if (
        shouldRenderTerminalUpdate({
          renderedPaneId: state.renderedPaneId,
          nextPaneId: requestedPaneId,
          renderedOutput: state.renderedOutput,
          nextOutput,
          hasSelection: terminalHasSelection(),
          pointerActive: state.terminalPointerActive,
        })
      ) {
        renderAnsiOutput(nextOutput);
        state.renderedPaneId = requestedPaneId;
        state.renderedOutput = nextOutput;
        if (loadOlder) {
          const addedHeight = elements.terminalOutput.scrollHeight - previousScrollHeight;
          elements.terminalOutput.scrollTop = previousScrollTop + Math.max(0, addedHeight);
        } else if (nearBottom) {
          elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
        }
      }
    }
  } catch (error) {
    if (requestedPaneId === state.selectedPaneId) {
      if (loadOlder) {
        state.historyErrors.set(requestedPaneId, error.message);
      } else if (!state.terminalPointerActive && !terminalHasSelection()) {
        showTerminalMessage(`출력을 읽지 못했습니다: ${error.message}`);
      }
    }
  } finally {
    state.outputBusy = false;
    if (state.historyLoadingPaneId === requestedPaneId) {
      state.historyLoadingPaneId = null;
    }
    if (requestedPaneId === state.selectedPaneId) renderHistoryStatus();
  }
}

async function sendText(text) {
  if (!state.selectedPaneId) throw new Error("먼저 패인을 선택하세요.");
  return api(`/api/panes/${encodeURIComponent(state.selectedPaneId)}/text`, {
    method: "POST",
    body: { text, submit: true },
  });
}

async function sendKeys(keys) {
  if (!state.selectedPaneId) throw new Error("먼저 패인을 선택하세요.");
  await api(`/api/panes/${encodeURIComponent(state.selectedPaneId)}/keys`, {
    method: "POST",
    body: { keys },
  });
  await refreshOutput();
}

elements.inputForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.terminalInput.value;
  if (!text) return;
  const paneId = state.selectedPaneId;
  const submitButton = elements.inputForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setFeedback("전송 중…");
  try {
    await sendText(text);
    rememberSentInput(paneId, text);
    elements.terminalInput.value = "";
    setFeedback("");
    void refreshOutput();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

elements.terminalInput.addEventListener("keydown", (event) => {
  if (
    !event.isComposing &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === "ArrowUp" || event.key === "ArrowDown")
  ) {
    const next = nextInputHistory({
      history: state.inputHistoryByPane.get(state.selectedPaneId) || [],
      cursor: state.inputHistoryCursor,
      draft: state.inputHistoryDraft,
      currentValue: elements.terminalInput.value,
      direction: event.key === "ArrowUp" ? "previous" : "next",
    });
    if (next.handled) {
      event.preventDefault();
      state.inputHistoryCursor = next.cursor;
      state.inputHistoryDraft = next.draft;
      elements.terminalInput.value = next.value;
      elements.terminalInput.setSelectionRange(next.value.length, next.value.length);
    }
    return;
  }

  const action = inputKeyAction(event);
  if (action === "submit") {
    event.preventDefault();
    elements.inputForm.querySelector('button[type="submit"]').click();
  } else if (action === "newline") {
    event.preventDefault();
    const next = insertNewlineAtSelection(
      elements.terminalInput.value,
      elements.terminalInput.selectionStart,
      elements.terminalInput.selectionEnd,
    );
    elements.terminalInput.value = next.value;
    elements.terminalInput.setSelectionRange(next.caret, next.caret);
    elements.terminalInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

elements.terminalInput.addEventListener("input", () => {
  if (state.inputHistoryCursor !== null) resetInputHistoryNavigation();
});

elements.quickKeys.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-key]");
  if (!button) return;
  button.disabled = true;
  setFeedback(`${button.textContent} 전송 중…`);
  try {
    await sendKeys([button.dataset.key]);
    setFeedback("");
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

elements.themeToggle.addEventListener("click", () => {
  const currentTheme = window.herdrTheme?.current() || "dark";
  window.herdrTheme?.set(currentTheme === "dark" ? "light" : "dark");
});

window.addEventListener("herdr-theme-change", syncThemeButton);

elements.sidebarToggle.addEventListener("click", () => {
  markSidebarAnimating();
  if (desktopMedia.matches) {
    state.desktopSidebarCollapsed = !state.desktopSidebarCollapsed;
  } else {
    state.mobileSidebarOpen = false;
  }
  syncSidebar();
  if (!desktopMedia.matches) elements.mobileSidebarOpen.focus();
});

elements.navigator.addEventListener("transitionend", (event) => {
  if (event.target === elements.navigator && event.propertyName === "transform") {
    clearSidebarAnimationState();
  }
});

elements.mobileSidebarOpen.addEventListener("click", () => {
  state.mobileSidebarOpen = true;
  syncSidebar();
  elements.sidebarToggle.focus();
});

elements.sidebarScrim.addEventListener("click", () => {
  closeMobileSidebar({ restoreFocus: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileSidebar({ restoreFocus: true });
});

desktopMedia.addEventListener("change", () => {
  state.mobileSidebarOpen = false;
  syncSidebar();
});

elements.terminalOutput.addEventListener("scroll", () => {
  if (
    elements.terminalOutput.scrollTop <= 24 &&
    state.outputHasMore.get(state.selectedPaneId) === true
  ) {
    void refreshOutput({ loadOlder: true });
  }
});

elements.terminalOutput.addEventListener("pointerdown", () => {
  state.terminalPointerActive = true;
});

window.addEventListener("pointerup", () => {
  state.terminalPointerActive = false;
});

window.addEventListener("pointercancel", () => {
  state.terminalPointerActive = false;
});

async function start() {
  syncThemeButton();
  syncSidebar();
  if ("serviceWorker" in navigator) {
    let reloadingForWorkerUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForWorkerUpdate) return;
      reloadingForWorkerUpdate = true;
      window.location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
  try {
    const bootstrap = await api("/api/bootstrap");
    state.csrfToken = bootstrap.csrfToken;
    state.pollIntervalMs = bootstrap.pollIntervalMs || state.pollIntervalMs;
    await refreshSnapshot();
    await refreshOutput();
  } catch (error) {
    setConnection("error", error.message);
    showTerminalMessage(`초기화하지 못했습니다: ${error.message}`);
  }

  window.setInterval(() => void refreshSnapshot(), state.pollIntervalMs * 2);
  window.setInterval(() => void refreshOutput(), state.pollIntervalMs);
}

void start();

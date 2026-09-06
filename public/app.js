import {
  HISTORY_PAGE_LINES,
  agentCompletionIdentity,
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
  terminalPinchDirection,
  visibleAgentStatus,
} from "./ui-model.js?v=58";
import { ansiToSegments } from "./ansi.js?v=40";
import {
  readPanePreference,
  writePanePreference,
} from "./pane-preference.js?v=40";
import {
  readCollapsedWorkspaceIds,
  writeCollapsedWorkspaceIds,
} from "./workspace-preference.js?v=40";
import {
  adjustedTerminalFontSize,
  readTerminalFontSize,
  writeTerminalFontSize,
} from "./terminal-preference.js?v=1";
import {
  readAcknowledgedCompletions,
  writeAcknowledgedCompletions,
} from "./completion-preference.js?v=1";

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
const initialTerminalFontSize = readTerminalFontSize(panePreferenceStorage);
const initialAcknowledgedCompletions = readAcknowledgedCompletions(
  panePreferenceStorage,
);
document.documentElement.style.setProperty(
  "--terminal-font-size",
  `${initialTerminalFontSize}px`,
);

const elements = {
  shell: document.querySelector(".shell"),
  navigator: document.querySelector("#navigator"),
  navigatorContent: document.querySelector("#navigator-content"),
  createProject: document.querySelector("#create-project"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  mobileSidebarOpen: document.querySelector("#mobile-sidebar-open"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionStatus: document.querySelector("#connection-status"),
  workspaceList: document.querySelector("#workspace-list"),
  paneContext: document.querySelector("#pane-context"),
  paneTitle: document.querySelector("#pane-title"),
  themeToggle: document.querySelector("#theme-toggle"),
  historyStatus: document.querySelector("#history-status"),
  terminalPanel: document.querySelector(".terminal-panel"),
  terminalOutput: document.querySelector("#terminal-output"),
  quickKeys: document.querySelector(".quick-keys"),
  inputForm: document.querySelector("#input-form"),
  terminalInput: document.querySelector("#terminal-input"),
  actionFeedback: document.querySelector("#action-feedback"),
  projectDialog: document.querySelector("#project-dialog"),
  projectCreateForm: document.querySelector("#project-create-form"),
  projectName: document.querySelector("#project-name"),
  projectSessionContext: document.querySelector("#project-session-context"),
  projectDialogCancel: document.querySelector("#project-dialog-cancel"),
  projectDialogFeedback: document.querySelector("#project-dialog-feedback"),
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginPassword: document.querySelector("#login-password"),
  loginFeedback: document.querySelector("#login-feedback"),
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
  mutationBusy: false,
  openActionMenuId: null,
  createProjectSessionId: null,
  terminalFontSize: initialTerminalFontSize,
  authenticated: false,
  pollingStarted: false,
  acknowledgedCompletions: initialAcknowledgedCompletions,
};

const desktopMedia = window.matchMedia("(min-width: 761px)");
const primaryTouchMedia = window.matchMedia("(pointer: coarse) and (hover: none)");
const anyCoarsePointerMedia = window.matchMedia("(any-pointer: coarse)");
const anyHoverMedia = window.matchMedia("(any-hover: hover)");
const compactInputMedia = window.matchMedia("(max-width: 1024px)");
let sidebarAnimationTimer;
let terminalFontWheelDelta = 0;
let terminalPinchDistance = null;

function usesTouchInputEnvironment() {
  return detectTouchInput({
    primaryTouch: primaryTouchMedia.matches,
    anyCoarsePointer: anyCoarsePointerMedia.matches,
    anyHover: anyHoverMedia.matches,
    maxTouchPoints: navigator.maxTouchPoints,
    compactViewport: compactInputMedia.matches,
  });
}

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
  elements.mobileSidebarOpen.setAttribute("aria-expanded", String(presentation.open));
}

function showLogin() {
  state.authenticated = false;
  document.body.classList.remove("auth-pending", "auth-ready");
  document.body.classList.add("auth-required");
  elements.shell.inert = true;
  elements.loginScreen.hidden = false;
  window.requestAnimationFrame(() => elements.loginPassword.focus());
}

function showApplication() {
  state.authenticated = true;
  document.body.classList.remove("auth-pending", "auth-required");
  document.body.classList.add("auth-ready");
  elements.shell.inert = false;
  elements.loginScreen.hidden = true;
  elements.loginFeedback.textContent = "";
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

function adjustTerminalFont(direction) {
  const nextSize = adjustedTerminalFontSize(state.terminalFontSize, direction);
  state.terminalFontSize = nextSize;
  document.documentElement.style.setProperty(
    "--terminal-font-size",
    `${nextSize}px`,
  );
  writeTerminalFontSize(panePreferenceStorage, nextSize);
  resizeTerminalInput();
}

function resizeTerminalInput() {
  const input = elements.terminalInput;
  input.style.height = "auto";
  const maxHeight = Number.parseFloat(window.getComputedStyle(input).maxHeight);
  const contentHeight = input.scrollHeight;
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(contentHeight, maxHeight)
    : contentHeight;
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = contentHeight > nextHeight ? "auto" : "hidden";
}

function touchDistance(touches) {
  if (touches.length !== 2) return null;
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
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

class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const { body, csrf = true, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (csrf && fetchOptions.method && fetchOptions.method !== "GET") {
    headers.set("X-Herdr-CSRF", state.csrfToken);
  }

  const response = await fetch(path, {
    ...fetchOptions,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiError(payload?.error?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: payload?.error?.code,
    });
    if (error.code === "authentication_required") showLogin();
    throw error;
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
    herdrSessions: array(snapshot.herdr_sessions),
    workspaces: array(snapshot.workspaces),
    tabs: array(snapshot.tabs),
    panes: array(snapshot.panes),
    agents: array(snapshot.agents),
  };
}

function selectedHerdrSession() {
  const { herdrSessions, panes } = snapshotRecords();
  if (herdrSessions.length === 0) {
    return { session_id: null, name: "default", running: true, available: true };
  }
  const selectedPane = panes.find(
    (pane) => idOf(pane, "pane_id", "id") === state.selectedPaneId,
  );
  const selectedSessionId = idOf(
    selectedPane,
    "herdr_session_id",
    "herdrSessionId",
  );
  return herdrSessions.find(
    (session) => idOf(session, "session_id", "id") === selectedSessionId &&
      session.running === true && session.available === true,
  ) || herdrSessions.find(
    (session) => session.default === true && session.running === true &&
      session.available === true,
  ) || herdrSessions.find(
    (session) => session.running === true && session.available === true,
  ) || null;
}

function syncCreateProjectAvailability() {
  elements.createProject.disabled = selectedHerdrSession() === null;
}

function agentForPane(paneId) {
  return snapshotRecords().agents.find(
    (agent) => idOf(agent, "pane_id", "paneId") === paneId,
  );
}

function visibleStatusForPane(paneId, agent, pane) {
  return visibleAgentStatus(
    agent,
    pane,
    state.acknowledgedCompletions.get(paneId) || null,
  );
}

function acknowledgePaneCompletion(paneId) {
  const pane = snapshotRecords().panes.find(
    (item) => idOf(item, "pane_id", "id") === paneId,
  );
  const agent = agentForPane(paneId);
  if (agentStatus(agent, pane) !== "done") return;
  const identity = agentCompletionIdentity(agent, pane);
  if (!identity || state.acknowledgedCompletions.get(paneId) === identity) return;
  state.acknowledgedCompletions.set(paneId, identity);
  writeAcknowledgedCompletions(
    panePreferenceStorage,
    state.acknowledgedCompletions,
  );
}

function pruneAcknowledgedCompletions() {
  const { panes } = snapshotRecords();
  const liveDonePanes = new Set();
  for (const pane of panes) {
    const paneId = idOf(pane, "pane_id", "id");
    if (agentStatus(agentForPane(paneId), pane) === "done") {
      liveDonePanes.add(paneId);
    }
  }
  let changed = false;
  for (const paneId of state.acknowledgedCompletions.keys()) {
    if (!liveDonePanes.has(paneId)) {
      state.acknowledgedCompletions.delete(paneId);
      changed = true;
    }
  }
  if (changed) {
    writeAcknowledgedCompletions(
      panePreferenceStorage,
      state.acknowledgedCompletions,
    );
  }
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

function sidebarActionMenu({ id, label, actions, className = "" }) {
  const details = createElement("details", {
    className: `sidebar-action-menu ${className}`.trim(),
  });
  details.dataset.menuId = id;
  details.open = state.openActionMenuId === id;
  const summary = createElement("summary", { className: "workspace-action" });
  summary.setAttribute("aria-label", label);
  summary.title = label;
  summary.append(createIcon(["M6 12h.01M12 12h.01M18 12h.01"], "more-icon"));
  const popover = createElement("div", {
    className: "sidebar-action-popover",
  });
  popover.setAttribute("role", "menu");

  for (const action of actions) {
    const button = createElement("button", {
      className: `sidebar-action-item ${action.danger ? "is-danger" : ""}`.trim(),
    });
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.append(
      createIcon(action.paths),
      createElement("span", { text: action.label }),
    );
    button.addEventListener("click", () => {
      details.open = false;
      state.openActionMenuId = null;
      action.onSelect(button);
    });
    popover.append(button);
  }

  details.addEventListener("toggle", () => {
    if (details.open) {
      state.openActionMenuId = id;
      for (const other of elements.workspaceList.querySelectorAll(
        ".sidebar-action-menu[open]",
      )) {
        if (other !== details) other.open = false;
      }
    } else if (state.openActionMenuId === id) {
      state.openActionMenuId = null;
    }
  });
  details.append(summary, popover);
  return details;
}

function paneBelongsToWorkspace(pane, workspaceId) {
  if (idOf(pane, "workspace_id", "workspaceId") === workspaceId) return true;
  const tabId = idOf(pane, "tab_id", "tabId");
  return snapshotRecords().tabs.some(
    (tab) =>
      idOf(tab, "tab_id", "id") === tabId &&
      idOf(tab, "workspace_id", "workspaceId") === workspaceId,
  );
}

function adoptMutationSnapshot(snapshot, preferredPaneId = null) {
  const previousPaneId = state.selectedPaneId;
  state.snapshot = snapshot || {};
  if (preferredPaneId) {
    state.selectedPaneId = preferredPaneId;
    state.preferredPaneId = preferredPaneId;
  }
  choosePane();
  syncCreateProjectAvailability();
  renderNavigation();
  const selected = selectedRecords();
  renderPaneHeading(selected.pane, selected.tab, selected.workspace);
  renderHistoryStatus();
  if (previousPaneId !== state.selectedPaneId) {
    showTerminalMessage(
      state.selectedPaneId ? "출력을 불러오는 중입니다…" : "열린 세션이 없습니다.",
    );
  }
  void refreshOutput();
}

async function createShellSession(workspaceId, button) {
  if (state.mutationBusy) return;
  state.mutationBusy = true;
  button.disabled = true;
  const previousPaneIds = new Set(
    snapshotRecords().panes.map((pane) => idOf(pane, "pane_id", "id")),
  );
  setFeedback("");
  try {
    const payload = await api(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tabs`,
      { method: "POST", body: {} },
    );
    state.snapshot = payload.snapshot || {};
    const newPane = snapshotRecords().panes.find(
      (pane) =>
        !previousPaneIds.has(idOf(pane, "pane_id", "id")) &&
        paneBelongsToWorkspace(pane, workspaceId),
    );
    state.collapsedWorkspaceIds.delete(workspaceId);
    writeCollapsedWorkspaceIds(panePreferenceStorage, state.collapsedWorkspaceIds);
    adoptMutationSnapshot(
      state.snapshot,
      newPane ? idOf(newPane, "pane_id", "id") : null,
    );
    closeMobileSidebar();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    state.mutationBusy = false;
    button.disabled = false;
  }
}

async function closeSession(tab, label, button) {
  const tabId = idOf(tab, "tab_id", "id");
  const workspaceId = idOf(tab, "workspace_id", "workspaceId");
  if (
    !tabId ||
    state.mutationBusy ||
    !window.confirm(`“${label}” 세션을 종료할까요? 실행 중인 프로세스도 함께 종료됩니다.`)
  ) return;
  state.mutationBusy = true;
  button.disabled = true;
  setFeedback("");
  try {
    const payload = await api(`/api/tabs/${encodeURIComponent(tabId)}/close`, {
      method: "POST",
      body: { confirmed: true },
    });
    state.snapshot = payload.snapshot || {};
    const fallbackPane = snapshotRecords().panes.find((pane) =>
      paneBelongsToWorkspace(pane, workspaceId),
    );
    adoptMutationSnapshot(
      state.snapshot,
      fallbackPane ? idOf(fallbackPane, "pane_id", "id") : null,
    );
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    state.mutationBusy = false;
    button.disabled = false;
  }
}

async function closeProject(workspaceId, workspaceLabel, button) {
  if (
    state.mutationBusy ||
    !window.confirm(`“${workspaceLabel}” 프로젝트를 종료할까요? 모든 세션과 프로세스가 함께 종료됩니다.`)
  ) return;
  state.mutationBusy = true;
  button.disabled = true;
  setFeedback("");
  try {
    const payload = await api(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/close`,
      { method: "POST", body: { confirmed: true } },
    );
    state.collapsedWorkspaceIds.delete(workspaceId);
    writeCollapsedWorkspaceIds(panePreferenceStorage, state.collapsedWorkspaceIds);
    adoptMutationSnapshot(payload.snapshot);
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    state.mutationBusy = false;
    button.disabled = false;
  }
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
    heading.append(sidebarActionMenu({
      id: `workspace-${workspaceId}`,
      label: `${workspaceLabel} 추가 액션`,
      actions: [
        {
          label: "이름 변경",
          paths: [
            "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z",
            "M14.5 7.5l3 3",
          ],
          onSelect: () => {
            state.editingWorkspaceId = workspaceId;
            setFeedback("");
            renderNavigation();
          },
        },
        {
          label: "새 세션",
          paths: ["M12 5v14M5 12h14"],
          onSelect: (button) => void createShellSession(workspaceId, button),
        },
        {
          label: "프로젝트 종료",
          paths: ["M6 6l12 12M18 6 6 18"],
          danger: true,
          onSelect: (button) => void closeProject(
            workspaceId,
            workspaceLabel,
            button,
          ),
        },
      ],
    }));
  }
  return heading;
}

function paneButton(pane, tab, workspace) {
  const paneId = idOf(pane, "pane_id", "id");
  const agent = agentForPane(paneId);
  const currentAgentStatus = visibleStatusForPane(paneId, agent, pane);
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
    acknowledgePaneCompletion(paneId);
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
  const { herdrSessions, workspaces, tabs, panes } = snapshotRecords();
  elements.workspaceList.replaceChildren();
  const showHerdrSessionGroups = herdrSessions.length > 1 ||
    (herdrSessions.length === 1 && herdrSessions[0].available !== true);

  const appendWorkspace = (parent, workspace) => {
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

      const sessionRow = createElement("div", { className: "session-row" });
      const sessionPanes = createElement("div", { className: "session-panes" });
      const tabPanes = panes.filter((pane) => idOf(pane, "tab_id", "tabId") === tabId);
      for (const pane of tabPanes) {
        sessionPanes.append(paneButton(pane, tab, workspace));
      }
      const sessionLabel =
        tabLabel ||
        displayRecordLabel(agentForPane(idOf(tabPanes[0], "pane_id", "id")), "세션");
      const sessionMenu = sidebarActionMenu({
        id: `tab-${tabId}`,
        label: `${sessionLabel} 추가 액션`,
        className: "session-action-menu",
        actions: [
          {
            label: "세션 종료",
            paths: ["M6 6l12 12M18 6 6 18"],
            danger: true,
            onSelect: (button) => void closeSession(
              tab,
              sessionLabel,
              button,
            ),
          },
        ],
      });
      sessionRow.append(sessionPanes, sessionMenu);
      tabGroup.append(sessionRow);
      childrenInner.append(tabGroup);
    }
    children.append(childrenInner);
    group.append(children);
    parent.append(group);
  };

  if (!showHerdrSessionGroups && workspaces.length === 0) {
    const empty = createElement("p", {
      className: "empty-state",
      text: "열린 워크스페이스가 없습니다.",
    });
    elements.workspaceList.append(empty);
    return;
  }

  if (showHerdrSessionGroups) {
    for (const session of herdrSessions) {
      const sessionId = idOf(session, "session_id", "id");
      const sessionGroup = createElement("section", {
        className: "herdr-session-group",
      });
      const sessionHeading = createElement("div", {
        className: "herdr-session-heading",
      });
      const status = session.available === true
        ? "실행 중"
        : session.running === true ? "연결 실패" : "중지됨";
      const statusDot = createElement("span", {
        className: `herdr-session-dot${
          session.available === true
            ? " is-online"
            : session.running === true ? " is-error" : ""
        }`,
      });
      statusDot.setAttribute("aria-hidden", "true");
      sessionHeading.setAttribute("aria-label", `Herdr ${session.name}, ${status}`);
      sessionHeading.title = status;
      sessionHeading.append(
        statusDot,
        createElement("strong", { text: session.name }),
        createElement("small", { text: status }),
      );
      sessionGroup.append(sessionHeading);

      const sessionWorkspaces = workspaces.filter(
        (workspace) => idOf(
          workspace,
          "herdr_session_id",
          "herdrSessionId",
        ) === sessionId,
      );
      if (sessionWorkspaces.length === 0) {
        sessionGroup.append(createElement("p", {
          className: "herdr-session-empty",
          text: session.available === true ? "열린 프로젝트 없음" : status,
        }));
      } else {
        for (const workspace of sessionWorkspaces) {
          appendWorkspace(sessionGroup, workspace);
        }
      }
      elements.workspaceList.append(sessionGroup);
    }
    return;
  }

  for (const workspace of workspaces) {
    appendWorkspace(elements.workspaceList, workspace);
  }
}

function renderPaneHeading(pane, tab, workspace) {
  if (!pane) {
    elements.paneContext.textContent = "패인을 선택하세요";
    elements.paneTitle.textContent = "터미널";
    return;
  }

  const paneId = idOf(pane, "pane_id", "id");
  const agent = agentForPane(paneId);
  const workspaceLabel = displayRecordLabel(workspace, "워크스페이스");
  const tabLabel = displayTabLabel(tab);

  const sessionName = typeof pane.herdr_session_name === "string"
    ? pane.herdr_session_name
    : "";
  const herdrSessions = snapshotRecords().herdrSessions;
  const showSessionName = herdrSessions.length > 1 ||
    (herdrSessions.length === 1 && herdrSessions[0].available !== true);
  elements.paneContext.textContent = [
    showSessionName ? sessionName : "",
    workspaceLabel,
    tabLabel,
  ].filter(Boolean).join(" / ");
  elements.paneTitle.textContent = displayRecordLabel(
    agent,
    displayRecordLabel(pane, "터미널"),
  );
}

function renderAnsiOutput(value) {
  const fragment = document.createDocumentFragment();
  for (const segment of ansiToSegments(compactTerminalSeparators(value))) {
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
  const { herdrSessions, panes } = snapshotRecords();
  const defaultHerdrSessionId = idOf(
    herdrSessions.find((session) => session.default === true),
    "session_id",
    "id",
  ) || null;
  const nextPaneId = selectedPaneIdForSnapshot(
    panes,
    state.selectedPaneId || state.preferredPaneId,
    defaultHerdrSessionId,
  );
  if (state.selectedPaneId !== nextPaneId) resetInputHistoryNavigation();
  state.selectedPaneId = nextPaneId;
  if (nextPaneId) {
    state.preferredPaneId = nextPaneId;
    writePanePreference(panePreferenceStorage, nextPaneId);
  }
}

async function refreshSnapshot() {
  if (!state.authenticated) return;
  if (state.snapshotBusy || state.mutationBusy || document.hidden) return;
  state.snapshotBusy = true;
  try {
    const payload = await api("/api/snapshot");
    state.snapshot = payload.snapshot || {};
    choosePane();
    pruneAcknowledgedCompletions();
    if (state.selectedPaneId) acknowledgePaneCompletion(state.selectedPaneId);
    syncCreateProjectAvailability();
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
  if (!state.authenticated) return;
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
    resizeTerminalInput();
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
      resizeTerminalInput();
    }
    return;
  }

  const action = inputKeyAction({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    isComposing: event.isComposing,
    usesTouchInput: usesTouchInputEnvironment(),
  });
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
  resizeTerminalInput();
  if (state.inputHistoryCursor !== null) resetInputHistoryNavigation();
});

window.addEventListener("resize", resizeTerminalInput);

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

elements.createProject.addEventListener("click", () => {
  if (state.mutationBusy) return;
  const herdrSession = selectedHerdrSession();
  if (!herdrSession) return;
  state.createProjectSessionId = idOf(herdrSession, "session_id", "id") || null;
  elements.projectSessionContext.textContent = snapshotRecords().herdrSessions.length > 1
    ? `Herdr 세션 “${herdrSession.name}”에서 기본 셸로 시작합니다.`
    : "기본 셸로 시작합니다.";
  elements.projectDialogFeedback.textContent = "";
  elements.projectDialogFeedback.dataset.error = "false";
  elements.projectDialog.showModal();
  window.requestAnimationFrame(() => elements.projectName.focus());
});

elements.projectDialogCancel.addEventListener("click", () => {
  if (!state.mutationBusy) elements.projectDialog.close();
});

elements.projectDialog.addEventListener("close", () => {
  state.createProjectSessionId = null;
  elements.projectCreateForm.reset();
  elements.projectDialogFeedback.textContent = "";
});

elements.projectCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.mutationBusy) return;
  const label = elements.projectName.value.trim();
  if (!label) {
    elements.projectName.setCustomValidity("프로젝트 이름을 입력하세요.");
    elements.projectName.reportValidity();
    return;
  }
  elements.projectName.setCustomValidity("");
  state.mutationBusy = true;
  const submitButton = elements.projectCreateForm.querySelector('button[type="submit"]');
  elements.projectName.disabled = true;
  elements.projectDialogCancel.disabled = true;
  submitButton.disabled = true;
  elements.projectDialogFeedback.textContent = "셸을 만드는 중…";
  elements.projectDialogFeedback.dataset.error = "false";
  const previousPaneIds = new Set(
    snapshotRecords().panes.map((pane) => idOf(pane, "pane_id", "id")),
  );
  try {
    const payload = await api("/api/workspaces", {
      method: "POST",
      body: {
        label,
        ...(state.createProjectSessionId
          ? { herdrSessionId: state.createProjectSessionId }
          : {}),
      },
    });
    state.snapshot = payload.snapshot || {};
    const newPane = snapshotRecords().panes.find(
      (pane) => !previousPaneIds.has(idOf(pane, "pane_id", "id")),
    );
    adoptMutationSnapshot(
      state.snapshot,
      newPane ? idOf(newPane, "pane_id", "id") : null,
    );
    elements.projectDialog.close();
    closeMobileSidebar();
  } catch (error) {
    elements.projectDialogFeedback.textContent = error.message;
    elements.projectDialogFeedback.dataset.error = "true";
  } finally {
    state.mutationBusy = false;
    elements.projectName.disabled = false;
    elements.projectDialogCancel.disabled = false;
    submitButton.disabled = false;
  }
});

elements.projectName.addEventListener("input", () => {
  elements.projectName.setCustomValidity("");
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

elements.terminalPanel.addEventListener("wheel", (event) => {
  if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
  event.preventDefault();
  if (
    terminalFontWheelDelta !== 0 &&
    Math.sign(terminalFontWheelDelta) !== Math.sign(event.deltaY)
  ) {
    terminalFontWheelDelta = 0;
  }
  terminalFontWheelDelta += event.deltaY;
  if (Math.abs(terminalFontWheelDelta) < 40) return;
  adjustTerminalFont(terminalFontWheelDelta < 0 ? "larger" : "smaller");
  terminalFontWheelDelta = 0;
}, { passive: false });

elements.terminalOutput.addEventListener("touchstart", (event) => {
  const distance = touchDistance(event.touches);
  if (distance === null) {
    terminalPinchDistance = null;
    return;
  }
  event.preventDefault();
  terminalPinchDistance = distance;
}, { passive: false });

elements.terminalOutput.addEventListener("touchmove", (event) => {
  const distance = touchDistance(event.touches);
  if (distance === null) {
    terminalPinchDistance = null;
    return;
  }
  event.preventDefault();
  const direction = terminalPinchDirection(terminalPinchDistance, distance);
  if (!direction) return;
  adjustTerminalFont(direction);
  terminalPinchDistance = distance;
}, { passive: false });

function finishTerminalPinch(event) {
  if (event.touches.length < 2) terminalPinchDistance = null;
}

elements.terminalOutput.addEventListener("touchend", finishTerminalPinch);
elements.terminalOutput.addEventListener("touchcancel", finishTerminalPinch);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  state.openActionMenuId = null;
  for (const menu of elements.workspaceList.querySelectorAll(
    ".sidebar-action-menu[open]",
  )) menu.open = false;
  closeMobileSidebar({ restoreFocus: true });
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".sidebar-action-menu")) return;
  state.openActionMenuId = null;
  for (const menu of elements.workspaceList.querySelectorAll(
    ".sidebar-action-menu[open]",
  )) menu.open = false;
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

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.loginForm.querySelector('button[type="submit"]');
  elements.loginPassword.disabled = true;
  submitButton.disabled = true;
  elements.loginFeedback.textContent = "확인 중…";
  elements.loginFeedback.dataset.error = "false";
  try {
    await api("/api/auth/login", {
      method: "POST",
      csrf: false,
      body: { password: elements.loginPassword.value },
    });
    elements.loginPassword.value = "";
    await initializeApplication();
  } catch (error) {
    elements.loginFeedback.textContent = error.message;
    elements.loginFeedback.dataset.error = "true";
  } finally {
    elements.loginPassword.disabled = false;
    submitButton.disabled = false;
    if (elements.loginFeedback.dataset.error === "true") {
      elements.loginPassword.focus();
      elements.loginPassword.select();
    }
  }
});

async function initializeApplication() {
  const bootstrap = await api("/api/bootstrap");
  state.csrfToken = bootstrap.csrfToken;
  state.pollIntervalMs = bootstrap.pollIntervalMs || state.pollIntervalMs;
  showApplication();
  await refreshSnapshot();
  await refreshOutput();
  if (!state.pollingStarted) {
    state.pollingStarted = true;
    window.setInterval(() => void refreshSnapshot(), state.pollIntervalMs * 2);
    window.setInterval(() => void refreshOutput(), state.pollIntervalMs);
  }
}

async function start() {
  syncThemeButton();
  syncSidebar();
  resizeTerminalInput();
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
    await initializeApplication();
  } catch (error) {
    if (error.code === "authentication_required") return;
    document.body.classList.remove("auth-pending", "auth-required");
    document.body.classList.add("auth-ready");
    elements.shell.inert = false;
    setConnection("error", error.message);
    showTerminalMessage(`초기화하지 못했습니다: ${error.message}`);
  }
}

void start();

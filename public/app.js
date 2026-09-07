import { combinedTerminalKey, keyboardTerminalKey } from "./key-combinations.js?v=1.0.1";
const selectedKeyModifiers = new Set();
let modifierPaneId = null;
let keySendBusy = false;
import {
  HISTORY_PAGE_LINES,
  agentCompletionIdentity,
  agentStatus,
  agentStatusIcon,
  detectTouchInput,
  displayRecordLabel,
  displayTabLabel,
  inputKeyAction,
  insertNewlineAtSelection,
  loginMethodPresentation,
  nearTerminalBottom,
  terminalShowsOlderScreen,
  nextInputHistory,
  nextHistoryLineLimit,
  outputPollingDecision,
  outputTextForUpdate,
  paneShortcutTarget,
  selectedPaneIdForSnapshot,
  shouldRenderTerminalUpdate,
  sidebarPresentation,
  terminalOutputForEnvironment,
  terminalPinchDirection,
  visibleAgentStatus,
} from "./ui-model.js?v=1.0.1";
import { ansiToSegments } from "./ansi.js?v=1.0.1";
import {
  readPanePreference,
  writePanePreference,
} from "./pane-preference.js?v=1.0.1";
import {
  readCollapsedWorkspaceIds,
  writeCollapsedWorkspaceIds,
} from "./workspace-preference.js?v=1.0.1";
import {
  adjustedTerminalFontSize,
  readTerminalFontSize,
  writeTerminalFontSize,
} from "./terminal-preference.js?v=1.0.1";
import {
  readAcknowledgedCompletions,
  writeAcknowledgedCompletions,
} from "./completion-preference.js?v=1.0.1";
import {
  readInputHistories,
  writeInputHistories,
} from "./input-history-preference.js?v=1.0.1";
import {
  clearLaunchToken,
  readLaunchToken,
  writeLaunchToken,
} from "./launch-session.js?v=1.0.1";
import {
  applicationServerKeyBytes,
  pushButtonPresentation,
} from "./push-notifications.js?v=1.0.1";

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const panePreferenceStorage = browserStorage();
const launchSessionStorage = browserSessionStorage();
const notificationPanePreference = new URL(window.location.href).searchParams.get("pane");
let pendingNotificationPaneId = null;

function acceptNotificationTarget(value) {
  let target;
  try { target = new URL(value, window.location.href); } catch { return false; }
  if (target.origin !== window.location.origin) return false;
  const paneId = target.searchParams.get("pane");
  if (!paneId || paneId.length > 512 || /[\u0000-\u001f\u007f]/u.test(paneId)) return false;
  // Persist the target before acknowledging delivery, so a reload or Android
  // activity restoration cannot discard a switch awaiting its snapshot.
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("pane", paneId);
  window.history.replaceState(null, "", currentUrl);
  pendingNotificationPaneId = paneId;
  void refreshSnapshot();
  return true;
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "query-viewing-pane") {
      event.ports?.[0]?.postMessage({
        viewing: state.authenticated && !document.hidden &&
          state.selectedPaneId === event.data.paneId,
      });
      return;
    }
    if (event.data?.type !== "open-notification-pane") return;
    event.ports?.[0]?.postMessage({ accepted: acceptNotificationTarget(event.data.url) });
  });
}
const initialPanePreference =
  typeof notificationPanePreference === "string" &&
  notificationPanePreference.length > 0 &&
  notificationPanePreference.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(notificationPanePreference)
    ? notificationPanePreference
    : readPanePreference(panePreferenceStorage);
const initialCollapsedWorkspaceIds = readCollapsedWorkspaceIds(
  panePreferenceStorage,
);
const initialTerminalFontSize = readTerminalFontSize(panePreferenceStorage);
const initialAcknowledgedCompletions = readAcknowledgedCompletions(
  panePreferenceStorage,
);
const initialInputHistories = readInputHistories(panePreferenceStorage);
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
  notificationToggle: document.querySelector("#notification-toggle"),
  themeToggle: document.querySelector("#theme-toggle"),
  historyStatus: document.querySelector("#history-status"),
  terminalPanel: document.querySelector(".terminal-panel"),
  terminalOutput: document.querySelector("#terminal-output"),
  terminalLive: document.querySelector("#terminal-live"),
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
  loginInstruction: document.querySelector("#login-instruction"),
  loginPassword: document.querySelector("#login-password"),
  loginPasswordLabel: document.querySelector("#login-password-label"),
  loginSubmit: document.querySelector(".login-submit"),
  loginFeedback: document.querySelector("#login-feedback"),
  passkeyLogin: document.querySelector("#passkey-login"),
  passkeyDialog: document.querySelector("#passkey-dialog"),
  passkeyRegister: document.querySelector("#passkey-register"),
  passkeyDialogCancel: document.querySelector("#passkey-dialog-cancel"),
  passkeyDialogFeedback: document.querySelector("#passkey-dialog-feedback"),
};

const state = {
  csrfToken: "",
  pollIntervalMs: 1_000,
  snapshot: null,
  selectedPaneId: initialPanePreference,
  preferredPaneId: initialPanePreference,
  snapshotBusy: false,
  outputRequests: new Set(),
  lastOutputRequestAt: 0,
  outputLineLimits: new Map(),
  outputRevisions: new Map(),
  outputHasMore: new Map(),
  historyRequested: new Set(),
  historyErrors: new Map(),
  historyLoadingPaneId: null,
  desktopSidebarCollapsed: false,
  mobileSidebarOpen: false,
  renderedPaneId: null,
  renderedOutput: null,
  terminalPointerActive: false,
  terminalFollow: true,
  remoteHistoryPanes: new Set(),
  remoteLiveRequests: new Set(),
  terminalScrollSettlesAt: 0,
  terminalUserScrollAt: 0,
  outputBurstUntil: 0,
  outputRefreshQueued: false,
  inputHistoryByPane: initialInputHistories,
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
  launchToken: readLaunchToken(launchSessionStorage),
  pushPublicKey: null,
  pushSubscription: null,
  pushBusy: false,
  passkeyAvailable: false,
  passkeyBusy: false,
  passkeyAutoStarted: false,
};

const desktopMedia = window.matchMedia("(min-width: 761px)");
const primaryTouchMedia = window.matchMedia("(pointer: coarse) and (hover: none)");
const anyCoarsePointerMedia = window.matchMedia("(any-pointer: coarse)");
const anyHoverMedia = window.matchMedia("(any-hover: hover)");
const compactInputMedia = window.matchMedia("(max-width: 1024px)");
let sidebarAnimationTimer;
let terminalFontWheelDelta = 0;
let terminalPinchDistance = null;
let terminalInputResizeTimer = null;

const COMPOSER_RESIZE_DELAY_MS = 300;
// Matches the #terminal-output line-height in styles.css.
const TERMINAL_LINE_HEIGHT_RATIO = 1.55;
// How long after the last scroll event the view is left alone. Momentum
// scrolling keeps firing scroll events after the finger is already gone.
const TERMINAL_SCROLL_SETTLE_MS = 350;
// A scroll event counts as the reader's only if a gesture just produced it.
// Momentum keeps scrolling after the finger lifts, and an on-screen keyboard
// resizes the viewport, which scrolls the terminal without anyone asking.
const TERMINAL_USER_SCROLL_WINDOW_MS = 1_000;
const OUTPUT_SUBMISSION_BURST_MS = 3_000;
const OUTPUT_SUBMISSION_RETRY_MS = 250;
// Check deadlines often enough to honor the 300ms post-submission cadence.
const OUTPUT_POLL_TICK_MS = 100;

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

async function dismissDeliveredNotifications() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.getNotifications !== "function") return;
    for (const notification of await registration.getNotifications()) {
      notification.close();
    }
  } catch {
    // Tidying notifications is best effort and never blocks the app.
  }
}

function showLogin() {
  state.authenticated = false;
  document.body.classList.remove("auth-pending", "auth-ready");
  document.body.classList.add("auth-required");
  elements.shell.inert = true;
  elements.loginScreen.hidden = false;
  renderLoginMethods();
  focusLoginMethod();
  startAutomaticPasskeyLogin();
}

function focusLoginMethod() {
  if (state.authenticated || elements.loginScreen.hidden || state.passkeyBusy) return;
  if (state.passkeyAvailable && supportsPasskeys()) {
    elements.passkeyLogin.focus({ preventScroll: true });
  } else {
    focusLoginPassword();
  }
}

function startAutomaticPasskeyLogin() {
  if (document.hidden || state.authenticated || elements.loginScreen.hidden ||
      state.passkeyAutoStarted || state.passkeyBusy ||
      !state.passkeyAvailable || !supportsPasskeys()) return;
  state.passkeyAutoStarted = true;
  void startPasskeyLogin();
}

function focusLoginPassword() {
  if (state.authenticated || elements.loginScreen.hidden || elements.loginPassword.disabled) return;
  elements.loginPassword.focus({ preventScroll: true });
  // Android may focus the DOM input without opening its software keyboard.
  // Keyboard display still depends on browser policy and user activation.
  if (usesTouchInputEnvironment()) {
    try { navigator.virtualKeyboard?.show(); } catch { /* Native input remains usable. */ }
  }
}

function focusComposer() {
  if (!desktopMedia.matches || usesTouchInputEnvironment() ||
      !state.authenticated || elements.terminalInput.disabled) return;
  elements.terminalInput.focus({ preventScroll: true });
}

function showApplication() {
  state.authenticated = true;
  document.body.classList.remove("auth-pending", "auth-required");
  document.body.classList.add("auth-ready");
  elements.shell.inert = false;
  elements.loginScreen.hidden = true;
  elements.loginFeedback.textContent = "";
}

function supportsPasskeys() {
  try {
    return window.isSecureContext &&
      window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn?.() === true;
  } catch {
    return false;
  }
}

async function completePasskeyLogin(ceremony, credential) {
  // Ignore a result if another login path already established the session.
  if (state.authenticated) return;
  const login = await api("/api/auth/passkeys/login/verify", {
    method: "POST",
    csrf: false,
    body: { attemptId: ceremony.attemptId, credential },
  });
  state.launchToken = writeLaunchToken(launchSessionStorage, login.launchToken);
  state.passkeyAvailable = true;
  elements.loginPassword.value = "";
  await initializeApplication();
}

function renderLoginMethods() {
  const presentation = loginMethodPresentation({
    passkeyAvailable: state.passkeyAvailable,
    passkeySupported: supportsPasskeys(),
  });
  elements.passkeyLogin.hidden = !presentation.passkeyVisible;
  elements.passkeyLogin.disabled = state.passkeyBusy;
  elements.passkeyLogin.classList.toggle("primary-button", presentation.passkeyPrimary);
  elements.passkeyLogin.classList.toggle("secondary-button", !presentation.passkeyPrimary);
  elements.loginSubmit.classList.toggle("primary-button", presentation.passwordPrimary);
  elements.loginSubmit.classList.toggle("secondary-button", !presentation.passwordPrimary);
  elements.loginInstruction.textContent = presentation.instruction;
  elements.loginPasswordLabel.textContent = presentation.passwordLabel;
  return presentation;
}

function setLoginBusy(busy) {
  state.passkeyBusy = busy;
  elements.loginPassword.disabled = busy;
  elements.loginSubmit.disabled = busy;
  renderLoginMethods();
}

function passkeyErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "The passkey request was canceled or timed out.";
  }
  return error?.message || "The passkey request failed.";
}

function offerPasskeyRegistration() {
  if (!supportsPasskeys() || state.passkeyAvailable || elements.passkeyDialog.open) return;
  elements.passkeyDialogFeedback.textContent = "";
  elements.passkeyDialogFeedback.dataset.error = "false";
  elements.passkeyDialog.showModal();
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
  const label = nextTheme === "light" ? "Switch to light mode" : "Switch to dark mode";
  elements.themeToggle.dataset.nextTheme = nextTheme;
  elements.themeToggle.setAttribute("aria-label", label);
  elements.themeToggle.title = label;
}

function supportsPushNotifications() {
  return Boolean(
    state.pushPublicKey &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window,
  );
}

function renderNotificationButton() {
  const supported = supportsPushNotifications();
  const presentation = pushButtonPresentation({
    supported,
    permission: supported ? Notification.permission : "default",
    subscribed: state.pushSubscription !== null,
    busy: state.pushBusy,
  });
  elements.notificationToggle.hidden = presentation.hidden;
  elements.notificationToggle.disabled = presentation.disabled;
  elements.notificationToggle.dataset.state = presentation.state;
  elements.notificationToggle.setAttribute(
    "aria-pressed",
    String(presentation.pressed),
  );
  elements.notificationToggle.setAttribute("aria-label", presentation.label);
  elements.notificationToggle.title = presentation.label;
}

async function serviceWorkerRegistration() {
  if (!supportsPushNotifications()) return null;
  return navigator.serviceWorker.ready;
}

async function syncPushSubscription() {
  renderNotificationButton();
  const registration = await serviceWorkerRegistration();
  if (!registration) return;
  state.pushSubscription = await registration.pushManager.getSubscription();
  renderNotificationButton();
  if (state.pushSubscription && Notification.permission === "granted") {
    await api("/api/push/subscriptions", {
      method: "POST",
      body: { subscription: state.pushSubscription },
    });
  }
}

async function togglePushNotifications() {
  if (state.pushBusy || !supportsPushNotifications()) return;
  state.pushBusy = true;
  renderNotificationButton();
  setFeedback("");
  try {
    const registration = await serviceWorkerRegistration();
    if (!registration) return;
    const existing = state.pushSubscription ||
      await registration.pushManager.getSubscription();
    if (existing) {
      await api("/api/push/subscriptions", {
        method: "DELETE",
        body: { endpoint: existing.endpoint },
      });
      await existing.unsubscribe();
      state.pushSubscription = null;
      return;
    }

    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") return;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKeyBytes(state.pushPublicKey),
    });
    try {
      await api("/api/push/subscriptions", {
        method: "POST",
        body: { subscription },
      });
      state.pushSubscription = subscription;
    } catch (error) {
      await subscription.unsubscribe().catch(() => {});
      throw error;
    }
  } catch (error) {
    setFeedback(`Couldn't update notifications: ${error.message}`, true);
  } finally {
    state.pushBusy = false;
    renderNotificationButton();
  }
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

function supportsNativeTerminalInputSizing() {
  return typeof CSS !== "undefined" &&
    CSS.supports?.("field-sizing", "content") === true;
}

function resizeTerminalInput() {
  const input = elements.terminalInput;
  if (supportsNativeTerminalInputSizing()) {
    input.style.removeProperty("height");
    input.style.removeProperty("overflow-y");
    return;
  }
  input.style.height = "auto";
  const maxHeight = Number.parseFloat(window.getComputedStyle(input).maxHeight);
  const contentHeight = input.scrollHeight;
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(contentHeight, maxHeight)
    : contentHeight;
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = contentHeight > nextHeight ? "auto" : "hidden";
}

function scheduleTerminalInputResize() {
  if (supportsNativeTerminalInputSizing()) return;
  window.clearTimeout(terminalInputResizeTimer);
  terminalInputResizeTimer = window.setTimeout(() => {
    terminalInputResizeTimer = null;
    resizeTerminalInput();
  }, COMPOSER_RESIZE_DELAY_MS);
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
  state.inputHistoryByPane.delete(paneId);
  state.inputHistoryByPane.set(paneId, history);
  writeInputHistories(panePreferenceStorage, state.inputHistoryByPane);
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
  if (state.launchToken) {
    headers.set("X-Herdr-Launch-Token", state.launchToken);
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
    if (error.code === "authentication_required") {
      state.launchToken = clearLaunchToken(launchSessionStorage);
      showLogin();
    }
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
    servers: array(snapshot.servers),
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
      state.selectedPaneId ? "Loading output…" : "No open sessions.",
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
    !window.confirm(`Close session “${label}”? This will also stop any running processes.`)
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
    !window.confirm(`Close project “${workspaceLabel}”? This will close all of its sessions and stop any running processes.`)
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
    label: collapsed ? `Expand ${workspaceLabel}` : `Collapse ${workspaceLabel}`,
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
      ? `Expand ${workspaceLabel}`
      : `Collapse ${workspaceLabel}`;
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
    input.setAttribute("aria-label", `${workspaceLabel} project name`);
    input.addEventListener("input", () => input.setCustomValidity(""));
    const saveButton = workspaceActionButton({
      className: "workspace-rename-save",
      label: "Save project name",
      paths: ["M5 12l4 4L19 6"],
      type: "submit",
    });
    const cancelButton = workspaceActionButton({
      className: "workspace-rename-cancel",
      label: "Cancel rename",
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
        input.setCustomValidity("Enter a project name.");
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
      label: `More actions for ${workspaceLabel}`,
      actions: [
        {
          label: "Rename",
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
          label: "New session",
          paths: ["M12 5v14M5 12h14"],
          onSelect: (button) => void createShellSession(workspaceId, button),
        },
        {
          label: "Close project",
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
  const workspaceLabel = displayRecordLabel(workspace, "Project");
  const tabLabel = displayTabLabel(tab);
  const agentLabel = displayRecordLabel(agent, displayRecordLabel(pane, "Terminal"));
  const button = createElement("button", { className: "pane-button" });
  button.type = "button";
  button.dataset.paneId = paneId;
  button.dataset.status = currentAgentStatus;
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
    if (state.selectedPaneId !== paneId) {
      resetInputHistoryNavigation();
      state.terminalFollow = true;
    }
    state.selectedPaneId = paneId;
    state.preferredPaneId = paneId;
    writePanePreference(panePreferenceStorage, paneId);
    acknowledgePaneCompletion(paneId);
    setFeedback("");
    renderNavigation();
    renderPaneHeading(pane, tab, workspace);
    renderHistoryStatus();
    showTerminalMessage("Loading output…");
    void refreshOutput();
    closeMobileSidebar();
    focusComposer();
  });

  return button;
}

function renderNavigation() {
  const { servers, herdrSessions, workspaces, tabs, panes } = snapshotRecords();
  elements.workspaceList.replaceChildren();
  const showServers = servers.length > 1;
  const serverGroups = new Map();
  if (showServers) {
    for (const server of servers) {
      const group = createElement("section", { className: "server-group" });
      const heading = createElement("div", { className: `server-heading${server.available ? " is-online" : ""}` });
      heading.title = `${server.name}: ${server.status}`;
      heading.setAttribute("aria-label", heading.title);
      heading.append(createElement("span", { className: "server-dot" }), createElement("strong", { text: server.name }), createElement("small", { text: server.available ? "Connected" : server.status === "Connecting" ? "Connecting" : "Offline" }));
      group.append(heading);
      if (!server.available || !herdrSessions.some((session) => session.server_id === server.id)) {
        group.append(createElement("p", { className: "server-empty", text: server.available ? "No Herdr sessions. Start Herdr on this server." : server.status }));
      }
      serverGroups.set(server.id, group);
      elements.workspaceList.append(group);
    }
  }
  const showHerdrSessionGroups = showServers || herdrSessions.length > 1 ||
    (herdrSessions.length === 1 && herdrSessions[0].available !== true);

  const appendWorkspace = (parent, workspace) => {
    const workspaceId = idOf(workspace, "workspace_id", "id");
    const group = createElement("section", { className: "workspace-group" });
    const workspaceLabel = displayRecordLabel(workspace, "Project");
    const workspaceTabs = tabs.filter(
      (tab) => idOf(tab, "workspace_id", "workspaceId") === workspaceId,
    );
    const workspaceTabIds = new Set(
      workspaceTabs.map((tab) => idOf(tab, "tab_id", "id")),
    );
    const hasCompletion = panes.some((pane) => {
      if (!workspaceTabIds.has(idOf(pane, "tab_id", "tabId"))) return false;
      const paneId = idOf(pane, "pane_id", "id");
      return visibleStatusForPane(paneId, agentForPane(paneId), pane) === "done";
    });
    const children = createElement("div", { className: "workspace-children" });
    children.id = `workspace-${workspaceId}-children`;
    const childrenInner = createElement("div", {
      className: "workspace-children-inner",
    });
    const collapsed = state.collapsedWorkspaceIds.has(workspaceId);
    group.classList.toggle("is-collapsed", collapsed);
    group.dataset.hasCompletion = String(hasCompletion);
    children.inert = collapsed;
    children.setAttribute("aria-hidden", String(collapsed));
    group.append(workspaceHeading(group, workspace, workspaceLabel, children));

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
        displayRecordLabel(agentForPane(idOf(tabPanes[0], "pane_id", "id")), "Session");
      const sessionMenu = sidebarActionMenu({
        id: `tab-${tabId}`,
        label: `More actions for ${sessionLabel}`,
        className: "session-action-menu",
        actions: [
          {
            label: "Close session",
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
      text: "No open projects.",
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
        ? "Running"
        : session.running === true ? "Connection failed" : "Stopped";
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
          text: session.available === true ? "No open projects" : status,
        }));
      } else {
        for (const workspace of sessionWorkspaces) {
          appendWorkspace(sessionGroup, workspace);
        }
      }
      (serverGroups.get(session.server_id) || elements.workspaceList).append(sessionGroup);
    }
    return;
  }

  for (const workspace of workspaces) {
    appendWorkspace(elements.workspaceList, workspace);
  }
}

function renderPaneHeading(pane, tab, workspace) {
  renderTerminalLive();
  if (modifierPaneId !== state.selectedPaneId) clearKeyModifiers();
  if (!pane) {
    elements.paneContext.textContent = "Select a pane";
    elements.paneTitle.textContent = "Terminal";
    return;
  }

  const paneId = idOf(pane, "pane_id", "id");
  const agent = agentForPane(paneId);
  const workspaceLabel = displayRecordLabel(workspace, "Project");
  const tabLabel = displayTabLabel(tab);

  const sessionName = typeof pane.herdr_session_name === "string"
    ? pane.herdr_session_name
    : "";
  const herdrSessions = snapshotRecords().herdrSessions;
  const showSessionName = herdrSessions.length > 1 ||
    (herdrSessions.length === 1 && herdrSessions[0].available !== true);
  elements.paneContext.textContent = [
    snapshotRecords().servers.length > 1 ? pane.server_name : "",
    showSessionName ? sessionName : "",
    workspaceLabel,
    tabLabel,
  ].filter(Boolean).join(" / ");
  elements.paneTitle.textContent = displayRecordLabel(
    agent,
    displayRecordLabel(pane, "Terminal"),
  );
}

function renderAnsiOutput(value) {
  const fragment = document.createDocumentFragment();
  const visibleOutput = terminalOutputForEnvironment(value, {
    touchInput: usesTouchInputEnvironment(),
  });
  for (const segment of ansiToSegments(visibleOutput)) {
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

function selectedAgentStatus() {
  const { pane } = selectedRecords();
  return agentStatus(agentForPane(state.selectedPaneId), pane);
}

function choosePane() {
  const { herdrSessions, panes } = snapshotRecords();
  if (pendingNotificationPaneId && panes.some(
    (pane) => idOf(pane, "pane_id", "id") === pendingNotificationPaneId,
  )) {
    if (state.selectedPaneId !== pendingNotificationPaneId) {
      resetInputHistoryNavigation();
      state.terminalFollow = true;
    }
    state.selectedPaneId = pendingNotificationPaneId;
    pendingNotificationPaneId = null;
    writePanePreference(panePreferenceStorage, state.selectedPaneId);
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("pane");
    window.history.replaceState(null, "", currentUrl);
    closeMobileSidebar();
  }
  const preferredServerId = state.selectedPaneId?.split("!")[0];
  if (state.selectedPaneId?.includes("!") &&
      !panes.some((pane) => idOf(pane, "pane_id", "id") === state.selectedPaneId) &&
      snapshotRecords().servers.some((server) => server.id === preferredServerId && !server.available)) return;
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
  if (state.selectedPaneId !== nextPaneId) {
    resetInputHistoryNavigation();
    state.terminalFollow = true;
  }
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
  const previousPaneId = state.selectedPaneId;
  const previousStatus = selectedAgentStatus();
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
    setConnection("online", "Connected");
    const polling = outputPollingDecision({
      baseIntervalMs: state.pollIntervalMs,
      previousStatus,
      currentStatus: selectedAgentStatus(),
    });
    if (previousPaneId !== state.selectedPaneId || polling.refreshNow) {
      void refreshOutput();
    }
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
    elements.historyStatus.textContent = "Loading history…";
    return;
  }
  const error = state.historyErrors.get(paneId);
  if (error) {
    elements.historyStatus.textContent = `Could not load history: ${error}`;
    return;
  }
  if (state.outputHasMore.get(paneId) === true) {
    elements.historyStatus.textContent = "";
    return;
  }
  elements.historyStatus.textContent = state.historyRequested.has(paneId)
    ? "Beginning of history."
    : "";
}

async function refreshOutput({ loadOlder = false } = {}) {
  if (!state.authenticated || document.hidden || !state.selectedPaneId) return;
  if (state.outputRequests.has(state.selectedPaneId)) {
    // Run once the in-flight request finishes instead of dropping this one.
    // Otherwise the immediate refresh after sending input is simply lost and
    // the echo waits for the next scheduled poll.
    if (!loadOlder) state.outputRefreshQueued = true;
    return;
  }
  state.outputRequests.add(state.selectedPaneId);
  state.lastOutputRequestAt = Date.now();
  const requestedPaneId = state.selectedPaneId;
  const currentLineLimit =
    state.outputLineLimits.get(requestedPaneId) || HISTORY_PAGE_LINES;
  const requestedLineLimit = loadOlder
    ? nextHistoryLineLimit(currentLineLimit)
    : currentLineLimit;
  if (loadOlder && requestedLineLimit === currentLineLimit) {
    state.outputHasMore.set(requestedPaneId, false);
    state.historyRequested.add(requestedPaneId);
    state.outputRequests.delete(requestedPaneId);
    renderHistoryStatus();
    return;
  }
  if (loadOlder) {
    state.historyLoadingPaneId = requestedPaneId;
    state.historyErrors.delete(requestedPaneId);
    renderHistoryStatus();
  }
  try {
    const previousRevision =
      state.renderedPaneId === requestedPaneId &&
      typeof state.renderedOutput === "string"
        ? state.outputRevisions.get(requestedPaneId)
        : null;
    const query = new URLSearchParams({ lines: String(requestedLineLimit) });
    const selectedAgent = agentForPane(requestedPaneId);
    const selectedPane = selectedRecords().pane;
    if (previousRevision) query.set("since", previousRevision);
    const payload = await api(
      `/api/panes/${encodeURIComponent(requestedPaneId)}/output?${query}`,
    );
    if (requestedPaneId === state.selectedPaneId) {
      if (!payload.update && payload.output === undefined) return;
      const update = payload.update
        ? payload
        : { ...payload, update: "replace" };
      const nextRawOutput = outputTextForUpdate(state.renderedOutput, update);
      if (nextRawOutput === null) {
        state.outputRevisions.delete(requestedPaneId);
        return;
      }
      if (String(selectedAgent?.agent || selectedPane?.agent || "").toLowerCase() === "claude" &&
          terminalShowsOlderScreen(nextRawOutput)) {
        state.remoteHistoryPanes.add(requestedPaneId);
      } else {
        state.remoteHistoryPanes.delete(requestedPaneId);
      }
      renderTerminalLive();
      state.outputLineLimits.set(
        requestedPaneId,
        Number(payload.requestedLines) || requestedLineLimit,
      );
      state.outputHasMore.set(requestedPaneId, payload.hasMore === true);
      state.historyErrors.delete(requestedPaneId);
      if (loadOlder) state.historyRequested.add(requestedPaneId);
      const shouldRender = shouldRenderTerminalUpdate({
        renderedPaneId: state.renderedPaneId,
        nextPaneId: requestedPaneId,
        renderedOutput: state.renderedOutput,
        nextOutput: nextRawOutput,
        hasSelection: terminalHasSelection(),
        pointerActive: state.terminalPointerActive,
        scrolling: Date.now() < state.terminalScrollSettlesAt,
        // A rolling output window drops old rows as new ones arrive. Keep the
        // displayed conversation still until the reader returns to the bottom;
        // explicit history loading must remain available while reading above it.
        readingHistory: !loadOlder && !state.terminalFollow,
      });
      if (shouldRender) {
        // Read the position immediately before replacing the DOM. Reading it
        // before the request would restore wherever the view was a network
        // round trip ago, undoing any scrolling done while it was in flight.
        const previousScrollHeight = elements.terminalOutput.scrollHeight;
        const previousScrollTop = elements.terminalOutput.scrollTop;
        renderAnsiOutput(nextRawOutput || "(No output)");
        state.renderedPaneId = requestedPaneId;
        state.renderedOutput = nextRawOutput;
        if (typeof payload.revision === "string") {
          state.outputRevisions.set(requestedPaneId, payload.revision);
        }
        if (loadOlder) {
          const addedHeight = elements.terminalOutput.scrollHeight - previousScrollHeight;
          elements.terminalOutput.scrollTop = previousScrollTop + Math.max(0, addedHeight);
        } else if (state.terminalFollow) {
          elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
        } else {
          // replaceChildren empties the node list, which clamps scrollTop to 0.
          // Without this the view jumps to the top on every poll.
          elements.terminalOutput.scrollTop = previousScrollTop;
        }
      } else if (
        state.renderedPaneId === requestedPaneId &&
        state.renderedOutput === nextRawOutput &&
        typeof payload.revision === "string"
      ) {
        state.outputRevisions.set(requestedPaneId, payload.revision);
      }
    }
  } catch (error) {
    if (requestedPaneId === state.selectedPaneId) {
      if (loadOlder) {
        state.historyErrors.set(requestedPaneId, error.message);
      } else if (
        state.renderedPaneId === requestedPaneId &&
        typeof state.renderedOutput === "string"
      ) {
        // A single failed poll must not blank a terminal that is already on
        // screen; the next poll recovers it.
        setConnection("error", error.message);
      } else if (!state.terminalPointerActive && !terminalHasSelection()) {
        showTerminalMessage(`Could not read output: ${error.message}`);
      }
    }
  } finally {
    state.outputRequests.delete(requestedPaneId);
    if (state.historyLoadingPaneId === requestedPaneId) {
      state.historyLoadingPaneId = null;
    }
    if (requestedPaneId === state.selectedPaneId) renderHistoryStatus();
    if (state.outputRefreshQueued) {
      state.outputRefreshQueued = false;
      void refreshOutput();
    }
  }
}

function refreshOutputOnSchedule() {
  const polling = outputPollingDecision({
    baseIntervalMs: state.pollIntervalMs,
    currentStatus: selectedAgentStatus(),
    recentSubmission: Date.now() < state.outputBurstUntil,
    connection: navigator.connection || navigator.mozConnection || navigator.webkitConnection,
  });
  if (Date.now() - state.lastOutputRequestAt < polling.intervalMs) return;
  void refreshOutput();
}

async function sendText(text) {
  if (!state.selectedPaneId) throw new Error("Select a pane first.");
  return api(`/api/panes/${encodeURIComponent(state.selectedPaneId)}/text`, {
    method: "POST",
    body: { text, submit: true },
  });
}

async function sendKeys(keys) {
  if (!state.selectedPaneId) throw new Error("Select a pane first.");
  await api(`/api/panes/${encodeURIComponent(state.selectedPaneId)}/keys`, {
    method: "POST",
    body: { keys },
  });
}

function refreshAfterSubmission() {
  state.outputBurstUntil = Date.now() + OUTPUT_SUBMISSION_BURST_MS;
  state.terminalFollow = true;
  state.terminalScrollSettlesAt = 0;
  elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
  renderTerminalLive();
  void refreshOutput();
  window.setTimeout(() => void refreshOutput(), OUTPUT_SUBMISSION_RETRY_MS);
}

elements.inputForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.terminalInput.value;
  if (!text) return;
  const paneId = state.selectedPaneId;
  const submitButton = elements.inputForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setFeedback("Sending…");
  try {
    await sendText(text);
    rememberSentInput(paneId, text);
    elements.terminalInput.value = "";
    window.clearTimeout(terminalInputResizeTimer);
    terminalInputResizeTimer = null;
    resizeTerminalInput();
    setFeedback("");
    refreshAfterSubmission();
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
  if (usesTouchInputEnvironment()) {
    resizeTerminalInput();
  } else {
    scheduleTerminalInputResize();
  }
  if (state.inputHistoryCursor !== null) resetInputHistoryNavigation();
});

elements.terminalInput.addEventListener("blur", () => {
  void refreshOutput();
});

window.addEventListener("resize", resizeTerminalInput);

function renderKeyModifiers() {
  for (const button of elements.quickKeys.querySelectorAll("[data-modifier]")) {
    button.setAttribute("aria-pressed", String(selectedKeyModifiers.has(button.dataset.modifier)));
  }
}

function clearKeyModifiers() {
  selectedKeyModifiers.clear();
  modifierPaneId = null;
  renderKeyModifiers();
}

async function sendCommandKey(key) {
  if (!key || keySendBusy || !state.authenticated || !state.selectedPaneId) return;
  keySendBusy = true;
  clearKeyModifiers();
  setFeedback(`Sending ${key}…`);
  try {
    await sendKeys([key]);
    refreshAfterSubmission();
    setFeedback("");
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    keySendBusy = false;
  }
}

// Keep the composer focused when using the screen keyboard with a mouse.
elements.quickKeys.addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) event.preventDefault();
});

elements.quickKeys.addEventListener("click", (event) => {
  if (!state.authenticated || !state.selectedPaneId || keySendBusy) return;
  const modifier = event.target.closest("button[data-modifier]");
  if (modifier) {
    const key = modifier.dataset.modifier;
    if (selectedKeyModifiers.has(key)) selectedKeyModifiers.delete(key);
    else selectedKeyModifiers.add(key);
    modifierPaneId = state.selectedPaneId;
    renderKeyModifiers();
    focusComposer();
    return;
  }
  const button = event.target.closest("button[data-key]");
  if (!button) return;
  const modifiers = [...selectedKeyModifiers];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  void sendCommandKey(combinedTerminalKey(button.dataset.key, modifiers));
});

// Only intercept the terminal area: login fields and other dialogs retain
// their normal shortcuts. Without a selected modifier, the composer does too.
elements.terminalPanel.addEventListener("keydown", (event) => {
  if (!state.authenticated || !state.selectedPaneId) return;
  const directTerminalChord = event.target === elements.terminalOutput && (event.ctrlKey || event.altKey);
  if (selectedKeyModifiers.size === 0 && !directTerminalChord) return;
  const key = keyboardTerminalKey(event, [...selectedKeyModifiers]);
  if (!key) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void sendCommandKey(key);
}, { capture: true });

// Mobile keyboards may emit beforeinput without a usable keydown event.
elements.terminalInput.addEventListener("beforeinput", (event) => {
  if (!selectedKeyModifiers.size || event.isComposing || event.inputType !== "insertText") return;
  if (typeof event.data !== "string" || event.data.length !== 1) return;
  const key = keyboardTerminalKey({ key: event.data }, [...selectedKeyModifiers]);
  if (!key || !event.cancelable) return;
  event.preventDefault();
  void sendCommandKey(key);
});

window.addEventListener("blur", clearKeyModifiers);

elements.createProject.addEventListener("click", () => {
  document.querySelector("#add-menu").open = false;
  if (state.mutationBusy) return;
  const herdrSession = selectedHerdrSession();
  if (!herdrSession) return;
  state.createProjectSessionId = idOf(herdrSession, "session_id", "id") || null;
  const select = document.querySelector("#project-server-session");
  select.replaceChildren();
  for (const session of snapshotRecords().herdrSessions.filter((item) => item.running && item.available)) {
    const option = createElement("option", { text: `${session.server_name || "Local"} / ${session.name}` });
    option.value = idOf(session, "session_id", "id");
    select.append(option);
  }
  select.value = state.createProjectSessionId || "";
  select.disabled = select.options.length < 2;
  elements.projectSessionContext.textContent = snapshotRecords().herdrSessions.length > 1
    ? `A default shell will open in Herdr session “${herdrSession.name}”.`
    : "A default shell will open.";
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
  state.createProjectSessionId = document.querySelector("#project-server-session").value || state.createProjectSessionId;
  const label = elements.projectName.value.trim();
  if (!label) {
    elements.projectName.setCustomValidity("Enter a project name.");
    elements.projectName.reportValidity();
    return;
  }
  elements.projectName.setCustomValidity("");
  state.mutationBusy = true;
  const submitButton = elements.projectCreateForm.querySelector('button[type="submit"]');
  elements.projectName.disabled = true;
  elements.projectDialogCancel.disabled = true;
  submitButton.disabled = true;
  elements.projectDialogFeedback.textContent = "Creating project…";
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
      (pane) => !previousPaneIds.has(idOf(pane, "pane_id", "id")) &&
        (!state.createProjectSessionId || pane.herdr_session_id === state.createProjectSessionId),
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

elements.notificationToggle.addEventListener("click", () => {
  void togglePushNotifications();
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

function activatePaneShortcut(event) {
  if (!state.authenticated || document.querySelector("dialog[open]")) return false;
  const paneButtons = Array.from(
    elements.workspaceList.querySelectorAll(".pane-button"),
  );
  const targetPaneId = paneShortcutTarget({
    key: event.key,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    isComposing: event.isComposing,
    paneIds: paneButtons.map((button) => button.dataset.paneId),
    currentPaneId: state.selectedPaneId,
  });
  if (!targetPaneId) return false;

  const targetButton = paneButtons.find(
    (button) => button.dataset.paneId === targetPaneId,
  );
  if (!targetButton) return false;
  event.preventDefault();
  targetButton.click();
  return true;
}

document.addEventListener("keydown", (event) => {
  if (activatePaneShortcut(event)) return;
  if (event.key !== "Escape") return;
  document.querySelector("#add-menu").open = false;
  state.openActionMenuId = null;
  for (const menu of elements.workspaceList.querySelectorAll(
    ".sidebar-action-menu[open]",
  )) menu.open = false;
  closeMobileSidebar({ restoreFocus: true });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#add-menu")) document.querySelector("#add-menu").open = false;
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

function renderTerminalLive() {
  elements.terminalLive.hidden = !state.selectedPaneId ||
    (state.terminalFollow && !state.remoteHistoryPanes.has(state.selectedPaneId));
  elements.terminalLive.disabled = state.remoteLiveRequests.has(state.selectedPaneId);
}

async function returnTerminalToLive() {
  const paneId = state.selectedPaneId;
  if (!state.authenticated || !paneId || state.remoteLiveRequests.has(paneId)) return;
  if (!state.remoteHistoryPanes.has(paneId)) {
    if (!state.terminalFollow) refreshAfterSubmission();
    return;
  }
  state.remoteLiveRequests.add(paneId);
  state.terminalFollow = true;
  state.terminalScrollSettlesAt = 0;
  renderTerminalLive();
  try {
    await api(`/api/panes/${encodeURIComponent(paneId)}/keys`, {
      method: "POST", body: { keys: ["ctrl+end"] },
    });
    state.remoteHistoryPanes.delete(paneId);
    if (state.selectedPaneId === paneId) refreshAfterSubmission();
  } catch (error) {
    if (state.selectedPaneId === paneId) setFeedback(error.message, true);
  } finally {
    state.remoteLiveRequests.delete(paneId);
    renderTerminalLive();
  }
}

function terminalAtBottom() {
  return nearTerminalBottom({
    scrollTop: elements.terminalOutput.scrollTop,
    scrollHeight: elements.terminalOutput.scrollHeight,
    clientHeight: elements.terminalOutput.clientHeight,
  });
}

elements.terminalLive.addEventListener("click", () => void returnTerminalToLive());
elements.terminalOutput.addEventListener("wheel", (event) => {
  if (event.deltaY > 0 && !event.ctrlKey && terminalAtBottom()) void returnTerminalToLive();
}, { passive: true });
let terminalTouchY = null;
elements.terminalOutput.addEventListener("touchstart", (event) => {
  terminalTouchY = event.touches.length === 1 ? event.touches[0].clientY : null;
}, { passive: true });
elements.terminalOutput.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 1) { terminalTouchY = null; return; }
  const nextY = event.touches[0].clientY;
  if (terminalTouchY !== null && nextY < terminalTouchY - 8 && terminalAtBottom()) void returnTerminalToLive();
  if (terminalTouchY === null || nextY > terminalTouchY) terminalTouchY = nextY;
}, { passive: true });

function markTerminalUserScroll() {
  state.terminalUserScrollAt = Date.now();
}

for (const gesture of ["wheel", "touchmove"]) {
  elements.terminalOutput.addEventListener(gesture, markTerminalUserScroll, {
    passive: true,
  });
}

let previousTerminalScrollTop = 0;
elements.terminalOutput.addEventListener("scroll", () => {
  const scrollingDown = elements.terminalOutput.scrollTop > previousTerminalScrollTop;
  previousTerminalScrollTop = elements.terminalOutput.scrollTop;
  const readerDriven = state.terminalPointerActive ||
    Date.now() - state.terminalUserScrollAt < TERMINAL_USER_SCROLL_WINDOW_MS;
  if (readerDriven) {
    state.terminalFollow = nearTerminalBottom({
      scrollTop: elements.terminalOutput.scrollTop,
      scrollHeight: elements.terminalOutput.scrollHeight,
      clientHeight: elements.terminalOutput.clientHeight,
      lineHeight: state.terminalFontSize * TERMINAL_LINE_HEIGHT_RATIO,
    });
    renderTerminalLive();
    if (scrollingDown && state.terminalFollow) void returnTerminalToLive();
    // While the view follows the bottom the scrolling is ours, not the
    // reader's, and re-rendering there is what keeps output visible.
    if (!state.terminalFollow) {
      state.terminalScrollSettlesAt = Date.now() + TERMINAL_SCROLL_SETTLE_MS;
    }
  }
  if (
    elements.terminalOutput.scrollTop <= 24 &&
    state.outputHasMore.get(state.selectedPaneId) === true
  ) {
    void refreshOutput({ loadOlder: true });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state.authenticated) return;
  void dismissDeliveredNotifications();
  if (pendingNotificationPaneId) void refreshSnapshot();
  void refreshOutput();
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

elements.loginScreen.addEventListener("click", (event) => {
  if (event.target.closest("button, a, input, label")) return;
  focusLoginPassword();
});

window.addEventListener("focus", () => {
  if (document.activeElement === document.body) focusLoginMethod();
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginBusy(true);
  elements.loginFeedback.textContent = "Signing in…";
  elements.loginFeedback.dataset.error = "false";
  try {
    const login = await api("/api/auth/login", {
      method: "POST",
      csrf: false,
      body: { password: elements.loginPassword.value },
    });
    state.launchToken = writeLaunchToken(
      launchSessionStorage,
      login.launchToken,
    );
    state.passkeyAvailable = login.passkeyAvailable === true;
    const shouldOfferRegistration = !state.passkeyAvailable && supportsPasskeys();
    elements.loginPassword.value = "";
    await initializeApplication();
    if (shouldOfferRegistration) offerPasskeyRegistration();
  } catch (error) {
    elements.loginFeedback.textContent = error.message;
    elements.loginFeedback.dataset.error = "true";
  } finally {
    setLoginBusy(false);
    if (elements.loginFeedback.dataset.error === "true") {
      elements.loginPassword.focus();
      elements.loginPassword.select();
    }
  }
});

async function startPasskeyLogin() {
  if (state.passkeyBusy || state.authenticated || !state.passkeyAvailable || !supportsPasskeys()) return;
  setLoginBusy(true);
  elements.loginFeedback.textContent = "Verifying passkey…";
  elements.loginFeedback.dataset.error = "false";
  try {
    const ceremony = await api("/api/auth/passkeys/login/options", {
      method: "POST",
      csrf: false,
      body: {},
    });
    const credential = await window.SimpleWebAuthnBrowser.startAuthentication({
      optionsJSON: ceremony.options,
    });
    await completePasskeyLogin(ceremony, credential);
  } catch (error) {
    elements.loginFeedback.textContent = passkeyErrorMessage(error);
    elements.loginFeedback.dataset.error = "true";
  } finally {
    setLoginBusy(false);
    if (document.activeElement === document.body) focusLoginMethod();
  }
}

elements.passkeyLogin.addEventListener("click", () => void startPasskeyLogin());
document.addEventListener("visibilitychange", startAutomaticPasskeyLogin);

elements.passkeyDialogCancel.addEventListener("click", () => {
  if (!state.passkeyBusy) elements.passkeyDialog.close();
});

elements.passkeyRegister.addEventListener("click", async () => {
  if (state.passkeyBusy || !supportsPasskeys()) return;
  state.passkeyBusy = true;
  elements.passkeyRegister.disabled = true;
  elements.passkeyDialogCancel.disabled = true;
  elements.passkeyDialogFeedback.textContent = "Follow the prompt on your device…";
  elements.passkeyDialogFeedback.dataset.error = "false";
  try {
    const ceremony = await api("/api/auth/passkeys/register/options", {
      method: "POST",
      body: {},
    });
    const credential = await window.SimpleWebAuthnBrowser.startRegistration({
      optionsJSON: ceremony.options,
    });
    await api("/api/auth/passkeys/register/verify", {
      method: "POST",
      body: { attemptId: ceremony.attemptId, credential },
    });
    state.passkeyAvailable = true;
    elements.passkeyDialog.close();
  } catch (error) {
    elements.passkeyDialogFeedback.textContent = passkeyErrorMessage(error);
    elements.passkeyDialogFeedback.dataset.error = "true";
  } finally {
    state.passkeyBusy = false;
    elements.passkeyRegister.disabled = false;
    elements.passkeyDialogCancel.disabled = false;
    renderLoginMethods();
  }
});

async function initializeApplication() {
  document.querySelector("#manage-servers").disabled = false;
  const bootstrap = await api("/api/bootstrap");
  state.csrfToken = bootstrap.csrfToken;
  state.pollIntervalMs = bootstrap.pollIntervalMs || state.pollIntervalMs;
  state.pushPublicKey = typeof bootstrap.pushPublicKey === "string"
    ? bootstrap.pushPublicKey
    : null;
  showApplication();
  await refreshSnapshot();
  await refreshOutput();
  if (notificationPanePreference) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("pane");
    window.history.replaceState(null, "", cleanUrl);
  }
  void syncPushSubscription().catch(() => renderNotificationButton());
  void dismissDeliveredNotifications();
  focusComposer();
  if (!state.pollingStarted) {
    state.pollingStarted = true;
    window.setInterval(() => void refreshSnapshot(), state.pollIntervalMs * 2);
    window.setInterval(refreshOutputOnSchedule, Math.min(state.pollIntervalMs, OUTPUT_POLL_TICK_MS));
  }
}

const serversDialog = document.querySelector("#servers-dialog");
const sshForm = document.querySelector("#ssh-profile-form");
const sshFeedback = document.querySelector("#ssh-feedback");
let editingSshProfile = null;
let sshBusy = false;

function syncSshAuthentication() {
  const method = sshForm.elements.namedItem("authMethod").value;
  document.querySelector("#ssh-key-fields").hidden = method !== "key";
  document.querySelector("#ssh-password-fields").hidden = method !== "password";
  sshForm.elements.namedItem("identityFile").required = method === "key";
  sshForm.elements.namedItem("password").required = method === "password";
  if (method !== "password") sshForm.elements.namedItem("password").value = "";
}

document.querySelector("#ssh-auth-method").addEventListener("change", syncSshAuthentication);

function resetSshForm(profile = null) {
  editingSshProfile = profile?.id || null;
  sshForm.reset();
  if (profile) for (const name of ["name", "host", "username", "port", "identityFile", "herdrBin", "authMethod"]) {
    sshForm.elements.namedItem(name).value = profile[name] ?? "";
  }
  syncSshAuthentication();
  sshFeedback.textContent = "";
  sshFeedback.dataset.error = "false";
  sshForm.querySelector('button[type="submit"]').textContent = profile ? "Save changes" : "Save";
}

async function sshAction(action) {
  if (sshBusy) return;
  sshBusy = true;
  serversDialog.querySelectorAll("button, input, select").forEach((element) => { element.disabled = true; });
  sshFeedback.textContent = "Connecting…";
  sshFeedback.dataset.error = "false";
  try { await action(); }
  catch (error) { sshFeedback.textContent = error.message; sshFeedback.dataset.error = "true"; }
  finally {
    sshBusy = false;
    serversDialog.querySelectorAll("button, input, select").forEach((element) => { element.disabled = false; });
  }
}

async function loadSshProfiles() {
  const { profiles } = await api("/api/ssh-profiles");
  const list = document.querySelector("#ssh-profile-list");
  list.replaceChildren();
  for (const profile of profiles) {
    const row = createElement("div", { className: "ssh-profile-row" });
    row.append(createElement("strong", { text: profile.name }));
    const edit = createElement("button", { className: "secondary-button", text: "Edit" });
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${profile.name}`);
    edit.addEventListener("click", () => { if (!sshBusy) { resetSshForm(profile); sshForm.elements.namedItem("name").focus(); } });
    const remove = createElement("button", { className: "secondary-button", text: "Remove" });
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${profile.name}`);
    remove.addEventListener("click", () => {
      if (sshBusy || !window.confirm(`Remove “${profile.name}” from HerdRabbit? Remote sessions will keep running.`)) return;
      void sshAction(async () => {
        await api(`/api/ssh-profiles/${profile.id}`, { method: "DELETE" });
        if (editingSshProfile === profile.id) resetSshForm();
        await loadSshProfiles();
        await refreshSnapshot();
        sshFeedback.textContent = "Server removed.";
      });
    });
    row.append(edit, remove);
    list.append(row);
  }
}

document.querySelector("#manage-servers").addEventListener("click", () => {
  document.querySelector("#add-menu").open = false;
  resetSshForm();
  serversDialog.showModal();
  void sshAction(async () => { await loadSshProfiles(); sshFeedback.textContent = ""; });
});
document.querySelector("#ssh-close").addEventListener("click", () => { if (!sshBusy) serversDialog.close(); });
serversDialog.addEventListener("cancel", (event) => { if (sshBusy) event.preventDefault(); });
serversDialog.addEventListener("close", () => { sshForm.elements.namedItem("password").value = ""; });
document.querySelector("#ssh-test").addEventListener("click", () => {
  if (!sshForm.reportValidity()) return;
  const profile = Object.fromEntries(new FormData(sshForm));
  void sshAction(async () => {
    const result = await api("/api/ssh-profiles/test", { method: "POST", body: profile });
    sshFeedback.textContent = `Connected. ${result.sessions} Herdr sessions, ${result.panes} panes.`;
  });
});
sshForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const profile = Object.fromEntries(new FormData(sshForm));
  void sshAction(async () => {
    await api(editingSshProfile ? `/api/ssh-profiles/${editingSshProfile}` : "/api/ssh-profiles", {
      method: editingSshProfile ? "PUT" : "POST", body: profile,
    });
    resetSshForm();
    await loadSshProfiles();
    await refreshSnapshot();
    sshFeedback.textContent = "Saved. Connection status appears in the sidebar.";
  });
});

async function start() {
  if (window.launchQueue?.setConsumer) {
    window.launchQueue.setConsumer((launch) => {
      if (launch.targetURL) acceptNotificationTarget(launch.targetURL);
    });
  }
  syncThemeButton();
  renderNotificationButton();
  syncSidebar();
  resizeTerminalInput();
  if ("serviceWorker" in navigator) {
    // Worker updates must not reload an active conversation or drop a pending
    // notification target. Refresh application code on the next page load.
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
  try {
    const authStatus = await api("/api/auth/status", { csrf: false });
    state.passkeyAvailable = authStatus.passkeyAvailable === true;
    if (authStatus.required && !authStatus.authenticated) {
      showLogin();
      return;
    }
    await initializeApplication();
  } catch (error) {
    if (error.code === "authentication_required") return;
    document.body.classList.remove("auth-pending", "auth-required");
    document.body.classList.add("auth-ready");
    elements.shell.inert = false;
    setConnection("error", error.message);
    showTerminalMessage(`Could not initialize: ${error.message}`);
  }
}

void start();

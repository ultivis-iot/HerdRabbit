import { combinedTerminalKey, keyboardTerminalKey } from "./key-combinations.js?v=1.4.0";
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
  flattenTree,
  formatTransferSize,
  inputKeyAction,
  insertNewlineAtSelection,
  insertPathAtSelection,
  paneStartDirectory,
  paneServerId,
  parentDirectory,
  loginMethodPresentation,
  nearTerminalBottom,
  terminalShowsOlderScreen,
  nextInputHistory,
  shouldBrowseInputHistory,
  preferredLoginMethod,
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
} from "./ui-model.js?v=1.4.0";
import { ansiToSegments } from "./ansi.js?v=1.4.0";
import {
  clampNavigatorWidth,
  readBrowsePath,
  readNavigatorTab,
  readNavigatorWidth,
  writeBrowsePath,
  writeNavigatorTab,
  writeNavigatorWidth,
} from "./browse-preference.js?v=1.4.0";
import { linkTerminalSegments } from "./terminal-links.js?v=1.4.0";
import { attachDirectTerminalInput } from "./direct-terminal-input.js?v=1.4.0";
import { terminalConnection } from "./terminal-connection.js?v=1.4.0";
import {
  readPanePreference,
  writePanePreference,
} from "./pane-preference.js?v=1.4.0";
import {
  readCollapsedGroupIds,
  readCollapsedWorkspaceIds,
  writeCollapsedGroupIds,
  writeCollapsedWorkspaceIds,
} from "./workspace-preference.js?v=1.4.0";
import {
  adjustedTerminalFontSize,
  readTerminalFontSize,
  writeTerminalFontSize,
} from "./terminal-preference.js?v=1.4.0";
import {
  readAcknowledgedCompletions,
  writeAcknowledgedCompletions,
} from "./completion-preference.js?v=1.4.0";
import {
  readInputHistories,
  writeInputHistories,
} from "./input-history-preference.js?v=1.4.0";
import {
  clearLaunchToken,
  readLaunchToken,
  writeLaunchToken,
} from "./launch-session.js?v=1.4.0";
import {
  applicationServerKeyBytes,
  pushButtonPresentation,
} from "./push-notifications.js?v=1.4.0";

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
let lastLoginMethod;
try { lastLoginMethod = panePreferenceStorage?.getItem("herdr:last-login-method"); } catch {}

function rememberLoginMethod(method) {
  lastLoginMethod = method;
  try { panePreferenceStorage?.setItem("herdr:last-login-method", method); } catch {}
}

function currentLoginMethod() {
  return preferredLoginMethod({
    lastMethod: lastLoginMethod, touchInput: usesTouchInputEnvironment(),
    passkeyAvailable: state.passkeyAvailable && supportsPasskeys(),
  });
}
const launchSessionStorage = browserSessionStorage();
const notificationPanePreference = new URL(window.location.href).searchParams.get("pane");
let pendingNotificationPaneId = null;
const notificationNavigationCache = "herdr-notification-navigation-v1";
let notificationRelayTarget = null;
let notificationRelayCompletedId = null;
let notificationRelayChannel = null;

function receiveNotificationRelay(target) {
  if (!target || typeof target.id !== "string" || !Number.isFinite(target.expiresAt) || target.expiresAt < Date.now()) return false;
  if (target.id === notificationRelayCompletedId || target.id === notificationRelayTarget?.id) return true;
  notificationRelayTarget = target;
  if (!acceptNotificationTarget(target.url)) { notificationRelayTarget = null; return false; }
  return true;
}

async function requestNotificationWorker(message) {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (result) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(result); };
    const timer = setTimeout(() => finish(null), 800);
    channel.port1.onmessage = (event) => finish(event.data);
    try { worker.postMessage(message, [channel.port2]); } catch { finish(null); }
  });
}

async function restoreNotificationTarget() {
  const response = await requestNotificationWorker({ type: "read-notification-target" });
  if (response && !response.unavailable) {
    if (response.target) receiveNotificationRelay(response.target);
    return;
  }
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(notificationNavigationCache);
    const [pending, applied] = await Promise.all([cache.match("/pending"), cache.match("/applied")]);
    if (!pending) return;
    const target = await pending.json();
    if (applied && (await applied.json()).id === target.id) return;
    receiveNotificationRelay(target);
  } catch { /* Direct messages and the launch URL remain available. */ }
}

async function completeNotificationRelay() {
  const target = notificationRelayTarget;
  if (!target || document.hidden || state.renderedPaneId !== state.selectedPaneId ||
      new URL(target.url, location.href).searchParams.get("pane") !== state.selectedPaneId) return;
  notificationRelayTarget = null;
  notificationRelayCompletedId = target.id;
  notificationRelayChannel?.postMessage({ type: "notification-target-applied", id: target.id, visible: true });
  const response = await requestNotificationWorker({ type: "complete-notification-target", id: target.id });
  if (response?.applied) return;
  try {
    const cache = await caches.open(notificationNavigationCache);
    await cache.put("/applied", new Response(JSON.stringify({ id: target.id })));
  } catch { /* Acknowledgement still reached the active worker. */ }
}
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
    event.ports?.[0]?.postMessage({ accepted: event.data.target
      ? receiveNotificationRelay(event.data.target) : acceptNotificationTarget(event.data.url) });
  });
}
const initialPanePreference =
  typeof notificationPanePreference === "string" &&
  notificationPanePreference.length > 0 &&
  notificationPanePreference.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(notificationPanePreference)
    ? notificationPanePreference
    : readPanePreference(panePreferenceStorage);
const initialCollapsedGroupIds = readCollapsedGroupIds(
  (() => { try { return window.localStorage; } catch { return null; } })(),
);
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
  attachButton: document.querySelector("#attach-button"),
  transferDialog: document.querySelector("#transfer-dialog"),
  transferFile: document.querySelector("#transfer-file"),
  transferUpload: document.querySelector("#transfer-upload"),
  transferClose: document.querySelector("#transfer-close"),
  transferDialogFeedback: document.querySelector("#transfer-dialog-feedback"),
  transferDrop: document.querySelector("#transfer-drop"),
  transferDropLabel: document.querySelector("#transfer-drop-label"),
  uploadsList: document.querySelector("#uploads-list"),
  navigator: document.querySelector("#navigator"),
  navigatorResizer: document.querySelector("#navigator-resizer"),
  navigatorTabs: document.querySelectorAll(".navigator-tab"),
  tabSessions: document.querySelector("#tab-sessions"),
  tabFiles: document.querySelector("#tab-files"),
  filePanel: document.querySelector("#file-panel"),
  filePath: document.querySelector("#file-path"),
  fileSuggestions: document.querySelector("#file-suggestions"),
  fileUp: document.querySelector("#file-up"),
  fileUploads: document.querySelector("#file-uploads"),
  fileHidden: document.querySelector("#file-hidden"),
  fileServer: document.querySelector("#file-server"),
  browseTree: document.querySelector("#file-tree"),
  browseFeedback: document.querySelector("#file-feedback"),
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
  collapsedGroupIds: initialCollapsedGroupIds,
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
  terminalStream.pause();
  state.authenticated = false;
  document.body.classList.remove("auth-pending", "auth-ready");
  document.body.classList.add("auth-required");
  elements.shell.inert = true;
  elements.loginScreen.hidden = false;
  renderLoginMethods();
  // Let the revealed login screen participate in layout before requesting IME
  // focus, as in the original password login flow.
  window.requestAnimationFrame(() => {
    if (!elements.loginScreen.contains(document.activeElement)) focusLoginMethod();
  });
  startAutomaticPasskeyLogin();
}

function focusLoginMethod() {
  if (state.authenticated || elements.loginScreen.hidden || state.passkeyBusy) return;
  if (currentLoginMethod() === "passkey") {
    elements.passkeyLogin.focus({ preventScroll: true });
  } else {
    focusLoginPassword();
  }
}

function restoreLoginFocus() {
  if (document.hidden || state.authenticated || elements.loginScreen.hidden) return;
  const active = document.activeElement;
  // Preserve the user's chosen control; restore only missing login focus.
  if ((active === elements.loginPassword && currentLoginMethod() === "password") ||
      !elements.loginScreen.contains(active)) {
    focusLoginMethod();
  }
  startAutomaticPasskeyLogin();
}

function startAutomaticPasskeyLogin() {
  if (document.hidden || state.authenticated || elements.loginScreen.hidden ||
      currentLoginMethod() !== "passkey" ||
      state.passkeyAutoStarted || state.passkeyBusy ||
      !state.passkeyAvailable || !supportsPasskeys()) return;
  state.passkeyAutoStarted = true;
  void startPasskeyLogin();
}

function focusLoginPassword() {
  if (state.authenticated || elements.loginScreen.hidden || elements.loginPassword.disabled) return;
  elements.loginPassword.focus();
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
  rememberLoginMethod("passkey");
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

// Server and session headings fold the same way project headings do, so a
// sidebar with several machines can be narrowed down to the one in use.
function attachGroupCollapse(group, heading, body, groupId, label) {
  const collapsed = state.collapsedGroupIds.has(groupId);
  const button = workspaceActionButton({
    className: "group-collapse",
    label: `${collapsed ? "Expand" : "Collapse"} ${label}`,
    paths: ["M9 18l6-6-6-6"],
  });
  button.setAttribute("aria-expanded", String(!collapsed));
  group.classList.toggle("is-collapsed", collapsed);
  body.inert = collapsed;
  body.setAttribute("aria-hidden", String(collapsed));

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.collapsedGroupIds.has(groupId)) state.collapsedGroupIds.delete(groupId);
    else state.collapsedGroupIds.add(groupId);
    const now = state.collapsedGroupIds.has(groupId);
    group.classList.toggle("is-collapsed", now);
    body.inert = now;
    body.setAttribute("aria-hidden", String(now));
    button.setAttribute("aria-expanded", String(!now));
    const next = `${now ? "Expand" : "Collapse"} ${label}`;
    button.setAttribute("aria-label", next);
    button.title = next;
    writeCollapsedGroupIds(panePreferenceStorage, state.collapsedGroupIds);
  });
  heading.prepend(button);
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
      const body = createElement("div", { className: "server-body" });
      if (!server.available || !herdrSessions.some((session) => session.server_id === server.id)) {
        body.append(createElement("p", { className: "server-empty", text: server.available ? "No Herdr sessions. Start Herdr on this server." : server.status }));
      }
      group.append(body);
      attachGroupCollapse(group, heading, body, `server:${server.id}`, server.name);
      serverGroups.set(server.id, body);
      elements.workspaceList.append(group);
    }
  }
  // A session heading earns its place only when there is something to tell
  // apart: more than one session on a server, or one that is not running. With
  // servers shown, the server heading already says which machine this is.
  const sessionsPerServer = new Map();
  for (const session of herdrSessions) {
    const id = session.server_id || "local";
    sessionsPerServer.set(id, (sessionsPerServer.get(id) || 0) + 1);
  }
  const showHerdrSessionGroups = [...sessionsPerServer.values()].some((count) => count > 1) ||
    herdrSessions.some((session) => session.available !== true);

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
    const hasRequest = panes.some((pane) => {
      if (!workspaceTabIds.has(idOf(pane, "tab_id", "tabId"))) return false;
      const paneId = idOf(pane, "pane_id", "id");
      return visibleStatusForPane(paneId, agentForPane(paneId), pane) === "blocked";
    });
    const children = createElement("div", { className: "workspace-children" });
    children.id = `workspace-${workspaceId}-children`;
    const childrenInner = createElement("div", {
      className: "workspace-children-inner",
    });
    const collapsed = state.collapsedWorkspaceIds.has(workspaceId);
    group.classList.toggle("is-collapsed", collapsed);
    group.dataset.hasCompletion = String(hasCompletion);
    group.dataset.hasRequest = String(hasRequest);
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
      const sessionBody = createElement("div", { className: "herdr-session-body" });

      const sessionWorkspaces = workspaces.filter(
        (workspace) => idOf(
          workspace,
          "herdr_session_id",
          "herdrSessionId",
        ) === sessionId,
      );
      if (sessionWorkspaces.length === 0) {
        sessionBody.append(createElement("p", {
          className: "herdr-session-empty",
          text: session.available === true ? "No open projects" : status,
        }));
      } else {
        for (const workspace of sessionWorkspaces) {
          appendWorkspace(sessionBody, workspace);
        }
      }
      sessionGroup.append(sessionBody);
      attachGroupCollapse(
        sessionGroup,
        sessionHeading,
        sessionBody,
        `session:${sessionId}`,
        displayRecordLabel(session, "Herdr session"),
      );
      (serverGroups.get(session.server_id) || elements.workspaceList).append(sessionGroup);
    }
    return;
  }

  // Without session headings the projects still belong to a machine, so they go
  // inside that server's body. Appending them to the list itself would leave
  // them as siblings of the server heading, which then collapses over nothing.
  for (const workspace of workspaces) {
    appendWorkspace(serverGroups.get(workspace.server_id) || elements.workspaceList, workspace);
  }
}

function renderPaneHeading(pane, tab, workspace) {
  renderTerminalLive();
  syncAttachAvailability();
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
  let linkElement = null;
  let linkStart = null;
  for (const segment of linkTerminalSegments(ansiToSegments(visibleOutput))) {
    if (segment.href && segment.linkStart !== linkStart) {
      linkElement = document.createElement("a");
      linkElement.href = segment.href;
      linkElement.target = "_blank";
      linkElement.rel = "noopener noreferrer";
      linkElement.className = "terminal-link";
      linkElement.title = segment.href;
      linkStart = segment.linkStart;
      fragment.append(linkElement);
    } else if (!segment.href) {
      linkElement = null;
      linkStart = null;
    }
    const parent = linkElement || fragment;
    const hasStyle =
      segment.bold ||
      segment.dim ||
      segment.italic ||
      segment.underline ||
      segment.inverse ||
      segment.foreground ||
      segment.background;
    if (!hasStyle) {
      parent.append(document.createTextNode(segment.text));
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
    parent.append(span);
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

const liveStatusUpdates = new Map();
let liveStatusSequence = 0;

function applyLiveStatus(event) {
  const records = snapshotRecords();
  for (const record of [...records.panes, ...records.agents]) {
    if (idOf(record, "pane_id", "id") === event.pane_id) record.agent_status = event.agent_status;
  }
}

function receiveLiveStatus(event) {
  if (!["idle", "working", "blocked", "done", "unknown"].includes(event.agent_status)) return;
  if (!snapshotRecords().panes.some(pane => idOf(pane, "pane_id", "id") === event.pane_id)) return;
  liveStatusUpdates.set(event.pane_id, { ...event, sequence: ++liveStatusSequence });
  applyLiveStatus(event);
  pruneAcknowledgedCompletions();
  if (state.selectedPaneId) acknowledgePaneCompletion(state.selectedPaneId);
  if (!state.editingWorkspaceId) renderNavigation();
  const selected = selectedRecords();
  renderPaneHeading(selected.pane, selected.tab, selected.workspace);
}

async function refreshSnapshot() {
  if (!state.authenticated) return;
  if (state.snapshotBusy || state.mutationBusy || document.hidden) return;
  state.snapshotBusy = true;
  const previousPaneId = state.selectedPaneId;
  const previousStatus = selectedAgentStatus();
  try {
    await restoreNotificationTarget();
    const statusAtRequest = liveStatusSequence;
    const payload = await api("/api/snapshot");
    const previouslyAcknowledged = new Set(snapshotRecords().panes.filter(pane => {
      const id = idOf(pane, "pane_id", "id");
      return state.acknowledgedCompletions.get(id) === agentCompletionIdentity(agentForPane(id), pane);
    }).map(pane => idOf(pane, "pane_id", "id")));
    state.snapshot = payload.snapshot || {};
    const records = snapshotRecords();
    const paneIds = records.panes.map(pane => idOf(pane, "pane_id", "id"));
    for (const [paneId, event] of liveStatusUpdates) {
      const pane = records.panes.find(pane => idOf(pane, "pane_id", "id") === paneId);
      if (!pane) { liveStatusUpdates.delete(paneId); continue; }
      const agent = agentForPane(paneId);
      if (agentStatus(agent, pane) === event.agent_status && event.sequence <= statusAtRequest) {
        liveStatusUpdates.delete(paneId);
        if (event.agent_status === "done" && previouslyAcknowledged.has(paneId)) {
          state.acknowledgedCompletions.set(paneId, agentCompletionIdentity(agent, pane));
        }
      } else applyLiveStatus(event); // A slow HTTP response must not undo a newer event.
    }
    terminalStream.watchStatuses(paneIds);
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
    if (previousPaneId !== state.selectedPaneId || polling.refreshNow || notificationRelayTarget) {
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

async function refreshOutput({ loadOlder = false, streamPayload = null } = {}) {
  if (!state.authenticated || document.hidden || !state.selectedPaneId) return;
  if (!loadOlder && !streamPayload) {
    const lines = state.outputLineLimits.get(state.selectedPaneId) || HISTORY_PAGE_LINES;
    terminalStream.select(state.selectedPaneId, lines);
    streamPayload = terminalStream.latest(state.selectedPaneId, lines);
    if (!streamPayload) return;
  }
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
    const payload = streamPayload || await api(
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
    void completeNotificationRelay();
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

async function sendText(text, paneId = state.selectedPaneId) {
  if (!paneId) throw new Error("Select a pane first.");
  return terminalStream.send({ paneId, text, submit: true });
}

async function sendKeys(keys, paneId = state.selectedPaneId) {
  if (!paneId) throw new Error("Select a pane first.");
  await terminalStream.send({ paneId, keys });
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

const terminalStream = terminalConnection({
  credentials: () => ({ csrf: state.csrfToken, launchToken: state.launchToken }),
  onOutput: payload => {
    if (payload.paneId === state.selectedPaneId && payload.requestedLines ===
        (state.outputLineLimits.get(state.selectedPaneId) || HISTORY_PAGE_LINES)) {
      setConnection("online", "Connected");
      void refreshOutput({ streamPayload: payload });
    }
  },
  onDisconnect: error => {
    liveStatusUpdates.clear();
    if (state.authenticated && !document.hidden) {
      directTerminalInput.stop(error);
      setConnection("error", error.message);
    }
  },
  onAuthenticationRequired: () => showLogin(),
  onStatus: receiveLiveStatus,
  onStatusesReady: () => void refreshSnapshot(),
  onStatusesUnavailable: () => liveStatusUpdates.clear(),
});

const directTerminalInput = attachDirectTerminalInput({
  output: elements.terminalOutput,
  input: document.querySelector("#terminal-direct-input"),
  composer: elements.terminalInput,
  stage: document.querySelector(".terminal-stage"),
  indicator: document.querySelector("#terminal-input-indicator"),
  getPaneId: () => state.authenticated ? state.selectedPaneId : null,
  getModifiers: () => [...selectedKeyModifiers],
  clearModifiers: clearKeyModifiers,
  send: item => terminalStream.send(item, { waitForAck: false }),
  onSent: ({ paneId }) => {
    if (paneId === state.selectedPaneId) refreshAfterSubmission();
  },
  onError: (error) => setFeedback(`Direct input stopped: ${error.message}. Check the terminal before clicking to resume.`, true),
  onFiles: (files) => acceptDroppedFiles(files, setFeedback),
});

elements.inputForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.terminalInput.value;
  const paneId = state.selectedPaneId;
  const submitButton = elements.inputForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setFeedback("Sending…");
  try {
    await directTerminalInput.idle();
    if (text) {
      await sendText(text, paneId);
      rememberSentInput(paneId, text);
    } else {
      await sendKeys(["enter"], paneId);
    }
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
    selectedKeyModifiers.size === 0 &&
    (event.key === "ArrowUp" || event.key === "ArrowDown")
  ) {
    if (!shouldBrowseInputHistory({
      key: event.key, value: elements.terminalInput.value,
      selectionStart: elements.terminalInput.selectionStart,
      selectionEnd: elements.terminalInput.selectionEnd,
    })) return;
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
  if (key && directTerminalInput.isActive()) {
    directTerminalInput.key(key);
    return;
  }
  if (!key || keySendBusy || !state.authenticated || !state.selectedPaneId) return;
  keySendBusy = true;
  const paneId = state.selectedPaneId;
  clearKeyModifiers();
  setFeedback(`Sending ${key}…`);
  try {
    await directTerminalInput.idle();
    await sendKeys([key], paneId);
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
    if (directTerminalInput.isActive()) directTerminalInput.focus();
    else focusComposer();
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
  if (directTerminalInput.ownsEvent(event)) return;
  // A physical copy shortcut belongs to the browser while text is selected.
  if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      event.key.toLowerCase() === "c" && window.getSelection()?.toString()) return;
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

const TRANSFER_MAX_BYTES = 50 * 1024 * 1024;

function setTransferFeedback(text, isError = false) {
  elements.transferDialogFeedback.textContent = text;
  elements.transferDialogFeedback.dataset.error = String(isError);
}

function setBrowseFeedback(text, isError = false) {
  elements.browseFeedback.textContent = text;
  elements.browseFeedback.dataset.error = String(isError);
}

// An upload lands on the machine the selected session runs on, so the path that
// goes into the composer is one that session can actually open.
function uploadServerId() {
  return paneServerId(state.selectedPaneId) || "local";
}

function syncAttachAvailability() {
  elements.attachButton.disabled = !state.selectedPaneId;
  elements.attachButton.title = "Upload a file";
}

// The session gate wants a launch token header, which a plain link cannot send,
// so every transfer goes through fetch with the same credentials as api().
function transferHeaders(extra = {}) {
  const headers = new Headers(extra);
  if (state.launchToken) headers.set("X-Herdr-Launch-Token", state.launchToken);
  return headers;
}

async function transferRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: transferHeaders(options.headers),
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
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
  return response;
}

function insertTransferPath(path) {
  const input = elements.terminalInput;
  const { value, caret } = insertPathAtSelection(
    input.value,
    input.selectionStart,
    input.selectionEnd,
    path,
  );
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// The download route trades the launch token header for a one-time ticket, so a
// plain link works and the browser streams the file itself instead of holding
// the whole thing in memory as a blob.
async function downloadPath(filePath, label, server = browseState.server) {
  setBrowseFeedback(`Downloading ${label}…`);
  try {
    const { ticket } = await transferRequest("/api/browse/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Herdr-CSRF": state.csrfToken },
      body: JSON.stringify({ path: filePath, server }),
    }).then((response) => response.json());

    const link = createElement("a");
    link.href = `/api/browse/download/${ticket}`;
    link.download = label;
    document.body.append(link);
    link.click();
    link.remove();
    setBrowseFeedback("");
  } catch (error) {
    setBrowseFeedback(error.message, true);
  }
}

// A pasted screenshot arrives as a blob with no useful name, so it gets one
// that says when it came from.
function droppedFileName(file) {
  if (file.name && file.name !== "image.png" && file.name !== "blob") return file.name;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
  const extension = (file.type.split("/")[1] || "bin").replace(/[^a-z0-9]/giu, "");
  return `pasted-${stamp}.${extension}`;
}

// One path for every way a file can arrive: the picker, a drop, or a paste.
async function uploadFile(file, { report = setFeedback } = {}) {
  if (!file) return null;
  if (file.size > TRANSFER_MAX_BYTES) {
    report(`${file.name || "That file"} is larger than ${formatTransferSize(TRANSFER_MAX_BYTES)}.`, true);
    return null;
  }
  if (!state.selectedPaneId) {
    report("Select a session first.", true);
    return null;
  }

  const name = droppedFileName(file);
  state.mutationBusy = true;
  report(`Uploading ${name}…`);
  try {
    const response = await transferRequest(
      `/api/files/${encodeURIComponent(name)}?server=${encodeURIComponent(uploadServerId())}`,
      {
        method: "POST",
        // File.type would otherwise set a media type the upload route rejects.
        headers: { "Content-Type": "application/octet-stream", "X-Herdr-CSRF": state.csrfToken },
        body: file,
      },
    );
    const { file: saved } = await response.json();
    insertTransferPath(saved.path);
    report(`Uploaded ${saved.name}.`);
    if (elements.transferDialog.open) void refreshUploadsList();
    return saved;
  } catch (error) {
    report(error.message, true);
    return null;
  } finally {
    state.mutationBusy = false;
  }
}

async function uploadFromDialog() {
  const file = elements.transferFile.files?.[0];
  if (!file) {
    setTransferFeedback("Choose a file first.", true);
    return;
  }
  const controls = elements.transferDialog.querySelectorAll("button, input");
  for (const control of controls) control.disabled = true;
  const saved = await uploadFile(file, { report: setTransferFeedback });
  for (const control of controls) control.disabled = false;
  if (saved) elements.transferDialog.close();
}

function showChosenFile() {
  const file = elements.transferFile.files?.[0];
  elements.transferDropLabel.textContent = file
    ? `${file.name} · ${formatTransferSize(file.size)}`
    : "Choose a file, or drop one here";
}

// Drops and pastes are accepted wherever they land in the app, so a screenshot
// can go straight from the clipboard to the composer without opening anything.
function acceptDroppedFiles(list, report, onUploaded) {
  const files = [...(list || [])].filter((item) => item instanceof File);
  if (files.length === 0) return false;
  if (files.length > 1) report("Drop one file at a time.", true);
  void uploadFile(files[0], { report }).then((saved) => {
    if (saved) onUploaded?.(saved);
  });
  return true;
}

function attachDropZone(element, { report, onDragState, onUploaded } = {}) {
  let depth = 0;
  const setActive = (active) => onDragState?.(active);
  element.addEventListener("dragenter", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    depth += 1;
    setActive(true);
  });
  element.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  element.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  });
  element.addEventListener("drop", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    depth = 0;
    setActive(false);
    acceptDroppedFiles(event.dataTransfer.files, report ?? setFeedback, onUploaded);
  });
}

function uploadsRow(file) {
  const row = createElement("div", { className: "uploads-row" });
  const copy = createElement("div", { className: "transfer-copy" });
  copy.append(createElement("div", { className: "transfer-name", text: file.name }));
  copy.append(createElement("div", {
    className: "transfer-meta",
    text: `${formatTransferSize(file.size)} · ${new Date(file.modifiedAt).toLocaleString()}`,
  }));

  const actions = createElement("div", { className: "transfer-row-actions" });
  for (const action of [
    {
      label: `Insert path ${file.name}`,
      paths: ["M12 5v14M5 12h14"],
      run: () => {
        insertTransferPath(file.path);
        elements.transferDialog.close();
      },
    },
    {
      label: `Copy path ${file.name}`,
      paths: ["M9 9h9v11H9z", "M6 15H5V4h9v1"],
      run: () => void copyUploadPath(file.path),
    },
    {
      label: `Download ${file.name}`,
      paths: ["M12 4v11m-4-4 4 4 4-4", "M5 20h14"],
      run: () => void downloadPath(file.path, file.name, uploadServerId()),
    },
    {
      label: `Delete ${file.name}`,
      paths: ["M5 7h14", "M10 7V4h4v3", "M7 7l1 13h8l1-13"],
      danger: true,
      run: () => void deleteUpload(file.name),
    },
  ]) {
    const button = createElement("button", {
      className: `secondary-button ${action.danger ? "is-danger" : ""}`.trim(),
    });
    button.type = "button";
    button.setAttribute("aria-label", action.label);
    button.title = action.label.split(" ")[0] === "Insert" ? "Insert path" : action.label;
    button.append(createIcon(action.paths));
    button.addEventListener("click", action.run);
    actions.append(button);
  }

  row.append(copy, actions);
  return row;
}

async function copyUploadPath(path) {
  try {
    await navigator.clipboard.writeText(path);
    setTransferFeedback("Path copied.");
  } catch {
    setTransferFeedback("Copying needs a secure connection (HTTPS).", true);
  }
}

async function deleteUpload(name) {
  if (!window.confirm(`Delete “${name}”?`)) return;
  setTransferFeedback(`Deleting ${name}…`);
  try {
    await transferRequest(
      `/api/files/${encodeURIComponent(name)}?server=${encodeURIComponent(uploadServerId())}`,
      { method: "DELETE", headers: { "X-Herdr-CSRF": state.csrfToken } },
    );
    setTransferFeedback("");
    await refreshUploadsList();
  } catch (error) {
    setTransferFeedback(error.message, true);
  }
}

async function refreshUploadsList() {
  try {
    const server = encodeURIComponent(uploadServerId());
    const { files } = await transferRequest(`/api/files?server=${server}`)
      .then((response) => response.json());
    elements.uploadsList.replaceChildren();
    if (!array(files).length) {
      elements.uploadsList.append(
        createElement("p", { className: "transfer-empty", text: "Nothing uploaded yet." }),
      );
      return;
    }
    for (const file of files) elements.uploadsList.append(uploadsRow(file));
  } catch (error) {
    setTransferFeedback(error.message, true);
  }
}

function openUploadsDialog() {
  if (elements.transferDialog.open) return;
  setTransferFeedback("");
  elements.transferDialog.showModal();
  void refreshUploadsList();
}

elements.attachButton.addEventListener("click", () => {
  if (elements.attachButton.disabled) return;
  openUploadsDialog();
});

elements.transferUpload.addEventListener("click", () => void uploadFromDialog());

elements.transferDrop.addEventListener("click", () => elements.transferFile.click());

elements.transferFile.addEventListener("change", showChosenFile);

attachDropZone(elements.transferDialog, {
  report: setTransferFeedback,
  onDragState: (active) => elements.transferDrop.classList.toggle("is-dragging", active),
  onUploaded: () => elements.transferDialog.close(),
});

// The terminal panel covers the output, the key bar, and the composer, which is
// the whole area a person would aim a file at.
attachDropZone(elements.terminalPanel, {
  onDragState: (active) => elements.terminalPanel.classList.toggle("is-dropping", active),
});

// A screenshot pasted into the composer is uploaded instead of being ignored;
// ordinary text still pastes normally.
elements.terminalInput.addEventListener("paste", (event) => {
  if (acceptDroppedFiles(event.clipboardData?.files, setFeedback)) event.preventDefault();
});

elements.transferClose.addEventListener("click", () => {
  if (!state.mutationBusy) elements.transferDialog.close();
});

elements.transferDialog.addEventListener("cancel", (event) => {
  if (state.mutationBusy) event.preventDefault();
});

elements.transferDialog.addEventListener("close", () => {
  elements.transferFile.value = "";
  showChosenFile();
  setTransferFeedback("");
});

// Only folders that were opened have been fetched, so the tree keeps a listing
// per visited path rather than one nested structure.
const browseState = {
  server: "local",
  root: null,
  uploads: null,
  loaded: new Map(),
  expanded: new Set(),
  selected: null,
  busy: false,
};

const FOLDER_ICON = ["M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"];
const FILE_ICON = ["M7 3h7l5 5v13H7z", "M14 3v5h5"];
const IMAGE_ICON = ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"];
const CODE_ICON = ["M9 8l-4 4 4 4", "M15 8l4 4-4 4"];
const DATA_ICON = ["M12 6c4 0 7-.9 7-2v12c0 1.1-3 2-7 2s-7-.9-7-2V4c0 1.1 3 2 7 2Z", "M5 4c0 1.1 3 2 7 2s7-.9 7-2"];
const ARCHIVE_ICON = ["M4 7h16v13H4z", "M4 7l2-3h12l2 3", "M12 11v3"];

const ICONS_BY_EXTENSION = new Map(Object.entries({
  png: IMAGE_ICON, jpg: IMAGE_ICON, jpeg: IMAGE_ICON, gif: IMAGE_ICON,
  webp: IMAGE_ICON, svg: IMAGE_ICON, avif: IMAGE_ICON, bmp: IMAGE_ICON, ico: IMAGE_ICON,
  js: CODE_ICON, mjs: CODE_ICON, cjs: CODE_ICON, ts: CODE_ICON, tsx: CODE_ICON,
  jsx: CODE_ICON, py: CODE_ICON, rb: CODE_ICON, go: CODE_ICON, rs: CODE_ICON,
  java: CODE_ICON, c: CODE_ICON, h: CODE_ICON, cpp: CODE_ICON, sh: CODE_ICON,
  css: CODE_ICON, html: CODE_ICON, vue: CODE_ICON, php: CODE_ICON, sql: CODE_ICON,
  json: DATA_ICON, yaml: DATA_ICON, yml: DATA_ICON, toml: DATA_ICON,
  csv: DATA_ICON, xml: DATA_ICON, db: DATA_ICON, sqlite: DATA_ICON,
  zip: ARCHIVE_ICON, gz: ARCHIVE_ICON, tar: ARCHIVE_ICON, tgz: ARCHIVE_ICON,
  bz2: ARCHIVE_ICON, xz: ARCHIVE_ICON, rar: ARCHIVE_ICON, "7z": ARCHIVE_ICON,
}));

function entryIcon(entry) {
  if (entry.kind === "directory") return FOLDER_ICON;
  const dot = entry.name.lastIndexOf(".");
  const extension = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
  return ICONS_BY_EXTENSION.get(extension) || FILE_ICON;
}

function browseActionButton({ label, paths, danger = false, run }) {
  const button = createElement("button", {
    className: `secondary-button ${danger ? "is-danger" : ""}`.trim(),
  });
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createIcon(paths));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    run();
  });
  return button;
}

function browseRow({ entry, depth, expanded }) {
  const row = createElement("div", { className: "transfer-row browse-row" });
  row.style.setProperty("--depth", String(depth));

  const lead = createElement("div", { className: "browse-lead" });
  // One guide per level, drawn in the DOM so the lines line up with the rows
  // above and below rather than being faked with padding.
  for (let level = 0; level < depth; level += 1) {
    lead.append(createElement("span", { className: "browse-indent" }));
  }
  if (entry.kind === "directory" && !entry.broken) {
    const twisty = createElement("button", { className: "browse-twisty" });
    twisty.type = "button";
    twisty.setAttribute("aria-expanded", String(expanded));
    twisty.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${entry.name}`);
    twisty.append(createIcon(["M9 6l6 6-6 6"]));
    twisty.addEventListener("click", (event) => {
      // The row toggles too, so without this the chevron would fire twice and
      // land back where it started.
      event.stopPropagation();
      void toggleBrowseFolder(entry.path);
    });
    lead.append(twisty);
  } else {
    lead.append(createElement("span", { className: "browse-twisty-gap" }));
  }

  lead.append(createIcon(entryIcon(entry), "browse-icon"));

  // One line per entry: the name carries the row, the size sits at the end, and
  // the full timestamp waits in the tooltip rather than wrapping the row.
  const copy = createElement("div", { className: "transfer-copy" });
  const name = createElement("div", { className: "transfer-name", text: entry.name });
  if (entry.symlink) name.append(createElement("span", { className: "transfer-tag", text: "link" }));
  copy.append(name);
  lead.append(copy);
  if (entry.modifiedAt) {
    const size = entry.kind === "directory" ? "" : `${formatTransferSize(entry.size ?? 0)} · `;
    row.title = `${entry.name}\n${size}${new Date(entry.modifiedAt).toLocaleString()}`;
  }

  if (entry.broken) {
    lead.append(createElement("span", { className: "transfer-meta", text: "broken" }));
  }

  const actions = createElement("div", { className: "transfer-row-actions" });
  // Expanding shows a folder in place; this re-roots the tree there, so a deep
  // path stops costing a column of indentation.
  if (entry.kind === "directory" && !entry.broken) {
    actions.append(browseActionButton({
      label: `Open ${entry.name} as the root`,
      paths: ["M4 12h13", "M13 7l5 5-5 5", "M20 5v14"],
      run: () => void loadBrowseFolder(entry.path),
    }));
  }
  if (entry.kind === "file" && entry.readable !== false) {
    actions.append(browseActionButton({
      label: `Download ${entry.name}`,
      paths: ["M12 4v11m-4-4 4 4 4-4", "M5 20h14"],
      run: () => void downloadPath(entry.path, entry.name),
    }));
  }

  // Clicking the row selects it, and clicking a folder opens it -- the way an
  // editor sidebar behaves, rather than making people hit the small chevron.
  row.dataset.selected = String(browseState.selected === entry.path);
  row.addEventListener("click", () => {
    browseState.selected = entry.path;
    for (const other of elements.browseTree.querySelectorAll(".browse-row")) {
      other.dataset.selected = "false";
    }
    row.dataset.selected = "true";
    if (entry.kind === "directory" && !entry.broken) void toggleBrowseFolder(entry.path);
  });

  row.append(lead, actions);
  return row;
}

function renderBrowseTree() {
  const showHidden = elements.fileHidden.checked;
  if (document.activeElement !== elements.filePath) {
    elements.filePath.value = browseState.root || "";
  }
  elements.fileUp.disabled = !parentDirectory(browseState.root);
  elements.fileUploads.disabled = !browseState.uploads || browseState.root === browseState.uploads;

  const rows = flattenTree(browseState.root, browseState.loaded, browseState.expanded)
    .filter((row) => showHidden || !row.entry.hidden);

  elements.browseTree.replaceChildren();
  if (rows.length === 0) {
    elements.browseTree.append(createElement("p", {
      className: "transfer-empty",
      text: "This folder is empty.",
    }));
    return;
  }
  for (const row of rows) elements.browseTree.append(browseRow(row));
}

async function fetchListing(target, { prefix = "" } = {}) {
  const parts = [`server=${encodeURIComponent(browseState.server)}`];
  // A remote listing with no path starts at that server's home.
  if (target) parts.push(`path=${encodeURIComponent(target)}`);
  if (prefix !== "") parts.push(`prefix=${encodeURIComponent(prefix)}`);
  return transferRequest(`/api/browse?${parts.join("&")}`).then((response) => response.json());
}

async function toggleBrowseFolder(path) {
  if (browseState.expanded.has(path)) {
    browseState.expanded.delete(path);
    renderBrowseTree();
    return;
  }
  if (!browseState.loaded.has(path)) {
    setBrowseFeedback("Loading…");
    try {
      const listing = await fetchListing(path);
      browseState.loaded.set(listing.path, listing);
      setBrowseFeedback(listing.truncated ? `Showing the first ${listing.entries.length} of ${listing.total}.` : "");
    } catch (error) {
      setBrowseFeedback(error.message, true);
      return;
    }
  }
  browseState.expanded.add(path);
  renderBrowseTree();
}

async function loadBrowseFolder(target, { refresh = false } = {}) {
  if (browseState.busy) return;
  browseState.busy = true;
  setBrowseFeedback("Loading…");
  try {
    const listing = await fetchListing(target);
    if (!refresh) browseState.expanded.clear();
    browseState.loaded.clear();
    browseState.loaded.set(listing.path, listing);
    browseState.root = listing.path;
    writeBrowsePath(browsePathStorage, listing.path, browseState.server);
    renderBrowseTree();
    setBrowseFeedback(listing.truncated ? `Showing the first ${listing.entries.length} of ${listing.total}.` : "");
  } catch (error) {
    setBrowseFeedback(error.message, true);
  } finally {
    browseState.busy = false;
  }
}

const browsePathStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

async function ensureUploadsPath() {
  if (browseState.uploads !== null) return browseState.uploads;
  const server = encodeURIComponent(browseState.server);
  const { directory } = await transferRequest(`/api/files?server=${server}`)
    .then((response) => response.json())
    .catch(() => ({ directory: null }));
  browseState.uploads = directory || null;
  return browseState.uploads;
}

// Files opens where browsing last stopped; the uploads folder is the fallback on a
// first visit because it is the one folder this app is certain exists.
// The snapshot already carries every configured server with its reachability,
// including ones Herdr could not answer on. Reading the session records instead
// would drop exactly those, and files may still be reachable over SFTP when
// Herdr itself is missing.
function refreshServerChoices() {
  const options = [
    { id: "local", name: "This machine" },
    // Every registered server answers for its own files now, so all of them
    // belong here.
    ...array(state.snapshot?.servers)
      .filter((server) => server.id !== "local")
      .map((server) => ({ id: server.id, name: server.name || server.id })),
  ];
  elements.fileServer.replaceChildren();
  for (const option of options) {
    const node = createElement("option", { text: option.name });
    node.value = option.id;
    elements.fileServer.append(node);
  }
  // A server that was removed falls back to this machine.
  if (!options.some((option) => option.id === browseState.server)) browseState.server = "local";
  elements.fileServer.value = browseState.server;
  elements.fileServer.hidden = options.length < 2;
}

async function openFilePanel() {
  if (browseState.root) return;
  refreshServerChoices();
  const remembered = readBrowsePath(browsePathStorage, browseState.server);
  const uploads = await ensureUploadsPath();
  await loadBrowseFolder(remembered || uploads || "/");
}

elements.fileServer.addEventListener("change", () => {
  browseState.server = elements.fileServer.value;
  browseState.uploads = null;
  browseState.root = null;
  browseState.loaded.clear();
  browseState.expanded.clear();
  completion.entries = [];
  // An empty target asks the server where its home is.
  void loadBrowseFolder(readBrowsePath(browsePathStorage, browseState.server) || "");
});

function showNavigatorTab(tab) {
  const files = tab === "files";
  elements.tabSessions.setAttribute("aria-selected", String(!files));
  elements.tabFiles.setAttribute("aria-selected", String(files));
  elements.workspaceList.hidden = files;
  elements.filePanel.hidden = !files;
  writeNavigatorTab(browsePathStorage, tab);
  if (files) void openFilePanel();
}

for (const tab of elements.navigatorTabs) {
  tab.addEventListener("click", () => showNavigatorTab(tab === elements.tabFiles ? "files" : "sessions"));
}

// A file tree needs more room than a session list, so the sidebar is draggable
// and remembers the width. On a phone the sidebar is a full-width overlay and
// the handle does nothing, so it is hidden there by CSS.
function applyNavigatorWidth(width) {
  const clamped = clampNavigatorWidth(width);
  // Set on the root so the shell grid narrows the terminal by the same amount
  // the sidebar gains, instead of the two overlapping.
  document.documentElement.style.setProperty("--navigator-width", `${clamped}px`);
  elements.navigatorResizer.setAttribute("aria-valuenow", String(clamped));
  return clamped;
}

let navigatorWidth = applyNavigatorWidth(readNavigatorWidth(browsePathStorage));

elements.navigatorResizer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = navigatorWidth;
  elements.navigatorResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("is-resizing-sidebar");

  const move = (moveEvent) => {
    navigatorWidth = applyNavigatorWidth(startWidth + (moveEvent.clientX - startX));
  };
  const stop = () => {
    elements.navigatorResizer.removeEventListener("pointermove", move);
    elements.navigatorResizer.removeEventListener("pointerup", stop);
    elements.navigatorResizer.removeEventListener("pointercancel", stop);
    document.body.classList.remove("is-resizing-sidebar");
    writeNavigatorWidth(browsePathStorage, navigatorWidth);
  };
  elements.navigatorResizer.addEventListener("pointermove", move);
  elements.navigatorResizer.addEventListener("pointerup", stop);
  elements.navigatorResizer.addEventListener("pointercancel", stop);
});

elements.navigatorResizer.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 40 : 12;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  navigatorWidth = applyNavigatorWidth(navigatorWidth + (event.key === "ArrowRight" ? step : -step));
  writeNavigatorWidth(browsePathStorage, navigatorWidth);
});

elements.fileUp.addEventListener("click", () => {
  const parent = parentDirectory(browseState.root);
  if (parent) void loadBrowseFolder(parent);
});

// The uploads folder gets its own dialog rather than sending the tree there:
// it is a short list you act on, not somewhere to browse.
elements.fileUploads.addEventListener("click", () => openUploadsDialog());

elements.fileHidden.addEventListener("change", () => renderBrowseTree());

const completion = { entries: [], active: -1, timer: null };

function hideSuggestions() {
  // Cancel the pending lookup too, or it reopens the list a moment later.
  window.clearTimeout(completion.timer);
  completion.active = -1;
  elements.fileSuggestions.hidden = true;
  elements.fileSuggestions.replaceChildren();
  elements.filePath.setAttribute("aria-expanded", "false");
}

function applySuggestion(value) {
  elements.filePath.value = value;
  hideSuggestions();
  void loadBrowseFolder(value);
}

function renderSuggestions(matches) {
  elements.fileSuggestions.replaceChildren();
  if (matches.length === 0) {
    hideSuggestions();
    return;
  }
  matches.forEach((entry, index) => {
    const item = createElement("li", { className: "file-suggestion" });
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(index === completion.active));
    item.append(createElement("span", { text: entry.name }));
    item.addEventListener("mousedown", (event) => {
      // mousedown beats the input losing focus and closing the list first.
      event.preventDefault();
      applySuggestion(entry.path);
    });
    elements.fileSuggestions.append(item);
  });
  elements.fileSuggestions.hidden = false;
  elements.filePath.setAttribute("aria-expanded", "true");
}

async function updateCompletion() {
  const typed = elements.filePath.value;
  if (!typed.startsWith("/")) {
    hideSuggestions();
    return;
  }
  const cut = typed.lastIndexOf("/");
  const folder = cut === 0 ? "/" : typed.slice(0, cut);
  const prefix = typed.slice(cut + 1).toLowerCase();

  // The server does the prefix match: a folder like /tmp can hold thousands of
  // entries, and filtering here would only see whatever survived the limit.
  try {
    const listing = await fetchListing(folder, { prefix });
    // Typing moves on while the request is in flight; a reply the caret has
    // already left behind would otherwise replace the newer list.
    if (elements.filePath.value !== typed) return;
    completion.entries = listing.entries.filter((entry) => entry.kind === "directory");
  } catch {
    if (elements.filePath.value !== typed) return;
    completion.entries = [];
  }
  completion.active = -1;
  renderSuggestions(completion.entries.slice(0, 12));
}

elements.filePath.addEventListener("input", () => {
  // A short wait keeps a fast typist from firing one listing per keystroke.
  window.clearTimeout(completion.timer);
  completion.timer = window.setTimeout(() => void updateCompletion(), 150);
});

elements.filePath.addEventListener("keydown", (event) => {
  const items = [...elements.fileSuggestions.children];
  if (event.key === "Escape" && !elements.fileSuggestions.hidden) {
    event.preventDefault();
    hideSuggestions();
    return;
  }
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length > 0) {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    completion.active = (completion.active + step + items.length) % items.length;
    items.forEach((item, index) => item.setAttribute("aria-selected", String(index === completion.active)));
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const chosen = items[completion.active];
    if (chosen) {
      const match = completion.entries.find((entry) => entry.name === chosen.textContent);
      applySuggestion(match ? match.path : elements.filePath.value);
      return;
    }
    hideSuggestions();
    void loadBrowseFolder(elements.filePath.value);
  }
});

elements.filePath.addEventListener("blur", () => window.setTimeout(hideSuggestions, 120));

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
  if (document.hidden) terminalStream.pause();
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

window.addEventListener("focus", restoreLoginFocus);
window.addEventListener("pageshow", restoreLoginFocus);

elements.loginPassword.addEventListener("input", () => {
  if (elements.loginPassword.value) rememberLoginMethod("password");
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  rememberLoginMethod("password");
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

elements.passkeyLogin.addEventListener("click", () => {
  rememberLoginMethod("passkey");
  void startPasskeyLogin();
});
document.addEventListener("visibilitychange", restoreLoginFocus);

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
  showNavigatorTab(readNavigatorTab(browsePathStorage));
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
const serverForm = document.querySelector("#server-form");
const serverFeedback = document.querySelector("#server-feedback");
let editingServer = null;
let serverBusy = false;


// A server is only worth saving once it has actually answered, so Save stays
// closed until a test succeeds and reopens only for the settings that passed.
const serverSubmitButton = serverForm.querySelector('button[type="submit"]');
let verifiedServerSettings = null;

function serverFormValues() {
  return Object.fromEntries(new FormData(serverForm));
}

function serverFormFingerprint() {
  return JSON.stringify(serverFormValues());
}

function syncServerSubmitState() {
  const verified = verifiedServerSettings !== null && verifiedServerSettings === serverFormFingerprint();
  serverSubmitButton.disabled = !verified;
  serverSubmitButton.title = verified ? "" : "Test the connection first";
}

serverForm.addEventListener("input", syncServerSubmitState);
serverForm.addEventListener("change", syncServerSubmitState);

function resetServerForm(profile = null) {
  editingServer = profile?.id || null;
  serverForm.reset();
  if (profile) for (const name of ["name", "address"]) {
    serverForm.elements.namedItem(name).value = profile[name] ?? "";
  }
  serverFeedback.textContent = "";
  serverFeedback.dataset.error = "false";
  serverForm.querySelector('button[type="submit"]').textContent = profile ? "Save changes" : "Save";
  // Switching to another server drops whatever the last test proved.
  verifiedServerSettings = null;
  syncServerSubmitState();
}

async function serverAction(action) {
  if (serverBusy) return;
  serverBusy = true;
  serversDialog.querySelectorAll("button, input, select").forEach((element) => { element.disabled = true; });
  serverFeedback.textContent = "Connecting…";
  serverFeedback.dataset.error = "false";
  try { await action(); }
  catch (error) { serverFeedback.textContent = error.message; serverFeedback.dataset.error = "true"; }
  finally {
    serverBusy = false;
    serversDialog.querySelectorAll("button, input, select").forEach((element) => { element.disabled = false; });
    // The blanket re-enable above would otherwise hand Save back untested.
    syncServerSubmitState();
  }
}

async function loadServers() {
  const { profiles } = await api("/api/servers");
  const list = document.querySelector("#server-list");
  list.replaceChildren();
  for (const profile of profiles) {
    const row = createElement("div", { className: "server-row" });
    // The address is long enough to squeeze a name out of the row, and it is
    // the thing you check when a server will not answer, so it gets its own
    // line rather than competing for the first one.
    const identity = createElement("div", { className: "server-row-identity" });
    identity.append(
      createElement("strong", { text: profile.name }),
      createElement("small", { text: profile.address }),
    );
    const live = array(state.snapshot?.servers).find((server) => server.id === profile.id);
    if (live) {
      const reachable = live.available === true;
      const status = createElement("small", {
        className: `server-row-status${reachable ? " is-online" : ""}`,
        text: reachable ? "Connected" : live.status || "Offline",
      });
      status.title = live.status || "";
      identity.append(status);
    }
    row.append(identity);
    const edit = createElement("button", { className: "secondary-button", text: "Edit" });
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${profile.name}`);
    edit.addEventListener("click", () => { if (!serverBusy) { resetServerForm(profile); serverForm.elements.namedItem("name").focus(); } });
    const remove = createElement("button", { className: "secondary-button", text: "Remove" });
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${profile.name}`);
    remove.addEventListener("click", () => {
      if (serverBusy || !window.confirm(`Remove “${profile.name}” from HerdRabbit? Remote sessions will keep running.`)) return;
      void serverAction(async () => {
        await api(`/api/servers/${profile.id}`, { method: "DELETE" });
        if (editingServer === profile.id) resetServerForm();
        await loadServers();
        await refreshSnapshot();
        serverFeedback.textContent = "Server removed.";
      });
    });
    row.append(edit, remove);
    list.append(row);
  }
}

document.querySelector("#manage-servers").addEventListener("click", () => {
  document.querySelector("#add-menu").open = false;
  resetServerForm();
  serversDialog.showModal();
  void serverAction(async () => { await loadServers(); serverFeedback.textContent = ""; });
  void lookForServers();
});
// Typing a tailnet address is a poor way to answer "which machine": the hub can
// list them, and it can say which ones are actually ready to be added.
const candidateList = document.querySelector("#server-candidates");
const setupHint = document.querySelector("#server-setup-hint");

const CANDIDATE_LABELS = {
  ready: "Ready",
  added: "Already added",
  refused: "Does not accept this machine",
  incompatible: "Version does not match",
  absent: "No HerdRabbit",
  offline: "Offline",
};

function renderCandidates(found) {
  candidateList.replaceChildren();
  if (!found.available) {
    setupHint.textContent = "Tailscale is not running here, so machines cannot be listed. Enter an address instead.";
    return;
  }
  setupHint.textContent = found.self?.address
    ? `Setting one up? Install HerdRabbit there, answer "leaf", and give it this machine's address: ${found.self.address}`
    : "";
  if (found.candidates.length === 0) {
    candidateList.append(createElement("p", { className: "dialog-feedback", text: "No other machines on this tailnet." }));
    return;
  }
  for (const candidate of found.candidates) {
    const row = createElement("button", { className: `server-candidate is-${candidate.state}` });
    row.type = "button";
    // Only a ready machine can be filled in; the rest are shown so the reason
    // is visible rather than the machine simply being missing from the list.
    row.disabled = candidate.state !== "ready";
    row.title = candidate.reason || candidate.address;
    row.append(
      createElement("strong", { text: candidate.name }),
      createElement("small", { text: CANDIDATE_LABELS[candidate.state] || candidate.state }),
    );
    row.addEventListener("click", () => {
      serverForm.elements.namedItem("name").value = candidate.name;
      serverForm.elements.namedItem("address").value = candidate.address;
      syncServerSubmitState();
      serverFeedback.textContent = "Test the connection to save it.";
    });
    candidateList.append(row);
  }
}

async function lookForServers() {
  candidateList.replaceChildren(createElement("p", { className: "dialog-feedback", text: "Looking…" }));
  setupHint.textContent = "";
  try {
    renderCandidates(await api("/api/servers/discover", { method: "POST", body: {} }));
  } catch (error) {
    candidateList.replaceChildren();
    setupHint.textContent = error.message;
  }
}

document.querySelector("#server-refresh").addEventListener("click", () => { void lookForServers(); });
document.querySelector("#server-close").addEventListener("click", () => { if (!serverBusy) serversDialog.close(); });
serversDialog.addEventListener("cancel", (event) => { if (serverBusy) event.preventDefault(); });
serversDialog.addEventListener("close", () => { serverForm.elements.namedItem("password").value = ""; });
document.querySelector("#server-test").addEventListener("click", () => {
  if (!serverForm.reportValidity()) return;
  const profile = serverFormValues();
  const tested = serverFormFingerprint();
  void serverAction(async () => {
    const result = await api("/api/servers/test", { method: "POST", body: profile });
    verifiedServerSettings = tested;
    syncServerSubmitState();
    const reached = result.version ? `Connected to HerdRabbit ${result.version}.` : "Connected.";
    serverFeedback.textContent = `${reached} ${result.sessions} Herdr sessions, ${result.panes} panes. You can save now.`;
  });
});
serverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (serverSubmitButton.disabled) return;
  const profile = serverFormValues();
  void serverAction(async () => {
    await api(editingServer ? `/api/servers/${editingServer}` : "/api/servers", {
      method: editingServer ? "PUT" : "POST", body: profile,
    });
    resetServerForm();
    await loadServers();
    await refreshSnapshot();
    serverFeedback.textContent = "Saved. Connection status appears in the sidebar.";
  });
});

async function start() {
  if ("BroadcastChannel" in window) {
    notificationRelayChannel = new BroadcastChannel("herdr-notification-navigation");
    notificationRelayChannel.onmessage = ({ data }) => {
      if (data?.type === "notification-target") receiveNotificationRelay(data);
    };
  }
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
    // Update the existing scope explicitly: the page and notification handler
    // must advance together, even when the browser retains the old script URL.
    void navigator.serviceWorker.register("/sw.js?revision=notification-routing-4", {
      scope: "/", updateViaCache: "none",
    }).then((registration) => {
      registration.waiting?.postMessage({ type: "activate-worker" });
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") installing.postMessage({ type: "activate-worker" });
      });
    }).catch(() => {});
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

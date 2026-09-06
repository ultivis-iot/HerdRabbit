const NOTIFIABLE_STATES = new Set(["blocked", "done", "idle", "unknown"]);
const MAX_REQUEST_LENGTH = 72;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(record, ...keys) {
  for (const key of keys) {
    if (typeof record?.[key] === "string") return record[key];
  }
  return "";
}

function firstLabel(record, keys, fallback = "") {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return fallback;
}

function statusOf(agent, pane) {
  return firstLabel(agent, ["agent_status", "state"],
    firstLabel(pane, ["agent_status", "agent_state"], "unknown"));
}

function sequenceOf(agent, pane) {
  for (const record of [agent, pane]) {
    if (Number.isSafeInteger(record?.state_change_seq) && record.state_change_seq >= 0) {
      return record.state_change_seq;
    }
  }
  for (const record of [agent, pane]) {
    if (Number.isSafeInteger(record?.revision) && record.revision >= 0) {
      return record.revision;
    }
  }
  return 0;
}

function requestSummary(value) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = [...normalized];
  if (characters.length <= MAX_REQUEST_LENGTH) return normalized;
  return `${characters.slice(0, MAX_REQUEST_LENGTH - 1).join("")}…`;
}

function bodyFor(status, request) {
  const subject = request ? `“${request}” 작업` : "작업";
  if (status === "done") return `${subject}을 완료했습니다.`;
  if (status === "blocked") return `${subject}에 확인 또는 입력이 필요합니다.`;
  if (status === "idle") return `${subject}이 끝나 대기 중입니다.`;
  return `${subject} 상태를 확인할 수 없습니다.`;
}

function shouldNotify(previous, current, hasPendingRequest) {
  if (!NOTIFIABLE_STATES.has(current.status)) {
    return false;
  }
  const requestFinishedBetweenPolls = hasPendingRequest &&
    previous.sequence !== current.sequence;
  if (current.status === "done" || current.status === "blocked") {
    return previous.status !== current.status || requestFinishedBetweenPolls;
  }
  return previous.status === "working" || requestFinishedBetweenPolls;
}

function recordsForSnapshot(snapshot) {
  const workspaces = array(snapshot?.workspaces);
  const tabs = array(snapshot?.tabs);
  const panes = array(snapshot?.panes);
  const agents = array(snapshot?.agents);
  const workspaceById = new Map(
    workspaces.map((workspace) => [idOf(workspace, "workspace_id", "id"), workspace]),
  );
  const tabById = new Map(
    tabs.map((tab) => [idOf(tab, "tab_id", "id"), tab]),
  );
  const agentByPaneId = new Map(
    agents.map((agent) => [idOf(agent, "pane_id", "paneId"), agent]),
  );

  return panes.map((pane) => {
    const paneId = idOf(pane, "pane_id", "id");
    const tab = tabById.get(idOf(pane, "tab_id", "tabId"));
    const workspaceId = idOf(
      pane,
      "workspace_id",
      "workspaceId",
    ) || idOf(tab, "workspace_id", "workspaceId");
    const workspace = workspaceById.get(workspaceId);
    const agent = agentByPaneId.get(paneId);
    const tabLabel = firstLabel(tab, ["label", "name"]);
    const sessionLabel = !/^\d+$/.test(tabLabel)
      ? tabLabel
      : firstLabel(
        pane,
        ["label", "terminal_title_stripped", "terminal_title"],
        firstLabel(
          agent,
          ["display_agent", "terminal_title_stripped", "terminal_title", "name", "agent"],
          "세션",
        ),
      );
    return {
      paneId,
      status: statusOf(agent, pane),
      sequence: sequenceOf(agent, pane),
      projectLabel: firstLabel(workspace, ["label", "name"], "프로젝트"),
      sessionLabel,
    };
  }).filter((record) => record.paneId !== "");
}

function subscriptionAvailable(push) {
  return typeof push?.hasSubscriptions === "function"
    ? push.hasSubscriptions()
    : push?.hasSubscriptions === true;
}

export class AgentNotificationMonitor {
  constructor({
    herdr = null,
    push,
    pollIntervalMs = 2_000,
    logger = console,
  } = {}) {
    if (!push) throw new TypeError("push service is required");
    this.herdr = herdr;
    this.push = push;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.previousStates = new Map();
    this.lastRequests = new Map();
    this.pendingRequests = new Set();
    this.timer = null;
    this.pollBusy = false;
  }

  recordRequest(paneId, request) {
    const summary = requestSummary(request);
    if (typeof paneId === "string" && paneId !== "" && summary !== "") {
      this.lastRequests.set(paneId, summary);
      this.pendingRequests.add(paneId);
    }
  }

  async observeSnapshot(snapshot) {
    const records = recordsForSnapshot(snapshot);
    const livePaneIds = new Set(records.map(({ paneId }) => paneId));
    const notifications = [];

    for (const record of records) {
      const previous = this.previousStates.get(record.paneId);
      this.previousStates.set(record.paneId, {
        status: record.status,
        sequence: record.sequence,
      });
      if (!previous || !shouldNotify(
        previous,
        record,
        this.pendingRequests.has(record.paneId),
      )) continue;

      notifications.push({
        title: `${record.projectLabel} · ${record.sessionLabel}`,
        body: bodyFor(record.status, this.lastRequests.get(record.paneId) || ""),
        tag: `herd-rabbit:${record.paneId}:${record.sequence}`,
        data: {
          paneId: record.paneId,
          status: record.status,
          url: `/?${new URLSearchParams({ pane: record.paneId })}`,
        },
      });
      this.pendingRequests.delete(record.paneId);
    }

    for (const paneId of this.previousStates.keys()) {
      if (!livePaneIds.has(paneId)) {
        this.previousStates.delete(paneId);
        this.lastRequests.delete(paneId);
        this.pendingRequests.delete(paneId);
      }
    }

    if (!subscriptionAvailable(this.push)) return;
    await Promise.all(notifications.map((notification) => this.push.send(notification)));
  }

  async poll() {
    if (this.pollBusy || !this.herdr || !subscriptionAvailable(this.push)) return;
    this.pollBusy = true;
    try {
      await this.observeSnapshot(await this.herdr.snapshot());
    } catch (error) {
      this.logger.error?.("notification poll failed", { message: error.message });
    } finally {
      this.pollBusy = false;
    }
  }

  start() {
    if (this.timer || !this.herdr) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

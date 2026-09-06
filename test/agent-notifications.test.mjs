import test from "node:test";
import assert from "node:assert/strict";
import { AgentNotificationMonitor } from "../src/agent-notifications.mjs";

function snapshot(status, sequence = 1) {
  return {
    workspaces: [
      { workspace_id: "hs_ZGVmYXVsdA~w8", label: "HerdRabbit" },
    ],
    tabs: [
      {
        tab_id: "hs_ZGVmYXVsdA~w8:t1",
        workspace_id: "hs_ZGVmYXVsdA~w8",
        label: "1",
      },
    ],
    panes: [
      {
        pane_id: "hs_ZGVmYXVsdA~w8:p1",
        tab_id: "hs_ZGVmYXVsdA~w8:t1",
        workspace_id: "hs_ZGVmYXVsdA~w8",
        terminal_title_stripped: "알림 구현",
        agent_status: status,
        state_change_seq: sequence,
      },
    ],
    agents: [
      {
        pane_id: "hs_ZGVmYXVsdA~w8:p1",
        agent: "codex",
        agent_status: status,
        state_change_seq: sequence,
        terminal_title_stripped: "알림 구현",
      },
    ],
  };
}

test("sends project, session, and request-aware completion notifications", async () => {
  const sent = [];
  const monitor = new AgentNotificationMonitor({
    push: {
      hasSubscriptions: true,
      async send(notification) {
        sent.push(notification);
      },
    },
  });

  monitor.recordRequest(
    "hs_ZGVmYXVsdA~w8:p1",
    "프로젝트명과 세션명을 포함한 알림을 만들어줘",
  );
  await monitor.observeSnapshot(snapshot("working", 10));
  assert.deepEqual(sent, []);

  await monitor.observeSnapshot(snapshot("done", 11));
  assert.deepEqual(sent, [
    {
      title: "HerdRabbit · 알림 구현",
      body: "“프로젝트명과 세션명을 포함한 알림을 만들어줘” 작업을 완료했습니다.",
      tag: "herd-rabbit:hs_ZGVmYXVsdA~w8:p1:11",
      data: {
        paneId: "hs_ZGVmYXVsdA~w8:p1",
        status: "done",
        url: "/?pane=hs_ZGVmYXVsdA%7Ew8%3Ap1",
      },
    },
  ]);

  await monitor.observeSnapshot(snapshot("done", 11));
  assert.equal(sent.length, 1);
});

test("uses different copy when an agent needs input or returns to idle", async () => {
  const sent = [];
  const monitor = new AgentNotificationMonitor({
    push: {
      hasSubscriptions: true,
      async send(notification) {
        sent.push(notification);
      },
    },
  });

  monitor.recordRequest("hs_ZGVmYXVsdA~w8:p1", "배포 준비해줘");
  await monitor.observeSnapshot(snapshot("working", 20));
  await monitor.observeSnapshot(snapshot("blocked", 21));
  await monitor.observeSnapshot(snapshot("working", 22));
  await monitor.observeSnapshot(snapshot("idle", 23));

  assert.deepEqual(sent.map(({ body }) => body), [
    "“배포 준비해줘” 작업에 확인 또는 입력이 필요합니다.",
    "“배포 준비해줘” 작업이 끝나 대기 중입니다.",
  ]);
});

test("notifies when a newly submitted request finishes between polls", async () => {
  const sent = [];
  const monitor = new AgentNotificationMonitor({
    push: {
      hasSubscriptions: true,
      async send(notification) {
        sent.push(notification);
      },
    },
  });

  await monitor.observeSnapshot(snapshot("done", 30));
  monitor.recordRequest("hs_ZGVmYXVsdA~w8:p1", "아주 짧은 작업");
  await monitor.observeSnapshot(snapshot("done", 31));
  await monitor.observeSnapshot(snapshot("done", 31));

  assert.deepEqual(sent.map(({ body }) => body), [
    "“아주 짧은 작업” 작업을 완료했습니다.",
  ]);
});

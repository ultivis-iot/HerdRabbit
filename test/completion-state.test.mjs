import test from "node:test";
import assert from "node:assert/strict";
import {
  agentCompletionIdentity,
  visibleAgentStatus,
} from "../public/ui-model.js";

test("shows a viewed completion as idle until a newer completion arrives", () => {
  const completed = { agent_status: "done", state_change_seq: 41 };
  const acknowledged = agentCompletionIdentity(completed);

  assert.equal(visibleAgentStatus(completed, null, null), "done");
  assert.equal(visibleAgentStatus(completed, null, acknowledged), "idle");
  assert.equal(
    visibleAgentStatus(
      { agent_status: "done", state_change_seq: 42 },
      null,
      acknowledged,
    ),
    "done",
  );
});

test("does not override working, blocked, or unknown states", () => {
  for (const status of ["working", "blocked", "unknown"]) {
    assert.equal(
      visibleAgentStatus(
        { agent_status: status, state_change_seq: 41 },
        null,
        "seq:41",
      ),
      status,
    );
  }
});

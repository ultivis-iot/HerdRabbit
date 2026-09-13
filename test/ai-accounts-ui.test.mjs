import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_LOGIN_LABEL_PREFIX,
  aiAccountNotice,
  aiAccountsToSave,
  aiLoginSessionId,
  aiRestartHint,
  isAiLoginWorkspace,
  paneKeepsInputHistory,
} from "../public/ui-model.js";

const NOW = Date.parse("2026-09-13T00:00:00Z");

test("the sign-in project prefix matches the one the server uses", async () => {
  const server = await readFile(new URL("../src/http-server.mjs", import.meta.url), "utf8");
  assert.match(server, new RegExp(`AI_LOGIN_LABEL_PREFIX = "${AI_LOGIN_LABEL_PREFIX}"`, "u"));
});

test("nothing typed into a sign-in terminal is kept as prompt history", () => {
  const records = {
    workspaces: [
      { workspace_id: "w1", label: "api" },
      { workspace_id: "w2", label: "AI login: Claude Code (1234abcd)" },
    ],
    panes: [{ pane_id: "w1:p1", workspace_id: "w1" }, { pane_id: "w2:p1", workspace_id: "w2" }],
  };
  assert.equal(paneKeepsInputHistory("w1:p1", records), true);
  assert.equal(paneKeepsInputHistory("w2:p1", records), false);
  assert.equal(paneKeepsInputHistory("unknown", records), true);
  assert.equal(isAiLoginWorkspace({ label: "AI login" }), false);
});

test("an account says nothing more until a new sign-in is close", () => {
  assert.equal(aiAccountNotice({ plan: "max", refreshExpiresAt: NOW + 27 * 86_400_000 }, { now: NOW }), null);
  assert.equal(aiAccountNotice({ plan: "max", refreshExpiresAt: NOW + 86_400_000 }, { now: NOW }), "Sign in again soon");
  assert.equal(aiAccountNotice({ refreshExpiresAt: NOW - 1 }, { now: NOW }), "Sign-in expired");
  assert.equal(aiAccountNotice({ plan: "plus", refreshExpiresAt: null }, { now: NOW }), null);
});

test("opening the list saves the accounts signed in now", async () => {
  assert.deepEqual(aiAccountsToSave([
    { id: "claude", supported: true, current: { id: null, email: "a@example.com" } },
    { id: "codex", supported: true, current: { id: "acct_x", email: "a@example.com" } },
    { id: "other", supported: false, current: { id: null } },
    { id: "none", supported: true, current: null },
  ]), ["claude"]);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /aiAccountsToSave\(array\(payload\.clis\)\)[\s\S]*?"\/api\/ai-accounts\/current"/);
  assert.doesNotMatch(app, /aiButton\("Save"/);
});

test("a sign-in opens in a running session of the chosen server", () => {
  const sessions = [
    { session_id: "hs_a", server_id: "local", running: false },
    { session_id: "hs_b", server_id: "local", running: true, available: true },
    { session_id: "link_x!hs_c", server_id: "link_x", running: true, available: false },
  ];
  assert.equal(aiLoginSessionId("local", sessions), "hs_b");
  assert.equal(aiLoginSessionId("link_x", sessions), null);
  assert.equal(aiRestartHint("codex"), "codex resume");
  assert.equal(aiRestartHint("claude"), "claude --continue");
});

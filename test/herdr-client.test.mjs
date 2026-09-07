import test from "node:test";
import assert from "node:assert/strict";
import {
  HerdrClient,
  HerdrCommandError,
  InputValidationError,
  validation,
} from "../src/herdr-client.mjs";

test("accepts alphanumeric Herdr IDs and rejects malformed IDs", () => {
  assert.equal(validation.validatePaneId("wB:p1"), "wB:p1");
  assert.equal(validation.validatePaneId("wB:pA"), "wB:pA");
  assert.equal(validation.validateWorkspaceId("wB"), "wB");
  assert.equal(validation.validateTabId("wB:tA"), "wB:tA");
  for (const id of ["wB:p1/", "wB:p1\n", "--help", "w:p", "wB:p1;id"]) {
    assert.throws(() => validation.validatePaneId(id), InputValidationError);
  }
});

function recordingRunner(responses) {
  const calls = [];
  const runner = async (binary, args, options) => {
    calls.push({ binary, args, options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, runner };
}

test("unwraps the Herdr snapshot envelope", async () => {
  const fixture = { workspaces: [{ workspace_id: "w1" }], tabs: [], panes: [] };
  const fake = recordingRunner([
    { stdout: JSON.stringify({ id: "cli:api", result: { snapshot: fixture } }), stderr: "" },
  ]);
  const client = new HerdrClient({ binary: "/opt/herdr", runner: fake.runner });

  assert.deepEqual(await client.snapshot(), fixture);
  assert.deepEqual(fake.calls[0].args, ["api", "snapshot"]);
  assert.equal(fake.calls[0].binary, "/opt/herdr");
});

test("scopes Herdr commands to a named persistent session", async () => {
  const fixture = { workspaces: [], tabs: [], panes: [], agents: [] };
  const fake = recordingRunner([
    { stdout: JSON.stringify({ result: { snapshot: fixture } }), stderr: "" },
  ]);
  const client = new HerdrClient({ runner: fake.runner, sessionName: "review" });

  assert.deepEqual(await client.snapshot(), fixture);
  assert.deepEqual(fake.calls[0].args, [
    "--session=review",
    "api",
    "snapshot",
  ]);
});

test("lists persistent Herdr sessions without selecting one", async () => {
  const sessions = [{ name: "default", default: true, running: true }];
  const fake = recordingRunner([
    { stdout: JSON.stringify({ sessions }), stderr: "" },
  ]);
  const client = new HerdrClient({ runner: fake.runner });

  assert.deepEqual(await client.listSessions(), sessions);
  assert.deepEqual(fake.calls[0].args, ["session", "list", "--json"]);
});

test("reads ANSI terminal output by default with bounded rows", async () => {
  const fake = recordingRunner([{ stdout: "hello\n", stderr: "" }]);
  const client = new HerdrClient({ runner: fake.runner });

  assert.equal(await client.readPane("w12:p3", { lines: 90 }), "hello\n");
  assert.deepEqual(fake.calls[0].args, [
    "pane",
    "read",
    "w12:p3",
    "--source",
    "recent-unwrapped",
    "--lines",
    "90",
    "--format",
    "ansi",
  ]);
});

test("can explicitly read plain terminal text", async () => {
  const fake = recordingRunner([{ stdout: "hello\n", stderr: "" }]);
  const client = new HerdrClient({ runner: fake.runner });

  await client.readPane("w12:p3", { lines: 90, format: "text" });
  assert.equal(fake.calls[0].args.at(-1), "text");
});

test("submits text through Herdr's atomic pane run command", async () => {
  const ok = { stdout: "", stderr: "" };
  const fake = recordingRunner([ok]);
  const client = new HerdrClient({ runner: fake.runner });

  assert.equal(
    await client.sendText("w1:p2", "$(touch /tmp/not-run)", { submit: true }),
    "",
  );

  assert.deepEqual(fake.calls.map((call) => call.args), [
    ["pane", "run", "w1:p2", "$(touch /tmp/not-run)"],
  ]);
});

test("accepts an empty successful response when sending terminal keys", async () => {
  const fake = recordingRunner([{ stdout: "", stderr: "" }]);
  const client = new HerdrClient({ runner: fake.runner });

  assert.equal(await client.sendKeys("w1:p2", ["ctrl+c"]), "");
  assert.deepEqual(fake.calls[0].args, ["pane", "send-keys", "w1:p2", "ctrl+c"]);
});

test("renames a workspace with one validated label argument", async () => {
  const fake = recordingRunner([
    { stdout: JSON.stringify({ result: { workspace: { workspace_id: "w12", label: "새 프로젝트" } } }), stderr: "" },
  ]);
  const client = new HerdrClient({ runner: fake.runner });

  await client.renameWorkspace("w12", "  새 프로젝트  ");

  assert.deepEqual(fake.calls[0].args, [
    "workspace",
    "rename",
    "w12",
    "새 프로젝트",
  ]);
});

test("creates and closes shell workspaces and tabs without changing Herdr focus", async () => {
  const ok = { stdout: "", stderr: "" };
  const fake = recordingRunner([ok, ok, ok, ok]);
  const client = new HerdrClient({ runner: fake.runner });

  await client.createWorkspace("  새 프로젝트  ");
  await client.createTab("w12");
  await client.closeTab("w12:t3");
  await client.closeWorkspace("w12");

  assert.deepEqual(fake.calls.map((call) => call.args), [
    ["workspace", "create", "--label", "새 프로젝트", "--no-focus"],
    ["tab", "create", "--workspace", "w12", "--no-focus"],
    ["tab", "close", "w12:t3"],
    ["workspace", "close", "w12"],
  ]);
});

test("rejects invalid pane ids, row counts, text and keys", async () => {
  const client = new HerdrClient({ runner: async () => assert.fail("runner must not execute") });

  await assert.rejects(() => client.readPane("../../socket", { lines: 10 }), InputValidationError);
  await assert.rejects(
    () => client.readPane("w1:p1", { lines: 100_002 }),
    InputValidationError,
  );
  await assert.rejects(() => client.sendText("w1:p1", ""), InputValidationError);
  await assert.rejects(() => client.sendKeys("w1:p1", ["ctrl+x"]), InputValidationError);
  await assert.rejects(() => client.renameWorkspace("../w1", "프로젝트"), InputValidationError);
  await assert.rejects(() => client.renameWorkspace("w1", "   "), InputValidationError);
  await assert.rejects(() => client.renameWorkspace("w1", "첫째\n둘째"), InputValidationError);
  await assert.rejects(() => client.createWorkspace("  "), InputValidationError);
  await assert.rejects(() => client.createTab("../w1"), InputValidationError);
  await assert.rejects(() => client.closeTab("w1:p1"), InputValidationError);
  await assert.rejects(() => client.closeWorkspace("w1:t1"), InputValidationError);
  assert.throws(
    () => new HerdrClient({ sessionName: "bad\nsession" }),
    InputValidationError,
  );
  assert.throws(
    () => new HerdrClient({ sessionName: "가".repeat(81) }),
    InputValidationError,
  );
});

test("does not reflect arbitrary stderr into browser-facing errors", async () => {
  const commandError = Object.assign(new Error("failed"), {
    stderr: "secret host path and token",
  });
  const fake = recordingRunner([commandError]);
  const client = new HerdrClient({ runner: fake.runner });

  await assert.rejects(
    () => client.snapshot(),
    (error) => {
      assert.ok(error instanceof HerdrCommandError);
      assert.equal(error.message, "Herdr command failed");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});

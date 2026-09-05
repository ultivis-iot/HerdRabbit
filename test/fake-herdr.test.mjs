import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const fixture = fileURLToPath(new URL("./fixtures/fake-herdr.mjs", import.meta.url));
const template = fileURLToPath(new URL("./fixtures/fake-state.template.json", import.meta.url));

test("fake Herdr records a submitted response without touching a real session", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-web-local-"));
  const statePath = join(directory, "state.json");
  await writeFile(statePath, await readFile(template));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const options = { env: { ...process.env, HERDR_FAKE_STATE: statePath } };

  const snapshot = await execFileAsync(fixture, ["api", "snapshot"], options);
  assert.equal(JSON.parse(snapshot.stdout).result.snapshot.agents[1].state, "blocked");

  await execFileAsync(
    fixture,
    ["workspace", "rename", "w1", "새 프로젝트"],
    options,
  );

  const recent = await execFileAsync(
    fixture,
    ["pane", "read", "w1:p2", "--lines", "201"],
    options,
  );
  assert.equal(recent.stdout.split("\n").length, 201);
  assert.doesNotMatch(recent.stdout, /세션 시작 기록/);

  const expanded = await execFileAsync(
    fixture,
    ["pane", "read", "w1:p2", "--lines", "401"],
    options,
  );
  assert.match(expanded.stdout, /세션 시작 기록/);

  await execFileAsync(fixture, ["pane", "run", "w1:p2", "--", "승인합니다"], options);

  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.snapshot.workspaces[0].label, "새 프로젝트");
  assert.equal(state.snapshot.agents[1].state, "idle");
  assert.match(state.outputs["w1:p2"], /승인합니다/);
  assert.match(state.outputs["w1:p2"], /응답을 전달했습니다/);
});

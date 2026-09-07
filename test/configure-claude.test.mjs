import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureClaude } from "../scripts/configure-claude.mjs";

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "claude-settings-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("Claude configuration preserves settings, backs up original, and is idempotent", async (t) => {
  const configDirectory = await directory(t);
  const original = JSON.stringify({ tui: "fullscreen", env: { EXISTING: "keep" }, permissions: { allow: ["Read"] } });
  await writeFile(join(configDirectory, "settings.json"), original);
  const result = await configureClaude({ configDirectory });
  assert.equal(await readFile(result.backup, "utf8"), original);
  assert.deepEqual(JSON.parse(await readFile(result.path, "utf8")), {
    tui: "default", env: { EXISTING: "keep", CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" }, permissions: { allow: ["Read"] },
  });
  assert.equal((await configureClaude({ configDirectory })).changed, false);
  assert.equal((await readdir(configDirectory)).length, 2);
});

test("Claude configuration creates a missing config directory", async (t) => {
  const configDirectory = join(await directory(t), "custom-config");
  const result = await configureClaude({ configDirectory });
  assert.equal(result.backup, undefined);
  assert.equal(JSON.parse(await readFile(result.path, "utf8")).tui, "default");
});

test("Claude configuration leaves malformed settings untouched", async (t) => {
  const configDirectory = await directory(t);
  for (const original of ["broken", "null", "[]", '{"env":[]}']) {
    const path = join(configDirectory, "settings.json");
    await writeFile(path, original);
    await assert.rejects(configureClaude({ configDirectory }));
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual(await readdir(configDirectory), ["settings.json"]);
  }
});

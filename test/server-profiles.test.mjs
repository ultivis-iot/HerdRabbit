import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { ServerProfiles, SERVER_ID_PATTERN, transportOf, validateServerProfile } from "../src/server-profiles.mjs";

const ssh = { name: "Box", host: "box.example", username: "deploy", authMethod: "config" };
const link = { name: "Dev box", address: "https://dev.tail1234.ts.net:38787", transport: "link" };

async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-servers-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "profiles.json");
  return { file, profiles: await ServerProfiles.load(file) };
}

test("a record without a transport is read as SSH", () => {
  // Files written before linking existed hold nothing but SSH servers, so the
  // discriminator is additive and needs no migration.
  assert.equal(transportOf({ host: "box" }), "ssh");
  assert.equal(transportOf({ transport: "link" }), "link");
  assert.equal(validateServerProfile(ssh).transport, "ssh");
});

test("keeps both kinds of server in one file", async (t) => {
  const { file, profiles } = await store(t);
  await profiles.save(ssh);
  await profiles.save(link);
  const saved = profiles.list();
  assert.deepEqual(saved.map((item) => item.transport), ["ssh", "link"]);
  assert.match(saved[0].id, /^ssh_/u);
  assert.match(saved[1].id, /^link_/u);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const reloaded = await ServerProfiles.load(file);
  assert.deepEqual(reloaded.list().map((item) => item.name), ["Box", "Dev box"]);
});

test("a link profile stores an origin and no secret", async (t) => {
  const { file, profiles } = await store(t);
  await profiles.save({ ...link, address: "https://Dev.Example:38787/" });
  const [saved] = profiles.list();
  assert.equal(saved.address, "https://dev.example:38787");
  const onDisk = JSON.parse(await readFile(file, "utf8"))[0];
  assert.deepEqual(Object.keys(onDisk).sort(), ["address", "id", "name", "transport"]);
});

test("refuses addresses that would change what the client talks to", () => {
  for (const address of [
    "ftp://box:38787", "https://user:pw@box", "https://box/path",
    "https://box?a=1", "https://box#x", "not a url", "https://",
  ]) {
    assert.throws(() => validateServerProfile({ ...link, address }), { name: "InputValidationError" });
  }
});

test("will not switch a saved server to another transport", async (t) => {
  // The id carries the transport; letting the record disagree with it would
  // route commands down the wrong path.
  const { profiles } = await store(t);
  const [saved] = await profiles.save(ssh);
  await assert.rejects(() => profiles.save({ ...link }, saved.id), /add it again/u);
});

test("the three copies of the server id pattern stay identical", () => {
  // public/ cannot import from src/, so the pattern is duplicated. A copy that
  // drifts silently drops a server's remembered folder or collapse state.
  const sources = ["public/browse-preference.js", "public/workspace-preference.js"]
    .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.match(source, /\(\?:ssh\|link\)_\[a-f0-9-\]\{36\}/u);
  }
  assert.ok(SERVER_ID_PATTERN.test(`ssh_${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`));
  assert.ok(SERVER_ID_PATTERN.test(`link_${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`));
  assert.ok(!SERVER_ID_PATTERN.test("other_00000000-0000-0000-0000-000000000000"));
});

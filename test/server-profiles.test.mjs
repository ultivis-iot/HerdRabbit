import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { ServerProfiles, SERVER_ID_PATTERN, validateServerProfile } from "../src/server-profiles.mjs";

const link = { name: "Dev box", address: "http://100.64.0.9:38787" };

async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-servers-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "profiles.json");
  return { file, profiles: await ServerProfiles.load(file) };
}

test("persists servers in a private file", async (t) => {
  const { file, profiles } = await store(t);
  await profiles.save(link);
  await profiles.save({ ...link, name: "Second", address: "http://100.64.0.10:38787" });
  const saved = profiles.list();
  assert.deepEqual(saved.map((item) => item.name), ["Dev box", "Second"]);
  assert.match(saved[0].id, /^link_/u);
  assert.equal(validateServerProfile(link).transport, "link");
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const reloaded = await ServerProfiles.load(file);
  assert.deepEqual(reloaded.list().map((item) => item.name), ["Dev box", "Second"]);
});

test("a server profile stores an origin and no secret", async (t) => {
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

test("the three copies of the server id pattern stay identical", () => {
  // public/ cannot import from src/, so the pattern is duplicated. A copy that
  // drifts silently drops a server's remembered folder or collapse state.
  const sources = ["public/browse-preference.js", "public/workspace-preference.js"]
    .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.match(source, /link_\[a-f0-9-\]\{36\}/u);
  }
  assert.ok(SERVER_ID_PATTERN.test(`link_${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`));
  assert.ok(!SERVER_ID_PATTERN.test("ssh_00000000-0000-0000-0000-000000000000"));
});

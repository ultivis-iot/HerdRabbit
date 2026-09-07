import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SshProfiles, validateSshProfile } from "../src/ssh-profiles.mjs";
import { shellQuote, sshInvocation, createSshRunner } from "../src/ssh-runner.mjs";
import { MultiServerClient } from "../src/multi-server-client.mjs";
import { HerdrBridgeClient } from "../src/herdr-bridge-client.mjs";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import { once } from "node:events";

const execute = promisify(execFile);
const sample = { name: "Development", host: "dev-server" };
const session = "hs_ZGVmYXVsdA";
const pane = `${session}~wB:p1`;

test("persists, edits, and removes SSH profiles with private permissions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "herdr-ssh-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "profiles.json");
  const store = await SshProfiles.load(file);
  await Promise.all([store.save(sample), store.save({ ...sample, name: "Second" })]);
  assert.equal(store.list().length, 2);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const loaded = await SshProfiles.load(file);
  const id = loaded.list()[0].id;
  await loaded.save({ ...sample, name: "Renamed" }, id);
  assert.equal((await SshProfiles.load(file)).list()[0].name, "Renamed");
  await loaded.remove(id);
  assert.equal((await SshProfiles.load(file)).list().length, 1);
});

test("rejects SSH options, control characters, and invalid profile fields", () => {
  for (const invalid of [
    { host: "-oProxyCommand=bad" }, { host: "server;id" }, { host: "server\n" },
    { username: "-root" }, { port: 65536 }, { identityFile: "relative" }, { herdrBin: "herdr;id" },
    { authMethod: "unknown" }, { authMethod: "key" }, { authMethod: "password", password: "bad\u0000password" },
  ]) assert.throws(() => validateSshProfile({ ...sample, ...invalid }));
});

test("passwords remain in memory, never appear in public profiles or persisted configuration", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "herdr-password-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "profiles.json");
  const store = await SshProfiles.load(file);
  const password = "  secret ' $value  ";
  const result = await store.save({ ...sample, authMethod: "password", password });
  const id = result[0].id;
  assert.equal(result[0].password, undefined);
  assert.equal(store.connectionProfiles()[0].password, password);
  assert.equal((await readFile(file, "utf8")).includes("secret"), false);
  assert.equal((await readFile(file, "utf8")).includes('"password":'), false);
  await store.save({ ...sample, name: "Another" });
  assert.equal(store.connectionProfiles()[0].password, password);
  const restored = await SshProfiles.load(file);
  assert.equal(restored.connectionProfiles()[0].password, "");
  await assert.rejects(createSshRunner(restored.connectionProfiles()[0], dir)("herdr", [], {}), /password again/);
  assert.throws(() => store.save({ ...sample, authMethod: "password" }), /Enter the SSH password/);
  await store.save({ ...sample, authMethod: "config" }, id);
  assert.equal(store.connectionProfiles()[0].password, "");
});

test("password authentication uses askpass without placing secrets in command arguments", async () => {
  const password = "  p@ss '$value'  ";
  const profile = validateSshProfile({ ...sample, authMethod: "password", password });
  const runner = createSshRunner(profile, "/tmp/private-controls", async (binary, args, options) => {
    assert.equal(binary, "ssh");
    assert.equal(args.join(" ").includes(password), false);
    assert.ok(args.includes("BatchMode=no"));
    assert.ok(args.includes("PreferredAuthentications=password"));
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.equal(options.env.SSH_ASKPASS_REQUIRE, "force");
    const answer = await execute(options.env.SSH_ASKPASS, ["test@host's password:"], { env: options.env });
    assert.equal(answer.stdout, password + "\n");
    await assert.rejects(execute(options.env.SSH_ASKPASS, ["Are you sure you want to continue connecting?"], { env: options.env }));
    return { stdout: "authenticated" };
  });
  assert.equal((await runner("herdr", ["api"], {})).stdout, "authenticated");
  const failing = createSshRunner(profile, "/tmp/private-controls", async () => {
    throw Object.assign(new Error(password), { stderr: "Permission denied " + password });
  });
  await assert.rejects(failing("herdr", [], {}), (error) => {
    assert.equal(error.message.includes(password), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("preserves prompts as a single remote argument without shell expansion", async () => {
  const prompt = "hello 'quoted' \"double\"\n$(printf injected); `printf injected` --";
  const { stdout } = await execute("sh", ["-c", `printf '%s' ${shellQuote(prompt)}`]);
  assert.equal(stdout, prompt);
  const args = sshInvocation(validateSshProfile(sample), ["pane", "run", "wB:p1", prompt], "/tmp/private-controls");
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("ForwardAgent=no"));
  assert.equal(args.at(-2), "dev-server");
  assert.ok(args.at(-1).endsWith(shellQuote(prompt)));
});

function bridge(label, received) {
  return new HerdrBridgeClient({ runner: async (_binary, args) => {
    const command = args[0]?.startsWith("--session=") ? args.slice(1) : args;
    if (command[0] === "session") return { stdout: JSON.stringify({ sessions: [{ name: "default", running: true, default: true }] }) };
    if (command[0] === "api") return { stdout: JSON.stringify({ snapshot: {
      workspaces: [{ workspace_id: "wB", label }],
      tabs: [{ workspace_id: "wB", tab_id: "wB:t1" }],
      panes: [{ workspace_id: "wB", tab_id: "wB:t1", pane_id: "wB:p1" }], agents: [],
    } }) };
    received.push(command);
    return { stdout: command[1] === "read" ? label : "" };
  } });
}

test("aggregates identical local and remote IDs and routes commands to the correct Herdr", async () => {
  const localCalls = [], remoteCalls = [];
  const profile = { ...validateSshProfile(sample), id: "ssh_11111111-1111-1111-1111-111111111111" };
  const profiles = { list: () => [profile] };
  const client = new MultiServerClient({ local: bridge("Local", localCalls), profiles, remoteFactory: () => bridge("Remote", remoteCalls) });
  await client.snapshot();
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = await client.snapshot();
  const remotePane = `${profile.id}!${pane}`;
  assert.deepEqual(snapshot.panes.map((item) => item.pane_id), [pane, remotePane]);
  assert.equal(await client.readPane(pane, { lines: 1 }), "Local");
  assert.equal(await client.readPane(remotePane, { lines: 1 }), "Remote");
  await client.sendText(remotePane, "hello", { submit: true });
  assert.deepEqual(remoteCalls.at(-1), ["pane", "run", "wB:p1", "hello"]);
  assert.equal(localCalls.length, 1);
  await client.createWorkspace("New", `${profile.id}!${session}`);
  assert.equal(remoteCalls.at(-1)[0], "workspace");
  profiles.list = () => [];
  await assert.rejects(client.readPane(remotePane), /no longer exists/);
});

test("a stalled remote cannot block local snapshots", { timeout: 1_000 }, async () => {
  const client = new MultiServerClient({ local: bridge("Local", []),
    profiles: { list: () => [{ ...sample, id: "ssh_stalled" }] },
    remoteFactory: () => ({ snapshot: () => new Promise(() => {}) }),
  });
  const snapshot = await client.snapshot();
  assert.equal(snapshot.panes[0].pane_id, pane);
  assert.equal(snapshot.servers[1].status, "Connecting");
});

test("profile HTTP API protects writes and supports test, add, edit, delete", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "herdr-profile-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profiles = await SshProfiles.load(join(dir, "profiles.json"));
  const herdr = new MultiServerClient({ local: bridge("Local", []), profiles, remoteFactory: () => bridge("Remote", []) });
  const { server } = createHerdrHttpServer({ herdr, profiles, csrfToken: "test-token" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body, authorized = true) => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(authorized ? { Origin: base, "X-Herdr-CSRF": "test-token" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await request("/api/ssh-profiles", "POST", sample, false)).status, 403);
  assert.equal(profiles.list().length, 0);
  assert.equal((await request("/api/ssh-profiles/test", "POST", { ...sample, host: "-bad" })).status, 400);
  assert.equal((await request("/api/ssh-profiles/test", "POST", { ...sample, authMethod: "password" })).status, 400);
  const tested = await request("/api/ssh-profiles/test", "POST", sample);
  assert.deepEqual(await tested.json(), { ok: true, sessions: 1, panes: 1 });
  assert.equal(profiles.list().length, 0);
  const saved = await request("/api/ssh-profiles", "POST", { ...sample, authMethod: "password", password: "api-secret" });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(JSON.stringify(savedBody).includes("api-secret"), false);
  assert.equal(profiles.connectionProfiles()[0].password, "api-secret");
  const id = savedBody.profiles[0].id;
  assert.equal((await request(`/api/ssh-profiles/${id}`, "PUT", { ...sample, name: "Renamed" })).status, 200);
  const listed = await fetch(base + "/api/ssh-profiles").then((response) => response.json());
  assert.equal(listed.profiles[0].name, "Renamed");
  assert.equal((await request(`/api/ssh-profiles/${id}`, "DELETE")).status, 200);
  assert.equal(profiles.list().length, 0);
});

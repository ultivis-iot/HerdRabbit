import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import { leafLinkRoutes } from "../src/link-server.mjs";
import { LeafLinkClient } from "../src/leaf-link-client.mjs";
import { MultiServerClient } from "../src/multi-server-client.mjs";
import { PEER_LOGIN_HEADER, PeerIdentity } from "../src/peer-identity.mjs";

const OWNER = "owner@example.com";
const HUB_VERSION = "1.2.0";
const LINK_ID = "link_11111111-1111-1111-1111-111111111111";
const SESSION = "hs_ZGVmYXVsdA";
const PANE = `${SESSION}~wB:p1`;

// The peer headers are added by Tailscale Serve in production. Here the client
// talks straight to the leaf, so the test supplies them.
function hubFetch(fetchImpl = globalThis.fetch) {
  return (url, options = {}) => fetchImpl(url, {
    ...options,
    headers: { ...options.headers, [PEER_LOGIN_HEADER]: OWNER },
  });
}

function leafHerdr(calls, snapshotOverrides = {}) {
  return {
    async snapshot() {
      calls.push(["snapshot"]);
      return {
        focused_pane_id: PANE,
        herdr_sessions: [{ session_id: SESSION, name: "default", running: true, available: true }],
        workspaces: [{ workspace_id: `${SESSION}~wB`, label: "ship it!", herdr_session_id: SESSION }],
        tabs: [], agents: [],
        panes: [{ pane_id: PANE, workspace_id: `${SESSION}~wB` }],
        ...snapshotOverrides,
      };
    },
    async readPane(id) { calls.push(["readPane", id]); return "remote output"; },
    async sendText(id, text, options) { calls.push(["sendText", id, text, options]); },
    async sendKeys(id, keys) { calls.push(["sendKeys", id, keys]); },
  };
}

async function startLeaf(context, { calls = [], version = HUB_VERSION, herdr } = {}) {
  const created = createHerdrHttpServer({
    herdr: { async snapshot() { return {}; } },
    csrfToken: "fixed-test-token",
    logger: { error() {} },
    peer: new PeerIdentity({ logins: [OWNER] }),
    link: leafLinkRoutes({ client: herdr ?? leafHerdr(calls), version, serverName: "dev-box" }),
  });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  context.after(() => new Promise((resolve) => created.server.close(resolve)));
  return { address: `http://127.0.0.1:${created.server.address().port}`, calls };
}

function hubFor(address, { name = "Dev box" } = {}) {
  const profile = { id: LINK_ID, name, transport: "link", address };
  const localCalls = [];
  const local = {
    async snapshot() { return { herdr_sessions: [], workspaces: [], tabs: [], panes: [], agents: [] }; },
    async readPane() { localCalls.push("readPane"); return "local"; },
  };
  const herdr = new MultiServerClient({
    local,
    profiles: { list: () => [profile], connectionProfiles: () => [profile] },
    remoteFactory: (item) => new LeafLinkClient({
      profile: item, hubVersion: HUB_VERSION, fetchImpl: hubFetch(),
    }),
  });
  return { herdr, localCalls };
}

async function settled(herdr) {
  await herdr.snapshot();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const snapshot = await herdr.snapshot();
    if (snapshot.servers[1].available) return snapshot;
  }
  return herdr.snapshot();
}

test("a linked leaf appears in the merged snapshot under its own prefix", async (context) => {
  const { address, calls } = await startLeaf(context);
  const { herdr } = hubFor(address);
  const snapshot = await settled(herdr);

  assert.equal(snapshot.servers[1].transport, "link");
  assert.equal(snapshot.servers[1].status, "Connected");
  assert.deepEqual(snapshot.panes.map((pane) => pane.pane_id), [`${LINK_ID}!${PANE}`]);
  assert.equal(snapshot.workspaces[0].label, "ship it!", "a label is not an id and keeps its punctuation");
  assert.equal(snapshot.panes[0].server_name, "Dev box");
  assert.ok(calls.some(([name]) => name === "snapshot"));
});

test("commands reach the leaf with the prefix taken off again", async (context) => {
  const { address, calls } = await startLeaf(context);
  const { herdr, localCalls } = hubFor(address);
  await settled(herdr);

  assert.equal(await herdr.readPane(`${LINK_ID}!${PANE}`, { lines: 40 }), "remote output");
  assert.deepEqual(calls.at(-1), ["readPane", PANE]);
  await herdr.sendText(`${LINK_ID}!${PANE}`, "hello", { submit: true });
  assert.deepEqual(calls.at(-1), ["sendText", PANE, "hello", { submit: true }]);
  await herdr.sendKeys(`${LINK_ID}!${PANE}`, ["enter"]);
  assert.deepEqual(calls.at(-1), ["sendKeys", PANE, ["enter"]]);
  assert.equal(localCalls.length, 0, "nothing was routed to the local machine");
});

test("a leaf on another version is shown offline with the reason", async (context) => {
  const { address } = await startLeaf(context, { version: "9.9.9" });
  const { herdr } = hubFor(address);
  await herdr.snapshot();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if ((await herdr.snapshot()).servers[1].status !== "Connecting") break;
  }
  const snapshot = await herdr.snapshot();
  assert.equal(snapshot.servers[1].available, false);
  assert.match(snapshot.servers[1].status, /9\.9\.9/u);
  assert.match(snapshot.servers[1].status, /1\.2\.0/u);
  assert.equal(snapshot.panes.length, 0, "an incompatible leaf contributes nothing");
});

test("records a leaf should not be reporting are dropped", async (context) => {
  // The leaf declares scope "local" and the hub still filters, because a
  // declaration is easy to get wrong and a silent forwarded record would carry
  // an id this hub cannot route.
  const calls = [];
  const herdrWithStrays = leafHerdr(calls, {
    panes: [
      { pane_id: PANE },
      { pane_id: "ssh_22222222-2222-2222-2222-222222222222!wC:p1" },
      { pane_id: "wD:p1", server_id: "ssh_22222222-2222-2222-2222-222222222222" },
    ],
  });
  const { address } = await startLeaf(context, { herdr: herdrWithStrays });
  const { herdr } = hubFor(address);
  const snapshot = await settled(herdr);
  assert.deepEqual(snapshot.panes.map((pane) => pane.pane_id), [`${LINK_ID}!${PANE}`]);
});

test("a leaf that refuses this hub says so instead of blaming SSH", async (context) => {
  const created = createHerdrHttpServer({
    herdr: { async snapshot() { return {}; } },
    csrfToken: "fixed-test-token",
    logger: { error() {} },
    peer: new PeerIdentity({ logins: ["someone@else"] }),
    link: leafLinkRoutes({ client: leafHerdr([]), version: HUB_VERSION }),
  });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  context.after(() => new Promise((resolve) => created.server.close(resolve)));

  const { herdr } = hubFor(`http://127.0.0.1:${created.server.address().port}`);
  await herdr.snapshot();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if ((await herdr.snapshot()).servers[1].status !== "Connecting") break;
  }
  const status = (await herdr.snapshot()).servers[1].status;
  assert.match(status, /did not accept this hub/u);
  assert.ok(!status.includes("SSH"), "a linked server has nothing to do with SSH access");
});

test("project changes on a linked server fail with something a person can read", async (context) => {
  const { address } = await startLeaf(context);
  const { herdr } = hubFor(address);
  await settled(herdr);
  await assert.rejects(() => herdr.createTab(`${LINK_ID}!${SESSION}~wB`), /not supported yet/u);
  await assert.rejects(() => herdr.renameWorkspace(`${LINK_ID}!${SESSION}~wB`, "New"), /not supported yet/u);
});

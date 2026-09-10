import test from "node:test";
import assert from "node:assert/strict";
import { discoverLeaves, readTailnetPeers } from "../src/tailnet-peers.mjs";

const HUB_VERSION = "1.4.0";

const status = {
  BackendState: "Running",
  Self: { DNSName: "hub.tailnet.ts.net.", TailscaleIPs: ["100.64.0.1", "fd7a::1"] },
  Peer: {
    a: { DNSName: "ready-box.tailnet.ts.net.", TailscaleIPs: ["100.64.0.2"], Online: true },
    b: { DNSName: "sleeping.tailnet.ts.net.", TailscaleIPs: ["100.64.0.3"], Online: false },
    c: { DNSName: "bare.tailnet.ts.net.", TailscaleIPs: ["100.64.0.4"], Online: true },
    d: { DNSName: "strict.tailnet.ts.net.", TailscaleIPs: ["100.64.0.5"], Online: true },
    e: { DNSName: "older.tailnet.ts.net.", TailscaleIPs: ["100.64.0.6"], Online: true },
  },
};

const execute = async () => ({ stdout: JSON.stringify(status) });

const answers = {
  "100.64.0.2": { status: 200, body: { product: "herdrabbit", version: HUB_VERSION, link_protocol: 1, scope: "local" } },
  "100.64.0.4": "refuse-connection",
  "100.64.0.5": { status: 403, body: { error: { code: "peer_address_rejected" } } },
  "100.64.0.6": { status: 200, body: { product: "herdrabbit", version: "1.1.0", link_protocol: 1, scope: "local" } },
};

const fetchImpl = async (url) => {
  const address = new URL(url).hostname;
  const answer = answers[address];
  if (answer === "refuse-connection") throw new Error("ECONNREFUSED");
  return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
};

function stateOf(candidates, name) {
  return candidates.find((candidate) => candidate.name === name)?.state;
}

test("reads the tailnet, dropping what cannot be addressed", async () => {
  const tailnet = await readTailnetPeers(execute);
  assert.equal(tailnet.available, true);
  assert.deepEqual(tailnet.self,
    { name: "hub", fullName: "hub.tailnet.ts.net", address: "100.64.0.1", login: "" });
  assert.deepEqual(tailnet.peers.map((peer) => peer.name), ["bare", "older", "ready-box", "sleeping", "strict"]);
});

test("says what each machine is rather than hiding the ones that will not work", async () => {
  // A machine missing from the list is indistinguishable from a machine that
  // is refusing this hub, and those need completely different fixes.
  const { candidates, self } = await discoverLeaves({ hubVersion: HUB_VERSION, execute, fetchImpl });
  assert.equal(self.address, "100.64.0.1");
  assert.equal(stateOf(candidates, "ready-box"), "ready");
  assert.equal(stateOf(candidates, "sleeping"), "offline", "an offline peer is named, not probed");
  assert.equal(stateOf(candidates, "bare"), "absent");
  assert.equal(stateOf(candidates, "strict"), "refused");
  assert.equal(stateOf(candidates, "older"), "incompatible");
  assert.match(candidates.find((candidate) => candidate.name === "older").reason, /1\.1\.0/u);
});

test("marks a machine that is already registered", async () => {
  const { candidates } = await discoverLeaves({
    hubVersion: HUB_VERSION, execute, fetchImpl,
    known: ["http://100.64.0.2:38787"],
  });
  assert.equal(stateOf(candidates, "ready-box"), "added");
});

test("reports plainly when there is no tailnet to read", async () => {
  const found = await discoverLeaves({
    hubVersion: HUB_VERSION,
    execute: async () => { throw new Error("tailscale: not found"); },
  });
  assert.deepEqual(found, { available: false, self: null, candidates: [] });
});

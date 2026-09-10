import test from "node:test";
import assert from "node:assert/strict";
import { parseAllowedHosts, parseHost, parsePeerAddresses, parsePeerLogins, parsePort, readConfig } from "../src/config.mjs";

test("uses safe loopback defaults", () => {
  const config = readConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 38_787);
  assert.equal(config.herdrBin, "herdr");
  assert.match(config.authFile, /\/\.config\/herdr-bridge\/auth\.json$/);
  assert.match(config.pushFile, /\/\.config\/herdr-bridge\/push\.json$/);
  assert.deepEqual(config.extraAllowedHosts, []);
});

test("accepts an explicit authentication file", () => {
  assert.equal(
    readConfig({ HERDR_WEB_AUTH_FILE: "/tmp/herdr-auth.json" }).authFile,
    "/tmp/herdr-auth.json",
  );
});

test("accepts an explicit push configuration file", () => {
  assert.equal(
    readConfig({ HERDR_WEB_PUSH_FILE: "/tmp/herdr-push.json" }).pushFile,
    "/tmp/herdr-push.json",
  );
});

test("accepts explicit proxy hostnames without accepting paths or ports", () => {
  assert.deepEqual(
    parseAllowedHosts("Workstation.tailnet.ts.net, local.example"),
    ["workstation.tailnet.ts.net", "local.example"],
  );
  assert.throws(() => parseAllowedHosts("https://local.example"));
  assert.throws(() => parseAllowedHosts("local.example:443"));
});

test("accepts an explicit unprivileged port", () => {
  assert.equal(parsePort("30001"), 30_001);
});

test("binds where it is told, defaulting to loopback", () => {
  assert.equal(parseHost(undefined), "127.0.0.1");
  assert.equal(parseHost("0.0.0.0"), "0.0.0.0");
  assert.equal(readConfig({ HERDR_WEB_HOST: "0.0.0.0" }).host, "0.0.0.0");
  // One interface only -- a Tailscale address -- keeps the service off every
  // other network the machine is on, which 0.0.0.0 cannot do.
  assert.equal(parseHost("100.101.171.95"), "100.101.171.95");
  assert.equal(parseHost("::1"), "::1");
});

test("refuses a host that is not a literal address", () => {
  // A name is resolved when the socket is opened, so it could bind an
  // interface the operator never meant to expose.
  for (const value of ["gungbuntu.example.ts.net", "localhost", "0.0.0.0:38787", "100.101.171"]) {
    assert.throws(() => parseHost(value), /HERDR_WEB_HOST/u);
  }
});

test("rejects privileged or malformed ports", () => {
  for (const value of ["80", "0", "abc", "65536", "8787.5"]) {
    assert.throws(() => parsePort(value));
  }
});

test("defaults to a hub with no peers", () => {
  const config = readConfig({});
  assert.equal(config.role, "hub");
  assert.deepEqual(config.peerLogins, []);
  assert.deepEqual(config.peerAddresses, []);
});

test("accepts a leaf pinned to loopback with a peer", () => {
  const config = readConfig({
    HERDR_WEB_ROLE: "leaf",
    HERDR_WEB_HOST: "127.0.0.1",
    HERDR_WEB_PEER_LOGINS: " Owner@Example.com , owner@example.com ",
    HERDR_WEB_PEER_ADDRESSES: "100.101.171.95",
  });
  assert.deepEqual(config.peerLogins, ["owner@example.com"]);
  assert.deepEqual(config.peerAddresses, ["100.101.171.95"]);
});

test("refuses the configurations that would leave a leaf open", () => {
  // Peers without the role is the dangerous one: the API would answer the whole
  // tailnet while the hub keeps working and nothing looks wrong.
  assert.throws(() => readConfig({ HERDR_WEB_PEER_LOGINS: "owner@example.com" }),
    /only apply with HERDR_WEB_ROLE=leaf/u);
  assert.throws(() => readConfig({ HERDR_WEB_ROLE: "leaf" }),
    /requires HERDR_WEB_PEER_LOGINS/u);
  // Every interface would put the leaf on the LAN and every container bridge,
  // where a source address proves nothing about who is calling.
  assert.throws(() => readConfig({
    HERDR_WEB_ROLE: "leaf",
    HERDR_WEB_HOST: "0.0.0.0",
    HERDR_WEB_PEER_LOGINS: "owner@example.com",
  }), /cannot bind every interface/u);
  // Bound to a tailnet address there is no Serve to name the account, so the
  // hub has to be named by address.
  assert.throws(() => readConfig({
    HERDR_WEB_ROLE: "leaf",
    HERDR_WEB_HOST: "100.101.171.95",
    HERDR_WEB_PEER_LOGINS: "owner@example.com",
  }), /HERDR_WEB_PEER_ADDRESSES is required/u);
  assert.throws(() => readConfig({ HERDR_WEB_ROLE: "bogus" }), /must be hub or leaf/u);
});

test("a leaf may listen on its own tailnet address instead of behind Serve", () => {
  const config = readConfig({
    HERDR_WEB_ROLE: "leaf",
    HERDR_WEB_HOST: "100.101.171.95",
    HERDR_WEB_PEER_ADDRESSES: "100.64.0.9",
  });
  assert.equal(config.host, "100.101.171.95");
  assert.deepEqual(config.peerAddresses, ["100.64.0.9"]);
});

test("rejects malformed peer logins and addresses", () => {
  for (const logins of ["not-a-login", "owner@example.com, bad", "@example.com", "a".repeat(330) + "@x"]) {
    assert.throws(() => parsePeerLogins(logins), /HERDR_WEB_PEER_LOGINS/u);
  }
  for (const addresses of ["box.example", "100.101.171.95, nope", "999.1.1.1"]) {
    assert.throws(() => parsePeerAddresses(addresses), /HERDR_WEB_PEER_ADDRESSES/u);
  }
});

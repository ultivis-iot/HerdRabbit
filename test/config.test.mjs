import test from "node:test";
import assert from "node:assert/strict";
import { parseAllowedHosts, parseHost, parsePort, readConfig } from "../src/config.mjs";

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

import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  connectionFromConfig,
  knownHostsFiles,
  parseEffectiveConfig,
  readEffectiveConfig,
  unsupportedReasons,
} from "../src/ssh-effective-config.mjs";

test("splits each line at the first gap only", () => {
  const config = parseEffectiveConfig([
    "user capalace",
    "hostname real.example",
    "port 2222",
    "proxycommand /usr/bin/nc -X connect -x proxy:8080 %h %p",
    "",
  ].join("\n"));

  assert.deepEqual(config.get("user"), ["capalace"]);
  assert.deepEqual(config.get("port"), ["2222"]);
  assert.deepEqual(
    config.get("proxycommand"),
    ["/usr/bin/nc -X connect -x proxy:8080 %h %p"],
    "a value with spaces stays whole",
  );
});

test("collects repeated keys in order", () => {
  const config = parseEffectiveConfig([
    "identityfile ~/.ssh/id_ed25519",
    "identityfile ~/.ssh/id_rsa",
  ].join("\n"));
  assert.equal(config.get("identityfile").length, 2);
});

test("names the settings ssh2 cannot honour", () => {
  assert.deepEqual(unsupportedReasons(parseEffectiveConfig("hostname box")), []);
  assert.deepEqual(
    unsupportedReasons(parseEffectiveConfig("proxycommand none\npkcs11provider none")),
    [],
    "none means unset",
  );
  assert.deepEqual(
    unsupportedReasons(parseEffectiveConfig("proxyjump bastion.example")),
    ["ProxyJump"],
  );
  assert.deepEqual(
    unsupportedReasons(parseEffectiveConfig("proxycommand /usr/bin/nc %h %p")),
    ["ProxyCommand"],
  );
  assert.deepEqual(
    unsupportedReasons(parseEffectiveConfig("pkcs11provider /usr/lib/opensc.so")),
    ["PKCS11Provider"],
  );
});

test("does not refuse a server over settings that only offer another credential", () => {
  // ssh -G lists the default identity candidates, FIDO ones included, whether
  // or not the files exist, and GSSAPI is on by default on many distributions.
  // Treating either as a blocker would refuse almost every server.
  assert.deepEqual(
    unsupportedReasons(parseEffectiveConfig([
      "gssapiauthentication yes",
      "identityfile ~/.ssh/id_rsa",
      "identityfile ~/.ssh/id_ecdsa_sk",
      "identityfile ~/.ssh/id_ed25519_sk",
    ].join("\n"))),
    [],
  );
});

test("follows the configured known_hosts files and expands ~", () => {
  const config = parseEffectiveConfig([
    "userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2",
    "globalknownhostsfile /etc/ssh/ssh_known_hosts",
  ].join("\n"));

  assert.deepEqual(knownHostsFiles(config), [
    `${homedir()}/.ssh/known_hosts`,
    `${homedir()}/.ssh/known_hosts2`,
    "/etc/ssh/ssh_known_hosts",
  ]);

  // Looking only at the default would miss a host kept in a system file.
  assert.deepEqual(knownHostsFiles(parseEffectiveConfig("hostname box")), [
    `${homedir()}/.ssh/known_hosts`,
  ]);
  assert.deepEqual(knownHostsFiles(parseEffectiveConfig("userknownhostsfile none")), [
    `${homedir()}/.ssh/known_hosts`,
  ]);
});

test("builds connection settings from the resolved config", () => {
  const config = parseEffectiveConfig([
    "hostname real.example",
    "user deploy",
    "port 2222",
    "identityfile ~/.ssh/id_ed25519",
    "hostkeyalias pinned.example",
  ].join("\n"));

  const connection = connectionFromConfig(config, { host: "alias", username: "", port: null });
  assert.equal(connection.host, "real.example");
  assert.equal(connection.username, "deploy");
  assert.equal(connection.port, 2222);
  assert.equal(connection.hostKeyAlias, "pinned.example");
  assert.deepEqual(connection.identityFiles, [`${homedir()}/.ssh/id_ed25519`]);
});

test("falls back to the profile when the config says nothing", () => {
  const connection = connectionFromConfig(parseEffectiveConfig(""), {
    host: "box.example",
    username: "me",
    port: 2022,
  });
  assert.equal(connection.host, "box.example");
  assert.equal(connection.username, "me");
  assert.equal(connection.port, 2022);
});

test("asks ssh with the same destination and flags the runner uses", async () => {
  let seen;
  await readEffectiveConfig({ host: "box", username: "me", port: 2222 }, async (_binary, args) => {
    seen = args;
    return { stdout: "hostname box" };
  });
  // Match blocks resolve against the destination, user and port, so these have
  // to mirror sshInvocation or the file path connects under other rules.
  assert.deepEqual(seen, ["-p", "2222", "-l", "me", "-G", "--", "box"]);

  await readEffectiveConfig({ host: "plain" }, async (_binary, args) => {
    seen = args;
    return { stdout: "" };
  });
  assert.deepEqual(seen, ["-G", "--", "plain"]);
});

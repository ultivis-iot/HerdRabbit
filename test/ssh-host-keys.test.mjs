import test from "node:test";
import assert from "node:assert/strict";
import {
  createHostVerifier,
  knownHostsTarget,
  lookupKnownHostKeys,
  parseKnownHostLines,
} from "../src/ssh-host-keys.mjs";

const KEY_A = Buffer.from("first-host-key");
const KEY_B = Buffer.from("second-host-key");
const line = (marker, key) =>
  `${marker ? `${marker} ` : ""}example.test ssh-ed25519 ${key.toString("base64")}`;

function verify(verifier, key) {
  return new Promise((resolve) => verifier(key, resolve));
}

test("names the known_hosts entry the way OpenSSH stores it", () => {
  assert.equal(knownHostsTarget({ host: "box" }), "box");
  assert.equal(knownHostsTarget({ host: "box", port: 22 }), "box");
  assert.equal(knownHostsTarget({ host: "box", port: 2222 }), "[box]:2222");
  // A resolved HostName or an explicit HostKeyAlias wins over the typed alias.
  assert.equal(knownHostsTarget({ host: "alias", hostname: "real.example" }), "real.example");
  assert.equal(
    knownHostsTarget({ host: "alias", hostname: "real.example", hostkeyalias: "pinned" }),
    "pinned",
  );
  assert.equal(knownHostsTarget({ host: "alias", hostname: "real.example", port: 2022 }), "[real.example]:2022");
});

test("separates ordinary keys from revoked ones and ignores CA lines", () => {
  const parsed = parseKnownHostLines([
    "# a comment",
    "",
    line(null, KEY_A),
    line("@revoked", KEY_B),
    line("@cert-authority", KEY_A),
  ].join("\n"));

  assert.equal(parsed.accepted.length, 1);
  assert.ok(parsed.accepted[0].equals(KEY_A));
  assert.equal(parsed.revoked.length, 1);
  assert.ok(parsed.revoked[0].equals(KEY_B));
});

test("reads every configured known_hosts file", async () => {
  const seen = [];
  const execute = async (_binary, args) => {
    seen.push(args[args.indexOf("-f") + 1]);
    return { stdout: args.includes("/etc/ssh/ssh_known_hosts") ? line(null, KEY_B) : line(null, KEY_A) };
  };

  const found = await lookupKnownHostKeys("example.test", ["/home/me/.ssh/known_hosts", "/etc/ssh/ssh_known_hosts"], execute);
  assert.deepEqual(seen, ["/home/me/.ssh/known_hosts", "/etc/ssh/ssh_known_hosts"]);
  assert.equal(found.accepted.length, 2);
});

test("trusts a key listed in known_hosts", async () => {
  const verifier = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    execute: async () => ({ stdout: line(null, KEY_A) }),
  });
  assert.equal(await verify(verifier, KEY_A), true);
  assert.equal(await verify(verifier, KEY_B), false, "a different key is not trusted");
});

test("refuses a revoked key even when the same key is also listed plainly", async () => {
  const verifier = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    execute: async () => ({ stdout: [line("@revoked", KEY_A), line(null, KEY_A)].join("\n") }),
  });
  assert.equal(await verify(verifier, KEY_A), false);
});

test("refuses when nothing is known about the host", async () => {
  const missing = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    // ssh-keygen exits non-zero with empty output when there is no match.
    execute: async () => { throw Object.assign(new Error("exit 1"), { stdout: "" }); },
  });
  assert.equal(await verify(missing, KEY_A), false);
});

test("refuses when the lookup itself fails", async () => {
  const broken = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    execute: () => { throw new Error("ssh-keygen is missing"); },
  });
  assert.equal(await verify(broken, KEY_A), false);
});

// ssh2 uses the return value as the verdict when it is not undefined, and only
// an explicit false rejects. A verifier that returns a promise therefore reads
// as "accepted" and silently disables host key checking altogether.
test("answers on the callback and returns nothing", async () => {
  const verifier = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    execute: async () => ({ stdout: line(null, KEY_A) }),
  });

  let answered;
  const returned = verifier(KEY_B, (permitted) => { answered = permitted; });
  assert.equal(returned, undefined, "a returned promise would override the callback");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
});

test("reports why a key was refused", async () => {
  const reasons = [];
  const verifier = createHostVerifier({
    target: "example.test",
    files: ["known_hosts"],
    execute: async () => ({ stdout: line("@revoked", KEY_A) }),
    onReject: (reason) => reasons.push(reason),
  });
  await verify(verifier, KEY_A);
  assert.deepEqual(reasons, ["revoked"]);
});

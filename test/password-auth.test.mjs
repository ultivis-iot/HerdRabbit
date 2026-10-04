import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPasswordConfiguration,
  loadPasswordAuth,
  passkeyHandle,
  PasswordAttempts,
  PasswordAuth,
  SESSION_DURATION_SECONDS,
  writePasswordConfiguration,
} from "../src/password-auth.mjs";

test("stores only a password hash with private file permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-auth-"));
  const authFile = join(directory, "nested", "auth.json");
  await writePasswordConfiguration(authFile, "correct horse battery staple");

  const source = await readFile(authFile, "utf8");
  const file = await stat(authFile);
  assert.doesNotMatch(source, /correct horse battery staple/);
  assert.equal(file.mode & 0o777, 0o600);

  const auth = await loadPasswordAuth(authFile);
  assert.equal(auth.required, true);
  assert.equal(await auth.verifyPassword("correct horse battery staple"), true);
  assert.equal(await auth.verifyPassword("wrong"), false);
});

test("an empty password removes authentication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-auth-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "temporary");
  await writePasswordConfiguration(authFile, "");
  const auth = await loadPasswordAuth(authFile);
  assert.equal(auth.required, false);
  assert.equal(auth.hasValidSession(), true);
});

test("signed sessions expire and changing the configuration invalidates them", async () => {
  let now = 1_000_000;
  const first = new PasswordAuth(
    await createPasswordConfiguration("password"),
    { now: () => now },
  );
  const token = first.createSession();
  const launchToken = first.createLaunchToken();
  assert.equal(first.hasValidSession(`other=x; herdr_session=${token}`), true);
  assert.equal(first.hasValidLaunchToken(launchToken), true);
  assert.equal(first.hasValidSession(`herdr_session=${launchToken}`), false);
  assert.equal(first.hasValidLaunchToken(token), false);
  assert.equal(SESSION_DURATION_SECONDS, 7 * 24 * 60 * 60);

  now += 8 * 24 * 60 * 60 * 1_000;
  assert.equal(first.hasValidSession(`herdr_session=${token}`), false);
  assert.equal(first.hasValidLaunchToken(launchToken), false);

  const replacement = new PasswordAuth(
    await createPasswordConfiguration("password"),
    { now: () => 1_000_000 },
  );
  assert.equal(replacement.hasValidSession(`herdr_session=${token}`), false);
});

test("persists passkey public data and clears it when the password changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-auth-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "first-password");

  const auth = await loadPasswordAuth(authFile);
  assert.equal(auth.hasPasskeys, false);
  await auth.addPasskey({
    id: "credential-id",
    publicKey: Uint8Array.from([1, 2, 3, 4]),
    counter: 3,
    transports: ["internal", "hybrid"],
    deviceType: "multiDevice",
    backedUp: true,
  });

  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.hasPasskeys, true);
  assert.deepEqual(reloaded.passkeys, [{
    id: "credential-id",
    publicKey: Uint8Array.from([1, 2, 3, 4]),
    counter: 3,
    transports: ["internal", "hybrid"],
    deviceType: "multiDevice",
    backedUp: true,
  }]);

  await reloaded.updatePasskeyCounter("credential-id", 4);
  const updated = await loadPasswordAuth(authFile);
  assert.equal(updated.passkeys[0].counter, 4);

  await writePasswordConfiguration(authFile, "second-password");
  const replaced = await loadPasswordAuth(authFile);
  assert.equal(replaced.hasPasskeys, false);
});

test("keeps passkey names and dates, removes by handle, and loads older entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-auth-"));
  const authFile = join(directory, "auth.json");
  let now = 1_000;
  const configuration = await createPasswordConfiguration("secret");
  // Written before passkeys had names or dates.
  configuration.passkeys = [{
    id: "older",
    publicKey: "b2xkZXI",
    counter: 0,
    transports: [],
    deviceType: "singleDevice",
    backedUp: false,
  }];
  const auth = new PasswordAuth(configuration, { authFile, now: () => now });
  await auth.addPasskey({
    id: "newer",
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 0,
    transports: ["hybrid"],
    deviceType: "multiDevice",
    backedUp: true,
    label: "Chrome · Android",
    createdAt: 900,
  });
  now = 2_000;
  await auth.updatePasskeyCounter("newer", 4);

  assert.deepEqual(auth.passkeySummaries(), [
    { handle: passkeyHandle("older"), label: null, createdAt: null, lastUsedAt: null, deviceType: "singleDevice", backedUp: false },
    { handle: passkeyHandle("newer"), label: "Chrome · Android", createdAt: 900, lastUsedAt: 2_000, deviceType: "multiDevice", backedUp: true },
  ]);
  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.passkeySummaries()[1].lastUsedAt, 2_000);

  assert.equal(await auth.removePasskey("not-a-handle"), false);
  assert.equal(await auth.removePasskey(passkeyHandle("missing")), false);
  assert.equal(await auth.removePasskey(passkeyHandle("older")), true);
  assert.equal(await auth.removePasskey(passkeyHandle("older")), false);
  assert.deepEqual(auth.passkeys.map(({ id }) => id), ["newer"]);
  assert.deepEqual((await loadPasswordAuth(authFile)).passkeys.map(({ id }) => id), ["newer"]);
});

test("rejects passkey names that carry control characters", () => {
  const configuration = {
    version: 1,
    password: { algorithm: "scrypt", salt: "c2FsdA", hash: "aGFzaA" },
    sessionSecret: "c2VjcmV0",
    passkeys: [{
      id: "one",
      publicKey: "b25l",
      counter: 0,
      transports: [],
      deviceType: "singleDevice",
      backedUp: false,
      label: "bad\u0000name",
    }],
  };
  assert.throws(() => new PasswordAuth(configuration), /passkey configuration is invalid/);
});

test("removing a passkey signs out every session made before it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-auth-"));
  const authFile = join(directory, "auth.json");
  const configuration = await createPasswordConfiguration("secret");
  configuration.passkeys = [{
    id: "lost-phone",
    publicKey: "a2V5",
    counter: 0,
    transports: [],
    deviceType: "multiDevice",
    backedUp: true,
  }];
  const auth = new PasswordAuth(configuration, { authFile });
  const before = auth.createSession();
  const beforeLaunch = auth.createLaunchToken();
  assert.equal(auth.hasValidSession(`herdr_session=${before}`), true);

  assert.equal(await auth.removePasskey(passkeyHandle("lost-phone")), true);
  assert.equal(auth.hasValidSession(`herdr_session=${before}`), false);
  assert.equal(auth.hasValidLaunchToken(beforeLaunch), false);
  const after = auth.createSession();
  assert.equal(auth.hasValidSession(`herdr_session=${after}`), true);
  // The ending survives a restart.
  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.hasValidSession(`herdr_session=${before}`), false);
  assert.equal(reloaded.hasValidSession(`herdr_session=${after}`), true);
});

test("a few wrong passwords are free, then each locks for twice as long", () => {
  let clock = 0;
  const attempts = new PasswordAttempts({ now: () => clock, free: 2, maxLockMs: 4_000 });
  attempts.failed();
  attempts.failed();
  assert.equal(attempts.retryAfterMs(), 0);
  attempts.failed();
  assert.equal(attempts.retryAfterMs(), 1_000);
  attempts.failed();
  assert.equal(attempts.retryAfterMs(), 2_000);
  attempts.failed();
  attempts.failed();
  assert.equal(attempts.retryAfterMs(), 4_000);
  clock += 4_000;
  assert.equal(attempts.retryAfterMs(), 0);
  attempts.succeeded();
  attempts.failed();
  assert.equal(attempts.retryAfterMs(), 0);
});

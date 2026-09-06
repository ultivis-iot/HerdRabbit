import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPasswordConfiguration,
  loadPasswordAuth,
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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPasswordConfiguration,
  loadPasswordAuth,
  PasswordAuth,
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
  assert.equal(first.hasValidSession(`other=x; herdr_session=${token}`), true);

  now += 31 * 24 * 60 * 60 * 1_000;
  assert.equal(first.hasValidSession(`herdr_session=${token}`), false);

  const replacement = new PasswordAuth(
    await createPasswordConfiguration("password"),
    { now: () => 1_000_000 },
  );
  assert.equal(replacement.hasValidSession(`herdr_session=${token}`), false);
});

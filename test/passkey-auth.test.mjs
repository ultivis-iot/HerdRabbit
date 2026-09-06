import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPasswordAuth,
  writePasswordConfiguration,
} from "../src/password-auth.mjs";
import { PasskeyAuth, PasskeyError } from "../src/passkey-auth.mjs";

test("registers a verified passkey for the exact browser origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-passkey-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "password");
  const auth = await loadPasswordAuth(authFile);
  const calls = [];
  const passkeys = new PasskeyAuth({
    auth,
    randomId: () => "registration-attempt",
    webauthn: {
      async generateRegistrationOptions(options) {
        calls.push(["generate", options]);
        return { challenge: "registration-challenge" };
      },
      async verifyRegistrationResponse(options) {
        calls.push(["verify", options]);
        return {
          verified: true,
          registrationInfo: {
            credential: {
              id: "credential-id",
              publicKey: Uint8Array.from([1, 2, 3]),
              counter: 0,
              transports: ["internal", "hybrid"],
            },
            credentialDeviceType: "multiDevice",
            credentialBackedUp: true,
          },
        };
      },
    },
  });

  const started = await passkeys.beginRegistration("https://rabbit.example:38787");
  assert.deepEqual(started, {
    attemptId: "registration-attempt",
    options: { challenge: "registration-challenge" },
  });
  assert.equal(calls[0][1].rpName, "HerdRabbit");
  assert.equal(calls[0][1].rpID, "rabbit.example");
  assert.equal(calls[0][1].userName, "HerdRabbit");
  assert.equal(calls[0][1].userDisplayName, "HerdRabbit");
  assert.ok(calls[0][1].userID instanceof Uint8Array);
  assert.deepEqual(calls[0][1].authenticatorSelection, {
    residentKey: "required",
    userVerification: "required",
  });

  const response = { id: "credential-id", response: { attestationObject: "data" } };
  assert.equal(await passkeys.finishRegistration(
    "https://rabbit.example:38787",
    "registration-attempt",
    response,
  ), true);
  assert.equal(calls[1][1].response, response);
  assert.equal(calls[1][1].expectedChallenge, "registration-challenge");
  assert.equal(calls[1][1].expectedOrigin, "https://rabbit.example:38787");
  assert.equal(calls[1][1].expectedRPID, "rabbit.example");
  assert.equal(calls[1][1].requireUserVerification, true);

  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.hasPasskeys, true);
  assert.equal(reloaded.passkeys[0].id, "credential-id");
});

test("authenticates once with a registered passkey and advances its counter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-passkey-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "password");
  const auth = await loadPasswordAuth(authFile);
  await auth.addPasskey({
    id: "credential-id",
    publicKey: Uint8Array.from([4, 5, 6]),
    counter: 2,
    transports: ["internal"],
    deviceType: "singleDevice",
    backedUp: false,
  });
  const calls = [];
  const passkeys = new PasskeyAuth({
    auth,
    randomId: () => "authentication-attempt",
    webauthn: {
      async generateAuthenticationOptions(options) {
        calls.push(["generate", options]);
        return { challenge: "authentication-challenge" };
      },
      async verifyAuthenticationResponse(options) {
        calls.push(["verify", options]);
        return {
          verified: true,
          authenticationInfo: { newCounter: 7 },
        };
      },
    },
  });

  const started = await passkeys.beginAuthentication("https://rabbit.example:38787");
  assert.deepEqual(started, {
    attemptId: "authentication-attempt",
    options: { challenge: "authentication-challenge" },
  });
  assert.equal(calls[0][1].rpID, "rabbit.example");
  assert.equal(calls[0][1].userVerification, "required");
  assert.deepEqual(calls[0][1].allowCredentials, [{
    id: "credential-id",
    transports: ["internal"],
  }]);

  const response = { id: "credential-id", response: { signature: "data" } };
  assert.equal(await passkeys.finishAuthentication(
    "https://rabbit.example:38787",
    "authentication-attempt",
    response,
  ), true);
  assert.equal(calls[1][1].response, response);
  assert.equal(calls[1][1].expectedChallenge, "authentication-challenge");
  assert.equal(calls[1][1].expectedOrigin, "https://rabbit.example:38787");
  assert.equal(calls[1][1].expectedRPID, "rabbit.example");
  assert.equal(calls[1][1].requireUserVerification, true);
  assert.deepEqual(calls[1][1].credential, {
    id: "credential-id",
    publicKey: Uint8Array.from([4, 5, 6]),
    counter: 2,
    transports: ["internal"],
  });

  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.passkeys[0].counter, 7);
  await assert.rejects(
    () => passkeys.finishAuthentication(
      "https://rabbit.example:38787",
      "authentication-attempt",
      response,
    ),
    (error) => error instanceof PasskeyError && error.code === "passkey_challenge_invalid",
  );
});

test("rejects expired challenges and a response from a different origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-passkey-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "password");
  const auth = await loadPasswordAuth(authFile);
  let now = 1_000;
  let attempt = 0;
  const passkeys = new PasskeyAuth({
    auth,
    now: () => now,
    randomId: () => `attempt-${++attempt}`,
    webauthn: {
      async generateRegistrationOptions() {
        return { challenge: `challenge-${attempt + 1}` };
      },
      async verifyRegistrationResponse() {
        throw new Error("verification must not run for a rejected challenge");
      },
    },
  });

  const expired = await passkeys.beginRegistration("https://rabbit.example");
  now += 5 * 60 * 1_000;
  await assert.rejects(
    () => passkeys.finishRegistration(
      "https://rabbit.example",
      expired.attemptId,
      { id: "credential-id" },
    ),
    (error) => error instanceof PasskeyError && error.code === "passkey_challenge_invalid",
  );

  const otherOrigin = await passkeys.beginRegistration("https://rabbit.example");
  await assert.rejects(
    () => passkeys.finishRegistration(
      "https://other.example",
      otherOrigin.attemptId,
      { id: "credential-id" },
    ),
    (error) => error instanceof PasskeyError && error.code === "passkey_challenge_invalid",
  );
});

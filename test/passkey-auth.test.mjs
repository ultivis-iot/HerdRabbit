import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPasswordAuth,
  writePasswordConfiguration,
} from "../src/password-auth.mjs";
import { PasskeyAuth, PasskeyError, passkeyLabel } from "../src/passkey-auth.mjs";

test("registers a verified passkey for the exact browser origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-passkey-"));
  const authFile = join(directory, "auth.json");
  await writePasswordConfiguration(authFile, "password");
  const auth = await loadPasswordAuth(authFile);
  const calls = [];
  const passkeys = new PasskeyAuth({
    auth,
    now: () => 1_700_000_000_000,
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
    { label: "Safari · macOS" },
  ), true);
  assert.equal(calls[1][1].response, response);
  assert.equal(calls[1][1].expectedChallenge, "registration-challenge");
  assert.equal(calls[1][1].expectedOrigin, "https://rabbit.example:38787");
  assert.equal(calls[1][1].expectedRPID, "rabbit.example");
  assert.equal(calls[1][1].requireUserVerification, true);

  const reloaded = await loadPasswordAuth(authFile);
  assert.equal(reloaded.hasPasskeys, true);
  assert.equal(reloaded.passkeys[0].id, "credential-id");
  assert.equal(reloaded.passkeys[0].label, "Safari · macOS");
  assert.equal(reloaded.passkeys[0].createdAt, 1_700_000_000_000);
});

test("names a passkey after the browser and system that registered it", () => {
  const cases = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "Safari · iOS"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Chrome · Android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Edge · Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox · macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Chrome · Linux"],
    ["curl/8.5.0", "Passkey"],
    [undefined, "Passkey"],
    ["<script>alert(1)</script>", "Passkey"],
  ];
  for (const [userAgent, label] of cases) assert.equal(passkeyLabel(userAgent), label);
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

import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const MAX_PENDING_ATTEMPTS = 64;

const defaultWebAuthn = Object.freeze({
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
});

export class PasskeyError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, { cause });
    this.name = "PasskeyError";
    this.code = code;
    this.status = status;
  }
}

function ceremonyContext(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new PasskeyError("invalid_passkey_origin", "Passkey 요청 주소가 올바르지 않습니다.");
  }
  const isLoopback = parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1";
  if (
    parsed.origin !== origin ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback))
  ) {
    throw new PasskeyError(
      "passkey_secure_context_required",
      "Passkey는 HTTPS 또는 localhost에서만 사용할 수 있습니다.",
    );
  }
  return { origin: parsed.origin, rpID: parsed.hostname };
}

export class PasskeyAuth {
  constructor({
    auth,
    webauthn = {},
    now = () => Date.now(),
    randomId = () => randomBytes(24).toString("base64url"),
  } = {}) {
    if (!auth) throw new TypeError("password auth is required");
    this.auth = auth;
    this.webauthn = { ...defaultWebAuthn, ...webauthn };
    this.now = now;
    this.randomId = randomId;
    this.attempts = new Map();
  }

  get hasCredentials() {
    return this.auth.hasPasskeys;
  }

  async beginRegistration(origin) {
    if (!this.auth.required) {
      throw new PasskeyError("password_auth_required", "비밀번호 인증을 먼저 활성화하세요.");
    }
    const context = ceremonyContext(origin);
    const options = await this.webauthn.generateRegistrationOptions({
      rpName: "HerdRabbit",
      rpID: context.rpID,
      userID: this.auth.passkeyUserId,
      userName: "HerdRabbit",
      userDisplayName: "HerdRabbit",
      attestationType: "none",
      excludeCredentials: this.auth.passkeys.map(({ id, transports }) => ({
        id,
        transports,
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const attemptId = this.#rememberAttempt("registration", context, options.challenge);
    return { attemptId, options };
  }

  async finishRegistration(origin, attemptId, response) {
    const context = ceremonyContext(origin);
    const attempt = this.#consumeAttempt("registration", context, attemptId);
    let verification;
    try {
      verification = await this.webauthn.verifyRegistrationResponse({
        response,
        expectedChallenge: attempt.challenge,
        expectedOrigin: context.origin,
        expectedRPID: context.rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new PasskeyError(
        "passkey_verification_failed",
        "Passkey를 확인하지 못했습니다.",
        { cause: error },
      );
    }
    if (!verification.verified || !verification.registrationInfo?.credential) {
      throw new PasskeyError(
        "passkey_verification_failed",
        "Passkey를 확인하지 못했습니다.",
      );
    }
    const {
      credential,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;
    await this.auth.addPasskey({
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
    return true;
  }

  async beginAuthentication(origin) {
    if (!this.hasCredentials) {
      throw new PasskeyError(
        "passkey_unavailable",
        "등록된 Passkey가 없습니다.",
        { status: 404 },
      );
    }
    const context = ceremonyContext(origin);
    const options = await this.webauthn.generateAuthenticationOptions({
      rpID: context.rpID,
      allowCredentials: this.auth.passkeys.map(({ id, transports }) => ({
        id,
        transports,
      })),
      userVerification: "required",
    });
    const attemptId = this.#rememberAttempt("authentication", context, options.challenge);
    return { attemptId, options };
  }

  async finishAuthentication(origin, attemptId, response) {
    const context = ceremonyContext(origin);
    const attempt = this.#consumeAttempt("authentication", context, attemptId);
    const credential = this.auth.passkeys.find(({ id }) => id === response?.id);
    if (!credential) {
      throw new PasskeyError("passkey_not_registered", "등록되지 않은 Passkey입니다.");
    }
    let verification;
    try {
      const verificationCredential = {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      };
      verification = await this.webauthn.verifyAuthenticationResponse({
        response,
        expectedChallenge: attempt.challenge,
        expectedOrigin: context.origin,
        expectedRPID: context.rpID,
        credential: verificationCredential,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new PasskeyError(
        "passkey_verification_failed",
        "Passkey를 확인하지 못했습니다.",
        { cause: error },
      );
    }
    if (!verification.verified || !verification.authenticationInfo) {
      throw new PasskeyError(
        "passkey_verification_failed",
        "Passkey를 확인하지 못했습니다.",
      );
    }
    await this.auth.updatePasskeyCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
    );
    return true;
  }

  #rememberAttempt(type, context, challenge) {
    this.#pruneAttempts();
    while (this.attempts.size >= MAX_PENDING_ATTEMPTS) {
      this.attempts.delete(this.attempts.keys().next().value);
    }
    const id = this.randomId();
    this.attempts.set(id, {
      type,
      ...context,
      challenge,
      expiresAt: this.now() + CHALLENGE_TTL_MS,
    });
    return id;
  }

  #consumeAttempt(type, context, attemptId) {
    if (typeof attemptId !== "string" || attemptId.length === 0 || attemptId.length > 256) {
      throw new PasskeyError("passkey_challenge_invalid", "Passkey 요청이 만료되었거나 올바르지 않습니다.");
    }
    const attempt = this.attempts.get(attemptId);
    this.attempts.delete(attemptId);
    if (
      !attempt ||
      attempt.type !== type ||
      attempt.origin !== context.origin ||
      attempt.rpID !== context.rpID ||
      attempt.expiresAt <= this.now()
    ) {
      throw new PasskeyError("passkey_challenge_invalid", "Passkey 요청이 만료되었거나 올바르지 않습니다.");
    }
    return attempt;
  }

  #pruneAttempts() {
    const now = this.now();
    for (const [id, attempt] of this.attempts) {
      if (attempt.expiresAt <= now) this.attempts.delete(id);
    }
  }
}

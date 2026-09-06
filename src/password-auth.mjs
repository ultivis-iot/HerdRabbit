import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_BYTES = 64;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTH_VERSION = 1;
const PASSKEY_DEVICE_TYPES = new Set(["singleDevice", "multiDevice"]);
const SCRYPT_OPTIONS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

function safeEquals(expected, candidate) {
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer);
}

function validateStoredPasskey(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 2048 ||
    !/^[A-Za-z0-9_-]+$/u.test(value.id) ||
    typeof value.publicKey !== "string" ||
    value.publicKey.length === 0 ||
    value.publicKey.length > 16_384 ||
    !/^[A-Za-z0-9_-]+$/u.test(value.publicKey) ||
    !Number.isSafeInteger(value.counter) ||
    value.counter < 0 ||
    !Array.isArray(value.transports) ||
    value.transports.length > 16 ||
    !value.transports.every((transport) => (
      typeof transport === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(transport)
    )) ||
    !PASSKEY_DEVICE_TYPES.has(value.deviceType) ||
    typeof value.backedUp !== "boolean"
  ) {
    throw new Error("HerdRabbit passkey configuration is invalid");
  }
  return {
    id: value.id,
    publicKey: value.publicKey,
    counter: value.counter,
    transports: [...new Set(value.transports)],
    deviceType: value.deviceType,
    backedUp: value.backedUp,
  };
}

function validateStoredConfiguration(value) {
  if (
    !value ||
    value.version !== AUTH_VERSION ||
    value.password?.algorithm !== "scrypt" ||
    typeof value.password.salt !== "string" ||
    typeof value.password.hash !== "string" ||
    typeof value.sessionSecret !== "string"
  ) {
    throw new Error("HerdRabbit authentication configuration is invalid");
  }
  const passkeys = value.passkeys === undefined ? [] : value.passkeys;
  if (!Array.isArray(passkeys) || passkeys.length > 32) {
    throw new Error("HerdRabbit passkey configuration is invalid");
  }
  const normalizedPasskeys = passkeys.map(validateStoredPasskey);
  if (new Set(normalizedPasskeys.map(({ id }) => id)).size !== normalizedPasskeys.length) {
    throw new Error("HerdRabbit passkey configuration contains duplicate credentials");
  }
  return {
    version: AUTH_VERSION,
    password: { ...value.password },
    sessionSecret: value.sessionSecret,
    passkeys: normalizedPasskeys,
  };
}

async function derivePassword(password, salt) {
  return scrypt(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS);
}

export function defaultAuthFilePath(environment = process.env) {
  if (environment.HERDR_WEB_AUTH_FILE) {
    return resolve(environment.HERDR_WEB_AUTH_FILE);
  }
  const configHome = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "herdr-bridge", "auth.json");
}

export async function createPasswordConfiguration(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("password must not be empty");
  }
  if (password.length > 256) {
    throw new TypeError("password must be at most 256 characters");
  }

  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);
  return {
    version: AUTH_VERSION,
    password: {
      algorithm: "scrypt",
      salt: salt.toString("base64url"),
      hash: hash.toString("base64url"),
    },
    sessionSecret: randomBytes(32).toString("base64url"),
    passkeys: [],
  };
}

async function writeConfigurationFile(authFile, configuration) {
  const parent = dirname(authFile);
  const temporary = `${authFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  try {
    await writeFile(temporary, `${JSON.stringify(configuration, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, authFile);
    await chmod(authFile, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function writePasswordConfiguration(authFile, password) {
  if (password === "") {
    await unlink(authFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return { required: false };
  }

  const configuration = await createPasswordConfiguration(password);
  await writeConfigurationFile(authFile, configuration);
  return { required: true };
}

function cookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

export class PasswordAuth {
  constructor(configuration = null, {
    now = () => Date.now(),
    authFile = null,
  } = {}) {
    this.configuration = configuration
      ? validateStoredConfiguration(configuration)
      : null;
    this.now = now;
    this.authFile = authFile;
    this.writeQueue = Promise.resolve();
  }

  get required() {
    return this.configuration !== null;
  }

  get hasPasskeys() {
    return this.required && this.configuration.passkeys.length > 0;
  }

  get passkeyUserId() {
    if (!this.required) return null;
    return Uint8Array.from(Buffer.from(this.configuration.sessionSecret, "base64url"));
  }

  get passkeys() {
    if (!this.required) return [];
    return this.configuration.passkeys.map((passkey) => ({
      ...passkey,
      publicKey: Uint8Array.from(Buffer.from(passkey.publicKey, "base64url")),
      transports: [...passkey.transports],
    }));
  }

  async addPasskey(passkey) {
    if (!this.required || !this.authFile) {
      throw new Error("Passkeys require a persistent password configuration");
    }
    const publicKey = passkey?.publicKey;
    if (!(publicKey instanceof Uint8Array) || publicKey.byteLength === 0) {
      throw new TypeError("passkey publicKey must be a non-empty Uint8Array");
    }
    const stored = validateStoredPasskey({
      ...passkey,
      publicKey: Buffer.from(publicKey).toString("base64url"),
    });
    await this.#updateConfiguration((configuration) => {
      if (configuration.passkeys.some(({ id }) => id === stored.id)) {
        throw new Error("Passkey is already registered");
      }
      if (configuration.passkeys.length >= 32) {
        throw new Error("Too many passkeys are registered");
      }
      return {
        ...configuration,
        passkeys: [...configuration.passkeys, stored],
      };
    });
  }

  async updatePasskeyCounter(id, counter) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new TypeError("passkey counter must be a non-negative integer");
    }
    await this.#updateConfiguration((configuration) => {
      let found = false;
      const passkeys = configuration.passkeys.map((passkey) => {
        if (passkey.id !== id) return passkey;
        found = true;
        return { ...passkey, counter: Math.max(passkey.counter, counter) };
      });
      if (!found) throw new Error("Passkey is not registered");
      return { ...configuration, passkeys };
    });
  }

  async #updateConfiguration(update) {
    if (!this.required || !this.authFile) {
      throw new Error("Passkeys require a persistent password configuration");
    }
    const operation = this.writeQueue.then(async () => {
      const next = validateStoredConfiguration(update(this.configuration));
      await writeConfigurationFile(this.authFile, next);
      this.configuration = next;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async verifyPassword(password) {
    if (!this.required || typeof password !== "string" || password.length > 256) {
      return false;
    }
    const expected = Buffer.from(this.configuration.password.hash, "base64url");
    const candidate = await derivePassword(
      password,
      Buffer.from(this.configuration.password.salt, "base64url"),
    );
    return safeEquals(expected, candidate);
  }

  createSession() {
    return this.#createToken("cookie");
  }

  createLaunchToken() {
    return this.#createToken("launch");
  }

  #createToken(purpose) {
    if (!this.required) return null;
    const expiresAt = Math.floor(this.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = `${randomBytes(24).toString("base64url")}.${expiresAt}`;
    const signature = createHmac("sha256", this.configuration.sessionSecret)
      .update(`${purpose}.${payload}`)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  hasValidSession(cookieHeader) {
    if (!this.required) return true;
    const token = cookieValue(cookieHeader, "herdr_session");
    return this.#hasValidToken(token, "cookie");
  }

  hasValidLaunchToken(token) {
    return this.#hasValidToken(token, "launch");
  }

  #hasValidToken(token, purpose) {
    if (!this.required) return true;
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [nonce, rawExpiry, candidateSignature] = parts;
    const expiresAt = Number(rawExpiry);
    if (!nonce || !Number.isSafeInteger(expiresAt)) return false;
    if (expiresAt <= Math.floor(this.now() / 1000)) return false;
    const payload = `${nonce}.${rawExpiry}`;
    const expectedSignature = createHmac(
      "sha256",
      this.configuration.sessionSecret,
    ).update(`${purpose}.${payload}`).digest("base64url");
    return safeEquals(expectedSignature, candidateSignature);
  }

  sessionCookie(token, { secure = false } = {}) {
    const attributes = [
      `herdr_session=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${SESSION_TTL_SECONDS}`,
    ];
    if (secure) attributes.push("Secure");
    return attributes.join("; ");
  }
}

export async function loadPasswordAuth(authFile) {
  try {
    const source = await readFile(authFile, "utf8");
    return new PasswordAuth(JSON.parse(source), { authFile });
  } catch (error) {
    if (error.code === "ENOENT") return new PasswordAuth(null, { authFile });
    if (error instanceof SyntaxError) {
      throw new Error("HerdRabbit authentication configuration is not valid JSON", {
        cause: error,
      });
    }
    throw error;
  }
}

export const SESSION_DURATION_SECONDS = SESSION_TTL_SECONDS;

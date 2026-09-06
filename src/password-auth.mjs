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
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_VERSION = 1;
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

function validateStoredConfiguration(value) {
  if (
    !value ||
    value.version !== AUTH_VERSION ||
    value.password?.algorithm !== "scrypt" ||
    typeof value.password.salt !== "string" ||
    typeof value.password.hash !== "string" ||
    typeof value.sessionSecret !== "string"
  ) {
    throw new Error("HerdrBridge authentication configuration is invalid");
  }
  return value;
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
  };
}

export async function writePasswordConfiguration(authFile, password) {
  if (password === "") {
    await unlink(authFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return { required: false };
  }

  const configuration = await createPasswordConfiguration(password);
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
  constructor(configuration = null, { now = () => Date.now() } = {}) {
    this.configuration = configuration
      ? validateStoredConfiguration(configuration)
      : null;
    this.now = now;
  }

  get required() {
    return this.configuration !== null;
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
    if (!this.required) return null;
    const expiresAt = Math.floor(this.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = `${randomBytes(24).toString("base64url")}.${expiresAt}`;
    const signature = createHmac("sha256", this.configuration.sessionSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  hasValidSession(cookieHeader) {
    if (!this.required) return true;
    const token = cookieValue(cookieHeader, "herdr_session");
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
    ).update(payload).digest("base64url");
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
    return new PasswordAuth(JSON.parse(source));
  } catch (error) {
    if (error.code === "ENOENT") return new PasswordAuth();
    if (error instanceof SyntaxError) {
      throw new Error("HerdrBridge authentication configuration is not valid JSON", {
        cause: error,
      });
    }
    throw error;
  }
}

export const SESSION_DURATION_SECONDS = SESSION_TTL_SECONDS;

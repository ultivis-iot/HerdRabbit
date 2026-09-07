import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InputValidationError } from "./herdr-client.mjs";

export function validateSshProfile(input, { allowMissingPassword = false } = {}) {
  const text = (key, limit, fallback = "") => {
    const value = input?.[key] ?? fallback;
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new InputValidationError(`Invalid SSH ${key}`);
    }
    return value.trim();
  };
  const name = text("name", 80);
  const host = text("host", 253);
  const username = text("username", 64);
  const authMethod = text("authMethod", 20, input?.identityFile ? "key" : "config");
  const identityFile = authMethod === "key" ? text("identityFile", 512) : "";
  const password = authMethod === "password" ? (input?.password ?? "") : "";
  if (!["config", "key", "password"].includes(authMethod) ||
      (authMethod === "key" && !identityFile) || typeof password !== "string" ||
      password.length > 1024 || /[\u0000\r\n]/u.test(password)) {
    throw new InputValidationError("Choose an authentication method and provide valid credentials.");
  }
  if (authMethod === "password" && !password && !allowMissingPassword) throw new InputValidationError("Enter the SSH password.");
  const herdrBin = text("herdrBin", 512, "herdr") || "herdr";
  const port = input?.port === "" || input?.port == null ? null : Number(input.port);
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9.:-]*$/u.test(host) ||
      (username && !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(username)) ||
      (identityFile && !identityFile.startsWith("/")) ||
      (herdrBin !== "herdr" && !herdrBin.startsWith("/")) ||
      (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    throw new InputValidationError("Enter a valid SSH host, user, port, and absolute file paths.");
  }
  return { name, host, username, port, identityFile, herdrBin, authMethod, password };
}

export class SshProfiles {
  constructor(file, profiles = []) {
    this.file = file;
    this.profiles = profiles;
    this.pending = Promise.resolve();
  }

  static async load(file) {
    let values = [];
    try { values = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!Array.isArray(values) || values.length > 20) throw new Error("Invalid SSH profile configuration");
    const ids = new Set();
    const profiles = values.map((value) => {
      if (!/^ssh_[a-f0-9-]{36}$/u.test(value.id) || ids.has(value.id)) throw new Error("Invalid SSH profile id");
      ids.add(value.id);
      return { ...validateSshProfile(value, { allowMissingPassword: true }), id: value.id };
    });
    return new SshProfiles(file, profiles);
  }

  list() { return this.profiles.map(({ password, ...profile }) => ({ ...profile })); }

  connectionProfiles() { return this.profiles.map((profile) => ({ ...profile })); }

  change(operation) {
    const task = this.pending.then(async () => {
      const next = operation(this.connectionProfiles());
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
      this.profiles = next;
      return this.list();
    });
    this.pending = task.catch(() => {});
    return task;
  }

  save(value, id = null) {
    const profile = { ...validateSshProfile(value), id: id || `ssh_${randomUUID()}` };
    return this.change((values) => {
      if (id && !values.some((item) => item.id === id)) throw new InputValidationError("SSH profile not found");
      if (!id && values.length >= 20) throw new InputValidationError("Up to 20 SSH servers are supported");
      return id ? values.map((item) => item.id === id ? profile : item) : [...values, profile];
    });
  }

  remove(id) {
    return this.change((values) => {
      if (!values.some((item) => item.id === id)) throw new InputValidationError("SSH profile not found");
      return values.filter((item) => item.id !== id);
    });
  }
}

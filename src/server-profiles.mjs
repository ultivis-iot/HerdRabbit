import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InputValidationError } from "./herdr-client.mjs";
import { validateLinkProfile } from "./link-profiles.mjs";
import { validateSshProfile } from "./ssh-profiles.mjs";

const MAX_PROFILES = 20;

// The prefix records how the server is reached, which is worth having in ids
// that show up in logs and in pane ids. Two copies of this pattern live in
// public/ (browse-preference.js, workspace-preference.js) because the browser
// cannot import from src/; a test keeps all three identical.
export const SERVER_ID_PATTERN = /^(?:ssh|link)_[a-f0-9-]{36}$/u;

export const TRANSPORTS = ["ssh", "link"];

export function newServerId(transport) {
  return `${transport}_${randomUUID()}`;
}

// Older files predate the discriminator, and everything they hold is SSH.
export function transportOf(value) {
  return value?.transport === "link" ? "link" : "ssh";
}

export function validateServerProfile(input, options = {}) {
  const transport = transportOf(input);
  if (!TRANSPORTS.includes(transport)) {
    throw new InputValidationError("Choose how to reach this server.");
  }
  return transport === "link"
    ? { ...validateLinkProfile(input), transport }
    : { ...validateSshProfile(input, options), transport };
}

export class ServerProfiles {
  constructor(file, profiles = []) {
    this.file = file;
    this.profiles = profiles;
    this.pending = Promise.resolve();
  }

  static async load(file) {
    let values = [];
    try { values = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!Array.isArray(values) || values.length > MAX_PROFILES) throw new Error("Invalid server configuration");
    const ids = new Set();
    const profiles = values.map((value) => {
      if (!SERVER_ID_PATTERN.test(value.id) || ids.has(value.id)) throw new Error("Invalid server id");
      ids.add(value.id);
      return { ...validateServerProfile(value, { allowMissingPassword: true }), id: value.id };
    });
    return new ServerProfiles(file, profiles);
  }

  // Secrets never leave the server. An SSH profile keeps a password; a link
  // profile has nothing to hide, but stripping by name keeps the rule one line.
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
    const validated = validateServerProfile(value);
    const profile = { ...validated, id: id || newServerId(validated.transport) };
    return this.change((values) => {
      const existing = values.find((item) => item.id === id);
      if (id && !existing) throw new InputValidationError("Server not found");
      // The id carries the transport, so changing it would leave the two
      // disagreeing. Editing keeps the transport the id was minted for.
      if (existing && existing.transport !== profile.transport) {
        throw new InputValidationError("Remove this server and add it again to change how it is reached.");
      }
      if (!id && values.length >= MAX_PROFILES) throw new InputValidationError(`Up to ${MAX_PROFILES} servers are supported`);
      return id ? values.map((item) => item.id === id ? profile : item) : [...values, profile];
    });
  }

  remove(id) {
    return this.change((values) => {
      if (!values.some((item) => item.id === id)) throw new InputValidationError("Server not found");
      return values.filter((item) => item.id !== id);
    });
  }
}

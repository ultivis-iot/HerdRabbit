import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path/posix";
import { FileAccessError } from "./file-browser.mjs";
import {
  connectionFromConfig,
  readEffectiveConfig,
  unsupportedReasons,
} from "./ssh-effective-config.mjs";
import { createHostVerifier, knownHostsTarget, HOST_KEY_REJECTED } from "./ssh-host-keys.mjs";
import { safeTransferName } from "./file-store.mjs";

const MAX_PATH_LENGTH = 4096;
const MAX_LISTED_ENTRIES = 2000;
const MAX_STREAM_BYTES = 1024 * 1024 * 1024;
// Resolving a symlink target costs a round trip each, so only a bounded number
// of them are followed; the rest are shown without a resolved kind.
const MAX_SYMLINK_LOOKUPS = 100;
const SYMLINK_CONCURRENCY = 8;
const OPERATION_TIMEOUT_MS = 15_000;
const IDLE_CLOSE_MS = 60_000;
// Mirrors the local uploads folder, relative to the remote account's home.
const UPLOADS_SEGMENTS = [".local", "share", "herdrabbit", "files"];
const MAX_NAME_ATTEMPTS = 100;

// SFTP status codes carry the same meaning as the errno values the local
// browser maps, so failures read alike on both sides.
const SFTP_STATUS = new Map([
  [2, [404, "not_found", "That path no longer exists."]],
  [3, [403, "permission_denied", "You do not have permission to read this."]],
  [4, [502, "remote_failure", "The remote server could not complete that."]],
  [8, [501, "unsupported", "The remote server does not support that."]],
  [10, [400, "invalid_path", "That path cannot be read."]],
  [11, [409, "already_exists", "A file with that name already exists."]],
  [12, [403, "permission_denied", "You do not have permission to read this."]],
]);

export function remoteAccessError(error) {
  if (error instanceof FileAccessError) return error;
  const mapped = SFTP_STATUS.get(error?.code);
  if (mapped) return new FileAccessError(...mapped);
  return null;
}

export function validateRemotePath(value) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > MAX_PATH_LENGTH ||
    !isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FileAccessError(400, "invalid_path", "Enter an absolute path.");
  }
  return resolve(value);
}

function splitExtension(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

function numberedName(name, attempt) {
  if (attempt === 1) return name;
  const { stem, extension } = splitExtension(name);
  return `${stem}-${attempt}${extension}`;
}

function entryKind(attrs) {
  if (attrs.isDirectory()) return "directory";
  if (attrs.isFile()) return "file";
  return "other";
}

function withTimeout(label, work) {
  return new Promise((settle, fail) => {
    // SFTP has no per-operation timeout, so a wedged server would otherwise
    // hold the request until the HTTP server gives up two minutes later.
    const timer = setTimeout(() => {
      fail(new FileAccessError(504, "remote_timeout", `The remote server did not answer (${label}).`));
    }, OPERATION_TIMEOUT_MS);
    work().then(
      (value) => { clearTimeout(timer); settle(value); },
      (error) => { clearTimeout(timer); fail(error); },
    );
  });
}

const call = (session, method, ...args) =>
  withTimeout(method, () => new Promise((settle, fail) => {
    session[method](...args, (error, value) => (error ? fail(error) : settle(value)));
  }));

async function mapConcurrently(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class RemoteFileBrowser {
  // The ssh2 client arrives through a factory so tests can supply a stand-in and
  // the app still starts when the package fails to load.
  constructor(profile, { connect, maxBytes = MAX_STREAM_BYTES } = {}) {
    this.profile = profile;
    this.connect = connect;
    this.maxBytes = maxBytes;
    this.client = null;
    this.connecting = null;
    this.listing = null;
    this.config = null;
    this.holds = 0;
    this.idleTimer = null;
    this.uploads = null;
  }

  async settings() {
    if (!this.config) {
      const config = await readEffectiveConfig(this.profile);
      const blockers = unsupportedReasons(config);
      if (blockers.length > 0) {
        throw new FileAccessError(
          501,
          "unsupported_ssh_config",
          `Remote files are not available for this server: ${blockers.join(", ")} is not supported.`,
        );
      }
      this.config = connectionFromConfig(config, this.profile);
    }
    return this.config;
  }

  async #privateKey(settings) {
    const candidates = this.profile.authMethod === "key" && this.profile.identityFile
      ? [this.profile.identityFile]
      : settings.identityFiles;
    for (const file of candidates) {
      try {
        return await readFile(file);
      } catch {
        continue;
      }
    }
    return null;
  }

  async #open() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const settings = await this.settings();
      const target = knownHostsTarget({
        hostkeyalias: settings.hostKeyAlias,
        hostname: settings.host,
        host: this.profile.host,
        port: settings.port,
      });
      let rejection = null;
      const options = {
        host: settings.host,
        port: settings.port,
        username: settings.username,
        readyTimeout: 8_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 2,
        hostVerifier: createHostVerifier({
          target,
          files: settings.knownHostsFiles,
          onReject: (reason) => { rejection = reason; },
        }),
      };
      if (this.profile.authMethod === "password") options.password = this.profile.password;
      else {
        const key = await this.#privateKey(settings);
        if (key) options.privateKey = key;
        if (settings.agentSocket) options.agent = settings.agentSocket;
      }

      try {
        const client = await this.connect(options);
        this.client = client;
        client.once("close", () => this.#forget());
        client.once("error", () => this.#forget());
        return client;
      } catch (error) {
        if (rejection) throw new FileAccessError(403, "host_key_rejected", HOST_KEY_REJECTED);
        if (/passphrase|encrypted/iu.test(String(error?.message))) {
          throw new FileAccessError(
            501,
            "unsupported_ssh_config",
            "Remote files are not available for this server: the private key needs a passphrase.",
          );
        }
        throw new FileAccessError(502, "ssh_connect_failed", "Could not open an SFTP connection to this server.");
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  // Listing keeps one long-lived session. Transfers get their own, because a
  // slow download's backpressure would otherwise stall readdir on the same
  // channel until it finished.
  async #listingSession() {
    if (this.listing) return this.listing;
    const client = await this.#open();
    this.listing = await call(client, "sftp");
    return this.listing;
  }

  async #transferSession() {
    const client = await this.#open();
    return call(client, "sftp");
  }

  #forget() {
    this.client = null;
    this.listing = null;
  }

  hold() {
    this.holds += 1;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  release() {
    this.holds = Math.max(0, this.holds - 1);
    if (this.holds > 0 || this.idleTimer) return;
    // Closing on a timer alone would cut a download or an unspent ticket short.
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.holds === 0) this.close();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  close() {
    const client = this.client;
    this.#forget();
    try {
      client?.end();
    } catch {
      // Already gone.
    }
  }

  async home() {
    const session = await this.#listingSession();
    return call(session, "realpath", ".");
  }

  async listDirectory(rawPath, { limit = MAX_LISTED_ENTRIES, prefix = "" } = {}) {
    const requested = validateRemotePath(rawPath);
    const session = await this.#listingSession();
    const directory = await call(session, "realpath", requested);
    const all = await call(session, "readdir", directory);

    const wanted = prefix === ""
      ? all
      : all.filter((entry) => entry.filename.toLowerCase().startsWith(prefix.toLowerCase()));
    const names = wanted.sort((first, second) => (first.filename < second.filename ? -1 : 1));
    const visible = names.slice(0, limit);

    let lookups = 0;
    const entries = await mapConcurrently(visible, SYMLINK_CONCURRENCY, async (item) => {
      const path = resolve(directory, item.filename);
      const entry = {
        name: item.filename,
        path,
        hidden: item.filename.startsWith("."),
        readable: true,
        size: item.attrs.isFile() ? item.attrs.size : null,
        modifiedAt: new Date(item.attrs.mtime * 1000).toISOString(),
      };
      if (!item.attrs.isSymbolicLink()) return { ...entry, kind: entryKind(item.attrs) };

      // readdir already answered with lstat semantics; the target costs another
      // round trip, so only a bounded number are resolved.
      if (lookups >= MAX_SYMLINK_LOOKUPS) return { ...entry, kind: "other", symlink: true };
      lookups += 1;
      try {
        const target = await call(session, "stat", path);
        return {
          ...entry,
          kind: entryKind(target),
          size: target.isFile() ? target.size : null,
          symlink: true,
        };
      } catch {
        return { ...entry, kind: "other", symlink: true, broken: true };
      }
    });

    entries.sort((first, second) => {
      if (first.kind !== second.kind) return first.kind === "directory" ? -1 : 1;
      return first.name < second.name ? -1 : 1;
    });

    const parent = dirname(directory);
    return {
      path: directory,
      parent: parent === directory ? null : parent,
      entries,
      truncated: names.length > visible.length,
      total: names.length,
    };
  }

  // Writing is confined to one folder per server, exactly as it is locally:
  // an arbitrary remote path would let an upload reach ~/.ssh/authorized_keys.
  async uploadsDirectory() {
    if (this.uploads) return this.uploads;
    const session = await this.#listingSession();
    const home = await call(session, "realpath", ".");
    let directory = home;
    for (const segment of UPLOADS_SEGMENTS) {
      directory = resolve(directory, segment);
      try {
        await call(session, "mkdir", directory);
      } catch (error) {
        // Already there is the normal case; anything else is a real failure.
        if (error?.code !== 4 && error?.code !== 11) throw error;
      }
    }
    this.uploads = directory;
    return directory;
  }

  async listUploads() {
    const directory = await this.uploadsDirectory();
    const { entries } = await this.listDirectory(directory);
    return entries.filter((entry) => entry.kind === "file");
  }

  async saveUpload(requestedName, body) {
    const directory = await this.uploadsDirectory();
    const name = safeTransferName(requestedName);
    const session = await this.#transferSession();
    try {
      return await this.#writeExclusive(session, directory, name, body);
    } finally {
      session.end?.();
    }
  }

  // The request body can only be read once, so the name is settled before the
  // write starts. A racing upload can still take it, but the exclusive open
  // means the loser fails instead of overwriting the winner.
  async #freeName(session, directory, name) {
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
      const candidate = numberedName(name, attempt);
      const path = resolve(directory, candidate);
      if (!(await this.#exists(session, path))) return { name: candidate, path };
    }
    throw new FileAccessError(409, "already_exists", "Too many files share this name.");
  }

  async #writeExclusive(session, directory, name, body) {
    const target = await this.#freeName(session, directory, name);
    try {
      const written = await new Promise((settle, fail) => {
        let bytes = 0;
        // SFTP has no atomic link and its rename may clobber, so the exclusive
        // flag is what keeps an upload from replacing an existing file. A
        // refused name surfaces as an error before anything is written.
        const stream = session.createWriteStream(target.path, { flags: "wx" });
        stream.once("error", fail);
        stream.once("close", () => settle(bytes));
        body.on("data", (chunk) => { bytes += chunk.length; });
        body.once("error", fail);
        body.pipe(stream);
      });
      return {
        name: target.name,
        size: written,
        modifiedAt: new Date().toISOString(),
        path: target.path,
      };
    } catch (error) {
      // Unlike the local store there is no temporary name to discard, so a
      // broken transfer leaves the final name behind. The name was free a
      // moment ago and is one this upload chose, so removing it is safe.
      await call(session, "unlink", target.path).catch(() => {});
      throw error;
    }
  }

  async #exists(session, path) {
    try {
      await call(session, "lstat", path);
      return true;
    } catch {
      return false;
    }
  }

  async removeUpload(rawName) {
    const directory = await this.uploadsDirectory();
    const name = String(rawName);
    // Only names the listing actually shows can be removed, so a crafted name
    // cannot address anything outside the uploads folder.
    const listed = await this.listUploads();
    const found = listed.find((entry) => entry.name === name);
    if (!found) throw new FileAccessError(404, "not_found", "File not found");
    const session = await this.#listingSession();
    await call(session, "unlink", resolve(directory, found.name));
  }

  async openFile(rawPath) {
    const path = validateRemotePath(rawPath);
    const session = await this.#transferSession();
    // There is no O_NONBLOCK here, so a FIFO would hang the remote sftp-server.
    // Checking first leaves a TOCTOU gap, which is why transfers run on their
    // own session: a wedged one cannot take the listing down with it.
    const attrs = await call(session, "lstat", path);
    if (!attrs.isFile()) {
      session.end?.();
      throw new FileAccessError(400, "not_a_file", "That path is not a regular file.");
    }
    if (attrs.size > this.maxBytes) {
      session.end?.();
      throw new FileAccessError(413, "file_too_large", "That file is too large to download here.");
    }

    const size = attrs.size > 0 ? attrs.size : null;
    const stream = session.createReadStream(path, size === null ? {} : { start: 0, end: size - 1 });
    stream.once("close", () => session.end?.());
    return { name: basename(path), path, size, stream };
  }
}

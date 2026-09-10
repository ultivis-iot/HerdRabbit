import { FileAccessError } from "./file-browser.mjs";
import { RemoteFileBrowser } from "./remote-file-browser.mjs";

const FAILURE_COOLDOWN_MS = 10_000;

export const LOCAL_SERVER = "local";
const SERVER_ID_PATTERN = /^(?:local|(?:ssh|link)_[a-f0-9-]{36})$/u;

export function validateServerId(value) {
  if (value === undefined || value === null || value === "") return LOCAL_SERVER;
  if (typeof value !== "string" || !SERVER_ID_PATTERN.test(value)) {
    throw new FileAccessError(400, "invalid_server", "Unknown server.");
  }
  return value;
}

// One browser per server, created on demand. Slots are counted per server so a
// host that stops answering cannot starve the shared pool and take local
// browsing down with it.
export class RemoteFileService {
  constructor({ profiles, connect, maxConcurrent = 4 } = {}) {
    this.profiles = profiles;
    this.connect = connect;
    this.maxConcurrent = maxConcurrent;
    this.browsers = new Map();
    this.active = new Map();
    this.failedUntil = new Map();
  }

  #profile(serverId) {
    const profile = this.profiles?.connectionProfiles().find((item) => item.id === serverId);
    if (!profile) throw new FileAccessError(404, "unknown_server", "That server is no longer configured.");
    return profile;
  }

  browser(serverId) {
    let browser = this.browsers.get(serverId);
    if (!browser) {
      browser = new RemoteFileBrowser(this.#profile(serverId), { connect: this.connect });
      this.browsers.set(serverId, browser);
    }
    return browser;
  }

  // A server that just failed is refused outright rather than spending another
  // connect timeout, which is what would hold a slot open.
  #assertReachable(serverId) {
    const until = this.failedUntil.get(serverId);
    if (until && until > Date.now()) {
      throw new FileAccessError(502, "server_unreachable", "That server did not answer. Try again shortly.");
    }
  }

  async withSlot(serverId, work) {
    this.#assertReachable(serverId);
    const active = this.active.get(serverId) || 0;
    if (active >= this.maxConcurrent) {
      throw new FileAccessError(429, "browse_busy", "Too many folders are being read on that server.");
    }
    this.active.set(serverId, active + 1);
    try {
      const result = await work();
      this.failedUntil.delete(serverId);
      return result;
    } catch (error) {
      if (error?.code === "ssh_connect_failed" || error?.code === "remote_timeout") {
        this.failedUntil.set(serverId, Date.now() + FAILURE_COOLDOWN_MS);
      }
      throw error;
    } finally {
      this.active.set(serverId, (this.active.get(serverId) || 1) - 1);
    }
  }

  forget(serverId) {
    this.browsers.get(serverId)?.close();
    this.browsers.delete(serverId);
    this.failedUntil.delete(serverId);
  }

  close() {
    for (const browser of this.browsers.values()) browser.close();
    this.browsers.clear();
  }
}

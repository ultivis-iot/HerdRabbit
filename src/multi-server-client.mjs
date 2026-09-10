import { HerdrBridgeClient } from "./herdr-bridge-client.mjs";
import { InputValidationError } from "./herdr-client.mjs";
import { createSshRunner } from "./ssh-runner.mjs";

const collections = ["herdr_sessions", "workspaces", "tabs", "panes", "agents"];
const idFields = ["session_id", "herdr_session_id", "workspace_id", "active_tab_id", "tab_id", "pane_id"];
const empty = () => Object.fromEntries(collections.map((key) => [key, []]));

function scope(snapshot, server) {
  const prefix = (id) => server.id === "local" ? id : `${server.id}!${id}`;
  return Object.fromEntries(collections.map((key) => [key, (snapshot[key] || []).map((record) => {
    const next = { ...record, server_id: server.id, server_name: server.name };
    for (const field of idFields) if (typeof next[field] === "string") next[field] = prefix(next[field]);
    if (server.id !== "local" && key === "herdr_sessions") next.default = false;
    return next;
  })]));
}

// Only messages we wrote ourselves are safe to show; anything else could be a
// remote command's output. The fallback has to name the right transport too --
// telling someone to check SSH access on a linked server sends them nowhere.
export function serverStatusFor(error, transport) {
  const code = error?.code;
  if (code?.startsWith("ssh_") || code?.startsWith("leaf_")) return error.message;
  return transport === "link"
    ? "Could not reach HerdRabbit on this server. Check the address and that it is running there."
    : "Could not connect to Herdr. Check SSH access and the Herdr installation.";
}

export class MultiServerClient {
  constructor({ local, profiles, controlDirectory, remoteFactory = (profile) => new HerdrBridgeClient({
    runner: createSshRunner(profile, controlDirectory),
  }) }) {
    this.local = local;
    this.profiles = profiles;
    this.remoteFactory = remoteFactory;
    this.entries = new Map();
    this.stopped = false;
  }

  syncEntries() {
    const profiles = [{ id: "local", name: "Local" }, ...(this.profiles.connectionProfiles?.() ?? this.profiles.list())];
    for (const id of this.entries.keys()) {
      if (profiles.some((profile) => profile.id === id)) continue;
      this.entries.get(id)?.client?.close?.();
      this.entries.delete(id);
    }
    for (const profile of profiles) {
      const fingerprint = JSON.stringify(profile);
      if (this.entries.get(profile.id)?.fingerprint === fingerprint) continue;
      this.entries.get(profile.id)?.client?.close?.();
      this.entries.set(profile.id, {
        profile, fingerprint,
        client: profile.id === "local" ? this.local : this.remoteFactory(profile),
        snapshot: empty(), available: false, status: "Connecting", lastPoll: 0, pending: null,
      });
    }
  }

  async refresh(entry) {
    if (entry.pending) return entry.pending;
    entry.pending = Promise.resolve().then(async () => {
      try {
        entry.snapshot = await entry.client.snapshot();
        entry.available = true;
        entry.status = "Connected";
      } catch (error) {
        entry.available = false;
        entry.status = serverStatusFor(error, entry.profile.transport);
      } finally {
        entry.lastPoll = Date.now();
        entry.pending = null;
      }
    });
    return entry.pending;
  }

  async snapshot() {
    this.syncEntries();
    const entries = [...this.entries.values()];
    // Remote polling is independent so an unreachable host cannot delay local data.
    for (const entry of entries) {
      if (!this.stopped && entry.profile.id !== "local" &&
          Date.now() - entry.lastPoll >= (entry.available ? 2_000 : 10_000)) void this.refresh(entry);
    }
    await this.refresh(this.entries.get("local"));
    const snapshots = entries.map((entry) => {
      const value = scope(entry.snapshot, entry.profile);
      if (!entry.available) {
        value.herdr_sessions = value.herdr_sessions.map((session) => ({ ...session, available: false }));
      }
      return value;
    });
    return {
      ...this.entries.get("local").snapshot,
      ...Object.fromEntries(collections.map((key) => [key, snapshots.flatMap((snapshot) => snapshot[key])])),
      servers: entries.map(({ profile, available, status }) => ({
        id: profile.id, name: profile.name, available, status,
        transport: profile.id === "local" ? "local" : (profile.transport ?? "ssh"),
      })),
    };
  }

  async testProfile(profile) {
    const client = this.remoteFactory(profile);
    const snapshot = await client.snapshot().finally(() => client.close?.());
    if (snapshot.herdr_sessions.some((session) => session.running && !session.available)) {
      throw new InputValidationError(profile.transport === "link"
        ? "Connected to HerdRabbit, but a running Herdr session could not be read."
        : "SSH connected, but a running Herdr session could not be read.");
    }
    return {
      ok: true,
      transport: profile.transport ?? "ssh",
      version: client.info?.().version ?? null,
      sessions: snapshot.herdr_sessions.length,
      panes: snapshot.panes.length,
    };
  }

  target(id) {
    this.syncEntries();
    if (typeof id !== "string") throw new InputValidationError("Invalid target id");
    const separator = id.indexOf("!");
    const serverId = separator < 0 ? "local" : id.slice(0, separator);
    const entry = this.entries.get(serverId);
    if (!entry) throw new InputValidationError("SSH server no longer exists");
    return { entry, id: separator < 0 ? id : id.slice(separator + 1) };
  }

  async invoke(method, targetId, args, mutation = false) {
    const { entry, id } = this.target(targetId);
    const result = await entry.client[method](id, ...args);
    if (mutation && entry.profile.id !== "local") {
      if (entry.pending) await entry.pending;
      await this.refresh(entry);
    }
    return result;
  }

  readPane(id, options) { return this.invoke("readPane", id, [options]); }
  sendText(id, text, options) { return this.invoke("sendText", id, [text, options]); }
  sendKeys(id, keys) { return this.invoke("sendKeys", id, [keys]); }
  async watchStatuses(paneIds, onStatus, onError) {
    const groups = new Map();
    for (const paneId of paneIds) {
      const { entry, id } = this.target(paneId);
      if (!groups.has(entry)) groups.set(entry, []);
      groups.get(entry).push(id);
    }
    const results = await Promise.allSettled([...groups].map(([entry, ids]) =>
      entry.client.watchStatuses(ids, event => onStatus({ ...event,
        pane_id: entry.profile.id === "local" ? event.pane_id : `${entry.profile.id}!${event.pane_id}` }), onError)));
    const stops = results.filter(result => result.status === "fulfilled").map(result => result.value);
    for (const result of results) if (result.status === "rejected") onError(result.reason);
    return () => stops.forEach(stop => stop());
  }
  renameWorkspace(id, label) { return this.invoke("renameWorkspace", id, [label], true); }
  closeWorkspace(id) { return this.invoke("closeWorkspace", id, [], true); }
  createTab(id) { return this.invoke("createTab", id, [], true); }
  closeTab(id) { return this.invoke("closeTab", id, [], true); }
  async createWorkspace(label, sessionId) {
    if (!sessionId) return this.local.createWorkspace(label);
    const { entry, id } = this.target(sessionId);
    const result = await entry.client.createWorkspace(label, id);
    if (entry.profile.id !== "local") {
      if (entry.pending) await entry.pending;
      await this.refresh(entry);
    }
    return result;
  }
}

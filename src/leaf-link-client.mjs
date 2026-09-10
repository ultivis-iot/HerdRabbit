import { HerdrCommandError } from "./herdr-client.mjs";
import { checkLeafCompatibility, normalizeLeafSnapshot } from "./leaf-protocol.mjs";
import { subscribeLeafStatuses } from "./leaf-status-stream.mjs";

const TIMEOUTS = { hello: 5_000, snapshot: 8_000, read: 6_000, write: 6_000 };
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function linkError(code, message, cause) {
  return new HerdrCommandError(message, { code, cause });
}

// Anything the leaf says reaches a status line in the sidebar, so it is trimmed
// and stripped of anything that would smear a log or a heading.
function readable(text) {
  return String(text ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 200);
}

function transportError(error, address) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return linkError("leaf_timeout", `HerdRabbit at ${address} did not answer in time.`, error);
  }
  const code = error?.cause?.code || error?.code;
  if (code === "CERT_HAS_EXPIRED" || String(code).startsWith("ERR_TLS") || String(code).startsWith("UNABLE_TO_")) {
    return linkError("leaf_tls", `The HTTPS certificate at ${address} was rejected.`, error);
  }
  return linkError("leaf_unreachable",
    `Could not reach HerdRabbit at ${address}. Check the address and that HerdRabbit is running there.`, error);
}

// The hub's half of a link. It is constructed synchronously because
// MultiServerClient builds clients inside syncEntries and expects an object,
// not a promise, so nothing here touches the network until it is called.
export class LeafLinkClient {
  #handshake = null;

  constructor({ profile, hubVersion, fetchImpl = globalThis.fetch, subscribe = subscribeLeafStatuses }) {
    this.profile = profile;
    this.address = profile.address;
    this.hubVersion = hubVersion;
    this.fetchImpl = fetchImpl;
    this.subscribe = subscribe;
    this.controllers = new Set();
    this.stops = new Set();
  }

  info() {
    return { transport: "link", version: this.#handshake?.version ?? null };
  }

  async #request(path, { method = "GET", body, timeoutMs = TIMEOUTS.read } = {}) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetchImpl(`${this.address}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw transportError(error, this.address);
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw linkError("leaf_error", `HerdRabbit at ${this.address} sent more than this hub will read.`);
    }
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* handled below */ }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw linkError("leaf_unauthorized",
          `HerdRabbit at ${this.address} did not accept this hub. Check the peer settings there.`);
      }
      if (response.status === 404) {
        throw linkError("leaf_not_linked",
          `HerdRabbit at ${this.address} is running but is not set up to accept a hub.`);
      }
      const message = readable(payload?.error?.message) || `HerdRabbit at ${this.address} returned ${response.status}.`;
      throw linkError(payload?.error?.code?.startsWith?.("leaf_") ? payload.error.code : "leaf_error", message);
    }
    if (payload === null || typeof payload !== "object") {
      throw linkError("leaf_not_herdrabbit", `That address answered, but it is not a HerdRabbit server.`);
    }
    return payload;
  }

  #verify(hello) {
    const result = checkLeafCompatibility(
      { hubVersion: this.hubVersion, serverName: `"${this.profile.name}"` },
      hello,
    );
    if (!result.ok) {
      this.#handshake = null;
      throw linkError(result.code, result.reason);
    }
    this.#handshake = result;
  }

  async snapshot() {
    // The handshake rides along, so an incompatible leaf is caught on the same
    // poll that would have merged its records.
    const body = await this.#request("/api/link/snapshot", { timeoutMs: TIMEOUTS.snapshot });
    this.#verify(body.hello);
    return normalizeLeafSnapshot(body.snapshot);
  }

  async readPane(paneId, { lines = 160, format = "ansi" } = {}) {
    const query = new URLSearchParams({ lines: String(lines), format });
    const body = await this.#request(`/api/link/panes/${encodeURIComponent(paneId)}/output?${query}`);
    return typeof body.output === "string" ? body.output : "";
  }

  async sendText(paneId, text, { submit = false } = {}) {
    return this.#request(`/api/link/panes/${encodeURIComponent(paneId)}/text`, {
      method: "POST", body: { text, submit }, timeoutMs: TIMEOUTS.write,
    });
  }

  async sendKeys(paneId, keys) {
    return this.#request(`/api/link/panes/${encodeURIComponent(paneId)}/keys`, {
      method: "POST", body: { keys }, timeoutMs: TIMEOUTS.write,
    });
  }

  async watchStatuses(paneIds, onStatus, onError) {
    const stop = await this.subscribe({
      url: `${this.address}/api/link/statuses`,
      paneIds,
      fetchImpl: this.fetchImpl,
      onStatus,
      onError,
    });
    this.stops.add(stop);
    return () => { this.stops.delete(stop); stop(); };
  }

  // Present because MultiServerClient dispatches these by name; a missing one
  // would surface as a TypeError rather than something a person can act on.
  #unsupported() {
    throw linkError("leaf_unsupported",
      "Creating, renaming and closing projects on a linked server is not supported yet.");
  }

  async createWorkspace() { this.#unsupported(); }
  async renameWorkspace() { this.#unsupported(); }
  async closeWorkspace() { this.#unsupported(); }
  async createTab() { this.#unsupported(); }
  async closeTab() { this.#unsupported(); }

  close() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    for (const stop of this.stops) stop();
    this.stops.clear();
  }
}

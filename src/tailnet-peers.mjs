import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkLeafCompatibility } from "./leaf-protocol.mjs";

const run = promisify(execFile);

// Probing every peer costs one request each, so keep them short and bounded.
const PROBE_TIMEOUT_MS = 1_500;
const MAX_PEERS = 32;

// The port the installer prefers. A machine that had to move off it is entered
// by hand instead -- guessing a range would turn one dialog into a port scan.
export const DEFAULT_LEAF_PORT = 38_787;

export async function readTailnetPeers(execute = run) {
  let status;
  try {
    const { stdout } = await execute("tailscale", ["status", "--json"], { timeout: 3_000 });
    status = JSON.parse(stdout);
  } catch {
    return { available: false, self: null, peers: [] };
  }
  if (status?.BackendState !== "Running") return { available: false, self: null, peers: [] };

  const name = (value) => String(value?.DNSName || "").replace(/\.$/u, "").split(".")[0];
  const address = (value) => (Array.isArray(value?.TailscaleIPs) ? value.TailscaleIPs : [])
    .find((item) => !String(item).includes(":")) || null;

  const peers = Object.values(status.Peer || {})
    .map((peer) => ({ name: name(peer), address: address(peer), online: peer?.Online === true }))
    .filter((peer) => peer.address && peer.name)
    .sort((first, second) => (first.name < second.name ? -1 : 1))
    .slice(0, MAX_PEERS);

  return {
    available: true,
    self: { name: name(status.Self), address: address(status.Self) },
    peers,
  };
}

// What a machine is, from this hub's point of view. The reasons matter as much
// as the verdict: "installed but does not accept you" and "nothing there" send
// a person to completely different places.
async function probe(peer, { hubVersion, port, fetchImpl }) {
  const address = `http://${peer.address}:${port}`;
  let response;
  try {
    response = await fetchImpl(`${address}/api/link/hello`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ...peer, address, state: "absent", reason: "No HerdRabbit answered on this machine." };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ...peer,
      address,
      state: "refused",
      reason: "HerdRabbit is running there but does not accept this machine as its hub.",
    };
  }
  if (!response.ok) {
    return { ...peer, address, state: "absent", reason: `That address answered with ${response.status}.` };
  }
  let hello = null;
  try { hello = await response.json(); } catch { /* handled by the check below */ }
  const verdict = checkLeafCompatibility({ hubVersion, serverName: `"${peer.name}"` }, hello);
  return verdict.ok
    ? { ...peer, address, state: "ready", version: verdict.version }
    : { ...peer, address, state: "incompatible", reason: verdict.reason };
}

export async function discoverLeaves({
  hubVersion,
  port = DEFAULT_LEAF_PORT,
  fetchImpl = globalThis.fetch,
  execute = run,
  known = [],
} = {}) {
  const tailnet = await readTailnetPeers(execute);
  if (!tailnet.available) return { available: false, self: null, candidates: [] };

  const registered = new Set(known);
  const candidates = await Promise.all(tailnet.peers.map(async (peer) => {
    // An offline peer cannot be probed, and saying so beats a timeout.
    if (!peer.online) {
      return { ...peer, address: `http://${peer.address}:${port}`, state: "offline", reason: "This machine is offline." };
    }
    const result = await probe(peer, { hubVersion, port, fetchImpl });
    return registered.has(result.address) ? { ...result, state: "added" } : result;
  }));

  return { available: true, self: tailnet.self, candidates };
}

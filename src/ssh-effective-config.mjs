import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

// Values can contain spaces (proxycommand, remotecommand), so only the first
// gap separates the key from the value. Repeated keys collect into a list.
export function parseEffectiveConfig(output) {
  const config = new Map();
  for (const line of String(output).split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    const gap = text.indexOf(" ");
    if (gap < 1) continue;
    const key = text.slice(0, gap).toLowerCase();
    const value = text.slice(gap + 1).trim();
    if (config.has(key)) config.get(key).push(value);
    else config.set(key, [value]);
  }
  return config;
}

function first(config, key) {
  return config.get(key)?.[0];
}

function expandHome(path) {
  return path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;
}

// ssh2 speaks SSH itself and cannot reach a host through another program, so a
// profile routed that way has to be refused rather than connected under rules
// the terminal does not use.
//
// Only settings that break the connection path count. Things that merely offer
// an extra way to authenticate are not listed: ssh -G always prints the default
// identity candidates, FIDO ones included, whether or not those files exist,
// and GSSAPI is enabled by default on many distributions. Treating those as
// blockers would refuse almost every server; a genuinely unusable credential
// surfaces as an authentication failure instead.
export function unsupportedReasons(config) {
  const reasons = [];
  if (first(config, "proxycommand") && first(config, "proxycommand") !== "none") {
    reasons.push("ProxyCommand");
  }
  if (first(config, "proxyjump") && first(config, "proxyjump") !== "none") {
    reasons.push("ProxyJump");
  }
  if (first(config, "pkcs11provider") && first(config, "pkcs11provider") !== "none") {
    reasons.push("PKCS11Provider");
  }
  return reasons;
}

export function knownHostsFiles(config) {
  const files = [];
  for (const key of ["userknownhostsfile", "globalknownhostsfile"]) {
    for (const value of config.get(key) || []) {
      for (const path of value.split(/\s+/u)) {
        if (path === "" || path === "none") continue;
        files.push(expandHome(path));
      }
    }
  }
  return files.length > 0 ? files : [`${homedir()}/.ssh/known_hosts`];
}

export function connectionFromConfig(config, profile) {
  const port = Number(first(config, "port") || profile.port || 22);
  return {
    host: first(config, "hostname") || profile.host,
    port: Number.isInteger(port) && port > 0 ? port : 22,
    username: first(config, "user") || profile.username || undefined,
    identityFiles: (config.get("identityfile") || []).map(expandHome),
    knownHostsFiles: knownHostsFiles(config),
    hostKeyAlias: first(config, "hostkeyalias"),
    agentSocket: first(config, "identityagent") === "none"
      ? undefined
      : first(config, "identityagent") || process.env.SSH_AUTH_SOCK,
  };
}

// Called with the same destination and flags as sshInvocation builds, because
// Match blocks resolve differently otherwise. `Match exec` runs during -G, so
// the result is cached per profile by the caller.
export async function readEffectiveConfig(profile, execute = run) {
  const args = [];
  if (profile.port) args.push("-p", String(profile.port));
  if (profile.username) args.push("-l", profile.username);
  args.push("-G", "--", profile.host);
  const { stdout } = await execute("ssh", args, { timeout: 5_000 });
  return parseEffectiveConfig(stdout);
}

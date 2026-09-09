import { defaultAuthFilePath } from "./password-auth.mjs";
import { defaultPushFilePath } from "./web-push-service.mjs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_PORT = 38_787;
// Any single address is narrower than 0.0.0.0, so binding to one interface --
// a Tailscale address, say -- is a tightening rather than a risk. Only literal
// addresses are taken: a hostname would be resolved at listen time and could
// land somewhere other than the interface the operator meant.
function parseHost(value) {
  const host = value || "127.0.0.1";
  if (isIP(host) === 0) {
    throw new Error("HERDR_WEB_HOST must be an IP address, such as 127.0.0.1, 0.0.0.0, or this host's Tailscale address");
  }
  return host;
}

function parsePort(value) {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("HERDR_WEB_PORT must be an integer between 1024 and 65535");
  }

  return port;
}

function parseAllowedHosts(value) {
  if (value === undefined || value.trim() === "") return [];
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) {
      throw new Error("HERDR_WEB_ALLOWED_HOSTS must contain comma-separated hostnames");
    }
  }
  return [...new Set(hosts)];
}

// Transferred files live outside the configuration directory that holds the
// password hash, SSH passwords, and VAPID keys. The uploads folder has no total size
// limit, and keeping it apart means a path bug can never reach a credential.
function defaultFilesDirectory(environment) {
  if (environment.HERDR_WEB_FILES_DIR) {
    return resolve(environment.HERDR_WEB_FILES_DIR);
  }
  const dataHome = environment.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "herdrabbit", "files");
}

export function readConfig(environment = process.env) {
  return Object.freeze({
    host: parseHost(environment.HERDR_WEB_HOST),
    port: parsePort(environment.HERDR_WEB_PORT),
    herdrBin: environment.HERDR_BIN || "herdr",
    authFile: defaultAuthFilePath(environment),
    sshProfilesFile: environment.HERDR_WEB_SSH_PROFILES_FILE || join(dirname(defaultAuthFilePath(environment)), "ssh-profiles.json"),
    pushFile: defaultPushFilePath(environment),
    extraAllowedHosts: parseAllowedHosts(environment.HERDR_WEB_ALLOWED_HOSTS),
    filesDir: defaultFilesDirectory(environment),
    commandTimeoutMs: 5_000,
    maxBodyBytes: 16 * 1024,
    maxTransferBytes: 50 * 1024 * 1024,
  });
}

export { parseAllowedHosts, parseHost, parsePort };

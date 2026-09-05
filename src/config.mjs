const DEFAULT_PORT = 38_787;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);

function parseHost(value) {
  const host = value || "127.0.0.1";
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error("HERDR_WEB_HOST must be 127.0.0.1 or 0.0.0.0");
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

export function readConfig(environment = process.env) {
  return Object.freeze({
    host: parseHost(environment.HERDR_WEB_HOST),
    port: parsePort(environment.HERDR_WEB_PORT),
    herdrBin: environment.HERDR_BIN || "herdr",
    extraAllowedHosts: parseAllowedHosts(environment.HERDR_WEB_ALLOWED_HOSTS),
    commandTimeoutMs: 5_000,
    maxBodyBytes: 16 * 1024,
  });
}

export { parseAllowedHosts, parseHost, parsePort };

import { hostname, networkInterfaces } from "node:os";

const LOOPBACK_REQUEST_HOSTS = Object.freeze([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);

function requestHostVariants(address) {
  return address.includes(":") ? [address, `[${address}]`] : [address];
}

export function allowedRequestHosts(
  bindHost,
  {
    interfaces = networkInterfaces(),
    machineHostname = hostname(),
    extraHosts = [],
  } = {},
) {
  const hosts = new Set(LOOPBACK_REQUEST_HOSTS);

  for (const extraHost of extraHosts) {
    hosts.add(String(extraHost).toLowerCase());
  }

  // A socket bound to one address is reached by that address, so requests
  // addressed to it are legitimate by construction. Without this a service
  // pinned to, say, its Tailscale address would answer 421 to every request
  // that actually arrives on it.
  if (bindHost !== "0.0.0.0") {
    if (typeof bindHost === "string" && bindHost !== "") {
      for (const candidate of requestHostVariants(bindHost)) {
        hosts.add(candidate.toLowerCase());
      }
    }
    return hosts;
  }

  if (machineHostname) {
    hosts.add(machineHostname.toLowerCase());
    if (!machineHostname.includes(".")) {
      hosts.add(`${machineHostname.toLowerCase()}.local`);
    }
  }

  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses || []) {
      if (typeof entry?.address !== "string") continue;
      for (const candidate of requestHostVariants(entry.address)) {
        hosts.add(candidate.toLowerCase());
      }
    }
  }

  return hosts;
}

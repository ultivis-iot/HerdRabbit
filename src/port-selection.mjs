import { createServer } from "node:net";

export const MIN_SERVICE_PORT = 30_000;
export const MAX_SERVICE_PORT = 39_999;
export const PREFERRED_SERVICE_PORT = 38_787;

function candidatePorts(preferred, minimum, maximum) {
  const ports = [];
  if (preferred >= minimum && preferred <= maximum) ports.push(preferred);
  for (let port = minimum; port <= maximum; port += 1) {
    if (port !== preferred) ports.push(port);
  }
  return ports;
}

export function isPortInServiceRange(port) {
  return Number.isInteger(port) && port >= MIN_SERVICE_PORT && port <= MAX_SERVICE_PORT;
}

export function isLocalPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

export async function findAvailableServicePort({
  preferred = PREFERRED_SERVICE_PORT,
  unavailablePorts = new Set(),
  isAvailable = isLocalPortAvailable,
} = {}) {
  for (const port of candidatePorts(
    preferred,
    MIN_SERVICE_PORT,
    MAX_SERVICE_PORT,
  )) {
    if (unavailablePorts.has(port)) continue;
    if (await isAvailable(port)) return port;
  }
  throw new Error("No available HerdrBridge port in the 30000-39999 range");
}

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  findAvailableServicePort,
  isLocalPortAvailable,
  isPortInServiceRange,
} from "../src/port-selection.mjs";

test("selects an unused port in the 30000 range", async () => {
  const port = await findAvailableServicePort({
    preferred: 38_787,
    unavailablePorts: new Set([38_787, 30_000]),
    isAvailable: async (candidate) => candidate === 30_001,
  });
  assert.equal(port, 30_001);
  assert.equal(isPortInServiceRange(port), true);
});

test("detects a port already bound by another service", async (context) => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await new Promise((resolve) => occupied.once("listening", resolve));
  context.after(() => new Promise((resolve) => occupied.close(resolve)));
  const occupiedPort = occupied.address().port;
  assert.equal(await isLocalPortAvailable(occupiedPort), false);
});

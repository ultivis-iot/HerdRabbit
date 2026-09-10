import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExistingUnit, serviceUnit } from "../scripts/install-service.mjs";

async function unitFile(context, contents) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-unit-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "herdrabbit.service");
  if (contents !== null) await writeFile(file, contents);
  return file;
}

const hubUnit = `[Service]
Environment="HERDR_WEB_PORT=38787"
Environment="HERDR_WEB_HOST=127.0.0.1"
`;
const leafUnit = `[Service]
Environment="HERDR_WEB_PORT=38787"
Environment="HERDR_WEB_HOST=100.101.171.95"
Environment="HERDR_WEB_ROLE=leaf"
Environment="HERDR_WEB_PEER_ADDRESSES=100.64.0.9"
`;

test("reads what a machine already is so a rerun can keep it", async (context) => {
  assert.deepEqual(await readExistingUnit(await unitFile(context, hubUnit)),
    { port: 38787, role: "hub", hubAddress: "" });
  assert.deepEqual(await readExistingUnit(await unitFile(context, leafUnit)),
    { port: 38787, role: "leaf", hubAddress: "100.64.0.9" });
  // A machine with no unit yet is a hub, which is what a first install makes.
  assert.deepEqual(await readExistingUnit(await unitFile(context, null)),
    { port: null, role: "hub", hubAddress: "" });
});

test("a unit says leaf only while it is one", () => {
  const common = { nodeBin: "/usr/bin/node", herdrBin: "herdr", authFile: "/tmp/auth.json", port: 38787, hostname: "box.ts.net" };
  const asLeaf = serviceUnit({ ...common, leaf: { addresses: ["100.64.0.9"], bindHost: "100.101.171.95" }, bindHost: "100.101.171.95" });
  assert.match(asLeaf, /HERDR_WEB_ROLE=leaf/u);
  assert.match(asLeaf, /HERDR_WEB_PEER_ADDRESSES=100\.64\.0\.9/u);
  assert.match(asLeaf, /HERDR_WEB_HOST=100\.101\.171\.95/u);

  // Converting back has to leave nothing behind: a stray role line would keep
  // the machine refusing every browser while looking installed.
  const asHub = serviceUnit({ ...common });
  assert.ok(!asHub.includes("HERDR_WEB_ROLE"));
  assert.ok(!asHub.includes("HERDR_WEB_PEER_ADDRESSES"));
  assert.match(asHub, /HERDR_WEB_HOST=127\.0\.0\.1/u);
});

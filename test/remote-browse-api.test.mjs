import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import { FileAccessError } from "../src/file-browser.mjs";
import { RemoteFileService, validateServerId } from "../src/remote-files.mjs";

const herdr = { async snapshot() { return {}; } };
const SERVER = "ssh_0123abcd-0123-0123-0123-0123456789ab";

// Stands in for a RemoteFileBrowser without touching the network.
function fakeBrowser(behaviour = {}) {
  return {
    holds: 0,
    closed: false,
    async home() { return "/home/remote"; },
    async listDirectory(path) {
      if (behaviour.listFails) throw behaviour.listFails;
      return {
        path: path || "/home/remote",
        parent: "/home",
        entries: [{ name: "remote.txt", path: `${path || "/home/remote"}/remote.txt`, kind: "file", size: 6, modifiedAt: new Date(0).toISOString(), hidden: false }],
        truncated: false,
        total: 1,
      };
    },
    async openFile(path) {
      return { name: "remote.txt", path, size: 6, stream: Readable.from([Buffer.from("remote")]) };
    },
    hold() { this.holds += 1; },
    release() { this.holds -= 1; },
    close() { this.closed = true; },
  };
}

function service(browser, options = {}) {
  const remoteFiles = new RemoteFileService({
    profiles: { connectionProfiles: () => [{ id: SERVER, host: "box.example" }] },
    ...options,
  });
  remoteFiles.browsers.set(SERVER, browser);
  return remoteFiles;
}

async function startServer(options = {}) {
  const created = createHerdrHttpServer({
    herdr,
    csrfToken: "fixed-test-token",
    logger: { error() {} },
    ...options,
  });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  return { ...created, baseUrl: `http://127.0.0.1:${created.server.address().port}` };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("accepts only well-formed server ids", () => {
  assert.equal(validateServerId(undefined), "local");
  assert.equal(validateServerId(""), "local");
  assert.equal(validateServerId("local"), "local");
  assert.equal(validateServerId(SERVER), SERVER);
  for (const value of ["../etc", "ssh_short", "ssh_" + "z".repeat(36), 42]) {
    assert.throws(() => validateServerId(value), FileAccessError, String(value));
  }
});

test("lists a remote folder and says which server answered", async (context) => {
  const browser = fakeBrowser();
  const app = await startServer({ remoteFiles: service(browser) });
  context.after(() => closeServer(app.server));

  const listing = await fetch(
    `${app.baseUrl}/api/browse?server=${SERVER}&path=${encodeURIComponent("/srv/app")}`,
    { headers: { Origin: app.baseUrl } },
  ).then((response) => response.json());

  assert.equal(listing.server, SERVER);
  assert.equal(listing.path, "/srv/app");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["remote.txt"]);
});

test("starts at the remote home when no path is given", async (context) => {
  const app = await startServer({ remoteFiles: service(fakeBrowser()) });
  context.after(() => closeServer(app.server));

  const listing = await fetch(`${app.baseUrl}/api/browse?server=${SERVER}`, {
    headers: { Origin: app.baseUrl },
  }).then((response) => response.json());
  assert.equal(listing.path, "/home/remote");
});

test("carries a remote file down through a ticket", async (context) => {
  const browser = fakeBrowser();
  const app = await startServer({ remoteFiles: service(browser) });
  context.after(() => closeServer(app.server));

  const issued = await fetch(`${app.baseUrl}/api/browse/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Herdr-CSRF": "fixed-test-token", Origin: app.baseUrl },
    body: JSON.stringify({ server: SERVER, path: "/srv/app/remote.txt" }),
  });
  assert.equal(issued.status, 201);
  assert.equal(browser.holds, 1, "the connection is held until the ticket is spent");

  const { ticket } = await issued.json();
  const download = await fetch(`${app.baseUrl}/api/browse/download/${ticket}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "remote");
  assert.equal(browser.holds, 0, "and released afterwards");
});

test("keeps a failing server from starving local browsing", async (context) => {
  const failing = fakeBrowser({
    listFails: Object.assign(new FileAccessError(502, "ssh_connect_failed", "no answer")),
  });
  const remoteFiles = service(failing);
  const app = await startServer({ remoteFiles });
  context.after(() => closeServer(app.server));

  const remote = await fetch(`${app.baseUrl}/api/browse?server=${SERVER}&path=%2Fsrv`, {
    headers: { Origin: app.baseUrl },
  });
  assert.equal(remote.status, 502);

  // The next attempt is refused outright instead of spending another timeout.
  const again = await fetch(`${app.baseUrl}/api/browse?server=${SERVER}&path=%2Fsrv`, {
    headers: { Origin: app.baseUrl },
  });
  assert.equal((await again.json()).error.code, "server_unreachable");

  // Local browsing is untouched by the remote failure.
  const local = await fetch(`${app.baseUrl}/api/browse?path=%2Ftmp`, { headers: { Origin: app.baseUrl } });
  assert.equal(local.status, 200);
});

test("refuses a remote request when remote files are not configured", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));

  const response = await fetch(`${app.baseUrl}/api/browse?server=${SERVER}&path=%2Fsrv`, {
    headers: { Origin: app.baseUrl },
  });
  assert.equal(response.status, 501);
});

test("rejects a malformed server id before reaching any server", async (context) => {
  const app = await startServer({ remoteFiles: service(fakeBrowser()) });
  context.after(() => closeServer(app.server));

  const response = await fetch(`${app.baseUrl}/api/browse?server=..%2Fetc&path=%2Fsrv`, {
    headers: { Origin: app.baseUrl },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_server");
});

test("counts slots per server", async () => {
  const remoteFiles = new RemoteFileService({
    profiles: { connectionProfiles: () => [{ id: SERVER, host: "box" }] },
    maxConcurrent: 1,
  });
  remoteFiles.browsers.set(SERVER, fakeBrowser());

  let release;
  const held = remoteFiles.withSlot(SERVER, () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(
    () => remoteFiles.withSlot(SERVER, async () => "second"),
    (error) => error.code === "browse_busy",
  );
  // A different server has its own count.
  assert.equal(await remoteFiles.withSlot("other", async () => "ok"), "ok");
  release();
  await held;
});

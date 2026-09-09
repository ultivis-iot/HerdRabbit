import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import { createPasswordConfiguration, PasswordAuth } from "../src/password-auth.mjs";

const herdr = { async snapshot() { return {}; } };

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

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "herdrabbit-browse-api-"));
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "report.txt"), "terminal output");
  await writeFile(join(directory, ".hidden"), "quiet");
  return directory;
}

function browse(app, path) {
  return fetch(`${app.baseUrl}/api/browse?path=${encodeURIComponent(path)}`, {
    headers: { Origin: app.baseUrl },
  });
}

async function ticketFor(app, path, headers = {}) {
  const response = await fetch(`${app.baseUrl}/api/browse/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl,
      ...headers,
    },
    body: JSON.stringify({ path }),
  });
  return response;
}

test("lists a folder with its parent and entries", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));
  const directory = await fixture();

  const listing = await browse(app, directory).then((response) => response.json());
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["nested", ".hidden", "report.txt"]);
  assert.equal(listing.entries[1].hidden, true);
  assert.ok(listing.parent);
});

test("carries a file down through a one-time ticket", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));
  const directory = await fixture();
  const filePath = join(directory, "report.txt");

  const issued = await ticketFor(app, filePath);
  assert.equal(issued.status, 201);
  const { ticket } = await issued.json();

  const download = await fetch(`${app.baseUrl}/api/browse/download/${ticket}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-length"), "15");
  assert.match(download.headers.get("content-disposition"), /report\.txt$/u);
  assert.equal(await download.text(), "terminal output");

  // Spent once: a replay of the same link must not work.
  const replay = await fetch(`${app.baseUrl}/api/browse/download/${ticket}`);
  assert.equal(replay.status, 404);
  assert.equal((await replay.json()).error.code, "ticket_expired");
});

test("serves a download to a navigation that carries no headers", async (context) => {
  // The route sits ahead of the /api/ gate for exactly this reason: a plain
  // <a download> cannot send the launch token, and the ticket is the credential.
  const auth = new PasswordAuth(await createPasswordConfiguration("secret"));
  const app = await startServer({ auth });
  context.after(() => closeServer(app.server));
  const directory = await fixture();

  const login = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ password: "secret" }),
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const { launchToken } = await login.json();

  const issued = await ticketFor(app, join(directory, "report.txt"), {
    Cookie: cookie,
    "X-Herdr-Launch-Token": launchToken,
  });
  assert.equal(issued.status, 201);
  const { ticket } = await issued.json();

  const bare = await fetch(`${app.baseUrl}/api/browse/download/${ticket}`);
  assert.equal(bare.status, 200, "no cookie, no launch token, still served");
  assert.equal(await bare.text(), "terminal output");
});

test("keeps browsing behind the session and ticket issuing behind CSRF", async (context) => {
  const auth = new PasswordAuth(await createPasswordConfiguration("secret"));
  const app = await startServer({ auth });
  context.after(() => closeServer(app.server));
  const directory = await fixture();

  assert.equal((await browse(app, directory)).status, 401);

  const login = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ password: "secret" }),
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const { launchToken } = await login.json();
  const session = { Cookie: cookie, "X-Herdr-Launch-Token": launchToken, Origin: app.baseUrl };

  const listed = await fetch(`${app.baseUrl}/api/browse?path=${encodeURIComponent(directory)}`, {
    headers: session,
  });
  assert.equal(listed.status, 200);

  const noCsrf = await fetch(`${app.baseUrl}/api/browse/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...session },
    body: JSON.stringify({ path: join(directory, "report.txt") }),
  });
  assert.equal(noCsrf.status, 403);
});

test("refuses a cross-site browse request", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));
  const directory = await fixture();

  const foreign = await fetch(`${app.baseUrl}/api/browse?path=${encodeURIComponent(directory)}`, {
    headers: { Origin: "http://evil.example" },
  });
  assert.equal(foreign.status, 403);
});

test("maps filesystem failures onto meaningful statuses", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));
  const directory = await fixture();

  assert.equal((await browse(app, join(directory, "absent"))).status, 404);
  assert.equal((await browse(app, "relative/path")).status, 400);
  assert.equal((await browse(app, join(directory, "report.txt"))).status, 404, "a file is not a folder");
  assert.equal((await browse(app, "/root")).status, 403);

  const directoryTicket = await ticketFor(app, directory);
  assert.equal(directoryTicket.status, 201, "the path is only opened when redeemed");
  const { ticket } = await directoryTicket.json();
  assert.equal((await fetch(`${app.baseUrl}/api/browse/download/${ticket}`)).status, 400);
});

test("rejects an unknown or malformed ticket", async (context) => {
  const app = await startServer();
  context.after(() => closeServer(app.server));

  assert.equal((await fetch(`${app.baseUrl}/api/browse/download/short`)).status, 404);
  assert.equal(
    (await fetch(`${app.baseUrl}/api/browse/download/${"a".repeat(43)}`)).status,
    404,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import { PasswordAuth, createPasswordConfiguration } from "../src/password-auth.mjs";
import { PEER_ADDRESS_HEADER, PEER_LOGIN_HEADER, PeerIdentity } from "../src/peer-identity.mjs";

const OWNER = "owner@example.com";
const HUB = "100.101.171.95";

const herdr = {
  async snapshot() { return { herdr_sessions: [], workspaces: [], tabs: [], panes: [], agents: [] }; },
  async readPane() { return "output"; },
  async sendText() {}, async sendKeys() {},
};

async function start(context, options = {}) {
  const created = createHerdrHttpServer({
    herdr, csrfToken: "fixed-test-token", logger: { error() {} }, ...options,
  });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  context.after(() => new Promise((resolve) => created.server.close(resolve)));
  return `http://127.0.0.1:${created.server.address().port}`;
}

const asHub = { [PEER_LOGIN_HEADER]: OWNER, [PEER_ADDRESS_HEADER]: HUB };

function leaf(context, overrides = {}) {
  return start(context, {
    peer: new PeerIdentity({ logins: [OWNER], addresses: [HUB] }),
    ...overrides,
  });
}

test("a leaf answers nothing but the link API", async (context) => {
  const base = await leaf(context);
  // No person opens a leaf, so the UI, the login routes and the browser API are
  // all absent -- not merely refused, which would confirm what is running here.
  for (const path of ["/", "/app.js", "/api/auth/status", "/api/auth/login", "/api/snapshot", "/api/bootstrap"]) {
    const response = await fetch(`${base}${path}`, { headers: asHub });
    assert.equal(response.status, 404, path);
    const body = await response.json();
    assert.equal(body.error.code, "not_found", path);
  }
});

test("a leaf refuses a link request that carries no identity", async (context) => {
  const base = await leaf(context);
  const response = await fetch(`${base}/api/link/hello`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "peer_identity_required");
  // Nothing about the refusal starts a session.
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a leaf refuses the right account on the wrong device", async (context) => {
  const base = await leaf(context);
  const wrongDevice = { [PEER_LOGIN_HEADER]: OWNER, [PEER_ADDRESS_HEADER]: "100.64.0.9" };
  const response = await fetch(`${base}/api/link/hello`, { headers: wrongDevice });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "peer_address_rejected");

  const wrongAccount = { [PEER_LOGIN_HEADER]: "someone@else", [PEER_ADDRESS_HEADER]: HUB };
  const refused = await fetch(`${base}/api/link/hello`, { headers: wrongAccount });
  assert.equal((await refused.json()).error.code, "peer_identity_rejected");
});

test("a hub with a password is not opened by a forged identity header", async (context) => {
  // The header is a leaf's boundary. On a hub it must mean nothing at all,
  // or anyone able to set a header would walk past the password.
  const auth = new PasswordAuth(await createPasswordConfiguration("correct horse"));
  const base = await start(context, { auth });
  const response = await fetch(`${base}/api/snapshot`, { headers: asHub });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "authentication_required");
});

test("a hub without a peer keeps serving the browser", async (context) => {
  const base = await start(context);
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

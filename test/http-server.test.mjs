import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import {
  createPasswordConfiguration,
  PasswordAuth,
} from "../src/password-auth.mjs";

async function startServer(herdr, options = {}) {
  const created = createHerdrHttpServer({
    herdr,
    csrfToken: "fixed-test-token",
    logger: { error() {} },
    ...options,
  });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  const address = created.server.address();
  return {
    ...created,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { Host: host } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
  });
}

test("serves the UI and read-only API with hardened headers", async (context) => {
  const readCalls = [];
  const herdr = {
    async snapshot() {
      return { workspaces: [{ workspace_id: "w1" }], tabs: [], panes: [], agents: [] };
    },
    async readPane(...args) {
      readCalls.push(args);
      return "terminal output";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const page = await fetch(`${app.baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const pageSource = await page.text();
  assert.doesNotMatch(pageSource, /<h2>Sessions<\/h2>/);
  assert.doesNotMatch(pageSource, /id="pane-state"/);
  assert.match(pageSource, /id="login-form"/);
  assert.match(pageSource, /id="sidebar-toggle"/);
  assert.equal((await fetch(`${app.baseUrl}/ui-model.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/ansi.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/theme.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/workspace-preference.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/terminal-preference.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/completion-preference.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/launch-session.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/push-notifications.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/vendor/simplewebauthn-browser.js`)).status, 200);
  const manifestResponse = await fetch(`${app.baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "HerdRabbit");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
  assert.equal((await fetch(`${app.baseUrl}/sw.js`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/icons/herdr-192.png`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/icons/notification-icon-192.png`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/icons/notification-badge-96.png`)).status, 200);
  const faviconSvg = await fetch(`${app.baseUrl}/icons/favicon.svg`);
  assert.equal(faviconSvg.status, 200);
  assert.match(faviconSvg.headers.get("content-type"), /^image\/svg\+xml/);
  const faviconPng = await fetch(`${app.baseUrl}/icons/favicon-32.png`);
  assert.equal(faviconPng.status, 200);
  assert.match(faviconPng.headers.get("content-type"), /^image\/png/);
  const faviconIco = await fetch(`${app.baseUrl}/favicon.ico`);
  assert.equal(faviconIco.status, 200);
  assert.match(faviconIco.headers.get("content-type"), /^image\/x-icon/);
  const uncachedFavicon = await fetch(`${app.baseUrl}/icons/rabbit-outline-v33.svg`);
  assert.equal(uncachedFavicon.status, 200);
  assert.match(uncachedFavicon.headers.get("content-type"), /^image\/svg\+xml/);

  const bootstrap = await fetch(`${app.baseUrl}/api/bootstrap`).then((response) => response.json());
  assert.equal(bootstrap.csrfToken, "fixed-test-token");
  assert.equal(bootstrap.pollIntervalMs, 1_000);

  const snapshot = await fetch(`${app.baseUrl}/api/snapshot`).then((response) => response.json());
  assert.equal(snapshot.snapshot.workspaces[0].workspace_id, "w1");

  const output = await fetch(`${app.baseUrl}/api/panes/w1%3Ap1/output?lines=80`).then((response) => response.json());
  assert.equal(output.output, "terminal output");
  assert.equal(output.requestedLines, 80);
  assert.equal(output.returnedLines, 1);
  assert.equal(output.hasMore, false);
  assert.deepEqual(readCalls, [["w1:p1", { lines: 144, format: "ansi" }]]);
});

test("returns an output revision and no body when the terminal is unchanged", async (context) => {
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return "alpha\nbeta"; },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const firstResponse = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200`,
  );
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.update, "replace");
  assert.equal(first.output, "alpha\nbeta");
  assert.match(first.revision, /^[A-Za-z0-9_-]{16,64}$/);

  const unchanged = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200&since=${first.revision}`,
  );
  assert.equal(unchanged.status, 204);
  assert.equal(await unchanged.text(), "");

  const resynchronized = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200&since=${"A".repeat(32)}`,
  ).then((response) => response.json());
  assert.equal(resynchronized.update, "replace");
  assert.equal(resynchronized.output, "alpha\nbeta");
});

test("returns only the changed terminal text after a known revision", async (context) => {
  const outputs = [
    "Working (30s • esc to interrupt)",
    "Working (31s • esc to interrupt)",
  ];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return outputs.shift(); },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const first = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200`,
  ).then((response) => response.json());
  const changedResponse = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200&since=${first.revision}`,
  );
  assert.equal(changedResponse.status, 200);
  const changed = await changedResponse.json();
  assert.equal(changed.update, "delta");
  assert.equal(changed.output, undefined);
  assert.deepEqual(changed.patches, [
    { start: 10, deleteCount: 1, text: "1" },
  ]);
  assert.notEqual(changed.revision, first.revision);
});

test("keeps a one-character working update much smaller than the full window", async (context) => {
  const history = Array.from(
    { length: 199 },
    (_, index) => `terminal history ${String(index).padStart(3, "0")} ${"x".repeat(48)}`,
  ).join("\n");
  const outputs = [
    `${history}\nWorking (30s • esc to interrupt)`,
    `${history}\nWorking (31s • esc to interrupt)`,
  ];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return outputs.shift(); },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const firstResponse = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200`,
  );
  const firstBody = await firstResponse.text();
  const first = JSON.parse(firstBody);
  const changedResponse = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=200&since=${first.revision}`,
  );
  const changedBody = await changedResponse.text();
  assert.ok(
    Buffer.byteLength(changedBody) < Buffer.byteLength(firstBody) / 10,
    `expected ${Buffer.byteLength(changedBody)} bytes to be below one tenth of ${Buffer.byteLength(firstBody)}`,
  );
});

test("returns a compact delta when the live output window rolls forward", async (context) => {
  const outputs = ["old\nalpha\nbeta", "alpha\nbeta\ngamma"];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return outputs.shift(); },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const first = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=3`,
  ).then((response) => response.json());
  const changed = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=3&since=${first.revision}`,
  ).then((response) => response.json());

  assert.equal(changed.update, "delta");
  assert.deepEqual(changed.patches, [
    { start: 14, deleteCount: 0, text: "\ngamma" },
    { start: 0, deleteCount: 4, text: "" },
  ]);
});

test("accepts configured interface hosts and rejects unrelated hostnames", async (context) => {
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return ""; },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr, {
    allowedHosts: new Set(["127.0.0.1", "192.168.1.20"]),
  });
  context.after(() => closeServer(app.server));

  assert.equal(
    await requestWithHost(`${app.baseUrl}/api/bootstrap`, "192.168.1.20:38787"),
    200,
  );
  assert.equal(
    await requestWithHost(`${app.baseUrl}/api/bootstrap`, "attacker.example:38787"),
    421,
  );
});

test("returns a bounded output window and reports whether older rows exist", async (context) => {
  const herdr = {
    async snapshot() {
      return {};
    },
    async readPane(_paneId, { lines }) {
      assert.equal(lines, 67);
      return "line 1\nline 2\nline 3\nline 4";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const response = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=3`,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual({
    output: payload.output,
    requestedLines: payload.requestedLines,
    returnedLines: payload.returnedLines,
    hasMore: payload.hasMore,
    update: payload.update,
  }, {
    output: "line 2\nline 3\nline 4",
    requestedLines: 3,
    returnedLines: 3,
    hasMore: true,
    update: "replace",
  });
  assert.match(payload.revision, /^[A-Za-z0-9_-]{16,64}$/);

  const invalid = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=100001`,
  );
  assert.equal(invalid.status, 400);
});

test("rejects writes without both token and same origin", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() {
      return {};
    },
    async readPane() {
      return "";
    },
    async sendText(...args) {
      calls.push(args);
    },
    async sendKeys(...args) {
      calls.push(args);
    },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));
  const endpoint = `${app.baseUrl}/api/panes/w1%3Ap1/text`;

  const missingToken = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ text: "hello", submit: true }),
  });
  assert.equal(missingToken.status, 403);

  const crossOrigin = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: "https://attacker.example",
    },
    body: JSON.stringify({ text: "hello", submit: true }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(calls.length, 0);
});

test("forwards an authorized, bounded write", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() {
      return {};
    },
    async readPane() {
      return "";
    },
    async sendText(...args) {
      calls.push(args);
    },
    async sendKeys(...args) {
      calls.push(args);
    },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const response = await fetch(`${app.baseUrl}/api/panes/w1%3Ap9/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl,
    },
    body: JSON.stringify({ text: "review this", submit: true }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["w1:p9", "review this", { submit: true }]]);
});

test("forwards an authorized workspace rename", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return ""; },
    async sendText() {},
    async sendKeys() {},
    async renameWorkspace(...args) { calls.push(args); },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const rejected = await fetch(`${app.baseUrl}/api/workspaces/w12/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ label: "거절될 이름" }),
  });
  assert.equal(rejected.status, 403);
  assert.equal(calls.length, 0);

  const response = await fetch(`${app.baseUrl}/api/workspaces/w12/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl,
    },
    body: JSON.stringify({ label: "새 프로젝트" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["w12", "새 프로젝트"]]);
});

test("forwards an authorized session rename", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return ""; },
    async sendText() {},
    async sendKeys() {},
    async renameTab(...args) { calls.push(args); },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const rejected = await fetch(`${app.baseUrl}/api/tabs/w12%3At2/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ label: "거절될 이름" }),
  });
  assert.equal(rejected.status, 403);
  assert.equal(calls.length, 0);

  const response = await fetch(`${app.baseUrl}/api/tabs/w12%3At2/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl,
    },
    body: JSON.stringify({ label: "배포 확인" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["w12:t2", "배포 확인"]]);
});

test("creates shell workspaces and tabs and returns the updated snapshot", async (context) => {
  const calls = [];
  const snapshots = [
    { workspaces: [{ workspace_id: "w3", label: "새 프로젝트" }], tabs: [], panes: [] },
    {
      workspaces: [{ workspace_id: "w3", label: "새 프로젝트" }],
      tabs: [{ tab_id: "w3:t2", workspace_id: "w3" }],
      panes: [{ pane_id: "w3:p2", tab_id: "w3:t2", workspace_id: "w3" }],
    },
  ];
  const herdr = {
    async snapshot() { return snapshots.shift(); },
    async createWorkspace(...args) { calls.push(["createWorkspace", ...args]); },
    async createTab(...args) { calls.push(["createTab", ...args]); },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));
  const headers = {
    "Content-Type": "application/json",
    "X-Herdr-CSRF": "fixed-test-token",
    Origin: app.baseUrl,
  };

  const workspaceResponse = await fetch(`${app.baseUrl}/api/workspaces`, {
    method: "POST",
    headers,
    body: JSON.stringify({ label: "새 프로젝트" }),
  });
  assert.equal(workspaceResponse.status, 201);
  assert.equal((await workspaceResponse.json()).snapshot.workspaces[0].workspace_id, "w3");

  const tabResponse = await fetch(`${app.baseUrl}/api/workspaces/w3/tabs`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(tabResponse.status, 201);
  assert.equal((await tabResponse.json()).snapshot.panes[0].pane_id, "w3:p2");
  assert.deepEqual(calls, [
    ["createWorkspace", "새 프로젝트"],
    ["createTab", "w3"],
  ]);
});

test("forwards the selected Herdr session when creating a workspace", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() { return { workspaces: [], tabs: [], panes: [] }; },
    async createWorkspace(...args) { calls.push(args); },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));
  const response = await fetch(`${app.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl,
    },
    body: JSON.stringify({
      label: "새 프로젝트",
      herdrSessionId: "hs_ZGVmYXVsdA",
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [["새 프로젝트", "hs_ZGVmYXVsdA"]]);
});

test("requires explicit confirmation before closing tabs and workspaces", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() { return { workspaces: [], tabs: [], panes: [] }; },
    async closeTab(...args) { calls.push(["closeTab", ...args]); },
    async closeWorkspace(...args) { calls.push(["closeWorkspace", ...args]); },
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));
  const headers = {
    "Content-Type": "application/json",
    "X-Herdr-CSRF": "fixed-test-token",
    Origin: app.baseUrl,
  };

  const rejected = await fetch(`${app.baseUrl}/api/tabs/w2%3At4/close`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 0);

  const tabResponse = await fetch(`${app.baseUrl}/api/tabs/w2%3At4/close`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(tabResponse.status, 200);

  const workspaceResponse = await fetch(`${app.baseUrl}/api/workspaces/w2/close`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(workspaceResponse.status, 200);
  assert.deepEqual(calls, [
    ["closeTab", "w2:t4"],
    ["closeWorkspace", "w2"],
  ]);
});

test("accepts a same-host HTTPS origin from a terminating reverse proxy", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() { return {}; },
    async readPane() { return ""; },
    async sendText(...args) { calls.push(args); },
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const response = await fetch(`${app.baseUrl}/api/panes/w1%3Ap2/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-CSRF": "fixed-test-token",
      Origin: app.baseUrl.replace("http://", "https://"),
    },
    body: JSON.stringify({ text: "proxied", submit: false }),
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test("requires the configured password before exposing Herdr APIs", async (context) => {
  const calls = [];
  const herdr = {
    async snapshot() {
      calls.push("snapshot");
      return { workspaces: [] };
    },
  };
  const auth = new PasswordAuth(await createPasswordConfiguration("secret"));
  const app = await startServer(herdr, { auth });
  context.after(() => closeServer(app.server));

  assert.equal((await fetch(`${app.baseUrl}/`)).status, 200);
  const locked = await fetch(`${app.baseUrl}/api/bootstrap`);
  assert.equal(locked.status, 401);
  assert.equal((await locked.json()).error.code, "authentication_required");
  assert.equal(calls.length, 0);

  const wrong = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);

  const login = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.baseUrl,
      "X-Forwarded-Proto": "https",
    },
    body: JSON.stringify({ password: "secret" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^herdr_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=604800/);
  const loginPayload = await login.json();
  assert.match(loginPayload.launchToken, /^[A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+$/);

  const cookieOnly = await fetch(`${app.baseUrl}/api/bootstrap`, {
    headers: { Cookie: cookie.split(";", 1)[0] },
  });
  assert.equal(cookieOnly.status, 401);

  const launchOnly = await fetch(`${app.baseUrl}/api/bootstrap`, {
    headers: { "X-Herdr-Launch-Token": loginPayload.launchToken },
  });
  assert.equal(launchOnly.status, 401);

  const bootstrap = await fetch(`${app.baseUrl}/api/bootstrap`, {
    headers: {
      Cookie: cookie.split(";", 1)[0],
      "X-Herdr-Launch-Token": loginPayload.launchToken,
    },
  });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).authRequired, true);

  const snapshot = await fetch(`${app.baseUrl}/api/snapshot`, {
    headers: {
      Cookie: cookie.split(";", 1)[0],
      "X-Herdr-Launch-Token": loginPayload.launchToken,
    },
  });
  assert.equal(snapshot.status, 200);
  assert.deepEqual(calls, ["snapshot"]);
});

test("offers passkey login beside password login and creates the same session", async (context) => {
  const calls = [];
  const auth = new PasswordAuth(await createPasswordConfiguration("secret"));
  const passkeys = {
    get hasCredentials() { return true; },
    async beginAuthentication(origin) {
      calls.push(["begin", origin]);
      return {
        attemptId: "passkey-attempt",
        options: { challenge: "authentication-challenge" },
      };
    },
    async finishAuthentication(origin, attemptId, credential) {
      calls.push(["finish", origin, attemptId, credential]);
      return true;
    },
  };
  const app = await startServer({ async snapshot() { return {}; } }, {
    auth,
    passkeys,
  });
  context.after(() => closeServer(app.server));

  const status = await fetch(`${app.baseUrl}/api/auth/status`).then((response) => response.json());
  assert.deepEqual(status, {
    required: true,
    authenticated: false,
    passkeyAvailable: true,
  });

  const optionsResponse = await fetch(`${app.baseUrl}/api/auth/passkeys/login/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({}),
  });
  assert.equal(optionsResponse.status, 200);
  assert.deepEqual(await optionsResponse.json(), {
    attemptId: "passkey-attempt",
    options: { challenge: "authentication-challenge" },
  });

  const credential = { id: "credential-id", response: { signature: "signature" } };
  const login = await fetch(`${app.baseUrl}/api/auth/passkeys/login/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.baseUrl,
      "X-Forwarded-Proto": "https",
    },
    body: JSON.stringify({ attemptId: "passkey-attempt", credential }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  assert.match((await login.json()).launchToken, /^[A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(calls, [
    ["begin", app.baseUrl],
    ["finish", app.baseUrl, "passkey-attempt", credential],
  ]);
});

test("registers passkeys only from an authenticated password session", async (context) => {
  const calls = [];
  let hasCredentials = false;
  const auth = new PasswordAuth(await createPasswordConfiguration("secret"));
  const passkeys = {
    get hasCredentials() { return hasCredentials; },
    async beginRegistration(origin) {
      calls.push(["begin", origin]);
      return {
        attemptId: "registration-attempt",
        options: { challenge: "registration-challenge" },
      };
    },
    async finishRegistration(origin, attemptId, credential) {
      calls.push(["finish", origin, attemptId, credential]);
      hasCredentials = true;
      return true;
    },
  };
  const app = await startServer({ async snapshot() { return {}; } }, {
    auth,
    passkeys,
  });
  context.after(() => closeServer(app.server));

  const locked = await fetch(`${app.baseUrl}/api/auth/passkeys/register/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({}),
  });
  assert.equal(locked.status, 401);

  const login = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ password: "secret" }),
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const { launchToken } = await login.json();
  const authorizedHeaders = {
    "Content-Type": "application/json",
    "X-Herdr-CSRF": "fixed-test-token",
    "X-Herdr-Launch-Token": launchToken,
    Cookie: cookie,
    Origin: app.baseUrl,
  };

  const optionsResponse = await fetch(`${app.baseUrl}/api/auth/passkeys/register/options`, {
    method: "POST",
    headers: authorizedHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(optionsResponse.status, 200);
  assert.deepEqual(await optionsResponse.json(), {
    attemptId: "registration-attempt",
    options: { challenge: "registration-challenge" },
  });

  const credential = { id: "credential-id", response: { attestationObject: "data" } };
  const verification = await fetch(`${app.baseUrl}/api/auth/passkeys/register/verify`, {
    method: "POST",
    headers: authorizedHeaders,
    body: JSON.stringify({ attemptId: "registration-attempt", credential }),
  });
  assert.equal(verification.status, 200);
  assert.deepEqual(await verification.json(), { ok: true, passkeyAvailable: true });
  assert.deepEqual(calls, [
    ["begin", app.baseUrl],
    ["finish", app.baseUrl, "registration-attempt", credential],
  ]);
});

test("reports disabled authentication without creating a login session", async (context) => {
  const herdr = { async snapshot() { return {}; } };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const status = await fetch(`${app.baseUrl}/api/auth/status`).then((response) => response.json());
  assert.deepEqual(status, {
    required: false,
    authenticated: true,
    passkeyAvailable: false,
  });

  const login = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.baseUrl },
    body: JSON.stringify({ password: "" }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("set-cookie"), null);
});



// Herdr hands back fewer rows than asked for: blank rows at the bottom are
// trimmed and wrapped rows come back joined. A Claude pane with a long
// scrollback answered 199 rows to a request for 201.
function scrollbackThatTrims(total, trimmed = 2) {
  const rows = Array.from({ length: total }, (_, index) => `row ${index}`);
  return (lines) => rows.slice(-Math.min(lines, total)).slice(0, -trimmed).join("\n");
}

test("older rows are offered while herdr still holds them, though it answers short", async (context) => {
  const read = scrollbackThatTrims(1_000);
  const app = await startServer({
    async snapshot() { return {}; },
    async readPane(_paneId, { lines }) { return read(lines); },
  });
  context.after(() => closeServer(app.server));
  const window = async (lines) =>
    (await fetch(`${app.baseUrl}/api/panes/w1%3Ap1/output?lines=${lines}`)).json();

  const first = await window(200);
  assert.equal(first.hasMore, true, "a pane with 1,000 rows has more than 200");
  assert.equal(first.returnedLines, 200);
  assert.equal((await window(990)).hasMore, true);
  const all = await window(1_200);
  assert.equal(all.hasMore, false, "everything herdr holds has been shown");
  assert.equal(all.output.split("\n")[0], "row 0");
});

test("uses ANSI scrollback even for legacy hybrid requests without consulting session logs", async (context) => {
  const reads = [];
  const app = await startServer({
    async snapshot() { throw new Error("Output must not look up agent log directories"); },
    async readPane(paneId, options) {
      reads.push({ paneId, ...options });
      return "older\n\x1b[32mterminal history\x1b[0m\nlatest";
    },
  }, { transcripts: { async rowsFor() { assert.fail("Session logs must not be read"); } } });
  context.after(() => closeServer(app.server));
  for (const suffix of ["", "&history=hybrid"]) {
    const response = await fetch(`${app.baseUrl}/api/panes/w1%3Ap1/output?lines=2${suffix}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.output, "\x1b[32mterminal history\x1b[0m\nlatest");
    assert.equal(payload.hasMore, true);
  }
  assert.deepEqual(reads, Array(2).fill({ paneId: "w1:p1", lines: 66, format: "ansi" }));
});

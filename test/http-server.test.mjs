import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrHttpServer } from "../src/http-server.mjs";
import {
  AgentTranscriptReader,
  projectDirectoryName,
} from "../src/agent-transcript.mjs";
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
  assert.deepEqual(readCalls, [["w1:p1", { lines: 81, format: "ansi" }]]);
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

test("restores plain history while preserving the styled current screen", async (context) => {
  const herdr = {
    async snapshot() { return {}; },
    async readPane(_paneId, { format }) {
      if (format === "text") {
        return "older 1\nolder 2\nolder 3\ncurrent a\ncurrent b\n";
      }
      return "\x1b[32mcurrent a\x1b[0m\n\x1b[33mcurrent b\x1b[0m";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr);
  context.after(() => closeServer(app.server));

  const response = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=5&history=hybrid`,
  );
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.equal(
    output.output,
    "older 1\nolder 2\nolder 3\n" +
      "\x1b[32mcurrent a\x1b[0m\n\x1b[33mcurrent b\x1b[0m",
  );
  assert.equal(output.returnedLines, 5);
  assert.equal(output.hasMore, false);
});

test("prepends the agent session log for an alternate-screen agent", async (context) => {
  // Claude keeps no scrollback: every read returns the current screen only,
  // however many lines are requested. Its session log is the only past there is.
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-server-"));
  const cwd = "/tmp/logged-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.jsonl"),
    [
      { type: "user", message: { role: "user", content: "an older question entirely" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "an older answer entirely" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n"),
  );

  const herdr = {
    async snapshot() {
      return { agents: [{ pane_id: "w1:p1", agent: "claude", cwd }] };
    },
    async readPane(_paneId, { format }) {
      return format === "ansi"
        ? "\u001b[32mthe current screen\u001b[0m"
        : "the current screen";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr, {
    transcripts: new AgentTranscriptReader({ projectsRoot: root }),
  });
  context.after(() => closeServer(app.server));

  const payload = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=100&history=hybrid`,
  ).then((response) => response.json());

  assert.equal(
    payload.output,
    "> an older question entirely\n\n⏺ an older answer entirely\n" +
      "\u001b[32mthe current screen\u001b[0m",
    "the log goes above the live screen, which keeps its ANSI styling",
  );
});

test("does not repeat the exchange the screen is already showing", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-server-"));
  const cwd = "/tmp/overlap-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.jsonl"),
    [
      { type: "user", message: { role: "user", content: "an older question entirely" } },
      { type: "user", message: { role: "user", content: "what the screen is showing now" } },
    ].map((entry) => JSON.stringify(entry)).join("\n"),
  );

  const herdr = {
    async snapshot() {
      return { agents: [{ pane_id: "w1:p1", agent: "claude", cwd }] };
    },
    async readPane() {
      return "> what the screen is showing now";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr, {
    transcripts: new AgentTranscriptReader({ projectsRoot: root }),
  });
  context.after(() => closeServer(app.server));

  const payload = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=100&history=hybrid`,
  ).then((response) => response.json());

  const occurrences = payload.output.split("what the screen is showing now").length - 1;
  assert.equal(occurrences, 1, `repeated in ${JSON.stringify(payload.output)}`);
});

test("holds the transcript boundary still while the screen shows the past", async (context) => {
  // Claude scrolls inside its own alternate screen and shows a "new message"
  // banner. If the transcript were recut from that screen it would grow and
  // shrink by dozens of rows every poll, which makes the view unscrollable.
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-server-"));
  const cwd = "/tmp/scrollback-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.jsonl"),
    [
      { type: "user", message: { role: "user", content: "an older question entirely" } },
      { type: "user", message: { role: "user", content: "what the screen is showing now" } },
    ].map((entry) => JSON.stringify(entry)).join("\n"),
  );

  let screen = "> what the screen is showing now";
  const herdr = {
    async snapshot() {
      return { agents: [{ pane_id: "w1:p1", agent: "claude", cwd }] };
    },
    async readPane() {
      return screen;
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr, {
    transcripts: new AgentTranscriptReader({ projectsRoot: root }),
  });
  context.after(() => closeServer(app.server));

  const read = () => fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=100&history=hybrid`,
  ).then((response) => response.json());

  const live = await read();
  assert.match(live.output, /an older question entirely/);
  assert.doesNotMatch(
    live.output.replace(screen, ""),
    /what the screen is showing now/,
    "the exchange on screen is cut from the transcript",
  );

  // Now the reader scrolls back inside Claude: the screen shows the past and
  // the newest exchange is nowhere on it.
  screen = "> an older question entirely\n  1 new message (ctrl+End)";
  const scrolled = await read();
  const transcriptPart = scrolled.output.slice(0, scrolled.output.indexOf(screen));
  assert.doesNotMatch(
    transcriptPart,
    /what the screen is showing now/,
    "the boundary from the last live frame is kept instead of being recomputed",
  );
});

test("reports more history once the log exceeds the window", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-server-"));
  const cwd = "/tmp/long-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.jsonl"),
    Array.from({ length: 20 }, (_, index) => JSON.stringify({
      type: "user",
      message: { role: "user", content: `question number ${index}` },
    })).join("\n"),
  );

  const herdr = {
    async snapshot() {
      return { agents: [{ pane_id: "w1:p1", agent: "claude", cwd }] };
    },
    async readPane() {
      return "the current screen";
    },
    async sendText() {},
    async sendKeys() {},
  };
  const app = await startServer(herdr, {
    transcripts: new AgentTranscriptReader({ projectsRoot: root }),
  });
  context.after(() => closeServer(app.server));

  const payload = await fetch(
    `${app.baseUrl}/api/panes/w1%3Ap1/output?lines=5&history=hybrid`,
  ).then((response) => response.json());

  assert.equal(payload.hasMore, true, "scrolling up must be able to load older lines");
  assert.equal(payload.returnedLines, 5);
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
      assert.equal(lines, 4);
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

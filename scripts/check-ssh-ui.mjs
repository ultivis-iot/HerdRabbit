// Opt-in browser integration check using Firefox/geckodriver and isolated data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { ServerProfiles } from "../src/server-profiles.mjs";
import { MultiServerClient } from "../src/multi-server-client.mjs";
import { createHerdrHttpServer } from "../src/http-server.mjs";

const directory = await mkdtemp(join(tmpdir(), "hr-browser-check-"));
const received = [];
const sessionId = "hs_ZGVmYXVsdA";
const workspaceId = `${sessionId}~wB`;
const tabId = `${workspaceId}:t1`;
const paneId = `${workspaceId}:p1`;
const makeClient = (label) => ({
  async snapshot() { return {
    herdr_sessions: [{ session_id: sessionId, name: "default", running: true, available: true, default: true }],
    workspaces: [{ workspace_id: workspaceId, herdr_session_id: sessionId, label: "Project" }],
    tabs: [{ workspace_id: workspaceId, tab_id: tabId, herdr_session_id: sessionId, label: "Tab" }],
    panes: [{ workspace_id: workspaceId, tab_id: tabId, pane_id: paneId, herdr_session_id: sessionId, label }], agents: [],
  }; },
  async readPane() { return `${label} terminal output`; },
  async sendText(id, text) { received.push({ label, id, text }); },
});
const profiles = await ServerProfiles.load(join(directory, "profiles.json"));
const herdr = new MultiServerClient({ local: makeClient("Local"), profiles, remoteFactory: () => makeClient("Remote") });
const { server } = createHerdrHttpServer({ herdr, profiles });
let driver;
let webdriverUrl;
let session;
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const driverPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  driver = spawn("geckodriver", ["--port", String(driverPort)], { stdio: "ignore" });
  webdriverUrl = `http://127.0.0.1:${driverPort}`;
  const call = async (path, body, method = "POST") => {
    const response = await fetch(webdriverUrl + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json();
    if (payload.value?.error) throw new Error(JSON.stringify(payload.value));
    return payload.value;
  };
  for (let i = 0; i < 50; i++) {
    try { await call("/status", undefined, "GET"); break; } catch (error) { if (i === 49) throw error; await pause(); }
  }
  session = (await call("/session", { capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"] } } } })).sessionId;
  const js = (script) => call(`/session/${session}/execute/sync`, { script, args: [] });
  const wait = async (script) => {
    for (let i = 0; i < 100; i++) {
      try { if (await js(`return (${script})`)) return; } catch (error) { if (i === 99) throw error; }
      await pause();
    }
    throw new Error(`Browser condition timed out: ${script}`);
  };
  await call(`/session/${session}/url`, { url: base });
  await wait('document.querySelectorAll(".pane-button").length === 1');
  await js('document.querySelector("#add-menu summary").click()');
  assert.equal(await js('return document.querySelector("#add-menu").open'), true);
  assert.equal(await js('return document.querySelector("#manage-servers").getBoundingClientRect().width > 0'), true);
  await js('document.querySelector("#manage-servers").click()');
  assert.equal(await js('return document.querySelector("#add-menu").open'), false);
  await wait('!document.querySelector("#ssh-name").disabled');
  await js('document.querySelector("#ssh-auth-method").value="key"; document.querySelector("#ssh-auth-method").dispatchEvent(new Event("change"))');
  assert.equal(await js('return !document.querySelector("#ssh-key-fields").hidden && document.querySelector("#ssh-identity").required'), true);
  await js('document.querySelector("#ssh-auth-method").value="password"; document.querySelector("#ssh-auth-method").dispatchEvent(new Event("change"))');
  assert.equal(await js('return !document.querySelector("#ssh-password-fields").hidden && document.querySelector("#ssh-password").required && document.querySelector("#ssh-key-fields").hidden'), true);
  await js('document.querySelector("#ssh-password").value="fixture-password"');
  const fieldGaps = await js(`
    const gap = (id) => document.querySelector('#' + id).getBoundingClientRect().top - document.querySelector('label[for="' + id + '"]').getBoundingClientRect().bottom;
    return { normal: gap('ssh-name'), password: gap('ssh-password') };
  `);
  assert.ok(Math.abs(fieldGaps.normal - fieldGaps.password) < 1, JSON.stringify(fieldGaps));
  assert.equal(fieldGaps.normal, 6);
  await js('document.querySelector("#ssh-name").value="Development"; document.querySelector("#ssh-host").value="fixture-host"; document.querySelector("#ssh-test").click()');
  await wait('document.querySelector("#ssh-feedback").textContent.startsWith("Connected.")');
  await js('document.querySelector("#ssh-profile-form").requestSubmit()');
  await wait('document.querySelectorAll(".server-group").length === 2 && document.querySelectorAll(".pane-button").length === 2');
  assert.equal(profiles.list()[0].host, "fixture-host");
  assert.equal(profiles.list()[0].authMethod, "password");
  assert.equal(profiles.list()[0].password, undefined);
  assert.equal(profiles.connectionProfiles()[0].password, "fixture-password");
  assert.equal(await js('return document.querySelector("#ssh-password").value'), "");
  await js('document.querySelector("#ssh-close").click(); document.querySelectorAll(".pane-button")[1].click()');
  await wait('document.querySelector("#terminal-output").textContent.includes("Remote terminal output")');
  assert.match(await js('return document.querySelector("#pane-context").textContent'), /Development/);
  await js('document.querySelector("#terminal-input").value="Remote prompt"; document.querySelector("#input-form").requestSubmit()');
  await wait('document.querySelector("#terminal-input").value === ""');
  assert.deepEqual(received, [{ label: "Remote", id: paneId, text: "Remote prompt" }]);
  await call(`/session/${session}/window/rect`, { width: 390, height: 844 });
  await js('document.querySelector("#manage-servers").click()');
  await wait('!document.querySelector("#ssh-name").disabled');
  assert.equal(await js('return document.querySelector("#servers-dialog").getBoundingClientRect().width <= innerWidth'), true);
  await js('document.querySelector("#ssh-profile-list button").click(); document.querySelector("#ssh-name").value="Renamed"; document.querySelector("#ssh-password").value="replacement-password"; document.querySelector("#ssh-profile-form").requestSubmit()');
  await wait('document.querySelector(".ssh-profile-row strong")?.textContent === "Renamed"');
  assert.equal(profiles.list()[0].name, "Renamed");
  await js('window.confirm=()=>true; document.querySelectorAll("#ssh-profile-list button")[1].click()');
  await wait('document.querySelectorAll(".ssh-profile-row").length === 0');
  assert.equal(profiles.list().length, 0);
  console.log("PASS: browser add/test/save, concurrent servers, remote selection/input, mobile dialog, edit/remove");
} finally {
  if (session) await fetch(`${webdriverUrl}/session/${session}`, { method: "DELETE" }).catch(() => {});
  if (driver && driver.exitCode === null) { driver.kill(); await once(driver, "exit"); }
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

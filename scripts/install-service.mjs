#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  defaultAuthFilePath,
  writePasswordConfiguration,
} from "../src/password-auth.mjs";
import {
  findAvailableServicePort,
  isPortInServiceRange,
  PREFERRED_SERVICE_PORT,
} from "../src/port-selection.mjs";
import { promptForNewPassword, readVisibleLine } from "./password-prompt.mjs";
import { ensureHerdrExecutable } from "./herdr-install.mjs";
import { configureClaude } from "./configure-claude.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const serviceName = "herdrabbit.service";
const legacyServiceName = "herdr-web-local.service";

function quoteSystemd(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// Re-running the installer on a machine that is already set up should carry
// its answers forward, so the prompts default to what it is rather than to what
// a fresh install would be.
export async function readExistingUnit(serviceFile) {
  try {
    const source = await readFile(serviceFile, "utf8");
    const port = Number(source.match(/HERDR_WEB_PORT=(\d+)/)?.[1]);
    return {
      port: isPortInServiceRange(port) ? port : null,
      role: /HERDR_WEB_ROLE=(?:")?leaf/u.test(source) ? "leaf" : "hub",
      hubAddress: source.match(/HERDR_WEB_PEER_ADDRESSES=(?:")?([^"\s]+)/u)?.[1] || "",
    };
  } catch (error) {
    if (error.code === "ENOENT") return { port: null, role: "hub", hubAddress: "" };
    throw error;
  }
}

async function tailscaleDetails() {
  try {
    const { stdout: statusSource } = await execFileAsync(
      "tailscale",
      ["status", "--json"],
    );
    const status = JSON.parse(statusSource);
    let serve = {};
    try {
      const { stdout: serveSource } = await execFileAsync(
        "tailscale",
        ["serve", "status", "--json"],
      );
      serve = JSON.parse(serveSource);
    } catch {}
    const hostname = String(status.Self?.DNSName || "").replace(/\.$/, "");
    const addresses = Array.isArray(status.Self?.TailscaleIPs) ? status.Self.TailscaleIPs : [];
    const usedHttpsPorts = new Set(
      Object.entries(serve.TCP || {})
        .filter(([, value]) => value?.HTTPS === true)
        .map(([port]) => Number(port))
        .filter(Number.isInteger),
    );
    return {
      available: status.BackendState === "Running" && hostname !== "",
      hostname,
      addresses,
      usedHttpsPorts,
    };
  } catch {
    return { available: false, hostname: "", addresses: [], usedHttpsPorts: new Set() };
  }
}

export function serviceUnit({ nodeBin, herdrBin, authFile, port, hostname, leaf = null, bindHost = "127.0.0.1" }) {
  const lines = [
    "[Unit]",
    "Description=HerdRabbit",
    `Documentation=${quoteSystemd(`file://${repositoryRoot}README.md`)}`,
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${repositoryRoot}`,
    `Environment=${quoteSystemd(`HERDR_WEB_PORT=${port}`)}`,
    `Environment=${quoteSystemd(`HERDR_WEB_HOST=${bindHost}`)}`,
    `Environment=${quoteSystemd(`HERDR_WEB_AUTH_FILE=${authFile}`)}`,
  ];
  if (hostname) {
    lines.push(`Environment=${quoteSystemd(`HERDR_WEB_ALLOWED_HOSTS=${hostname}`)}`);
  }
  if (leaf) {
    // Baked in at install time so src/ never has to shell out to tailscale, and
    // so the trust set cannot change without the unit changing.
    // Bound to its own tailnet address, a leaf reads the caller off the socket,
    // so the hub is named by address and there is no login to configure.
    // HERDR_WEB_PEER_LOGINS still exists for a leaf placed behind Tailscale
    // Serve by hand; the installer does not build that shape.
    lines.push(
      `Environment=${quoteSystemd("HERDR_WEB_ROLE=leaf")}`,
      `Environment=${quoteSystemd(`HERDR_WEB_PEER_ADDRESSES=${leaf.addresses.join(",")}`)}`,
    );
  }
  lines.push(
    `Environment=${quoteSystemd(`HERDR_BIN=${herdrBin}`)}`,
    `ExecStart=${quoteSystemd(nodeBin)} ${quoteSystemd(join(repositoryRoot, "src/index.mjs"))}`,
    "Restart=on-failure",
    "RestartSec=2s",
    "NoNewPrivileges=true",
    "UMask=0077",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  );
  return lines.join("\n");
}

async function removeLegacyService(unitDirectory) {
  const legacyFile = join(unitDirectory, legacyServiceName);
  try {
    await stat(legacyFile);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const verb of ["stop", "disable"]) {
    try {
      await execFileAsync("systemctl", ["--user", verb, legacyServiceName]);
    } catch {}
  }
  await rm(legacyFile, { force: true });
  await rm(join(unitDirectory, "default.target.wants", legacyServiceName), {
    force: true,
  });
  return true;
}

// true when HerdRabbit answered, false when something else did, null when the
// address could not be reached at all.
async function reachesHerdRabbit(address) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(address, { redirect: "manual" });
      // Every HerdRabbit response carries the launch-token header name in its
      // allowed set; the login page is served even before authentication.
      const body = response.status < 400 ? await response.text() : "";
      return body.includes("HerdRabbit") ? true : false;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

function runInteractive(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}


// The hub is the machine a person opens; a leaf only ever answers that hub.
// Which one this is decides whether a password makes sense at all.
async function chooseLeafMode(tailscale, existing) {
  if (!tailscale.available) return null;
  const wasLeaf = existing.role === "leaf";
  const answer = await readVisibleLine(
    `이 머신을 다른 HerdRabbit(허브)에 연결되는 leaf로 설치할까요? [${wasLeaf ? "Y/n" : "y/N"}]: `,
  );
  const wantsLeaf = answer === "" ? wasLeaf : /^y(es)?$/iu.test(answer);
  if (!wantsLeaf) return null;

  const suggestion = existing.hubAddress ? ` [${existing.hubAddress}]` : "";
  const typed = await readVisibleLine(`허브의 tailnet 주소${suggestion} (예: 100.101.171.95): `);
  const hubAddress = typed || existing.hubAddress;
  if (!hubAddress) {
    throw new Error("leaf는 허브의 tailnet 주소로 상대를 알아봅니다. 주소가 필요합니다.");
  }
  // Listening on this node's own tailnet address means the caller's address is
  // set by the kernel from a WireGuard-authenticated peer, so there is nothing
  // to put in front and no certificate to obtain. A process on this machine
  // cannot claim the hub's address the way it could write a header.
  const bindHost = tailscale.addresses.find((address) => !address.includes(":"));
  if (!bindHost) {
    throw new Error("이 노드의 tailnet IPv4 주소를 읽지 못했습니다.");
  }
  return { addresses: [hubAddress], bindHost };
}

async function main() {
  const userConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const unitDirectory = join(userConfigHome, "systemd", "user");
  const serviceFile = join(unitDirectory, serviceName);
  const authFile = defaultAuthFilePath();
  const [existing, legacy, tailscale, herdrBin] = await Promise.all([
    readExistingUnit(serviceFile),
    readExistingUnit(join(unitDirectory, legacyServiceName)),
    tailscaleDetails(),
    ensureHerdrExecutable(),
  ]);
  const port = existing.port || legacy.port || await findAvailableServicePort({
    preferred: PREFERRED_SERVICE_PORT,
    unavailablePorts: tailscale.usedHttpsPorts,
  });

  const leaf = await chooseLeafMode(tailscale, existing);
  const becomingLeaf = leaf !== null && existing.role !== "leaf";
  if (becomingLeaf) {
    // The auth file holds the password hash and the registered passkeys, and a
    // leaf refuses to start while it exists. Say what is about to go.
    console.log("허브에서 leaf로 바꿉니다. 이 머신의 비밀번호와 등록된 passkey가 삭제됩니다.");
  }
  // A leaf has no login page, so asking for a password would set one that its
  // own gate then refuses to start with.
  const password = leaf ? "" : await promptForNewPassword();
  const claude = await configureClaude();
  console.log(`Claude 일반 터미널 모드 설정: ${claude.path}`);
  const auth = await writePasswordConfiguration(authFile, password);
  await mkdir(dirname(serviceFile), { recursive: true });
  const migrated = await removeLegacyService(unitDirectory);
  await writeFile(serviceFile, serviceUnit({
    nodeBin: process.execPath,
    herdrBin,
    authFile,
    port,
    hostname: tailscale.hostname,
    leaf,
    bindHost: leaf ? leaf.bindHost : "127.0.0.1",
  }), { mode: 0o600 });

  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", ["--user", "enable", serviceName]);
  await execFileAsync("systemctl", ["--user", "restart", serviceName]);

  if (migrated) {
    console.log(`이전 ${legacyServiceName}을 제거하고 ${serviceName}으로 옮겼습니다.`);
  }
  console.log(`HerdRabbit 서비스를 ${leaf ? leaf.bindHost : "127.0.0.1"}:${port}에 설치했습니다.`);
  console.log(
    auth.required
      ? "비밀번호 인증을 활성화했습니다."
      : "비밀번호 인증을 비활성화했습니다.",
  );
  if (leaf) {
    // A hub published itself over Tailscale Serve. A leaf listens on its own
    // tailnet address, so that registration would point at a port nothing
    // answers on any more.
    if (tailscale.usedHttpsPorts.has(port)) {
      console.log(`Tailscale HTTPS 등록(${port})을 해제합니다…`);
      await runInteractive("sudo", ["tailscale", "serve", `--https=${port}`, "off"]).catch(() => {
        console.warn(`경고: Tailscale HTTPS 등록을 해제하지 못했습니다. 직접 실행하세요: sudo tailscale serve --https=${port} off`);
      });
    }
    console.log(`이 머신은 leaf입니다. ${leaf.addresses.join(", ")}에서 온 요청만 받습니다.`);
    console.log(`허브에서 이 주소를 서버로 추가하세요: http://${leaf.bindHost}:${port}`);
    // Nothing here is browser-facing, so there is no secure context to provide
    // and no reason to publish it.
    console.log("leaf는 tailnet 안에서만 보이며 HTTPS 등록이 필요하지 않습니다.");
    return;
  }
  if (existing.role === "leaf") {
    console.log("leaf에서 허브로 바꿨습니다. 허브 쪽에 이 머신이 서버로 등록돼 있다면 지우세요.");
  }
  if (!auth.required) {
    // Neither a password nor a peer gate leaves the API open to the tailnet
    // while everything still looks like it is working.
    console.warn("경고: 비밀번호도 leaf 모드도 없습니다. 이 API는 tailnet의 모든 기기에 열려 있습니다.");
  }

  if (!tailscale.available) {
    console.log("Tailscale이 실행 중이 아니므로 HTTPS 등록을 건너뛰었습니다.");
    return;
  }

  console.log(`Tailscale HTTPS 포트 ${port}을 등록합니다…`);
  try {
    await runInteractive("sudo", [
      "tailscale",
      "serve",
      "--bg",
      "--yes",
      `--https=${port}`,
      `http://127.0.0.1:${port}`,
    ]);
  } catch (error) {
    throw new Error(
      `서비스 설치는 완료했지만 Tailscale HTTPS 등록에 실패했습니다: ${error.message}`,
      { cause: error },
    );
  }
  // Tailscale only owns the port inside its own listener. Another process that
  // already holds 0.0.0.0:<port> shadows it, and `serve status` still reports
  // the registration -- so the only honest check is to ask the address and see
  // who answers.
  const address = `https://${tailscale.hostname}:${port}`;
  const reached = await reachesHerdRabbit(address);
  if (reached === true) {
    console.log(`HerdRabbit 주소: ${address}`);
    return;
  }
  console.warn(
    reached === false
      ? `경고: ${address}에 다른 서비스가 응답합니다. 이 포트를 선점한 프로세스가 있는지 확인하세요 (ss -tlnp | grep ${port}).`
      : `경고: ${address}에 아직 연결되지 않습니다. 서비스가 뜬 뒤 다시 확인하세요.`,
  );
  console.log(`HerdRabbit 주소: ${address}`);
}

// Running only when invoked as a script keeps the unit builders importable by
// tests, which would otherwise trigger the install prompts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`설치 실패: ${error.message}`);
    process.exitCode = 1;
  });
}

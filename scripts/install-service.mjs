#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { promptForNewPassword } from "./password-prompt.mjs";
import { ensureHerdrExecutable } from "./herdr-install.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const serviceName = "herdr-web-local.service";

function quoteSystemd(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function readExistingPort(serviceFile) {
  try {
    const source = await readFile(serviceFile, "utf8");
    const match = source.match(/HERDR_WEB_PORT=(\d+)/);
    const port = Number(match?.[1]);
    return isPortInServiceRange(port) ? port : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
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
    const usedHttpsPorts = new Set(
      Object.entries(serve.TCP || {})
        .filter(([, value]) => value?.HTTPS === true)
        .map(([port]) => Number(port))
        .filter(Number.isInteger),
    );
    return {
      available: status.BackendState === "Running" && hostname !== "",
      hostname,
      usedHttpsPorts,
    };
  } catch {
    return { available: false, hostname: "", usedHttpsPorts: new Set() };
  }
}

function serviceUnit({ nodeBin, herdrBin, authFile, port, hostname }) {
  const lines = [
    "[Unit]",
    "Description=HerdrBridge",
    `Documentation=${quoteSystemd(`file://${repositoryRoot}README.md`)}`,
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${quoteSystemd(repositoryRoot)}`,
    `Environment=${quoteSystemd(`HERDR_WEB_PORT=${port}`)}`,
    `Environment=${quoteSystemd("HERDR_WEB_HOST=127.0.0.1")}`,
    `Environment=${quoteSystemd(`HERDR_WEB_AUTH_FILE=${authFile}`)}`,
  ];
  if (hostname) {
    lines.push(`Environment=${quoteSystemd(`HERDR_WEB_ALLOWED_HOSTS=${hostname}`)}`);
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

async function main() {
  const userConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const serviceFile = join(
    userConfigHome,
    "systemd",
    "user",
    serviceName,
  );
  const authFile = defaultAuthFilePath();
  const [existingPort, tailscale, herdrBin] = await Promise.all([
    readExistingPort(serviceFile),
    tailscaleDetails(),
    ensureHerdrExecutable(),
  ]);
  const port = existingPort || await findAvailableServicePort({
    preferred: PREFERRED_SERVICE_PORT,
    unavailablePorts: tailscale.usedHttpsPorts,
  });

  const password = await promptForNewPassword();
  const auth = await writePasswordConfiguration(authFile, password);
  await mkdir(dirname(serviceFile), { recursive: true });
  await writeFile(serviceFile, serviceUnit({
    nodeBin: process.execPath,
    herdrBin,
    authFile,
    port,
    hostname: tailscale.hostname,
  }), { mode: 0o600 });

  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", ["--user", "enable", serviceName]);
  await execFileAsync("systemctl", ["--user", "restart", serviceName]);

  console.log(`HerdrBridge 서비스를 127.0.0.1:${port}에 설치했습니다.`);
  console.log(
    auth.required
      ? "비밀번호 인증을 활성화했습니다."
      : "비밀번호 인증을 비활성화했습니다.",
  );

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
  console.log(`HerdrBridge 주소: https://${tailscale.hostname}:${port}`);
}

main().catch((error) => {
  console.error(`설치 실패: ${error.message}`);
  process.exitCode = 1;
});

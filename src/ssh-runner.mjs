import { execFile, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { HerdrCommandError } from "./herdr-client.mjs";

const execFileAsync = promisify(execFile);
export const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export function sshInvocation(profile, args, controlDirectory) {
  const fingerprint = createHash("sha256").update(JSON.stringify(profile)).digest("hex").slice(0, 24);
  const options = [
    "-T", "-o", `BatchMode=${profile.authMethod === "password" ? "no" : "yes"}`, "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
    "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
    "-o", "PermitLocalCommand=no", "-o", "ControlMaster=auto", "-o", "ControlPersist=60",
    "-o", `ControlPath=${controlDirectory}/${fingerprint}`,
  ];
  if (profile.authMethod === "password") options.push(
    "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no", "-o", "NumberOfPasswordPrompts=1",
  );
  if (profile.port) options.push("-p", String(profile.port));
  if (profile.username) options.push("-l", profile.username);
  if (profile.identityFile) options.push("-i", profile.identityFile, "-o", "IdentitiesOnly=yes");
  const executable = profile.herdrBin === "herdr"
    ? '"$(command -v herdr || printf \'%s/.local/bin/herdr\' "$HOME")"'
    : shellQuote(profile.herdrBin);
  return [...options, "--", profile.host, `exec ${executable} ${args.map(shellQuote).join(" ")}`];
}

export function createSshRunner(profile, controlDirectory, execute = execFileAsync, spawnProcess = spawn) {
  const runner = async (_binary, args, options) => {
    if (profile.authMethod === "password" && !profile.password) {
      throw new HerdrCommandError("No saved SSH password. Enter it in Connect SSH Server and save the connection.", { code: "ssh_password_required" });
    }
    try {
      return await execute("ssh", sshInvocation(profile, args, controlDirectory), {
        ...options, timeout: 8_000, killSignal: "SIGKILL",
        ...(profile.authMethod === "password" ? { env: {
          ...process.env, SSH_ASKPASS: fileURLToPath(new URL("./ssh-askpass.sh", import.meta.url)),
          SSH_ASKPASS_REQUIRE: "force", DISPLAY: "herdrabbit:0", HERDRABBIT_SSH_PASSWORD: profile.password,
        } } : {}),
      });
    } catch (error) {
      const stderr = String(error.stderr || "");
      const message = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/iu.test(stderr)
        ? "SSH host key is unknown or changed. Verify this host from the service account's terminal first."
        : /Permission denied/iu.test(stderr)
          ? "SSH authentication failed. Check the user and selected authentication method."
          : error.killed || /timed out/iu.test(stderr)
            ? "SSH connection timed out."
            : /not found|No such file/iu.test(stderr)
              ? "SSH or the remote Herdr executable was not found. Check the configured path."
              : "SSH command failed. Check the host, port, and remote Herdr installation.";
      // execFile errors include invocation details; do not retain credential-bearing causes.
      throw new HerdrCommandError(message, { code: "ssh_command_failed" });
    }
  };
  runner.openSocket = path => openSshStatusSocket(profile, controlDirectory, path, spawnProcess);
  return runner;
}

export function sshSocketInvocation(profile, controlDirectory, remotePath, localPath) {
  if (!remotePath.startsWith("/") || /[:\r\n\0]/.test(remotePath)) throw new Error("Unsupported Herdr socket path");
  const invocation = sshInvocation(profile, [], controlDirectory);
  const options = [];
  for (let index = 0; index < invocation.indexOf("--"); index++) {
    if (invocation[index] === "-o" && /^(Control(Master|Persist|Path)=|ClearAllForwardings=)/.test(invocation[index + 1])) { index++; continue; }
    options.push(invocation[index]);
  }
  return [...options, "-o", "ControlPath=none", "-o", "ExitOnForwardFailure=yes", "-N",
    "-L", `${localPath}:${remotePath}`, "--", profile.host];
}

async function openSshStatusSocket(profile, controlDirectory, remotePath, spawnProcess) {
  if (profile.authMethod === "password" && !profile.password) throw new Error("SSH password is required");
  const directory = await mkdtemp(join(tmpdir(), "herdr-status-"));
  const localPath = join(directory, "api.sock");
  let child;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    child?.kill();
    void rm(directory, { recursive: true, force: true });
  };
  try {
    child = spawnProcess("ssh", sshSocketInvocation(profile, controlDirectory, remotePath, localPath), {
      stdio: "ignore",
      env: { ...process.env, ...(profile.authMethod === "password" ? {
        SSH_ASKPASS: fileURLToPath(new URL("./ssh-askpass.sh", import.meta.url)),
        SSH_ASKPASS_REQUIRE: "force", DISPLAY: "herdrabbit:0", HERDRABBIT_SSH_PASSWORD: profile.password,
      } : {}) },
    });
    return await new Promise((resolve, reject) => {
      let settled = false;
      let retry;
      let connection;
      const timeout = setTimeout(() => fail(), 5000);
      function fail() {
        if (settled) { connection?.destroy(); return; }
        settled = true;
        clearTimeout(retry); clearTimeout(timeout); cleanup();
        reject(new Error("SSH status stream unavailable; check socket forwarding permissions"));
      }
      child.once("error", fail);
      child.once("exit", fail);
      function attempt() {
        if (settled) return;
        connection = createConnection(localPath);
        connection.once("connect", () => {
          settled = true; clearTimeout(timeout);
          connection.once("close", cleanup);
          resolve(connection);
        });
        connection.once("error", () => { if (!settled) retry = setTimeout(attempt, 50); });
      }
      attempt();
    });
  } catch (error) { cleanup(); throw error; }
}

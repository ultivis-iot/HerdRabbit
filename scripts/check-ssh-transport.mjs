// Opt-in integration check: requires ssh, ssh-keygen, and an unprivileged sshd.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { createSshRunner, sshInvocation } from "../src/ssh-runner.mjs";
import { validateSshProfile } from "../src/ssh-profiles.mjs";

const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "hr-ssh-check-"));
let daemon;
let controlPath;
try {
  for (const name of ["host", "client"]) await execute("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(directory, name)]);
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const config = join(directory, "sshd_config");
  await writeFile(config, [
    `Port ${port}`, "ListenAddress 127.0.0.1", `HostKey ${directory}/host`,
    `PidFile ${directory}/pid`, `AuthorizedKeysFile ${directory}/client.pub`,
    "StrictModes no", "PasswordAuthentication no", "KbdInteractiveAuthentication no",
    "UsePAM no", "AllowTcpForwarding no", "X11Forwarding no", "LogLevel ERROR",
  ].join("\n") + "\n");
  const knownHosts = join(directory, "known_hosts");
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${await readFile(join(directory, "host.pub"), "utf8")}`);
  daemon = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", config], { stdio: ["ignore", "ignore", "pipe"] });
  let errors = "";
  daemon.stderr.on("data", (data) => { errors += data; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (daemon.exitCode !== null) throw new Error(`Test sshd could not start: ${errors}`);
  const profile = validateSshProfile({ name: "Test", host: "127.0.0.1", port, username: userInfo().username, identityFile: join(directory, "client"), herdrBin: "/usr/bin/printf" });
  const invoke = (binary, args, options) => execute(binary, ["-F", "/dev/null", "-o", `UserKnownHostsFile=${knownHosts}`, ...args], options);
  const runner = createSshRunner(profile, directory, invoke);
  controlPath = sshInvocation(profile, [], directory).find((value) => value.startsWith("ControlPath=")).slice(12);
  const prompt = "quote ' double \" newline\n$(printf EXPANDED) `printf EXPANDED`; --";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runner("herdr", ["%s", prompt], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    assert.equal(result.stdout, prompt);
  }
  console.log("PASS: real SSH key authentication, host verification, connection reuse, and literal prompt transport");
} finally {
  if (controlPath) await execute("ssh", ["-S", controlPath, "-O", "exit", "127.0.0.1"]).catch(() => {});
  if (daemon && daemon.exitCode === null) { daemon.kill(); await once(daemon, "exit"); }
  await rm(directory, { recursive: true, force: true });
}

import { readConfig } from "./config.mjs";
import { allowedRequestHosts } from "./allowed-hosts.mjs";
import { AgentNotificationMonitor } from "./agent-notifications.mjs";
import { HerdrBridgeClient } from "./herdr-bridge-client.mjs";
import { createHerdrHttpServer } from "./http-server.mjs";
import { loadPasswordAuth } from "./password-auth.mjs";
import { PasskeyAuth } from "./passkey-auth.mjs";
import { loadWebPushService } from "./web-push-service.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SshProfiles } from "./ssh-profiles.mjs";
import { MultiServerClient } from "./multi-server-client.mjs";

const config = readConfig();
const auth = await loadPasswordAuth(config.authFile);
const passkeys = new PasskeyAuth({ auth });
const local = new HerdrBridgeClient({
  binary: config.herdrBin,
  timeoutMs: config.commandTimeoutMs,
});
const push = await loadWebPushService(config.pushFile);
const profiles = await SshProfiles.load(config.sshProfilesFile);
const controlDirectory = await mkdtemp(join(tmpdir(), "herdrabbit-ssh-"));
const herdr = new MultiServerClient({ local, profiles, controlDirectory });
const notificationMonitor = new AgentNotificationMonitor({ herdr, push });
const { server } = createHerdrHttpServer({
  herdr,
  profiles,
  auth,
  passkeys,
  push,
  notificationMonitor,
  allowedHosts: allowedRequestHosts(config.host, {
    extraHosts: config.extraAllowedHosts,
  }),
  maxBodyBytes: config.maxBodyBytes,
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use.`);
  } else {
    console.error("Server failed:", error.message);
  }
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  notificationMonitor.start();
  console.log(`HerdRabbit: http://${config.host}:${config.port}`);
  console.log(`Password authentication: ${auth.required ? "enabled" : "disabled"}`);
  console.log(
    config.host === "0.0.0.0"
      ? "Listening on all IPv4 interfaces. Press Ctrl+C to stop."
      : "Loopback only. Press Ctrl+C to stop.",
  );
});

function shutdown() {
  herdr.stopped = true;
  notificationMonitor.stop();
  server.close((error) => {
    if (error) {
      console.error("Shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

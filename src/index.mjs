import { readConfig } from "./config.mjs";
import { allowedRequestHosts } from "./allowed-hosts.mjs";
import { AgentNotificationMonitor } from "./agent-notifications.mjs";
import { HerdrBridgeClient } from "./herdr-bridge-client.mjs";
import { createHerdrHttpServer } from "./http-server.mjs";
import { loadPasswordAuth } from "./password-auth.mjs";
import { loadWebPushService } from "./web-push-service.mjs";

const config = readConfig();
const auth = await loadPasswordAuth(config.authFile);
const herdr = new HerdrBridgeClient({
  binary: config.herdrBin,
  timeoutMs: config.commandTimeoutMs,
});
const push = await loadWebPushService(config.pushFile);
const notificationMonitor = new AgentNotificationMonitor({ herdr, push });
const { server } = createHerdrHttpServer({
  herdr,
  auth,
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

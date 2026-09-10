import { readConfig } from "./config.mjs";
import { allowedRequestHosts } from "./allowed-hosts.mjs";
import { AgentNotificationMonitor } from "./agent-notifications.mjs";
import { HerdrBridgeClient } from "./herdr-bridge-client.mjs";
import { createHerdrHttpServer } from "./http-server.mjs";
import { loadPasswordAuth } from "./password-auth.mjs";
import { PasskeyAuth } from "./passkey-auth.mjs";
import { loadWebPushService } from "./web-push-service.mjs";
import { mkdtemp } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { ServerProfiles } from "./server-profiles.mjs";
import { PeerIdentity } from "./peer-identity.mjs";
import { leafLinkRoutes } from "./link-server.mjs";
import { readAppVersion } from "./app-version.mjs";
import { createRemoteClientFactory } from "./remote-client-factory.mjs";
import { FileStore } from "./file-store.mjs";
import { RemoteFileService } from "./remote-files.mjs";
import { MultiServerClient } from "./multi-server-client.mjs";

const config = readConfig();
const auth = await loadPasswordAuth(config.authFile);
// A leaf that also had a password would look protected while its real boundary
// is the peer gate, and a session it handed out could not be revoked for seven
// days. Refusing here beats discovering the mismatch later.
if (config.role === "leaf" && auth.required) {
  console.error("A leaf must not have password authentication. Clear it with: npm run password");
  process.exit(1);
}
const peer = config.role === "leaf"
  ? new PeerIdentity({ logins: config.peerLogins, addresses: config.peerAddresses })
  : null;
const passkeys = new PasskeyAuth({ auth });
const local = new HerdrBridgeClient({
  binary: config.herdrBin,
  timeoutMs: config.commandTimeoutMs,
});
const push = await loadWebPushService(config.pushFile);
const profiles = await ServerProfiles.load(config.sshProfilesFile);
const files = await FileStore.load(config.filesDir, { maxBytes: config.maxTransferBytes });
// ssh2 is loaded lazily so a failure to load it cannot stop the app from
// starting; remote file access simply stays unavailable.
const remoteFiles = new RemoteFileService({
  profiles,
  connect: async (options) => {
    const { Client } = (await import("ssh2")).default;
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.on("ready", () => resolve(client));
      client.on("error", reject);
      client.connect(options);
    });
  },
});
const controlDirectory = await mkdtemp(join(tmpdir(), "herdrabbit-ssh-"));
const hubVersion = readAppVersion();
const herdr = new MultiServerClient({
  local, profiles,
  remoteFactory: createRemoteClientFactory({ controlDirectory, hubVersion }),
});
const notificationMonitor = new AgentNotificationMonitor({ herdr, push });
const { server } = createHerdrHttpServer({
  herdr,
  profiles,
  files,
  remoteFiles,
  auth,
  passkeys,
  push,
  notificationMonitor,
  allowedHosts: allowedRequestHosts(config.host, {
    extraHosts: config.extraAllowedHosts,
  }),
  peer,
  // A leaf answers its hub with its own sessions only, so the link routes get
  // the local Herdr client rather than the aggregating one.
  link: peer ? leafLinkRoutes({ client: local, version: hubVersion, serverName: hostname() }) : null,
  maxBodyBytes: config.maxBodyBytes,
  maxTransferBytes: config.maxTransferBytes,
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
  if (peer) console.log(`Leaf mode: only ${config.peerLogins.join(", ") || "the configured device"} may call this server`);
  console.log(
    config.host === "0.0.0.0"
      ? "Listening on all IPv4 interfaces. Press Ctrl+C to stop."
      : "Loopback only. Press Ctrl+C to stop.",
  );
});

function shutdown() {
  herdr.stopped = true;
  notificationMonitor.stop();
  remoteFiles.close();
  server.close((error) => {
    if (error) {
      console.error("Shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

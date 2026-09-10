import { HerdrBridgeClient } from "./herdr-bridge-client.mjs";
import { LeafLinkClient } from "./leaf-link-client.mjs";
import { createSshRunner } from "./ssh-runner.mjs";

// Which transport a server uses is a property of its profile, so the choice
// lives here and nothing above this line has to know there are two.
export function createRemoteClientFactory({ controlDirectory, hubVersion, fetchImpl } = {}) {
  return (profile) => profile.transport === "link"
    ? new LeafLinkClient({ profile, hubVersion, fetchImpl })
    : new HerdrBridgeClient({ runner: createSshRunner(profile, controlDirectory) });
}

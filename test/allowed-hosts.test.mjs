import test from "node:test";
import assert from "node:assert/strict";
import { allowedRequestHosts } from "../src/allowed-hosts.mjs";

test("keeps loopback request hosts for the safe default bind", () => {
  const hosts = allowedRequestHosts("127.0.0.1", {
    interfaces: { eth0: [{ address: "192.168.1.20" }] },
    machineHostname: "workstation",
  });
  assert.equal(hosts.has("localhost"), true);
  assert.equal(hosts.has("192.168.1.20"), false);
  assert.equal(hosts.has("workstation"), false);
});

test("adds explicitly configured reverse-proxy hostnames", () => {
  const hosts = allowedRequestHosts("127.0.0.1", {
    interfaces: {},
    machineHostname: "workstation",
    extraHosts: ["Herdr.tailnet.ts.net"],
  });
  assert.equal(hosts.has("herdr.tailnet.ts.net"), true);
});

test("allows this machine's addresses and names for an all-interface bind", () => {
  const hosts = allowedRequestHosts("0.0.0.0", {
    interfaces: {
      eth0: [{ address: "192.168.1.20" }],
      tailscale0: [{ address: "100.64.1.2" }],
    },
    machineHostname: "Workstation",
  });
  assert.equal(hosts.has("192.168.1.20"), true);
  assert.equal(hosts.has("100.64.1.2"), true);
  assert.equal(hosts.has("workstation"), true);
  assert.equal(hosts.has("workstation.local"), true);
  assert.equal(hosts.has("attacker.example"), false);
});

test("accepts the single address it was bound to", () => {
  // Pinning the service to one interface -- a Tailscale address -- must not
  // make it answer 421 to the requests that arrive on that very address.
  const hosts = allowedRequestHosts("100.101.171.95", {
    interfaces: { eth0: [{ address: "192.168.0.156" }] },
    machineHostname: "gungbuntu",
    extraHosts: ["gungbuntu.tail8d1ab7.ts.net"],
  });

  assert.ok(hosts.has("100.101.171.95"));
  assert.ok(hosts.has("gungbuntu.tail8d1ab7.ts.net"));
  assert.ok(hosts.has("127.0.0.1"), "loopback stays reachable for a local proxy");
  // The other interfaces are not listened on, so they stay off the list.
  assert.ok(!hosts.has("192.168.0.156"));
  assert.ok(!hosts.has("gungbuntu"));
});

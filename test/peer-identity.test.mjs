import test from "node:test";
import assert from "node:assert/strict";
import {
  PEER_ADDRESS_HEADER, PEER_LOGIN_HEADER, PeerIdentity,
  isLoopbackSocket, nearestForwardedAddress, normalizeLogin,
} from "../src/peer-identity.mjs";

const OWNER = "owner@example.com";
const HUB = "100.101.171.95";
const loopback = () => true;

function ask(headers) {
  return { headers, socket: { remoteAddress: "127.0.0.1" } };
}

function gate(options = {}) {
  return new PeerIdentity({ logins: [OWNER], trustedTransport: loopback, ...options });
}

test("does nothing until a peer is configured", () => {
  assert.equal(new PeerIdentity().required, false);
  assert.equal(new PeerIdentity({ logins: [OWNER] }).required, true);
  assert.equal(new PeerIdentity({ addresses: [HUB] }).required, true);
});

test("accepts the configured login whatever case it arrives in", () => {
  const result = gate().authorize(ask({ [PEER_LOGIN_HEADER]: "  Owner@Example.COM  " }));
  assert.deepEqual(result, { login: OWNER });
});

test("a missing identity is unauthenticated, a wrong one is refused", () => {
  // The two are kept apart because they mean different things operationally:
  // nothing at all means Serve is not in front, a mismatch means a wrong account.
  assert.throws(() => gate().authorize(ask({})),
    { code: "peer_identity_required", status: 401 });
  assert.throws(() => gate().authorize(ask({ [PEER_LOGIN_HEADER]: "   " })),
    { code: "peer_identity_required", status: 401 });
  assert.throws(() => gate().authorize(ask({ [PEER_LOGIN_HEADER]: "someone@else" })),
    { code: "peer_identity_rejected", status: 403 });
});

test("a second forged identity header cannot smuggle the real one in", () => {
  // Node folds repeated headers into one comma-joined value, so an attacker
  // who can add a header would otherwise ride along with the genuine value.
  assert.equal(normalizeLogin(`attacker@example, ${OWNER}`), null);
  assert.equal(normalizeLogin([OWNER]), null);
  assert.equal(normalizeLogin(`${OWNER}\u0000`), null, "control characters are not a login");
  for (const forged of [`attacker@example, ${OWNER}`, `${OWNER}, attacker@example`]) {
    assert.throws(() => gate().authorize(ask({ [PEER_LOGIN_HEADER]: forged })),
      { code: "peer_identity_required" });
  }
});

test("the forwarded address is read from the last hop only", () => {
  // Every proxy appends, so anything before the final entry is caller input.
  assert.equal(nearestForwardedAddress(`10.0.0.1, ${HUB}`), HUB);
  assert.equal(nearestForwardedAddress(HUB), HUB);
  assert.equal(nearestForwardedAddress("not-an-address"), null);
  assert.equal(nearestForwardedAddress(""), null);
});

test("pins the device as well as the account when addresses are configured", () => {
  const pinned = gate({ addresses: [HUB] });
  const headers = { [PEER_LOGIN_HEADER]: OWNER };
  assert.deepEqual(
    pinned.authorize(ask({ ...headers, [PEER_ADDRESS_HEADER]: `10.0.0.1, ${HUB}` })),
    { login: OWNER },
  );
  // The owner's own phone carries the same login, so without this the leaf
  // would open to every device the account owns.
  assert.throws(() => pinned.authorize(ask({ ...headers, [PEER_ADDRESS_HEADER]: "100.64.0.9" })),
    { code: "peer_address_rejected", status: 403 });
  assert.throws(() => pinned.authorize(ask(headers)),
    { code: "peer_address_rejected", status: 403 });
  // A forged first hop must not win over the one Serve appended.
  assert.throws(() => pinned.authorize(ask({ ...headers, [PEER_ADDRESS_HEADER]: `${HUB}, 100.64.0.9` })),
    { code: "peer_address_rejected" });
});

test("a correct identity over an untrusted transport is still refused", () => {
  // The headers are only credentials because Serve is the sole way in. Reached
  // any other way they are plain client input, so the transport check decides
  // first and its reason is the one reported.
  const offSocket = new PeerIdentity({ logins: [OWNER], trustedTransport: () => false });
  assert.throws(() => offSocket.authorize(ask({ [PEER_LOGIN_HEADER]: OWNER })),
    { code: "peer_transport_rejected", status: 403 });
  assert.throws(() => offSocket.authorize(ask({})),
    { code: "peer_transport_rejected" });
});

test("recognises the shapes a loopback peer address takes", () => {
  for (const address of ["127.0.0.1", "127.0.0.53", "::1", "::ffff:127.0.0.1"]) {
    assert.ok(isLoopbackSocket({ socket: { remoteAddress: address } }), address);
  }
  for (const address of ["100.101.171.95", "192.168.0.5", "::ffff:10.0.0.1", undefined]) {
    assert.ok(!isLoopbackSocket({ socket: { remoteAddress: address } }), String(address));
  }
});

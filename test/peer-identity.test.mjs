import test from "node:test";
import assert from "node:assert/strict";
import {
  PEER_ADDRESS_HEADER, PEER_LOGIN_HEADER, PeerIdentity,
  isLoopbackSocket, nearestForwardedAddress, normalizeLogin, socketAddress,
} from "../src/peer-identity.mjs";

const OWNER = "owner@example.com";
const HUB = "100.101.171.95";
// Behind Tailscale Serve the socket is loopback and the identity is in headers.
function forwarded(headers) {
  return { headers, socket: { remoteAddress: "127.0.0.1" } };
}

// Bound to its own tailnet address, the leaf reads the caller off the socket.
function direct(remoteAddress, headers = {}) {
  return { headers, socket: { remoteAddress } };
}

function gate(options = {}) {
  return new PeerIdentity({ logins: [OWNER], ...options });
}

test("does nothing until a peer is configured", () => {
  assert.equal(new PeerIdentity().required, false);
  assert.equal(new PeerIdentity({ logins: [OWNER] }).required, true);
  assert.equal(new PeerIdentity({ addresses: [HUB] }).required, true);
});

test("accepts the configured login whatever case it arrives in", () => {
  const result = gate().authorize(forwarded({ [PEER_LOGIN_HEADER]: "  Owner@Example.COM  " }));
  assert.deepEqual(result, { address: null, login: OWNER });
});

test("a missing identity is unauthenticated, a wrong one is refused", () => {
  // The two are kept apart because they mean different things operationally:
  // nothing at all means Serve is not in front, a mismatch means a wrong account.
  assert.throws(() => gate().authorize(forwarded({})),
    { code: "peer_identity_required", status: 401 });
  assert.throws(() => gate().authorize(forwarded({ [PEER_LOGIN_HEADER]: "   " })),
    { code: "peer_identity_required", status: 401 });
  assert.throws(() => gate().authorize(forwarded({ [PEER_LOGIN_HEADER]: "someone@else" })),
    { code: "peer_identity_rejected", status: 403 });
});

test("a second forged identity header cannot smuggle the real one in", () => {
  // Node folds repeated headers into one comma-joined value, so an attacker
  // who can add a header would otherwise ride along with the genuine value.
  assert.equal(normalizeLogin(`attacker@example, ${OWNER}`), null);
  assert.equal(normalizeLogin([OWNER]), null);
  assert.equal(normalizeLogin(`${OWNER}\u0000`), null, "control characters are not a login");
  for (const forged of [`attacker@example, ${OWNER}`, `${OWNER}, attacker@example`]) {
    assert.throws(() => gate().authorize(forwarded({ [PEER_LOGIN_HEADER]: forged })),
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
    pinned.authorize(forwarded({ ...headers, [PEER_ADDRESS_HEADER]: `10.0.0.1, ${HUB}` })),
    { address: HUB, login: OWNER },
  );
  // The owner's own phone carries the same login, so without this the leaf
  // would open to every device the account owns.
  assert.throws(() => pinned.authorize(forwarded({ ...headers, [PEER_ADDRESS_HEADER]: "100.64.0.9" })),
    { code: "peer_address_rejected", status: 403 });
  assert.throws(() => pinned.authorize(forwarded(headers)),
    { code: "peer_address_rejected", status: 403 });
  // A forged first hop must not win over the one Serve appended.
  assert.throws(() => pinned.authorize(forwarded({ ...headers, [PEER_ADDRESS_HEADER]: `${HUB}, 100.64.0.9` })),
    { code: "peer_address_rejected" });
});

test("a request off the socket is judged by the socket, never by its headers", () => {
  // This is the whole point of the direct path: the source address is set by
  // the kernel from a WireGuard-authenticated peer, so a header claiming to be
  // the hub proves nothing and must not be consulted.
  const pinned = gate({ addresses: [HUB] });
  assert.deepEqual(pinned.authorize(direct(HUB)), { address: HUB, login: null });
  assert.deepEqual(
    pinned.authorize(direct(HUB, { [PEER_LOGIN_HEADER]: "someone@else" })),
    { address: HUB, login: null },
    "a header cannot take away what the socket proved",
  );
  assert.throws(
    () => pinned.authorize(direct("100.64.0.9", { [PEER_LOGIN_HEADER]: OWNER })),
    { code: "peer_address_rejected", status: 403 },
    "nor can a header stand in for the wrong address",
  );
});

test("a leaf with no address list cannot accept a direct connection", () => {
  // There is nothing to check the socket against and no login to read off it.
  assert.throws(() => gate().authorize(direct(HUB, { [PEER_LOGIN_HEADER]: OWNER })),
    { code: "peer_address_rejected" });
});

test("refuses a request whose source cannot be read at all", () => {
  assert.throws(() => gate({ addresses: [HUB] }).authorize({ headers: {}, socket: {} }),
    { code: "peer_transport_rejected", status: 403 });
});

test("reads the shapes a peer address arrives in", () => {
  assert.equal(socketAddress({ socket: { remoteAddress: "::ffff:100.101.171.95" } }), "100.101.171.95");
  assert.equal(socketAddress({ socket: {} }), null);
  for (const address of ["127.0.0.1", "127.0.0.53", "::1", "::ffff:127.0.0.1"]) {
    assert.ok(isLoopbackSocket({ socket: { remoteAddress: address } }), address);
  }
  for (const address of ["100.101.171.95", "192.168.0.5", "::ffff:10.0.0.1", undefined]) {
    assert.ok(!isLoopbackSocket({ socket: { remoteAddress: address } }), String(address));
  }
});


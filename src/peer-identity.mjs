// A leaf accepts requests from its hub and from nothing else. The proof is not
// a secret: Tailscale Serve stamps the caller's tailnet identity onto every
// request it forwards, and strips those headers from public (Funnel) traffic.
//
// That makes the headers trustworthy only while Serve is the sole thing that
// can reach the socket, which is why the transport check below is not a
// formality. Bind anywhere but loopback and these headers become client input.

const LOGIN_HEADER = "tailscale-user-login";
const FORWARDED_FOR_HEADER = "x-forwarded-for";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export { LOGIN_HEADER as PEER_LOGIN_HEADER, FORWARDED_FOR_HEADER as PEER_ADDRESS_HEADER };

export class PeerRejected extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PeerRejected";
    this.status = status;
    this.code = code;
  }
}

// Node folds repeated headers into one comma-joined value, so a forged second
// Tailscale-User-Login arrives as "attacker@example, owner@example". There is
// no legitimate comma in a login, so any comma means someone sent a second
// header and the value cannot be trusted at all.
export function normalizeLogin(value) {
  if (typeof value !== "string") return null;
  if (value.includes(",") || CONTROL_CHARACTERS.test(value)) return null;
  const login = value.trim().toLowerCase();
  return login === "" ? null : login;
}

// X-Forwarded-For is the opposite case: each proxy appends, so commas are
// expected and only the last entry was written by the proxy nearest to us.
// Anything earlier is whatever the caller chose to send.
export function nearestForwardedAddress(value) {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return null;
  const hops = value.split(",").map((hop) => hop.trim()).filter(Boolean);
  if (hops.length === 0) return null;
  const address = hops[hops.length - 1].toLowerCase();
  // Serve hands us a bare address, never a port, so anything else is unexpected.
  return /^[0-9a-f.:]+$/u.test(address) ? address : null;
}

export function isLoopbackSocket(request) {
  const address = request?.socket?.remoteAddress;
  if (typeof address !== "string") return false;
  const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
  return bare === "::1" || bare.startsWith("127.");
}

export class PeerIdentity {
  constructor({ logins = [], addresses = [], trustedTransport = isLoopbackSocket } = {}) {
    this.logins = new Set(logins.map((login) => String(login).trim().toLowerCase()).filter(Boolean));
    this.addresses = new Set(addresses.map((address) => String(address).trim().toLowerCase()).filter(Boolean));
    this.trustedTransport = trustedTransport;
  }

  get required() {
    return this.logins.size > 0 || this.addresses.size > 0;
  }

  // Transport first, so a request that reached us the wrong way always fails
  // for that reason rather than for whichever header happens to be missing.
  authorize(request) {
    if (!this.trustedTransport(request)) {
      throw new PeerRejected(403, "peer_transport_rejected",
        "This server only accepts requests forwarded from its own machine.");
    }

    const login = normalizeLogin(request?.headers?.[LOGIN_HEADER]);
    if (login === null) {
      throw new PeerRejected(401, "peer_identity_required",
        "This server only accepts requests from its hub.");
    }
    if (this.logins.size > 0 && !this.logins.has(login)) {
      throw new PeerRejected(403, "peer_identity_rejected",
        "This server does not accept requests from that account.");
    }

    if (this.addresses.size > 0) {
      const address = nearestForwardedAddress(request?.headers?.[FORWARDED_FOR_HEADER]);
      if (address === null || !this.addresses.has(address)) {
        throw new PeerRejected(403, "peer_address_rejected",
          "This server does not accept requests from that device.");
      }
    }

    return { login };
  }
}

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

export function socketAddress(request) {
  const address = request?.socket?.remoteAddress;
  if (typeof address !== "string" || address === "") return null;
  const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
  return bare.toLowerCase();
}

export function isLoopbackAddress(address) {
  return address === "::1" || (typeof address === "string" && address.startsWith("127."));
}

export function isLoopbackSocket(request) {
  return isLoopbackAddress(socketAddress(request));
}

// Two ways a leaf can know who is calling, and the socket decides which one is
// in play -- never the configuration, and never the caller.
//
//   direct    the leaf listens on its own tailnet address, so the source
//             address is set by the kernel from a WireGuard-authenticated
//             peer. Headers are ignored here: on this path they are ordinary
//             client input and nothing more.
//   forwarded the leaf listens on loopback behind Tailscale Serve, which
//             stamps the caller's identity on. Only trustworthy because
//             nothing but Serve can reach that socket.
//
// Direct is the stronger of the two: a process on the leaf cannot claim the
// hub's tailnet address the way it can write a header.
export class PeerIdentity {
  constructor({ logins = [], addresses = [], socketOf = socketAddress } = {}) {
    this.logins = new Set(logins.map((login) => String(login).trim().toLowerCase()).filter(Boolean));
    this.addresses = new Set(addresses.map((address) => String(address).trim().toLowerCase()).filter(Boolean));
    this.socketOf = socketOf;
  }

  get required() {
    return this.logins.size > 0 || this.addresses.size > 0;
  }

  authorize(request) {
    const from = this.socketOf(request);
    if (from === null) {
      throw new PeerRejected(403, "peer_transport_rejected",
        "This server could not tell where that request came from.");
    }
    return isLoopbackAddress(from) ? this.#forwarded(request) : this.#direct(from);
  }

  #direct(from) {
    // Without an address list there is nothing to check a socket against, and
    // a login cannot be read off one.
    if (this.addresses.size === 0 || !this.addresses.has(from)) {
      throw new PeerRejected(403, "peer_address_rejected",
        "This server does not accept requests from that device.");
    }
    return { address: from, login: null };
  }

  #forwarded(request) {
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
      return { address, login };
    }
    return { address: null, login };
  }
}

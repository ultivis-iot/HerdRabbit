// A leaf knows its hub -- that is what it was installed with -- so it can say
// where it is instead of waiting to be found. This matters when a machine runs
// more than one HerdRabbit, one per account: they share a tailnet address and
// differ only by port, and probing cannot guess a port.
//
// An announcement is not authority. It puts a row in a dialog; adding the
// server is still a person choosing it, and the choice still probes the address
// itself. So the guards here are about keeping the list small and honest, not
// about trusting what it says.

const MAX_ANNOUNCEMENTS = 32;
const LIFETIME_MS = 15 * 60 * 1000;

export function announcementRegistry({ now = () => Date.now(), lifetimeMs = LIFETIME_MS } = {}) {
  const entries = new Map();

  const sweep = () => {
    const cutoff = now() - lifetimeMs;
    for (const [address, entry] of entries) if (entry.at <= cutoff) entries.delete(address);
  };

  return {
    // `from` is the address the request actually arrived from. A machine may
    // announce itself and nothing else, which is the whole check: without it
    // one leaf could fill the dialog with rows pointing anywhere.
    record({ from, name, address, version, protocol }) {
      sweep();
      let parsed;
      try {
        parsed = new URL(address);
      } catch {
        return { ok: false, reason: "address" };
      }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.hostname !== from) {
        return { ok: false, reason: "address" };
      }
      if (typeof name !== "string" || name === "" || name.length > 80) {
        return { ok: false, reason: "name" };
      }
      if (!entries.has(parsed.origin) && entries.size >= MAX_ANNOUNCEMENTS) {
        return { ok: false, reason: "full" };
      }
      entries.set(parsed.origin, {
        name: name.trim(),
        address: parsed.origin,
        version: typeof version === "string" ? version : null,
        protocol: Number.isInteger(protocol) ? protocol : null,
        at: now(),
      });
      return { ok: true };
    },

    list() {
      sweep();
      return [...entries.values()].map(({ at, ...entry }) => ({ ...entry }));
    },

    get size() {
      sweep();
      return entries.size;
    },
  };
}

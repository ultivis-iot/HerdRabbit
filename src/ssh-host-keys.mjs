import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// OpenSSH stores a non-default port as [host]:port, and a HostKeyAlias or a
// resolved HostName rather than the alias typed into the profile.
export function knownHostsTarget({ hostkeyalias, hostname, host, port }) {
  const name = hostkeyalias || hostname || host;
  const numeric = Number(port);
  return Number.isInteger(numeric) && numeric !== 22 ? `[${name}]:${numeric}` : name;
}

// ssh-keygen -F prints the matching lines, hashed entries included. Markers sit
// in front of the host pattern: @revoked means "never trust this key" and
// @cert-authority holds a CA key that is not the host key at all.
export function parseKnownHostLines(output) {
  const accepted = [];
  const revoked = [];
  for (const line of String(output).split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;
    const fields = text.split(/\s+/u);
    const marker = fields[0].startsWith("@") ? fields.shift() : null;
    const blob = fields[2];
    if (!blob) continue;
    if (marker === "@cert-authority") continue;
    let key;
    try {
      key = Buffer.from(blob, "base64");
    } catch {
      continue;
    }
    if (key.length === 0) continue;
    (marker === "@revoked" ? revoked : accepted).push(key);
  }
  return { accepted, revoked };
}

export async function lookupKnownHostKeys(target, files, execute = run) {
  const accepted = [];
  const revoked = [];
  for (const file of files) {
    let output = "";
    try {
      ({ stdout: output } = await execute("ssh-keygen", ["-F", target, "-f", file]));
    } catch (error) {
      // Exit status is 0 or 1 depending on the build when nothing matches, so
      // the parsed lines are the only signal worth trusting.
      output = error?.stdout || "";
    }
    const found = parseKnownHostLines(output);
    accepted.push(...found.accepted);
    revoked.push(...found.revoked);
  }
  return { accepted, revoked };
}

export const HOST_KEY_REJECTED =
  "SSH host key is unknown or changed. Verify this host from the service account's terminal first.";

// ssh2 decides from the return value: anything other than undefined is used as
// the verdict, and only an explicit false rejects. An async function therefore
// returns a promise that reads as "accepted" and disables the check entirely.
// This must stay a plain function that returns nothing and answers on the
// callback, with every failure path reaching callback(false).
export function createHostVerifier({ target, files, execute = run, onReject = () => {} }) {
  return function hostVerifier(key, callback) {
    lookupKnownHostKeys(target, files, execute)
      .then(({ accepted, revoked }) => {
        if (revoked.some((known) => known.equals(key))) {
          onReject("revoked");
          callback(false);
          return;
        }
        const trusted = accepted.some((known) => known.equals(key));
        if (!trusted) onReject("unknown");
        callback(trusted);
      })
      .catch(() => {
        onReject("lookup_failed");
        callback(false);
      });
  };
}

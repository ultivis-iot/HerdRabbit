import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const MAX_ENTRIES = 128;
const MAX_BYTES = 8 * 1024 * 1024;

function revisionFor(paneId, window) {
  return createHash("sha256")
    .update(paneId)
    .update("\0")
    .update(String(window.requestedLines))
    .update("\0")
    .update(String(window.hasMore))
    .update("\0")
    .update(window.output)
    .digest("base64url")
    .slice(0, 32);
}

function replacementPatch(previous, current) {
  const sharedLimit = Math.min(previous.length, current.length);
  let prefixLength = 0;
  while (
    prefixLength < sharedLimit &&
    previous.charCodeAt(prefixLength) === current.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < sharedLimit - prefixLength &&
    previous.charCodeAt(previous.length - suffixLength - 1) ===
      current.charCodeAt(current.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  return {
    start: prefixLength,
    deleteCount: previous.length - prefixLength - suffixLength,
    text: current.slice(prefixLength, current.length - suffixLength),
  };
}

function suffixPrefixOverlap(previous, current) {
  if (previous.length === 0 || current.length === 0) return 0;
  const prefixTable = new Uint32Array(current.length);
  for (let index = 1, matched = 0; index < current.length; index += 1) {
    while (
      matched > 0 &&
      current.charCodeAt(index) !== current.charCodeAt(matched)
    ) {
      matched = prefixTable[matched - 1];
    }
    if (current.charCodeAt(index) === current.charCodeAt(matched)) matched += 1;
    prefixTable[index] = matched;
  }

  let overlap = 0;
  for (let index = 0; index < previous.length; index += 1) {
    while (
      overlap > 0 &&
      previous.charCodeAt(index) !== current.charCodeAt(overlap)
    ) {
      overlap = prefixTable[overlap - 1];
    }
    if (previous.charCodeAt(index) === current.charCodeAt(overlap)) overlap += 1;
    if (overlap === current.length && index < previous.length - 1) {
      overlap = prefixTable[overlap - 1];
    }
  }
  return overlap;
}

function patchesFor(previous, current) {
  const replacement = [replacementPatch(previous, current)];
  const overlap = suffixPrefixOverlap(previous, current);
  const removedPrefixLength = previous.length - overlap;
  if (
    removedPrefixLength === 0 ||
    overlap < Math.ceil(Math.min(previous.length, current.length) / 2)
  ) {
    return replacement;
  }
  return [
    { start: previous.length, deleteCount: 0, text: current.slice(overlap) },
    { start: 0, deleteCount: removedPrefixLength, text: "" },
  ];
}

export class OutputRevisions {
  #entries = new Map();
  #bytes = 0;

  #remember(entry) {
    const existing = this.#entries.get(entry.revision);
    if (existing) {
      this.#bytes -= existing.bytes;
      this.#entries.delete(entry.revision);
    }
    this.#entries.set(entry.revision, entry);
    this.#bytes += entry.bytes;
    while (this.#entries.size > MAX_ENTRIES || this.#bytes > MAX_BYTES) {
      const oldestRevision = this.#entries.keys().next().value;
      const oldest = this.#entries.get(oldestRevision);
      this.#entries.delete(oldestRevision);
      this.#bytes -= oldest.bytes;
    }
  }

  update({ paneId, window, since = null }) {
    const previous = since ? this.#entries.get(since) : null;
    const revision = revisionFor(paneId, window);
    this.#remember({
      paneId,
      lines: window.requestedLines,
      revision,
      output: window.output,
      bytes: Buffer.byteLength(window.output),
    });

    if (since === revision) return null;
    if (
      previous &&
      previous.paneId === paneId &&
      previous.lines === window.requestedLines
    ) {
      const { output, ...metadata } = window;
      return {
        ...metadata,
        update: "delta",
        revision,
        patches: patchesFor(previous.output, output),
      };
    }
    return { ...window, update: "replace", revision };
  }
}

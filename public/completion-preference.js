const STORAGE_KEY = "herdrBridge.acknowledgedCompletions.v1";
const MAX_ENTRIES = 256;

function isValidEntry([paneId, identity]) {
  return typeof paneId === "string" &&
    paneId.length > 0 &&
    paneId.length <= 256 &&
    typeof identity === "string" &&
    /^(seq|revision):[0-9]+$/.test(identity);
}

export function readAcknowledgedCompletions(storage) {
  if (!storage) return new Map();
  try {
    const entries = Object.entries(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"))
      .filter(isValidEntry)
      .slice(-MAX_ENTRIES);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function writeAcknowledgedCompletions(storage, completions) {
  if (!storage) return;
  try {
    const entries = [...completions.entries()]
      .filter(isValidEntry)
      .slice(-MAX_ENTRIES);
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

export { STORAGE_KEY as ACKNOWLEDGED_COMPLETIONS_STORAGE_KEY };

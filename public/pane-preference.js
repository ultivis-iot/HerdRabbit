export const PANE_PREFERENCE_STORAGE_KEY = "herdrbridge-selected-pane";

const MAX_PANE_ID_LENGTH = 512;

function validPaneId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PANE_ID_LENGTH
  );
}

export function readPanePreference(storage) {
  try {
    const value = storage?.getItem(PANE_PREFERENCE_STORAGE_KEY);
    return validPaneId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writePanePreference(storage, paneId) {
  if (!validPaneId(paneId)) return false;
  try {
    storage?.setItem(PANE_PREFERENCE_STORAGE_KEY, paneId);
    return storage != null;
  } catch {
    return false;
  }
}

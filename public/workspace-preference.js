export const COLLAPSED_WORKSPACES_STORAGE_KEY =
  "herdrbridge-collapsed-workspaces";

const WORKSPACE_ID_PATTERN = /^w[0-9]+$/;
const MAX_STORED_WORKSPACES = 500;

function normalizedWorkspaceIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(
    (value) => typeof value === "string" && WORKSPACE_ID_PATTERN.test(value),
  ))].slice(0, MAX_STORED_WORKSPACES);
}

export function readCollapsedWorkspaceIds(storage) {
  try {
    const value = storage?.getItem(COLLAPSED_WORKSPACES_STORAGE_KEY);
    return new Set(normalizedWorkspaceIds(JSON.parse(value || "[]")));
  } catch {
    return new Set();
  }
}

export function writeCollapsedWorkspaceIds(storage, workspaceIds) {
  try {
    if (!storage) return false;
    storage.setItem(
      COLLAPSED_WORKSPACES_STORAGE_KEY,
      JSON.stringify(normalizedWorkspaceIds([...workspaceIds])),
    );
    return true;
  } catch {
    return false;
  }
}

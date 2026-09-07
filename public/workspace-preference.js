export const COLLAPSED_WORKSPACES_STORAGE_KEY =
  "herdrbridge-collapsed-workspaces";

const WORKSPACE_ID_PATTERN = /^(?:ssh_[a-f0-9-]{36}!)?(?:hs_[A-Za-z0-9_-]+~)?w[A-Za-z0-9]+$/;
const MAX_STORED_WORKSPACES = 500;

function normalizedWorkspaceIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(
    (value) => typeof value === "string" && value.length <= 512 &&
      !/[\u0000-\u001f\u007f]/u.test(value) && WORKSPACE_ID_PATTERN.test(value),
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

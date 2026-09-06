const STORAGE_KEY = "herdr-bridge:launch-token";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+$/;

function normalizedToken(value) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !TOKEN_PATTERN.test(value)
  ) return "";
  return value;
}

export function readLaunchToken(storage) {
  try {
    return normalizedToken(storage?.getItem(STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writeLaunchToken(storage, value) {
  const token = normalizedToken(value);
  try {
    if (token) storage?.setItem(STORAGE_KEY, token);
    else storage?.removeItem(STORAGE_KEY);
  } catch {}
  return token;
}

export function clearLaunchToken(storage) {
  return writeLaunchToken(storage, "");
}

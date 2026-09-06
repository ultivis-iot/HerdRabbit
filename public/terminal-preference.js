export const TERMINAL_FONT_SIZE_STORAGE_KEY =
  "herdrbridge-terminal-font-size";
export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 18;

function normalizedFontSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, size));
}

export function readTerminalFontSize(storage) {
  try {
    const stored = storage?.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY);
    return stored === null
      ? DEFAULT_TERMINAL_FONT_SIZE
      : normalizedFontSize(stored);
  } catch {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

export function writeTerminalFontSize(storage, fontSize) {
  try {
    if (!storage) return false;
    storage.setItem(
      TERMINAL_FONT_SIZE_STORAGE_KEY,
      String(normalizedFontSize(fontSize)),
    );
    return true;
  } catch {
    return false;
  }
}

export function adjustedTerminalFontSize(fontSize, direction) {
  const current = normalizedFontSize(fontSize);
  if (direction === "smaller") {
    return Math.max(MIN_TERMINAL_FONT_SIZE, current - 1);
  }
  if (direction === "larger") {
    return Math.min(MAX_TERMINAL_FONT_SIZE, current + 1);
  }
  return current;
}

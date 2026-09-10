export const KEY_MODIFIERS = Object.freeze(["ctrl", "alt", "shift", "meta", "super", "hyper"]);
export const TERMINAL_KEYS = Object.freeze([
  "esc", "tab", "enter", "backspace", "delete", "insert", "space",
  "home", "end", "pageup", "pagedown", "up", "down", "left", "right",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);
// Validate the wire format, not whether Herdr or the receiving application
// supports the key. Unknown key names and printable symbols are forwarded.
export function isTerminalKey(key) {
  return typeof key === "string" && key.length > 0 && key.length <= 80 &&
    !key.startsWith("--") &&
    /^(?:(?:ctrl|alt|shift|meta|super|hyper)\+)*[^+\s\x00-\x1f\x7f]+$/u.test(key);
}

export function combinedTerminalKey(key, modifiers = []) {
  const result = [...KEY_MODIFIERS.filter((part) => modifiers.includes(part)), key].join("+");
  return isTerminalKey(result) ? result : null;
}

// Ctrl+Enter is this app's "new line, do not send" everywhere else, but a
// terminal has no such key: it goes out as xterm's CSI 27;5;13~, which almost
// nothing reads, so the keystroke lands as silence. ESC CR is what terminals
// send for Shift+Enter once an agent has set them up, and it is the sequence
// those agents actually treat as a line break -- measured against a live
// Claude pane, where ctrl+enter did nothing and alt+enter broke the line.
function newlineForTerminal(key, modifiers) {
  if (key !== "enter" || !modifiers.includes("ctrl")) return null;
  const rest = modifiers.filter((part) => part !== "ctrl");
  // Only the plain chord is redirected; Ctrl+Shift+Enter and friends stay
  // themselves, because they mean something else to whoever bound them.
  return rest.length === 0 ? combinedTerminalKey(key, ["alt"]) : null;
}

export function keyboardTerminalKey(event, selectedModifiers = []) {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return null;
  if (["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Process", "Unidentified"].includes(event.key)) return null;
  const aliases = { "+": "plus", Escape: "esc", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", " ": "space" };
  const key = aliases[event.key] || event.key?.toLowerCase();
  const modifiers = [...selectedModifiers];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  return newlineForTerminal(key, modifiers) ?? combinedTerminalKey(key, modifiers);
}

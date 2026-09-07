export const INPUT_HISTORY_STORAGE_KEY = "herdrbridge-input-history";

const MAX_PANE_ID_LENGTH = 512;
const MAX_PROMPT_LENGTH = 8_000;
const MAX_PROMPTS_PER_PANE = 100;
const MAX_STORED_PANES = 100;

function validPaneId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PANE_ID_LENGTH;
}

function normalizedPrompts(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((prompt) =>
    typeof prompt === "string" &&
    prompt.length > 0 &&
    prompt.length <= MAX_PROMPT_LENGTH
  ).slice(-MAX_PROMPTS_PER_PANE);
}

function normalizedEntries(histories) {
  const entries = histories instanceof Map
    ? [...histories.entries()]
    : Object.entries(histories || {});
  return entries.filter(([paneId]) => validPaneId(paneId))
    .map(([paneId, prompts]) => [paneId, normalizedPrompts(prompts)])
    .filter(([, prompts]) => prompts.length > 0)
    .slice(-MAX_STORED_PANES);
}

export function readInputHistories(storage) {
  try {
    const value = JSON.parse(storage?.getItem(INPUT_HISTORY_STORAGE_KEY) || "{}");
    return new Map(normalizedEntries(value));
  } catch {
    return new Map();
  }
}

export function writeInputHistories(storage, histories) {
  try {
    if (!storage) return false;
    storage.setItem(
      INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(normalizedEntries(histories))),
    );
    return true;
  } catch {
    return false;
  }
}

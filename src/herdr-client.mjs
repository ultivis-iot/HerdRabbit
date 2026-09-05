import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PANE_ID_PATTERN = /^w[0-9]+:p[0-9]+$/;
const WORKSPACE_ID_PATTERN = /^w[0-9]+$/;
const MAX_TEXT_LENGTH = 8_000;
const MAX_WORKSPACE_LABEL_LENGTH = 120;
export const MAX_PANE_READ_LINES = 100_001;

export const ALLOWED_KEYS = Object.freeze([
  "enter",
  "esc",
  "tab",
  "shift+tab",
  "backspace",
  "left",
  "right",
  "up",
  "down",
  "ctrl+c",
]);

const allowedKeySet = new Set(ALLOWED_KEYS);

export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}

export class HerdrCommandError extends Error {
  constructor(message, { code = "herdr_command_failed", cause } = {}) {
    super(message, { cause });
    this.name = "HerdrCommandError";
    this.code = code;
  }
}

function validatePaneId(paneId) {
  if (typeof paneId !== "string" || !PANE_ID_PATTERN.test(paneId)) {
    throw new InputValidationError("Invalid pane id");
  }

  return paneId;
}

function validateWorkspaceId(workspaceId) {
  if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new InputValidationError("Invalid workspace id");
  }
  return workspaceId;
}

function validateWorkspaceLabel(label) {
  if (typeof label !== "string") {
    throw new InputValidationError("Workspace name must be text");
  }
  const value = label.trim();
  if (value.length === 0) {
    throw new InputValidationError("Workspace name must not be empty");
  }
  if (value.length > MAX_WORKSPACE_LABEL_LENGTH) {
    throw new InputValidationError(
      `Workspace name must be at most ${MAX_WORKSPACE_LABEL_LENGTH} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InputValidationError("Workspace name must not contain control characters");
  }
  return value;
}

function validateText(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new InputValidationError("Text must not be empty");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new InputValidationError(`Text must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  if (text.includes("\0")) {
    throw new InputValidationError("Text must not contain null bytes");
  }

  return text;
}

function validateLines(lines) {
  const value = Number(lines);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PANE_READ_LINES) {
    throw new InputValidationError(`Lines must be between 1 and ${MAX_PANE_READ_LINES}`);
  }

  return value;
}

function validateReadFormat(format) {
  if (format !== "text" && format !== "ansi") {
    throw new InputValidationError("Read format must be text or ansi");
  }
  return format;
}

function validateKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 8) {
    throw new InputValidationError("Provide between 1 and 8 keys");
  }

  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeySet.has(key)) {
      throw new InputValidationError("Unsupported key");
    }
  }

  return keys;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HerdrCommandError("Herdr returned invalid JSON", {
      code: "invalid_herdr_response",
      cause: error,
    });
  }
}

function unwrapResult(payload) {
  return payload && typeof payload === "object" && "result" in payload
    ? payload.result
    : payload;
}

function publicCommandError(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  if (stderr) {
    try {
      const payload = JSON.parse(stderr);
      const detail = payload?.error;
      if (detail && typeof detail === "object") {
        const code = typeof detail.code === "string" ? detail.code : "herdr_command_failed";
        const message =
          typeof detail.message === "string" && detail.message.length <= 300
            ? detail.message
            : "Herdr command failed";
        return new HerdrCommandError(message, { code, cause: error });
      }
    } catch {
      // Herdr sometimes prints human-readable CLI errors. Do not reflect them to the browser.
    }
  }

  if (error?.killed || error?.signal === "SIGTERM") {
    return new HerdrCommandError("Herdr command timed out", {
      code: "herdr_timeout",
      cause: error,
    });
  }

  return new HerdrCommandError("Herdr command failed", { cause: error });
}

export class HerdrClient {
  constructor({
    binary = "herdr",
    timeoutMs = 5_000,
    runner = execFileAsync,
  } = {}) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.runner = runner;
  }

  async #run(args, { json = true } = {}) {
    try {
      const { stdout } = await this.runner(this.binary, args, {
        encoding: "utf8",
        timeout: this.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
        windowsHide: true,
      });

      return json ? unwrapResult(parseJson(stdout)) : stdout;
    } catch (error) {
      if (error instanceof HerdrCommandError) {
        throw error;
      }
      throw publicCommandError(error);
    }
  }

  async snapshot() {
    const result = await this.#run(["api", "snapshot"]);
    return result?.snapshot ?? result;
  }

  async listAgents() {
    const result = await this.#run(["agent", "list"]);
    return result?.agents ?? result;
  }

  async renameWorkspace(workspaceId, label) {
    const safeWorkspaceId = validateWorkspaceId(workspaceId);
    const safeLabel = validateWorkspaceLabel(label);
    return this.#run(["workspace", "rename", safeWorkspaceId, safeLabel]);
  }

  async readPane(paneId, { lines = 160, format = "ansi" } = {}) {
    const safePaneId = validatePaneId(paneId);
    const safeLines = validateLines(lines);
    const safeFormat = validateReadFormat(format);
    return this.#run(
      [
        "pane",
        "read",
        safePaneId,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(safeLines),
        "--format",
        safeFormat,
      ],
      { json: false },
    );
  }

  async sendText(paneId, text, { submit = false } = {}) {
    const safePaneId = validatePaneId(paneId);
    const safeText = validateText(text);
    if (submit) {
      return this.#run(["pane", "run", safePaneId, safeText], {
        json: false,
      });
    }
    return this.#run(["pane", "send-text", safePaneId, "--", safeText]);
  }

  async sendKeys(paneId, keys) {
    const safePaneId = validatePaneId(paneId);
    const safeKeys = validateKeys(keys);
    return this.#run(["pane", "send-keys", safePaneId, ...safeKeys], {
      json: false,
    });
  }
}

export const validation = Object.freeze({
  validatePaneId,
  validateWorkspaceId,
  validateWorkspaceLabel,
  validateText,
  validateLines,
  validateReadFormat,
  validateKeys,
});

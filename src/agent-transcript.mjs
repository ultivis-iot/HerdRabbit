import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const DEFAULT_MAX_ROWS = 4_000;
// Only the end of a session log is ever shown, and a long-running session runs
// to tens of megabytes. Reading the tail keeps both the parse and the read
// bounded; the partial line it starts with fails to parse and is dropped.
const DEFAULT_TAIL_BYTES = 4 * 1024 * 1024;

/**
 * Claude Code stores one JSONL file per session under a directory named after
 * the working directory, with every separator flattened to a dash.
 */
export function projectDirectoryName(cwd) {
  if (typeof cwd !== "string" || cwd === "") return "";
  return cwd.replaceAll(sep, "-").replaceAll(".", "-");
}

export function defaultProjectsRoot(environment = process.env) {
  if (environment.HERDR_WEB_AGENT_LOG_ROOT) {
    return resolve(environment.HERDR_WEB_AGENT_LOG_ROOT);
  }
  return join(environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

function textOf(block) {
  return typeof block?.text === "string" ? block.text : "";
}

function toolSummary(block) {
  const name = typeof block?.name === "string" ? block.name : "tool";
  const input = block?.input;
  if (input && typeof input === "object") {
    for (const key of ["description", "command", "file_path", "path", "pattern", "prompt"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim() !== "") {
        const flat = value.replaceAll("\n", " ").trim();
        return `${name}(${flat.length > 70 ? `${flat.slice(0, 70)}…` : flat})`;
      }
    }
  }
  return `${name}()`;
}

/**
 * Render one transcript entry the way Claude Code prints it: the prompt with a
 * chevron, answers and tool calls with a bullet. Thinking blocks and tool
 * results stay out, matching a screen where they are collapsed.
 */
export function transcriptRows(entry) {
  if (!entry || entry.isSidechain === true) return [];
  const message = entry.message;
  const content = message?.content;

  if (entry.type === "user" && message?.role === "user") {
    if (typeof content !== "string") return [];
    const text = content.trim();
    if (text === "") return [];
    return ["", ...text.split("\n").map((line) => `> ${line}`)];
  }

  if (entry.type !== "assistant" || !Array.isArray(content)) return [];
  const rows = [];
  for (const block of content) {
    if (block?.type === "text") {
      const text = textOf(block).trim();
      if (text === "") continue;
      const [first, ...rest] = text.split("\n");
      rows.push("", `⏺ ${first}`, ...rest.map((line) => `  ${line}`));
    } else if (block?.type === "tool_use") {
      rows.push("", `⏺ ${toolSummary(block)}`);
    }
  }
  return rows;
}

const MIN_ANCHOR_LENGTH = 24;
// How many anchors from the end of the transcript are checked before deciding
// the screen is not showing the present. A few is enough: an answer still being
// streamed has not reached the log yet.
const LATEST_ANCHORS_CHECKED = 5;

function anchorMatches(row, currentRows, comparable) {
  return currentRows.some((candidate) => {
    const target = comparable(candidate).trim();
    return target.length >= MIN_ANCHOR_LENGTH &&
      (target.includes(row) || row.includes(target));
  });
}

/**
 * Whether the screen is showing the end of the conversation.
 *
 * Claude scrolls inside its own alternate screen, which Herdr cannot see: the
 * pane reports no scrollback at all, yet `pane read` hands back whatever page
 * the reader scrolled to. If the newest thing in the log is nowhere on screen,
 * the screen is in the past and must not be used to cut the transcript.
 */
export function showsLatestExchange(rows, currentRows, comparable) {
  let checked = 0;
  for (let index = rows.length - 1; index >= 0 && checked < LATEST_ANCHORS_CHECKED; index -= 1) {
    const row = comparable(rows[index]).trim();
    if (row.length < MIN_ANCHOR_LENGTH) continue;
    checked += 1;
    if (anchorMatches(row, currentRows, comparable)) return true;
  }
  return false;
}

/**
 * Cut the transcript where the live screen picks up.
 *
 * The log holds the whole session, including the exchange the screen is showing
 * right now, so appending it verbatim would print that part twice. The screen
 * wraps its text and the log does not, so rows are compared by containment
 * rather than equality, and only rows long enough not to match by chance are
 * used as anchors.
 */
export function trimToScreen(rows, currentRows, comparable = (row) => String(row).trim()) {
  if (!showsLatestExchange(rows, currentRows, comparable)) return rows;
  for (const candidate of currentRows) {
    const target = comparable(candidate).trim();
    if (target.length < MIN_ANCHOR_LENGTH) continue;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = comparable(rows[index]).trim();
      if (row.length < MIN_ANCHOR_LENGTH) continue;
      if (row.includes(target) || target.includes(row)) {
        return rows.slice(0, index);
      }
    }
  }
  return rows;
}

export function renderTranscript(jsonlText) {
  const rows = [];
  for (const line of String(jsonlText).split("\n")) {
    if (line.trim() === "") continue;
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      // A half-written final line is normal while a session is running.
      continue;
    }
    rows.push(...transcriptRows(entry));
  }
  // The transcript is prepended to live output, which supplies its own spacing.
  while (rows.length > 0 && rows[0] === "") rows.shift();
  return rows;
}

/**
 * Reads the transcript of the session currently running in a working
 * directory. The newest file wins: its modification time keeps advancing while
 * the session is alive.
 */
export class AgentTranscriptReader {
  constructor({
    projectsRoot = defaultProjectsRoot(),
    maxRows = DEFAULT_MAX_ROWS,
    tailBytes = DEFAULT_TAIL_BYTES,
  } = {}) {
    this.projectsRoot = projectsRoot;
    this.maxRows = maxRows;
    this.tailBytes = tailBytes;
    this.cache = new Map();
  }

  async #readTail(path, size) {
    const length = Math.min(size, this.tailBytes);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }

  async #newestSession(cwd) {
    const directory = join(this.projectsRoot, projectDirectoryName(cwd));
    if (!directory.startsWith(this.projectsRoot)) return null;
    let names = [];
    try {
      names = await readdir(directory);
    } catch {
      return null;
    }
    let newest = null;
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(directory, name);
      try {
        const stats = await stat(path);
        if (!stats.isFile()) continue;
        if (!newest || stats.mtimeMs > newest.mtimeMs) {
          newest = { path, mtimeMs: stats.mtimeMs, size: stats.size };
        }
      } catch {
        // The file can disappear between listing and stat.
      }
    }
    return newest;
  }

  /** Transcript rows for a working directory, or [] when there is no log. */
  async rowsFor(cwd) {
    if (typeof cwd !== "string" || cwd === "") return [];
    const session = await this.#newestSession(cwd);
    if (!session) return [];

    const cached = this.cache.get(session.path);
    if (cached && cached.mtimeMs === session.mtimeMs && cached.size === session.size) {
      return cached.rows;
    }

    let contents = "";
    try {
      contents = await this.#readTail(session.path, session.size);
    } catch {
      return [];
    }
    const rows = renderTranscript(contents).slice(-this.maxRows);
    this.cache.set(session.path, { mtimeMs: session.mtimeMs, size: session.size, rows });
    // Only the session being viewed needs to stay parsed.
    if (this.cache.size > 8) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return rows;
  }
}

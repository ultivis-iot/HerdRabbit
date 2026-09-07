import { stripVTControlCharacters } from "node:util";

const DEFAULT_MAX_ROWS_PER_PANE = 4_000;
const DEFAULT_MAX_PANES = 32;
// A terminal frame is at most a few hundred rows. Anything larger means Herdr
// is serving real scrollback for this pane, so there is nothing to rebuild --
// and aligning frames that size would block the event loop for seconds.
const DEFAULT_MAX_FRAME_ROWS = 500;
// A single matching blank row is not evidence that two frames overlap.
const MIN_MEANINGFUL_MATCH = 1;

export function screenRows(output) {
  if (typeof output !== "string" || output === "") return [];
  let value = output;
  if (value.endsWith("\n")) {
    value = value.slice(0, -1);
    if (value.endsWith("\r")) value = value.slice(0, -1);
  }
  return value.split("\n");
}

export function comparableRow(row) {
  return stripVTControlCharacters(row).replaceAll("\r", "").trimEnd();
}

function meaningfulRows(rows, start, length) {
  let count = 0;
  for (let index = start; index < start + length; index += 1) {
    if (comparableRow(rows[index]) !== "") count += 1;
  }
  return count;
}

/**
 * Align two consecutive frames of an alternate-screen application.
 *
 * Claude redraws its whole screen every frame, so the previous frame is not a
 * prefix of the next one. What stays stable is a run of rows that moved up:
 * previous[start..] matches next[0..]. Everything before that run has scrolled
 * off the screen for good and is the only part safe to commit to history.
 */
export function frameAlignment(previousRows, nextRows) {
  const previous = previousRows.map(comparableRow);
  const next = nextRows.map(comparableRow);
  let best = { start: previous.length, matched: 0 };

  for (let start = 0; start < previous.length; start += 1) {
    let matched = 0;
    while (
      start + matched < previous.length &&
      matched < next.length &&
      previous[start + matched] === next[matched]
    ) {
      matched += 1;
    }
    if (
      matched > best.matched &&
      meaningfulRows(previousRows, start, matched) >= MIN_MEANINGFUL_MATCH
    ) {
      best = { start, matched };
    }
  }

  return best;
}

/** Rows both frames still end with, such as a composer box pinned to the bottom. */
export function commonTailLength(previousRows, nextRows) {
  let length = 0;
  while (
    length < previousRows.length &&
    length < nextRows.length &&
    comparableRow(previousRows[previousRows.length - 1 - length]) ===
      comparableRow(nextRows[nextRows.length - 1 - length])
  ) {
    length += 1;
  }
  return length;
}

/**
 * Rows of the previous frame that the next frame pushed off the screen.
 *
 * Two limits decide how much is safe to commit. The alignment says where the
 * surviving run of rows begins, and the common tail says how much of the frame
 * is still on screen -- without the latter, a burst of output that leaves no
 * overlap would commit the composer box over and over.
 */
export function scrolledOffRows(previousRows, nextRows) {
  if (previousRows.length === 0) return [];
  if (nextRows.length === 0) return previousRows;
  const { start } = frameAlignment(previousRows, nextRows);
  const stillOnScreen = commonTailLength(previousRows, nextRows);
  const count = Math.min(start, previousRows.length - stillOnScreen);
  return previousRows.slice(0, Math.max(0, count));
}

/**
 * Per-pane scrollback for agents that run on the alternate screen.
 *
 * Herdr keeps no scrollback for them: `pane read` returns only the current
 * screen however many lines are requested. This store reconstructs the missing
 * history from the frames the browser polls, so scrolling up has something to
 * show.
 */
export class ScreenHistoryStore {
  constructor({
    maxRowsPerPane = DEFAULT_MAX_ROWS_PER_PANE,
    maxPanes = DEFAULT_MAX_PANES,
    maxFrameRows = DEFAULT_MAX_FRAME_ROWS,
  } = {}) {
    this.maxRowsPerPane = maxRowsPerPane;
    this.maxPanes = maxPanes;
    this.maxFrameRows = maxFrameRows;
    this.panes = new Map();
  }

  #entry(paneId) {
    const existing = this.panes.get(paneId);
    if (existing) {
      // Refresh insertion order so the least recently polled pane is evicted.
      this.panes.delete(paneId);
      this.panes.set(paneId, existing);
      return existing;
    }
    const created = { history: [], screen: [] };
    this.panes.set(paneId, created);
    while (this.panes.size > this.maxPanes) {
      this.panes.delete(this.panes.keys().next().value);
    }
    return created;
  }

  /** Record one frame and return the rows that scrolled off before it. */
  observe(paneId, output) {
    const rows = screenRows(output);
    const entry = this.#entry(paneId);
    if (rows.length > this.maxFrameRows) {
      // This pane has its own scrollback after all. Drop what was reconstructed
      // so it cannot be prepended to output that already contains it.
      entry.history = [];
      entry.screen = [];
      return entry.history;
    }
    const scrolled = scrolledOffRows(entry.screen, rows);
    if (scrolled.length > 0) {
      entry.history.push(...scrolled);
      const overflow = entry.history.length - this.maxRowsPerPane;
      if (overflow > 0) entry.history.splice(0, overflow);
    }
    entry.screen = rows;
    return entry.history;
  }

  historyRows(paneId) {
    return this.panes.get(paneId)?.history ?? [];
  }
}

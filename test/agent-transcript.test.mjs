import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentTranscriptReader,
  projectDirectoryName,
  renderTranscript,
  transcriptRows,
  showsLatestExchange,
  trimToScreen,
} from "../src/agent-transcript.mjs";

function jsonl(...entries) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

const prompt = (text) => ({ type: "user", message: { role: "user", content: text } });
const answer = (...blocks) => ({
  type: "assistant",
  message: { role: "assistant", content: blocks },
});

test("names the log directory after the working directory", () => {
  assert.equal(
    projectDirectoryName("/home/user/Git/project"),
    "-home-user-Git-project",
  );
  assert.equal(
    projectDirectoryName("/home/user/Git/repo/.worktrees/issue-2"),
    "-home-user-Git-repo--worktrees-issue-2",
  );
  assert.equal(projectDirectoryName(""), "");
});

test("prints prompts and answers the way the terminal shows them", () => {
  assert.deepEqual(
    transcriptRows(prompt("fix the scrolling")),
    ["", "> fix the scrolling"],
  );
  assert.deepEqual(
    transcriptRows(answer({ type: "text", text: "Looking into it.\nOne moment." })),
    ["", "⏺ Looking into it.", "  One moment."],
  );
});

test("summarises tool calls and leaves thinking out", () => {
  assert.deepEqual(
    transcriptRows(answer(
      { type: "thinking", thinking: "not shown on screen" },
      { type: "tool_use", name: "Bash", input: { description: "check the tests" } },
    )),
    ["", "⏺ Bash(check the tests)"],
  );
  assert.deepEqual(
    transcriptRows(answer({ type: "tool_use", name: "Read", input: { file_path: "/a/b.js" } })),
    ["", "⏺ Read(/a/b.js)"],
  );
});

test("leaves out tool results and subagent conversations", () => {
  assert.deepEqual(
    transcriptRows({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", content: "..." }] },
    }),
    [],
  );
  assert.deepEqual(
    transcriptRows({ ...prompt("side quest"), isSidechain: true }),
    [],
  );
});

test("survives the half-written last line of a live session", () => {
  const rows = renderTranscript(
    `${jsonl(prompt("hello"))}\n{"type":"assistant","message":{"role`,
  );
  assert.deepEqual(rows, ["> hello"]);
});

test("cuts the transcript where the live screen picks up", () => {
  const rows = [
    "> an older question entirely",
    "⏺ an older answer entirely",
    "> what the screen is showing now",
    "⏺ the answer being shown now",
  ];
  // The screen wraps the same text differently, so rows are matched by
  // containment rather than equality.
  const screen = ["what the screen is showing now", "the answer being shown"];

  assert.deepEqual(trimToScreen(rows, screen), [
    "> an older question entirely",
    "⏺ an older answer entirely",
  ]);
});

test("keeps the whole transcript when the screen shares nothing with it", () => {
  const rows = ["> an older question entirely", "⏺ an older answer entirely"];
  assert.deepEqual(trimToScreen(rows, ["$ ls", "README.md"]), rows);
});

test("ignores rows too short to be a trustworthy anchor", () => {
  const rows = ["> ok", "⏺ a much longer answer that anchors reliably"];
  assert.deepEqual(trimToScreen(rows, ["ok"]), rows);
});

test("reads the newest session log for a working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-transcript-"));
  const cwd = "/tmp/example-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });

  await writeFile(
    join(directory, "older.jsonl"),
    jsonl(prompt("from the older session")),
  );
  await writeFile(
    join(directory, "newer.jsonl"),
    jsonl(prompt("from the newer session"), answer({ type: "text", text: "understood" })),
  );
  const future = new Date(Date.now() + 60_000);
  const { utimes } = await import("node:fs/promises");
  await utimes(join(directory, "newer.jsonl"), future, future);

  const reader = new AgentTranscriptReader({ projectsRoot: root });
  assert.deepEqual(await reader.rowsFor(cwd), [
    "> from the newer session",
    "",
    "⏺ understood",
  ]);
});

test("returns nothing for a directory with no log", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-transcript-"));
  const reader = new AgentTranscriptReader({ projectsRoot: root });
  assert.deepEqual(await reader.rowsFor("/tmp/nothing-here"), []);
  assert.deepEqual(await reader.rowsFor(null), []);
});

test("reparses only when the log changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-transcript-"));
  const cwd = "/tmp/cached-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  const path = join(directory, "session.jsonl");
  await writeFile(path, jsonl(prompt("first")));

  const reader = new AgentTranscriptReader({ projectsRoot: root });
  const first = await reader.rowsFor(cwd);
  assert.equal(await reader.rowsFor(cwd), first, "an unchanged log returns the same rows");

  await writeFile(path, jsonl(prompt("first"), prompt("second")));
  const updated = await reader.rowsFor(cwd);
  assert.deepEqual(updated, ["> first", "", "> second"]);
});

test("keeps the transcript when the screen is showing scrolled-back conversation", () => {
  // Claude scrolls inside its own alternate screen, which Herdr cannot see, so
  // an older exchange still arrives as the "current" screen. Cutting there
  // would drop everything said since — even one page back.
  const rows = [
    "> a question from much earlier on",
    ...Array.from(
      { length: 30 },
      (_, index) => `⏺ an answer line long enough to anchor ${index}`,
    ),
  ];
  const scrolledBack = ["> a question from much earlier on"];

  assert.equal(showsLatestExchange(rows, scrolledBack, (row) => String(row).trim()), false);
  assert.deepEqual(trimToScreen(rows, scrolledBack), rows);
});

test("recognises the present even while an answer is still streaming", () => {
  // The newest rows reach the log only once a message completes, so the check
  // looks a few anchors back rather than at the very last row alone.
  const rows = [
    "> the most recent question asked here",
    "⏺ an answer that is long enough to anchor",
    "⏺ a still newer answer not yet on screen",
  ];
  const screen = ["⏺ an answer that is long enough to anchor"];

  assert.equal(showsLatestExchange(rows, screen, (row) => String(row).trim()), true);
});

test("still cuts when the screen matches near the end of the transcript", () => {
  const rows = [
    "> a question from much earlier on",
    "⏺ an answer that is long enough to anchor",
    "> the most recent question asked here",
  ];
  assert.deepEqual(trimToScreen(rows, ["> the most recent question asked here"]), [
    "> a question from much earlier on",
    "⏺ an answer that is long enough to anchor",
  ]);
});

test("reads only the tail of a long-running session log", async () => {
  // A session that has run for a day reaches tens of megabytes. Reading it all
  // to show the last few hundred rows made the transcript disappear entirely
  // once it crossed the old size limit.
  const root = await mkdtemp(join(tmpdir(), "herdrabbit-transcript-"));
  const cwd = "/tmp/long-running-project";
  const directory = join(root, projectDirectoryName(cwd));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.jsonl"),
    jsonl(
      ...Array.from({ length: 200 }, (_, index) => prompt(`question number ${index}`)),
    ),
  );

  const reader = new AgentTranscriptReader({ projectsRoot: root, tailBytes: 2_000 });
  const rows = await reader.rowsFor(cwd);

  assert.ok(rows.length > 0, "the tail must still produce a transcript");
  assert.match(rows.at(-1), /question number 199/);
  assert.equal(
    rows.some((row) => row.includes("question number 0")),
    false,
    "the beginning is outside the tail",
  );
  // The tail starts mid-line; that fragment must not turn into a row.
  assert.equal(rows.every((row) => row === "" || row.startsWith("> ")), true);
});

// What a stored file may be handed to the browser as, and nothing else.
//
// Downloads leave here as `application/octet-stream; attachment` on purpose:
// that is what stops an uploaded page or SVG from ever running at this app's
// origin, where it would sit inside the session it could then steal. A viewer
// needs the opposite -- a real type, rendered in place -- so it gets its own
// door with its own rules, rather than a flag on that one.
//
// The rules are three:
//
//   1. An allow-list, never sniffing. The extension picks the type or there is
//      no preview. A file whose bytes disagree with its name renders as
//      whatever the name promised, and `nosniff` keeps the browser from
//      looking for a second opinion.
//   2. Only formats that cannot execute. SVG is an image everywhere else and
//      is absent here, because it carries script; so is HTML, which the text
//      view can still show as the characters it is made of.
//   3. Text never comes through this door at all. It is fetched as bytes and
//      written into the page as text, so no content type is ever negotiated
//      for it and no markup in it can be anything but characters.

const INLINE = new Map(Object.entries({
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  bmp: ["image", "image/bmp"],
  ico: ["image", "image/x-icon"],

  mp4: ["video", "video/mp4"],
  m4v: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
  ogv: ["video", "video/ogg"],
  mov: ["video", "video/quicktime"],

  mp3: ["audio", "audio/mpeg"],
  m4a: ["audio", "audio/mp4"],
  aac: ["audio", "audio/aac"],
  wav: ["audio", "audio/wav"],
  flac: ["audio", "audio/flac"],
  opus: ["audio", "audio/ogg"],
  oga: ["audio", "audio/ogg"],
  ogg: ["audio", "audio/ogg"],
}));

// Shown as characters, so the list can be generous: the risk in a text view is
// a browser tab chewing on a gigabyte, not the content doing something.
const TEXT = new Set([
  "txt", "text", "md", "markdown", "rst", "log", "csv", "tsv",
  "json", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  "xml", "html", "htm", "svg", "css", "scss", "less",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs",
  "php", "pl", "lua", "sh", "bash", "zsh", "fish", "ps1", "sql", "r", "jl", "dart", "scala",
  "diff", "patch", "gitignore", "dockerfile", "makefile", "lock", "gradle", "tf", "proto", "graphql",
]);

// A text view holds the whole file in the page, so the ceiling is what a tab
// can render without locking up rather than what the disk can hand over.
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

function extensionOf(name) {
  const base = String(name ?? "").split("/").pop().split("\\").pop();
  const dot = base.lastIndexOf(".");
  // A dotfile is its own name, not an extension: ".gitignore" is looked up as
  // "gitignore", and "Dockerfile" has nothing after a dot to go on at all.
  const candidate = dot > 0 ? base.slice(dot + 1) : base.replace(/^\.+/u, "");
  return candidate.toLowerCase();
}

// What this file can be shown as, or null when the answer is "download it".
// `size` is optional: without it a text file is offered whatever its length,
// and the caller finds out how big it is when it reads it.
export function previewFor(name, size = null) {
  const extension = extensionOf(name);
  const inline = INLINE.get(extension);
  if (inline) return { kind: inline[0], type: inline[1] };
  if (!TEXT.has(extension)) return null;
  if (Number.isFinite(size) && size > MAX_TEXT_PREVIEW_BYTES) return null;
  return { kind: "text", type: null };
}

// Only the media kinds are ever served with a type of their own; text is read
// as bytes and written into the page, so it never asks for one.
export function inlineTypeFor(name) {
  const preview = previewFor(name);
  return preview && preview.kind !== "text" ? preview.type : null;
}

// `bytes=<first>-<last>`, the only form worth answering: one range, from a
// player asking to seek. A syntactically valid header this cannot satisfy is
// the caller's problem to report as 416; anything malformed is treated as no
// range at all, which is what RFC 9110 asks for.
export function parseByteRange(header, size) {
  if (typeof header !== "string" || !Number.isInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // A suffix range: the last N bytes.
    const wanted = Number(rawEnd);
    if (wanted === 0) return { unsatisfiable: true };
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return { unsatisfiable: true };
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { unsatisfiable: true };
  return { start, end };
}

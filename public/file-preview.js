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
//   2. Nothing gets to run. Most formats here cannot; the two that can are
//      handled by how they are shown rather than by refusing them:
//        - SVG goes in an `<img>`, which does not execute script in any
//          browser, and the app's own `script-src 'self'` blocks inline script
//          and event handlers even for someone who opens the raw URL. Both
//          layers were measured, not assumed.
//        - HTML and PDF are framed, and the response they arrive in carries a
//          CSP of its own ending in `sandbox`: the document gets an opaque
//          origin and no script, whoever opens it and however. That is
//          stronger than the page they sit in, and it is what lets an HTML
//          report keep its own stylesheet without being able to use it for
//          anything else.
//      Refusing them would have been easier and worse: an SVG shown as its own
//      source is a picture nobody can see.
//   3. Text never comes through this door either, for the same reason -- bytes
//      in, characters out, no content type negotiated for it at all.

const INLINE = new Map(Object.entries({
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  bmp: ["image", "image/bmp"],
  ico: ["image", "image/x-icon"],
  svg: ["image", "image/svg+xml"],

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

  // The browser's own viewer draws this one, in its own process. It cannot
  // reach this origin from there -- but it has to be framed to be seen, and
  // this app refuses to be framed, so the response carries its own narrower
  // answer to that. See sendInline.
  pdf: ["pdf", "application/pdf"],
}));

// Rendered rather than read: markup whose point is what it draws. Both are
// also in TEXT, which is what lets the viewer offer their source as well --
// the rendering is the useful default, not the only thing available.
const DOCUMENT = new Map(Object.entries({
  html: "document",
  htm: "document",
  svg: "image",
}));

// A document is framed, not built into the page, so it needs a type of its
// own. What makes that safe is the response it arrives in: see sendInline.
const DOCUMENT_TYPES = new Map(Object.entries({ html: "text/html", htm: "text/html" }));

// Markdown is drawn too, but it is not HTML until something turns it into
// some: the server renders it and sends that. It is absent from TEXT below for
// the same reason SVG is absent from it -- drawing is the useful default, and
// the viewer's other button still shows the characters it was written as.
const MARKDOWN = new Set(["md", "markdown"]);

export function isMarkdown(name) {
  return MARKDOWN.has(extensionOf(name));
}

// Shown as characters, so the list can be generous: the risk in a text view is
// a browser tab chewing on a gigabyte, not the content doing something.
const TEXT = new Set([
  "txt", "text", "rst", "log", "csv", "tsv",
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
  // Rendering markdown means holding the whole file to convert it, so it is
  // gated by the same length as reading one.
  if (MARKDOWN.has(extension)) {
    if (Number.isFinite(size) && size > MAX_TEXT_PREVIEW_BYTES) return null;
    return { kind: "document", type: "text/html", source: true };
  }
  const drawn = DOCUMENT.get(extension);
  const inline = INLINE.get(extension);
  // Markup is worth reading both ways, so it says so. Its source is text, and
  // text is capped by length; too long to read is still fine to draw.
  if (drawn) {
    const readable = !Number.isFinite(size) || size <= MAX_TEXT_PREVIEW_BYTES;
    return {
      kind: drawn,
      type: inline ? inline[1] : DOCUMENT_TYPES.get(extension) ?? null,
      source: readable,
    };
  }
  if (inline) return { kind: inline[0], type: inline[1] };
  if (!TEXT.has(extension)) return null;
  if (Number.isFinite(size) && size > MAX_TEXT_PREVIEW_BYTES) return null;
  return { kind: "text", type: null };
}

// Only the media kinds are ever served with a type of their own; text is read
// as bytes and written into the page, so it never asks for one.
export function inlineTypeFor(name) {
  const preview = previewFor(name);
  // A null type means "this one is not served as itself" -- text and HTML both
  // arrive as opaque bytes, so neither has a type to hand out.
  return preview ? preview.type : null;
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

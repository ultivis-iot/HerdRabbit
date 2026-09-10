// Markdown is what the agents on the other end of this app write: plans,
// reports, READMEs, notes. Reading one as its own source on a phone means
// counting hashes and pipes to work out where a table starts, so it is drawn.
//
// The output goes down the same road a stored .html file does -- a response
// whose policy ends in `sandbox`, so an opaque origin with no script. That is
// what makes a small renderer an acceptable one: a bug here can produce ugly
// markup, never running markup. Escaping is still done properly, because text
// that says `<script>` should read as those characters.
//
// Line-based on purpose. A block that a line cannot decide -- a setext heading,
// a lazy continuation, a nested list -- is not worth the machinery here; what
// it costs is a paragraph where a list was wanted, in a viewer whose other
// button says "Source".

const ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ESCAPES.get(character));
}

// Only the two schemes a document should be able to point at. Everything else
// -- javascript:, data:, a bare word that resolves against our own origin --
// keeps its text and loses its link.
function safeUrl(raw) {
  const value = String(raw).trim();
  return /^https?:\/\/[^\s<>"]+$/iu.test(value) ? value : null;
}

// Code spans are taken out first and put back last: what is inside one is
// characters, not markup, and running the emphasis rules over it would turn
// `*args` into an italic that never closes. The marker is a NUL because a
// document cannot contain one; a plainer marker like " 3 " could not be told
// apart from a sentence that happens to mention the number three.
export function renderInline(source) {
  const spans = [];
  let text = String(source).replace(/`([^`]+)`/gu, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  text = escapeHtml(text);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, (whole, alt, raw) => {
    const url = safeUrl(raw);
    // An image the frame is not allowed to fetch would be a broken icon and no
    // explanation, so it stays as the text that says what it was.
    return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />` : escapeHtml(whole);
  });
  // The label is already escaped -- this runs over escaped text -- so it is used
  // as it stands. Escaping a second time would show the entities themselves.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (whole, label, raw) => {
    const url = safeUrl(raw);
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : whole;
  });
  text = text.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/gu, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/gu, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/gu, "<del>$1</del>");
  return text.replace(/\u0000(\d+)\u0000/gu, (_, index) => spans[Number(index)]);
}

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 18px 20px 40px; font: 15px/1.65 system-ui, sans-serif;
  color: #1c2320; background: #ffffff; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.3; }
h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
h1, h2 { padding-bottom: 0.25em; border-bottom: 1px solid #dfe6e2; }
p, ul, ol, blockquote, pre, table { margin: 0.8em 0; }
ul, ol { padding-left: 1.5em; }
li { margin: 0.25em 0; }
a { color: #167454; }
code { padding: 0.15em 0.35em; border-radius: 4px; background: #eef3f0;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.9em; }
pre { padding: 12px 14px; border-radius: 8px; background: #f3f7f5; overflow-x: auto; }
pre code { padding: 0; background: none; font-size: 0.88em; }
blockquote { padding-left: 14px; border-left: 3px solid #c9d8d2; color: #4d5d56; }
hr { height: 1px; margin: 1.6em 0; border: 0; background: #dfe6e2; }
img { max-width: 100%; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; }
th, td { padding: 6px 12px; border: 1px solid #dfe6e2; text-align: left; }
th { background: #f3f7f5; }
@media (prefers-color-scheme: dark) {
  body { color: #e2e9e5; background: #10161a; }
  h1, h2 { border-bottom-color: #2a343a; }
  a { color: #7fe0bd; }
  code { background: #1c252b; }
  pre { background: #161e24; }
  blockquote { border-left-color: #35434b; color: #a6b3ac; }
  hr { background: #2a343a; }
  th, td { border-color: #2a343a; }
  th { background: #161e24; }
}`;

export function renderMarkdown(source, title = "") {
  const lines = String(source).split(/\r?\n/u);
  const out = [];
  let code = null;
  let list = null;
  let table = false;
  let quote = false;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => { if (table) { out.push("</tbody></table></div>"); table = false; } };
  const closeQuote = () => { if (quote) { out.push("</blockquote>"); quote = false; } };
  const closeBlocks = () => { closeList(); closeTable(); closeQuote(); };

  for (const line of lines) {
    const fence = /^\s*```+\s*([\w+-]*)\s*$/u.exec(line);
    if (fence) {
      if (code === null) {
        closeBlocks();
        code = true;
        out.push("<pre><code>");
      } else {
        code = null;
        out.push("</code></pre>");
      }
      continue;
    }
    if (code !== null) {
      out.push(escapeHtml(line));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    // A row is a row only next to another one, so the divider is what says a
    // table started rather than a line that merely contains pipes.
    if (/^\s*\|.*\|\s*$/u.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
      if (/^[\s|:-]+$/u.test(line)) continue;
      if (!table) {
        closeList();
        closeQuote();
        out.push('<div class="table-scroll"><table><thead><tr>' +
          cells.map((cell) => `<th>${renderInline(cell)}</th>`).join("") +
          "</tr></thead><tbody>");
        table = true;
      } else {
        out.push("<tr>" + cells.map((cell) => `<td>${renderInline(cell)}</td>`).join("") + "</tr>");
      }
      continue;
    }
    closeTable();

    const quoted = /^\s*>\s?(.*)$/u.exec(line);
    if (quoted) {
      closeList();
      if (!quote) { out.push("<blockquote>"); quote = true; }
      if (quoted[1].trim()) out.push(`<p>${renderInline(quoted[1])}</p>`);
      continue;
    }
    closeQuote();

    const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
    if (bullet || numbered) {
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) { closeList(); out.push(`<${wanted}>`); list = wanted; }
      out.push(`<li>${renderInline((bullet ?? numbered)[1])}</li>`);
      continue;
    }
    closeList();

    if (!line.trim()) continue;
    if (/^\s*(?:[-*_]\s*){3,}$/u.test(line)) { out.push("<hr />"); continue; }
    out.push(`<p>${renderInline(line)}</p>`);
  }

  closeBlocks();
  if (code !== null) out.push("</code></pre>");

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head><body>",
    out.join("\n"),
    "</body></html>",
  ].join("\n");
}

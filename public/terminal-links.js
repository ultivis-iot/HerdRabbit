// Agents name files constantly -- "wrote src/api.mjs", "see ./docs/plan.md" --
// and on a phone the only way to look at one was to go find it in the tree. A
// path that names something this app can show becomes a link to it.
//
// Only such paths. Terminal output is full of path-shaped words, and linking
// every one of them would underline half the screen; requiring a name the
// viewer recognises is what keeps `/usr/bin` and `node_modules/` plain.
// Any run that holds a slash: `/abs/x.log`, `./rel/x.md`, `~/x.md`, and the
// bare `src/api.mjs` an agent writes most often of all.
const PATH_PATTERN = /(?:^|[\s'"`([<])([^\s'"`([<>:,;\x00-\x1f\x7f]*\/[^\s'"`)\]>:,;\x00-\x1f\x7f]+)/g;

function pathLinks(text, isViewable) {
  const links = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    let label = match[1];
    // Prose punctuation clings to the end of a path the same way it does to a
    // URL, and a trailing separator means a folder, which is not a document.
    while (label && /[.,;:!?)\]}/]/u.test(label.at(-1))) label = label.slice(0, -1);
    if (!label || !isViewable(label)) continue;
    const start = match.index + match[0].length - match[1].length;
    links.push({ start, end: start + label.length, path: label });
  }
  return links;
}

// Detect URLs across ANSI style boundaries without interpreting terminal text as HTML.
export function linkTerminalSegments(segments, { isViewablePath = () => false } = {}) {
  const text = segments.map((segment) => segment.text).join("");
  const links = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\x00-\x1f\x7f]+/gi)) {
    let label = match[0];
    while (label) {
      const last = label.at(-1);
      const open = { ")": "(", "]": "[", "}": "{" }[last];
      if (/[.,;:!]/.test(last) || (open && label.split(last).length > label.split(open).length)) {
        label = label.slice(0, -1);
      } else break;
    }
    try {
      const url = new URL(label);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) continue;
      links.push({ start: match.index, end: match.index + label.length, href: url.href });
    } catch { /* Leave incomplete URLs as ordinary text. */ }
  }
  // A URL wins where the two overlap: "https://x/a.md" is one address, not an
  // address next to a file.
  for (const link of pathLinks(text, isViewablePath)) {
    if (!links.some((found) => link.start < found.end && found.start < link.end)) links.push(link);
  }
  links.sort((first, second) => first.start - second.start);

  const result = [];
  let offset = 0;
  let linkIndex = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    let position = offset;
    while (position < end) {
      while (links[linkIndex]?.end <= position) linkIndex += 1;
      const link = links[linkIndex];
      const linked = link && position >= link.start;
      const boundary = Math.min(end, link ? linked ? link.end : link.start : end);
      const part = { ...segment, text: segment.text.slice(position - offset, boundary - offset) };
      if (linked) {
        if (link.href) part.href = link.href;
        else part.path = link.path;
        part.linkStart = link.start;
      }
      result.push(part);
      position = boundary;
    }
    offset = end;
  }
  return result;
}

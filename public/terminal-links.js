// Detect URLs across ANSI style boundaries without interpreting terminal text as HTML.
export function linkTerminalSegments(segments) {
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
  const result = [];
  let offset = 0;
  let linkIndex = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    let position = offset;
    while (position < end) {
      while (links[linkIndex]?.end <= position) linkIndex++;
      const link = links[linkIndex];
      const linked = link && position >= link.start;
      const boundary = Math.min(end, link ? linked ? link.end : link.start : end);
      const part = { ...segment, text: segment.text.slice(position - offset, boundary - offset) };
      if (linked) { part.href = link.href; part.linkStart = link.start; }
      result.push(part);
      position = boundary;
    }
    offset = end;
  }
  return result;
}

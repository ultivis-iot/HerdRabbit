const DEFAULT_STYLE = Object.freeze({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  foreground: null,
  background: null,
});

const ANSI_COLORS = Object.freeze([
  "#101010",
  "#ff8080",
  "#99ffe4",
  "#ffc799",
  "#9bb8ff",
  "#d8a0ff",
  "#66ddcc",
  "#d7d7d7",
  "#5c5c5c",
  "#ff9b9b",
  "#b5ffe9",
  "#ffe0b5",
  "#b9ccff",
  "#e6c0ff",
  "#9aeee2",
  "#ffffff",
]);

function copyStyle(style) {
  return { ...style };
}

function byte(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function rgbHex(red, green, blue) {
  const values = [byte(red), byte(green), byte(blue)];
  if (values.includes(null)) return null;
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function indexedColor(index) {
  const safeIndex = byte(index);
  if (safeIndex === null) return null;
  if (safeIndex < 16) return ANSI_COLORS[safeIndex];
  if (safeIndex < 232) {
    const offset = safeIndex - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return rgbHex(
      levels[Math.floor(offset / 36)],
      levels[Math.floor((offset % 36) / 6)],
      levels[offset % 6],
    );
  }
  const gray = 8 + (safeIndex - 232) * 10;
  return rgbHex(gray, gray, gray);
}

function applyExtendedColor(style, params, index, property) {
  if (params[index + 1] === 5) {
    const color = indexedColor(params[index + 2]);
    if (color) style[property] = color;
    return 2;
  }
  if (params[index + 1] === 2) {
    const color = rgbHex(params[index + 2], params[index + 3], params[index + 4]);
    if (color) style[property] = color;
    return 4;
  }
  return 0;
}

function applySgr(style, source) {
  const params = source === "" ? [0] : source.split(";").map((value) => Number(value || 0));
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (code === 0) Object.assign(style, DEFAULT_STYLE);
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 7) style.inverse = true;
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code >= 30 && code <= 37) style.foreground = ANSI_COLORS[code - 30];
    else if (code >= 90 && code <= 97) style.foreground = ANSI_COLORS[code - 90 + 8];
    else if (code >= 40 && code <= 47) style.background = ANSI_COLORS[code - 40];
    else if (code >= 100 && code <= 107) style.background = ANSI_COLORS[code - 100 + 8];
    else if (code === 38) index += applyExtendedColor(style, params, index, "foreground");
    else if (code === 48) index += applyExtendedColor(style, params, index, "background");
    else if (code === 39) style.foreground = null;
    else if (code === 49) style.background = null;
  }
}

function styleKey(style) {
  return [
    style.bold,
    style.dim,
    style.italic,
    style.underline,
    style.inverse,
    style.foreground,
    style.background,
  ].join("|");
}

function appendSegment(segments, text, style, maxSegments) {
  if (!text) return;
  const sanitized = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  if (!sanitized) return;
  const previous = segments.at(-1);
  if (previous && previous.key === styleKey(style)) {
    previous.text += sanitized;
    return;
  }
  if (segments.length >= maxSegments) {
    previous.text += sanitized;
    return;
  }
  segments.push({ text: sanitized, ...copyStyle(style), key: styleKey(style) });
}

function sequenceEnd(input, start, terminator) {
  const end = input.indexOf(terminator, start);
  return end === -1 ? input.length : end + terminator.length;
}

export function ansiToSegments(input, { maxSegments = 25_000 } = {}) {
  const text = String(input ?? "");
  const style = copyStyle(DEFAULT_STYLE);
  const segments = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    appendSegment(segments, plain, style, maxSegments);
    plain = "";
  };

  while (index < text.length) {
    if (text[index] !== "\x1b") {
      plain += text[index];
      index += 1;
      continue;
    }

    flush();
    const introducer = text[index + 1];
    if (introducer === "[") {
      let end = index + 2;
      while (end < text.length) {
        const code = text.charCodeAt(end);
        if (code >= 0x40 && code <= 0x7e) break;
        end += 1;
      }
      if (end >= text.length) break;
      if (text[end] === "m") applySgr(style, text.slice(index + 2, end));
      index = end + 1;
      continue;
    }
    if (introducer === "]") {
      const bellEnd = sequenceEnd(text, index + 2, "\x07");
      const stringEnd = sequenceEnd(text, index + 2, "\x1b\\");
      index = Math.min(bellEnd, stringEnd);
      continue;
    }
    if (["P", "X", "^", "_"].includes(introducer)) {
      index = sequenceEnd(text, index + 2, "\x1b\\");
      continue;
    }
    index += Math.min(2, text.length - index);
  }
  flush();
  return segments.map(({ key: _key, ...segment }) => segment);
}

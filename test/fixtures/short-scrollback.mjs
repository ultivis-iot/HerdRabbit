// Herdr hands back fewer rows than asked for: blank rows at the bottom are
// trimmed and wrapped rows come back joined. A Claude pane with a long
// scrollback answered 199 rows to a request for 201. This stands in for such a
// pane: `total` rows of scrollback, `trimmed` rows short on every read.
export function scrollbackThatTrims(total, trimmed = 2) {
  const rows = Array.from({ length: total }, (_, index) => `row ${index}`);
  return (lines) => rows.slice(-Math.min(lines, total)).slice(0, -trimmed).join("\n");
}

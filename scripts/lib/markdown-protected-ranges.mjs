// UTF-16 offsets into original Markdown, shared by source-preserving normalizers.
export function markdownProtectedRanges(text) {
  let ranges = [];
  let offset = 0;
  let fence = null;
  for (const line of text.split(/(?<=\n)/u)) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*(?:\r?\n)?$/u)?.[1];
      if (
        closing &&
        closing[0] === fence.token[0] &&
        closing.length >= fence.token.length
      ) {
        ranges = [...ranges, { start: fence.start, end: offset + line.length }];
        fence = null;
      }
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/u);
      if (opening && !(opening[1][0] === "`" && opening[2].includes("`")))
        fence = { token: opening[1], start: offset };
      else if (/^(?: {4}|\t)/u.test(line))
        ranges = [...ranges, { start: offset, end: offset + line.length }];
    }
    offset += line.length;
  }
  if (fence) throw Error("ambiguous unclosed Markdown fence");
  for (const match of text.matchAll(/<!--[\s\S]*?-->/gu)) {
    if (!isProtectedOffset(ranges, match.index))
      ranges = [
        ...ranges,
        { start: match.index, end: match.index + match[0].length },
      ];
  }
  const ticks = [...text.matchAll(/`+/gu)];
  for (let index = 0; index < ticks.length; index++) {
    const opening = ticks[index];
    if (isProtectedOffset(ranges, opening.index)) continue;
    const end = ticks.findIndex(
      (closing, i) =>
        i > index &&
        closing[0].length === opening[0].length &&
        !isProtectedOffset(ranges, closing.index),
    );
    if (end !== -1) {
      ranges = [
        ...ranges,
        { start: opening.index, end: ticks[end].index + ticks[end][0].length },
      ];
      index = end;
    }
  }
  return Object.freeze(ranges.map((range) => Object.freeze(range)));
}
export const isProtectedOffset = (ranges, offset) =>
  ranges.some((range) => offset >= range.start && offset < range.end);

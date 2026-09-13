import { createHash } from "node:crypto";
import {
  markdownProtectedRanges,
  isProtectedOffset,
} from "./markdown-protected-ranges.mjs";
import { UNRESOLVED_MARKER_RE } from "./content-contract.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");

// Only the complete terminal humanizer schema is process metadata. Similar
// reader-facing headings/prose are not a license to truncate an article.
export function separateGeneratedReport(source) {
  const ranges = markdownProtectedRanges(source);
  const boundaries = [
    ...source.matchAll(/^---\r?\n\r?\n윤문 리포트\r?\n\r?\n/gmu),
  ].filter((match) => !isProtectedOffset(ranges, match.index));
  const structured = boundaries.filter((match) =>
    /^(?:변경률:|카테고리별 수정:|주요 변경|자체검증:)/mu.test(
      source.slice(match.index + match[0].length),
    ),
  );
  if (!structured.length)
    return Object.freeze({ article: source, archive: null });
  if (structured.length !== 1)
    throw Error("ambiguous generated report boundaries");
  const start = structured[0].index;
  const text = source.slice(start);
  if (UNRESOLVED_MARKER_RE.test(text))
    throw Error(
      "generated report contains verification marker; review required",
    );
  const match = text.match(
    /^---\r?\n\r?\n윤문 리포트\r?\n\r?\n변경률: (\d{1,3})%\r?\n\r?\n카테고리별 수정: ([^\r\n]+)\r?\n\r?\n주요 변경 (\d+)건:\r?\n\r?\n((?:- `[^`\r\n]+` → `[^`\r\n]+`\r?\n)+)\r?\n자체검증: 6항 중 6항 통과\s*$/u,
  );
  if (
    !match ||
    Number(match[1]) > 100 ||
    !/^[A-F] [가-힣 ]+ \d+건(?:, [A-F] [가-힣 ]+ \d+건)*$/u.test(match[2]) ||
    Number(match[3]) !== match[4].trimEnd().split(/\r?\n/u).length
  )
    throw Error("ambiguous generated report structure; review required");
  const article = source.slice(0, start);
  const archive = Object.freeze({
    version: 1,
    kind: "terminal-humanization-report",
    start,
    end: source.length,
    text,
    sourceHash: hash(source),
    candidateHash: hash(article),
  });
  return Object.freeze({ article, archive });
}
export function restoreGeneratedReport(article, archive) {
  if (
    !archive ||
    archive.version !== 1 ||
    archive.kind !== "terminal-humanization-report" ||
    archive.start !== article.length ||
    archive.end !== article.length + archive.text.length ||
    hash(article) !== archive.candidateHash ||
    hash(article + archive.text) !== archive.sourceHash
  )
    throw Error("generated report archive hash/range conflict");
  return article + archive.text;
}

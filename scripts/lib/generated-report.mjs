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
    // Single-line wrapper variant observed in writer output:
    // "--- 윤문 리포트 ---" on one line, report fields following; an
    // optional preceding "---" horizontal rule belongs to the boundary.
    ...source.matchAll(/^(?:---\r?\n\r?\n)?--- 윤문 리포트 ---[ \t]*\r?\n/gmu),
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
  const strictMatch = text.match(
    /^---\r?\n\r?\n윤문 리포트\r?\n\r?\n변경률: (\d{1,3})%\r?\n\r?\n카테고리별 수정: ([^\r\n]+)\r?\n\r?\n주요 변경 (\d+)건:\r?\n\r?\n((?:- `[^`\r\n]+` → `[^`\r\n]+`\r?\n)+)\r?\n자체검증: 6항 중 6항 통과\s*$/u,
  );
  // The loose form still has to be a complete terminal report: the boundary
  // line, a 변경률 field, a category/change list, and the fixed closing line —
  // nothing after it, or it is not process metadata and we fail closed.
  // The prompt's 자체검증 section enumerates a fixed 6-item checklist, so the
  // model may echo it as a bullet list after the closing line. Tolerate that
  // optional trailing checklist (markdown list items only) while still
  // requiring the report to end at end-of-source — anything else after the
  // closing line is reader content and we fail closed.
  const looseMatch = strictMatch
    ? null
    : text.match(
        /^(?:---\r?\n\r?\n)?--- 윤문 리포트 ---[ \t]*\r?\n[\s\S]*?변경률: 약?\s*(\d{1,3})%[\s\S]*?자체검증: 6항 중 6항 통과(?:[ \t]*\r?\n[ \t]*-[ \t][^\r\n]*|[ \t]*\r?\n)*\s*$/u,
      );
  if (strictMatch) {
    if (
      Number(strictMatch[1]) > 100 ||
      !/^[A-F] [가-힣 ]+ \d+건(?:, [A-F] [가-힣 ]+ \d+건)*$/u.test(
        strictMatch[2],
      ) ||
      Number(strictMatch[3]) !==
        strictMatch[4].trimEnd().split(/\r?\n/u).length
    )
      throw Error("ambiguous generated report structure; review required");
  } else if (
    !looseMatch ||
    Number(looseMatch[1]) > 100 ||
    !/(?:카테고리별 수정:|주요 변경)/u.test(looseMatch[0])
  ) {
    throw Error("ambiguous generated report structure; review required");
  }
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

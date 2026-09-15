import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  separateGeneratedReport,
  restoreGeneratedReport,
} from "../lib/generated-report.mjs";
import { analyzePost } from "../check-writing.mjs";
// Pre-normalization oil-100-breakout.md bytes, preserved before the terminal
// report was separated through separateGeneratedReport (source hash pinned).
const oil = await readFile(
  new URL("./test-fixtures/oil-100-breakout-original.md", import.meta.url),
  "utf8",
);
assert.equal(
  createHash("sha256").update(oil).digest("hex"),
  "5330af8de2aa5c4ff010c7dda0b61781b0a27a2ac33a5b006100c3f04eaf30e6",
);
const notes = await readFile(
  new URL("./test-fixtures/oil-100-breakout-notes.md", import.meta.url),
  "utf8",
);
const tail = oil.slice(oil.indexOf("\n---\n\n윤문 리포트") + 1);
test("real oil terminal structured report is reversibly archived before actual mechanical gate", () => {
  const result = separateGeneratedReport(oil);
  assert.equal(result.archive.text, tail);
  assert.equal(result.article + result.archive.text, oil);
  assert.equal(result.archive.start, result.article.length);
  assert.equal(result.archive.end, oil.length);
  assert.equal(restoreGeneratedReport(result.article, result.archive), oil);
  assert.equal(analyzePost(oil, { notes }).pass, false);
  assert.equal(analyzePost(result.article, { notes }).pass, true);
  assert.equal(separateGeneratedReport(result.article).article, result.article);
  assert.equal(separateGeneratedReport(result.article).archive, null);
  assert.throws(
    () => restoreGeneratedReport(result.article + "edit", result.archive),
    /hash/,
  );
});
test("ordinary report mentions, percentages, titles and fenced/inline examples are not removed", () => {
  for (const text of [
    "본문의 윤문 리포트와 변경률: 18%를 설명합니다.",
    "본문\n---\n\n윤문 리포트\n\n독자가 읽을 설명입니다.",
    "```md\n" + tail + "```\n",
    "`" + tail + "`",
  ])
    assert.equal(separateGeneratedReport(text).article, text);
});
test("ambiguous structured reports and verification markers fail closed", () => {
  for (const text of [
    oil + "\n추가 독자 본문",
    oil.replace("자체검증: 6항 중 6항 통과", "자체검증: 확인 중"),
    oil.replace("주요 변경 3건:", "주요 변경 4건:"),
    oil.replace("변경률: 18%", "변경률: 118%"),
    oil.replace("D 관용구", "[직접 확인 필요] D 관용구"),
    oil + tail,
  ])
    assert.throws(() => separateGeneratedReport(text), /report|marker/);
});
test("all reader prose and verification markers outside the archived tail remain byte-exact", () => {
  const result = separateGeneratedReport(oil);
  assert.equal(result.article, oil.slice(0, result.archive.start));
  assert.ok(result.article.includes("[직접 확인 필요: 발행 전 NAVER API HUB"));
});
test("single-line --- 윤문 리포트 --- wrapper is separated only when the tail is a complete report", () => {
  const looseTail =
    "--- 윤문 리포트 ---\n\n변경률: 약 9%\n\n카테고리별 수정: A 번역투 4건, E 문장 리듬 3건\n\n주요 변경 1건:\n\n- \"전\" → \"후\"\n\n자체검증: 6항 중 6항 통과\n";
  for (const prefix of ["기사 본문입니다.\n\n", "기사 본문입니다.\n\n---\n\n"]) {
    const source = prefix + looseTail;
    const result = separateGeneratedReport(source);
    assert.equal(result.article, prefix.replace(/---\r?\n\r?\n$/u, ""));
    assert.equal(result.archive.text, source.slice(result.article.length));
    assert.equal(restoreGeneratedReport(result.article, result.archive), source);
  }
  assert.throws(
    () =>
      separateGeneratedReport(
        "본문\n\n--- 윤문 리포트 ---\n\n변경률: 약 9%\n\n끝나지 않은 리포트\n",
      ),
    /report/,
  );
});
test("single-line report tolerates the prompt's trailing self-check bullet list", () => {
  // The humanize prompt enumerates a fixed 6-item 자체검증 checklist; the model
  // may echo it as bullets after the closing line. That tail is still process
  // metadata and must be archived, not treated as reader prose.
  const tail =
    "--- 윤문 리포트 ---\n\n변경률: 약 7%\n\n카테고리별 수정: A 번역투 5건, E 리듬 4건\n\n주요 변경 1건:\n\n- \"전\" → \"후\"\n\n자체검증: 6항 중 6항 통과\n\n- 고유명사·수치·날짜·인용·툴 이름 보존\n- 검증 마커 보존\n- 번호 목록·표·FAQ·헤딩 구조 보존\n- 연결어미 뒤 쉼표 추가 없음\n- 변경률 30% 이하\n- 합니다체 유지\n";
  const source = "기사 본문입니다.\n\n" + tail;
  const result = separateGeneratedReport(source);
  assert.equal(result.article, "기사 본문입니다.\n\n");
  assert.equal(result.archive.text, tail);
  assert.equal(restoreGeneratedReport(result.article, result.archive), source);
  // The spec allows a parenthetical note on the closing line.
  const noted = source.replace(
    "자체검증: 6항 중 6항 통과",
    "자체검증: 6항 중 6항 통과 (기존 검증 마커 없음)",
  );
  const notedResult = separateGeneratedReport(noted);
  assert.equal(notedResult.article, "기사 본문입니다.\n\n");
  assert.equal(
    restoreGeneratedReport(notedResult.article, notedResult.archive),
    noted,
  );
  // Non-list trailing prose after the closing line is still reader content.
  assert.throws(
    () =>
      separateGeneratedReport(
        "기사 본문입니다.\n\n" +
          tail.replace("합니다체 유지\n", "합니다체 유지\n\n이어지는 독자 본문\n"),
      ),
    /report/,
  );
});

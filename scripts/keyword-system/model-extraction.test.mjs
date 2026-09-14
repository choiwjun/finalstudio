import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJsonObject } from "./lib/model-review.mjs";
import {
  applyTriage,
  corpusTextOf,
  validateExtraction,
} from "./lib/model-extraction.mjs";

const corpus = corpusTextOf([
  {
    title: "<b>3박 5일</b> 패키지 여행 비교",
    description: "노팁 노옵션 여부와 출발지 동선을 비교합니다",
  },
  { title: "다낭 호텔 추천", description: "3박 5일 일정으로 다낭을 다녀왔습니다" },
]);

test("extractJsonObject accepts fenced and bare JSON", () => {
  assert.deepEqual(extractJsonObject('noise\n```json\n{"a":1}\n```\n'), { a: 1 });
  assert.deepEqual(extractJsonObject('prefix {"b":2} suffix'), { b: 2 });
  assert.throws(() => extractJsonObject("no json here"), /parseable JSON/);
  assert.throws(() => extractJsonObject('{"a":'), /parseable JSON/);
});

test("validateExtraction keeps verbatim topics and dedupes", () => {
  const { topics } = validateExtraction(
    {
      topics: [
        {
          topic: "3박 5일",
          related_keywords: ["노팁 노옵션", "3박 5일", "다낭 호텔"],
          intent: "비교",
          angle: "확인 순서",
          rationale: "일정 비교 글이 여럿",
        },
        { topic: "3박  5일" }, // whitespace duplicate → dropped
      ],
    },
    { corpus, maxTopics: 5 },
  );
  assert.equal(topics.length, 1);
  // "3박 5일" related equals the head → removed by self-dedup
  assert.deepEqual([...topics[0].related_keywords], ["노팁 노옵션", "다낭 호텔"]);
});

test("validateExtraction rejects hallucinated topics and related terms", () => {
  assert.throws(
    () =>
      validateExtraction(
        { topics: [{ topic: "제주도 한달살기" }] },
        { corpus, maxTopics: 5 },
      ),
    /not verbatim in corpus/,
  );
  assert.throws(
    () =>
      validateExtraction(
        {
          topics: [
            { topic: "3박 5일", related_keywords: ["환각된 키워드"] },
          ],
        },
        { corpus, maxTopics: 5 },
      ),
    /not verbatim in corpus/,
  );
});

test("validateExtraction enforces schema and truncates over-cap", () => {
  assert.throws(() => validateExtraction({}, { corpus }), /topics array/);
  const { topics, overCap } = validateExtraction(
    {
      topics: [
        { topic: "3박 5일" },
        { topic: "다낭 호텔" },
        { topic: "노팁 노옵션" },
        { topic: "제주도 한달살기" }, // over cap → recorded, not validated
      ],
    },
    { corpus, maxTopics: 3 },
  );
  assert.equal(topics.length, 3);
  assert.deepEqual([...overCap], ["제주도 한달살기"]);
});

test("applyTriage only narrows: reject drops, merge folds into kept target", () => {
  const topics = [
    { topic: "3박 5일", related_keywords: [] },
    { topic: "3박5일 패키지", related_keywords: [] },
    { topic: "계획하면서 숙소", related_keywords: [] },
  ];
  const result = applyTriage(topics, {
    verdicts: [
      { topic: "3박5일 패키지", verdict: "merge", merge_into: "3박 5일" },
      { topic: "계획하면서 숙소", verdict: "reject", reason: "문장 파편" },
      { topic: "없는 주제", verdict: "reject" }, // ignored — not a candidate
      { topic: "3박 5일", verdict: "nonsense" }, // unknown verdict → keep
    ],
  });
  assert.deepEqual(
    result.kept.map((t) => t.topic),
    ["3박 5일"],
  );
  assert.deepEqual(result.rejected, [
    { topic: "계획하면서 숙소", reason: "문장 파편" },
  ]);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].into, "3박 5일");
});

test("applyTriage keeps candidate when merge target is itself rejected or missing", () => {
  const topics = [
    { topic: "3박 5일", related_keywords: [] },
    { topic: "속도 조절", related_keywords: [] },
  ];
  const mergedToRejected = applyTriage(topics, {
    verdicts: [
      { topic: "3박 5일", verdict: "reject" },
      { topic: "속도 조절", verdict: "merge", merge_into: "3박 5일" },
    ],
  });
  // merge into a rejected target keeps the candidate rather than dropping it
  assert.deepEqual(
    mergedToRejected.kept.map((t) => t.topic),
    ["속도 조절"],
  );
  const mergedToMissing = applyTriage(topics, {
    verdicts: [{ topic: "3박 5일", verdict: "merge", merge_into: "패키지 여행" }],
  });
  assert.deepEqual(
    mergedToMissing.kept.map((t) => t.topic),
    ["3박 5일", "속도 조절"],
  );
});

test("applyTriage requires a verdicts array", () => {
  assert.throws(
    () => applyTriage([{ topic: "3박 5일" }], {}),
    /verdicts array/,
  );
});

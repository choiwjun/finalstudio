import assert from "node:assert/strict";
import { test } from "node:test";
import { dateRequest, trendEchoMatches } from "./collect.mjs";

const NOW = new Date("2026-09-09T00:00:00.000Z");

function makeCandidate(overrides = {}) {
  return {
    category: "ai",
    head_keyword: "엑셀 자동화",
    related_keywords: ["엑셀 매크로", "업무 자동화"],
    ...overrides,
  };
}

test("trend request gives each keyword its own group with the head first", () => {
  const request = dateRequest(NOW, makeCandidate());
  assert.deepEqual(
    request.keywordGroups,
    [
      { groupName: "엑셀 자동화", keywords: ["엑셀 자동화"] },
      { groupName: "엑셀 매크로", keywords: ["엑셀 매크로"] },
      { groupName: "업무 자동화", keywords: ["업무 자동화"] },
    ],
  );
});

test("trend request caps at five groups with the head keyword never dropped", () => {
  const request = dateRequest(
    NOW,
    makeCandidate({
      related_keywords: ["r1", "r2", "r3", "r4", "r5"],
    }),
  );
  assert.equal(request.keywordGroups.length, 5);
  assert.equal(request.keywordGroups[0].groupName, "엑셀 자동화");
  assert.deepEqual(
    request.keywordGroups.map((group) => group.groupName),
    ["엑셀 자동화", "r1", "r2", "r3", "r4"],
  );
});

test("trend request deduplicates related keywords that normalize to the head", () => {
  const request = dateRequest(
    NOW,
    makeCandidate({ related_keywords: ["엑셀  자동화", "엑셀 매크로"] }),
  );
  assert.deepEqual(
    request.keywordGroups.map((group) => group.groupName),
    ["엑셀 자동화", "엑셀 매크로"],
  );
});

test("trendEchoMatches accepts an exact echo of the requested groups", () => {
  const request = dateRequest(NOW, makeCandidate());
  const response = {
    results: [
      { title: "엑셀 자동화", keywords: ["엑셀 자동화"], data: [] },
      { title: "엑셀 매크로", keywords: ["엑셀 매크로"], data: [] },
      { title: "업무 자동화", keywords: ["업무 자동화"], data: [] },
    ],
  };
  assert.equal(trendEchoMatches(request, response), true);
});

test("trendEchoMatches rejects foreign, missing, and extra groups", () => {
  const request = dateRequest(NOW, makeCandidate());
  const data = [{ period: "2026-09-09", ratio: 50 }];
  // Completely different groups — the classic wrong-answer response.
  assert.equal(
    trendEchoMatches(request, {
      results: [
        { title: "업무 자동화", keywords: ["엑셀 자동화", "엑셀 매크로"], data },
        { title: "개발 생산성", keywords: ["Node.js"], data },
      ],
    }),
    false,
  );
  // A missing requested group is a mismatch even when the rest echo.
  assert.equal(
    trendEchoMatches(request, {
      results: [
        { title: "엑셀 자동화", keywords: ["엑셀 자동화"], data },
        { title: "엑셀 매크로", keywords: ["엑셀 매크로"], data },
      ],
    }),
    false,
  );
  // An extra unrequested group is a mismatch.
  assert.equal(
    trendEchoMatches(request, {
      results: [
        { title: "엑셀 자동화", keywords: ["엑셀 자동화"], data },
        { title: "엑셀 매크로", keywords: ["엑셀 매크로"], data },
        { title: "업무 자동화", keywords: ["업무 자동화"], data },
        { title: "개발 생산성", keywords: ["Node.js"], data },
      ],
    }),
    false,
  );
  // Same titles but different bundled keywords do not echo the request.
  assert.equal(
    trendEchoMatches(request, {
      results: [
        { title: "엑셀 자동화", keywords: ["엑셀 자동화", "매크로"], data },
        { title: "엑셀 매크로", keywords: ["엑셀 매크로"], data },
        { title: "업무 자동화", keywords: ["업무 자동화"], data },
      ],
    }),
    false,
  );
});

test("trendEchoMatches is insensitive to keyword order and casing", () => {
  const request = {
    keywordGroups: [
      { groupName: "AI Tools", keywords: ["AI Tools", "Copilot"] },
    ],
  };
  const response = {
    results: [
      { title: "ai tools", keywords: ["copilot", "ai tools"], data: [] },
    ],
  };
  assert.equal(trendEchoMatches(request, response), true);
});

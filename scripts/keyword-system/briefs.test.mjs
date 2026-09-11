import assert from "node:assert/strict";
import { test } from "node:test";
import { makeValidRecord } from "./test-helpers.mjs";
import {
    BriefError,
    buildKeywordBrief,
    renderKeywordBrief,
} from "./lib/briefs.mjs";
import { normalizeManifestEvidencePath } from "./brief.mjs";

const blogEnvelope = {
    schema_version: 1,
    provider: "naver-api-hub",
    endpoint: "/search/v1/blog",
    method: "GET",
    source: "naver-api-hub-blog",
    request: { query: "선정 키워드" },
    collected_at: "2026-09-11T00:00:00.000Z",
    http: { status: 200, ok: true },
    response: {
        lastBuildDate: "Wed, 11 Sep 2026 00:00:00 +0000",
        total: 2,
        start: 1,
        display: 2,
        items: [
            {
                title: "<b>선정 키워드</b> 사용법",
                link: "https://example.test/guide",
                description: "확인할 문제와 절차입니다.",
                postdate: "20260910",
            },
            {
                title: "실패 사례",
                link: "https://example.test/failure",
                description: "오류를 점검합니다.",
                postdate: "20260909",
            },
        ],
    },
};

const trendEnvelope = {
    schema_version: 1,
    provider: "naver-api-hub",
    endpoint: "/search-trend/v1/search",
    method: "POST",
    source: "naver-api-hub-trend",
    request: {
        startDate: "2026-09-01",
        endDate: "2026-09-11",
        timeUnit: "date",
        keywordGroups: [
            { groupName: "선정 키워드", keywords: ["선정 키워드"] },
        ],
    },
    collected_at: "2026-09-11T00:00:00.000Z",
    http: { status: 200, ok: true },
    response: {
        startDate: "2026-09-01",
        endDate: "2026-09-11",
        timeUnit: "date",
        results: [
            {
                title: "선정 키워드 관심 흐름",
                keywords: ["선정 키워드"],
                data: [
                    { period: "2026-09-10", ratio: 42.5 },
                    { period: "2026-09-09", ratio: 80 },
                ],
            },
            {
                title: "무관한 결과",
                keywords: ["다른 키워드"],
                data: [{ period: "2026-09-11", ratio: 99 }],
            },
        ],
    },
};

test("normalizeManifestEvidencePath accepts Windows manifest separators", () => {
    assert.equal(
        normalizeManifestEvidencePath(
            String.raw`data\keywords\raw\evidence.json`,
        ),
        "data/keywords/raw/evidence.json",
    );
});

test("buildKeywordBrief combines a ready record with source evidence without inventing claims", () => {
    const record = makeValidRecord({
        category: "ai",
        head_keyword: "선정 키워드",
        collected_at: "2026-09-11T00:00:00.000Z",
        status: "ready-to-write",
    });
    const brief = buildKeywordBrief(record, [blogEnvelope, trendEnvelope]);

    assert.equal(brief.category, "ai");
    assert.equal(brief.head_keyword, "선정 키워드");
    assert.equal(brief.evidence.blog.length, 2);
    assert.equal(brief.evidence.trend.length, 1);
    assert.equal(brief.evidence.trend[0].latest_ratio, 42.5);
    assert.equal(
        brief.evidence.trend[0].ratio_note,
        "상대 지표이며 절대 검색량이 아님",
    );
    assert.deepEqual(brief.outline, [
        "독자가 겪는 문제",
        "핵심 답변과 적용 절차",
        "실패 조건과 확인 항목",
        "출처와 기준일",
    ]);
});

test("renderKeywordBrief produces a manual-review draft note with evidence links", () => {
    const record = makeValidRecord({
        category: "ai",
        head_keyword: "선정 키워드",
        collected_at: "2026-09-11T00:00:00.000Z",
        status: "ready-to-write",
    });
    const markdown = renderKeywordBrief(
        buildKeywordBrief(record, [blogEnvelope, trendEnvelope]),
    );

    assert.match(markdown, /# 선정 키워드/u);
    assert.match(markdown, /사람 검토 필요/u);
    assert.match(markdown, /https:\/\/example\.test\/guide/u);
    assert.match(markdown, /상대 지표이며 절대 검색량이 아님/u);
    assert.doesNotMatch(markdown, /자동 발행/u);
});

test("buildKeywordBrief rejects malformed evidence and mismatched collection runs", () => {
    const ready = makeValidRecord({
        collected_at: "2026-09-11T00:00:00.000Z",
        status: "ready-to-write",
    });
    assert.throws(
        () =>
            buildKeywordBrief(ready, [
                {
                    ...blogEnvelope,
                    response: { ...blogEnvelope.response, total: "bad" },
                },
                trendEnvelope,
            ]),
        BriefError,
    );
    assert.throws(
        () =>
            buildKeywordBrief(
                ready,
                [
                    {
                        envelope: blogEnvelope,
                        runId: "20260911T000000Z-aaaaaaaa",
                    },
                    {
                        envelope: trendEnvelope,
                        runId: "20260911T000000Z-aaaaaaaa",
                    },
                ],
                { runId: "20260911T000000Z-bbbbbbbb" },
            ),
        BriefError,
    );
});

test("buildKeywordBrief rejects records that are not ready-to-write or lack successful evidence", () => {
    const candidate = makeValidRecord({ status: "candidate" });
    assert.throws(
        () => buildKeywordBrief(candidate, [blogEnvelope]),
        BriefError,
    );
    const ready = makeValidRecord({ status: "ready-to-write" });
    assert.throws(
        () =>
            buildKeywordBrief(ready, [
                { ...blogEnvelope, http: { status: 500, ok: false } },
            ]),
        BriefError,
    );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWjKeywordRecord } from './lib/contracts.mjs';
import {
  AnalysisError,
  analyzeCandidate,
  stableSortRecords,
  transitionStatus,
} from './lib/analysis.mjs';
import { makeValidRecord, readJsonFixture } from './test-helpers.mjs';

// ---------------------------------------------------------------------------
// records-schema invariants: every analysis/transition output must be a valid
// eleven-field WJ record, and only documents transitions may change status.
// ---------------------------------------------------------------------------

const NOW = '2026-09-09T12:00:00.000Z';
const clock = () => new Date(NOW);
const blogPromise = readJsonFixture('blog-success.json');
const trendPromise = readJsonFixture('trend-success.json');

function candidate() {
  return {
    category: 'ai-it',
    head_keyword: '엑셀 자동화',
    related_keywords: ['엑셀 매크로', '업무 자동화'],
    search_intent: '방법',
    content_angle: '공식 문서와 실제 확인 항목을 기준으로 설명합니다',
    risk_flags: [],
  };
}

function blogEnvelope({ collectedAt = '2026-09-09T00:00:00.000Z', source = 'naver-api-hub-blog', response } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: '/search/v1/blog',
    method: 'GET',
    request: { query: '엑셀 자동화', display: 10, start: 1, sort: 'sim', format: 'json' },
    collected_at: collectedAt,
    http: { status: 200, ok: true },
    response: response ?? { total: 1, items: [{ title: '엑셀 자동화 첫 글', description: '설명', link: 'https://blog.example.test/1', postdate: '20260909' }] },
  };
}

function trendEnvelope({ collectedAt = '2026-09-09T00:00:00.000Z', source = 'naver-api-hub-trend', response } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: '/search-trend/v1/search',
    method: 'POST',
    request: { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', keywordGroups: [{ groupName: '업무 자동화', keywords: ['엑셀 자동화'] }] },
    collected_at: collectedAt,
    http: { status: 200, ok: true },
    response: response ?? { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', results: [{ title: 'g', keywords: ['엑셀 자동화'], data: [{ period: '2026-09-09', ratio: 100 }] }] },
  };
}

function failureEnvelope({ status = 429, kind = 'rate_limited', message = 'quota', source = 'naver-api-hub-blog', collectedAt = '2026-09-09T00:00:00.000Z' } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: source === 'naver-api-hub-trend' ? '/search-trend/v1/search' : '/search/v1/blog',
    method: source === 'naver-api-hub-trend' ? 'POST' : 'GET',
    request: { query: '엑셀 자동화' },
    collected_at: collectedAt,
    http: { status, ok: false },
    error: { kind, message },
  };
}

function emptyBlog() {
  return blogEnvelope({ response: { total: 0, items: [] } });
}

const schemaKeys = [
  'category', 'head_keyword', 'related_keywords', 'search_intent', 'content_angle',
  'source', 'collected_at', 'freshness', 'risk_flags', 'evidence_available', 'status',
];

function assertValidRecord(value, message = '') {
  assert.deepEqual(Object.keys(value), schemaKeys, message);
  const normalized = normalizeWjKeywordRecord(value);
  assert.deepEqual(normalized, value, `record must be normalized-idempotent: ${message}`);
  return value;
}

function assertNoScoreOrRank(value) {
  const json = JSON.stringify(value);
  assert.equal(/"score[A-Za-z_]*"/u.test(json), false, 'must not contain score fields');
  assert.equal(/"rank[A-Za-z_]*"/u.test(json), false, 'must not contain rank fields');
}

async function fixtures() {
  const blog = await blogPromise;
  const trend = await trendPromise;
  return { blog, trend };
}

test('Given every analysis outcome across the evidence matrix, when recorded, then each record satisfies the eleven-field WJ contract', async () => {
  const { blog, trend } = await fixtures();
  const evidenceSets = [
    [blogEnvelope(), trendEnvelope()],
    [blogEnvelope()],
    [emptyBlog()],
    [failureEnvelope({ status: 401, kind: 'auth_missing', message: 'no' })],
    [failureEnvelope({ status: 403, kind: 'forbidden', message: 'no' })],
    [failureEnvelope({ status: 429, kind: 'rate_limited', message: 'quota' })],
    [failureEnvelope({ status: 500, kind: 'server_error', message: 'boom' })],
    [blogEnvelope({ collectedAt: '2026-08-01T00:00:00.000Z' })],
    [blogEnvelope(), failureEnvelope({ source: 'naver-api-hub-trend', status: 429, kind: 'rate_limited' })],
    [blogEnvelope({ response: blog }), trendEnvelope({ response: trend })],
  ];

  for (const evidence of evidenceSets) {
    const record = analyzeCandidate(candidate(), evidence, { now: clock });
    assertValidRecord(record, JSON.stringify(evidence));
    assertNoScoreOrRank(record);
    assert.equal(STATUS_GUARD(record), true, record.status);
  }
});

// ready-to-write and written must always be backed by evidence and enough related keywords.
function STATUS_GUARD(record) {
  if (record.status === 'ready-to-write' || record.status === 'written') {
    return record.evidence_available === true && record.related_keywords.length >= 2 && record.related_keywords.length <= 5;
  }
  return true;
}

test('Given a candidate with each status, when clean or failed evidence is analyzed, then promotion only happens on clean evidence', async () => {
  const { blog, trend } = await fixtures();
  for (const status of ['candidate', 'researching']) {
    const base = makeValidRecord({ status, evidence_available: false, freshness: 'unknown', risk_flags: [] });
    const clean = analyzeCandidate(base, [blogEnvelope({ response: blog }), trendEnvelope({ response: trend })], { now: clock });
    assertValidRecord(clean);
    assert.equal(clean.status, 'ready-to-write', status);

    const failed = analyzeCandidate(base, [failureEnvelope({ status: 500, kind: 'server_error' })], { now: clock });
    assertValidRecord(failed);
    assert.equal(failed.status, 'candidate', status);
    assert.equal(failed.evidence_available, false, status);
  }
});

test('Given records in every legal start status, when each documented event is applied, then the result is a valid contract record', () => {
  const cases = [
    { from: 'candidate', event: { type: 'collection_started' } },
    { from: 'candidate', event: { type: 'reject', reason: 'out of scope' } },
    { from: 'researching', event: { type: 'analysis_failure' } },
    { from: 'researching', event: { type: 'reject', reason: 'out of scope' } },
    { from: 'ready-to-write', event: { type: 'writer_handoff', reference: 'drafts/excel' } },
    { from: 'ready-to-write', event: { type: 'reject', reason: 'out of scope' } },
    { from: 'rejected', event: { type: 'reseed', reference: 'run-1' } },
  ];
  for (const entry of cases) {
    const base = makeValidRecord({ status: entry.from, evidence_available: entry.from === 'candidate' ? false : true });
    const next = transitionStatus(base, entry.event);
    assertValidRecord(next, entry.event.type);
    assert.notEqual(next.status, entry.from, entry.event.type);
  }
});

test('Given an event that would leave an invalid record, when applied, then the transition is rejected', () => {
  // writing without evidence cannot happen because the record contract forbids written without evidence.
  assert.throws(() => normalizeWjKeywordRecord(makeValidRecord({ status: 'written', evidence_available: false })), /written/iu);
  // a handoff from a non-ready record is an invalid transition even with a reference.
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'researching', evidence_available: true }), { type: 'writer_handoff', reference: 'x' }), AnalysisError);
});

test('Given unsorted records, when stable-sorted, then category, head keyword, and status order is deterministic and the input is untouched', () => {
  const make = (category, head, status, tag) => makeValidRecord({ category, head_keyword: head, status, related_keywords: ['r1', 'r2'], risk_flags: [], ...(tag ? { content_angle: tag } : {}) });

  const records = [
    make('health', '수면 습관', 'candidate', 'a'),
    make('ai-it', '엑셀 자동화', 'candidate', 'b'),
    make('ai-it', '업무 자동화', 'researching', 'c'),
    make('ai-it', '엑셀 자동화', 'ready-to-write', 'd'),
    make('economy', '생활 물가', 'candidate', 'e'),
    make('ai-it', '엑셀 자동화', 'candidate', 'f'),
  ];
  const copy = structuredClone(records);
  const sorted = stableSortRecords(records);

  assert.deepEqual(records, copy, 'input must not be mutated');
  // Deterministic code-unit sort: category, then head keyword, then status.
  assert.deepEqual(sorted.map((r) => [r.category, r.head_keyword, r.status]), [
    ['ai-it', '업무 자동화', 'researching'],
    ['ai-it', '엑셀 자동화', 'candidate'],
    ['ai-it', '엑셀 자동화', 'candidate'],
    ['ai-it', '엑셀 자동화', 'ready-to-write'],
    ['economy', '생활 물가', 'candidate'],
    ['health', '수면 습관', 'candidate'],
  ]);
  // stability: equal sort keys keep their original relative input order
  assert.equal(sorted[1].content_angle, 'b');
  assert.equal(sorted[2].content_angle, 'f');
  assert.equal(sorted[3].content_angle, 'd');
  for (const record of sorted) assertValidRecord(record);
});

test('Given identical records, when stable-sorted twice, then both runs are byte-identical', () => {
  const records = [
    makeValidRecord({ category: 'ai-it', head_keyword: '업무 자동화', status: 'candidate', related_keywords: ['a', 'b'] }),
    makeValidRecord({ category: 'ai-it', head_keyword: '엑셀 자동화', status: 'candidate', related_keywords: ['a', 'b'] }),
  ];
  assert.equal(JSON.stringify(stableSortRecords(records)), JSON.stringify(stableSortRecords(structuredClone(records))));
});

test('Given an invalid record, when stable-sorted, then a deterministic AnalysisError is thrown', () => {
  const invalid = makeValidRecord({ category: 'ai-it', head_keyword: '엑셀 자동화', status: 'ready-to-write', evidence_available: false });
  assert.throws(() => stableSortRecords([invalid]), AnalysisError);
});

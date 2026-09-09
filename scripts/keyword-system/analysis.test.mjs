import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FRESHNESS_VALUES,
  RISK_FLAGS,
  STATUS_VALUES,
  normalizeBlogSearchResponse,
  normalizeTrendResponse,
  normalizeWjKeywordRecord,
} from './lib/contracts.mjs';
import {
  AnalysisError,
  SENSITIVE_TOPIC_MARKERS,
  analyzeCandidate,
  deriveBlogSignals,
  deriveTrendSignals,
  transitionStatus,
} from './lib/analysis.mjs';
import { makeValidRecord, readJsonFixture } from './test-helpers.mjs';

// ---------------------------------------------------------------------------
// Fixed clock and envelope builders. No network, no randomness, no LLM.
// ---------------------------------------------------------------------------

const FIXED_NOW = '2026-09-09T12:00:00.000Z';
const fixedClock = () => new Date(FIXED_NOW);
const COLLECTED = '2026-09-09T00:00:00.000Z';

const BLOG_BODY = normalizeBlogSearchResponse(await readJsonFixture('blog-success.json'));
const TREND_BODY = normalizeTrendResponse(await readJsonFixture('trend-success.json'));

function makeCandidate(overrides = {}) {
  return {
    category: 'ai-it',
    head_keyword: '엑셀 자동화',
    related_keywords: ['엑셀 매크로', '업무 자동화'],
    search_intent: '방법',
    content_angle: '공식 문서와 실제 확인 항목을 기준으로 작은 자동화부터 설명합니다',
    risk_flags: [],
    ...overrides,
  };
}

function makeBlogEnvelope({ collectedAt = COLLECTED, response, source = 'naver-api-hub-blog' } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: '/search/v1/blog',
    method: 'GET',
    request: { query: '엑셀 자동화', display: 10, start: 1, sort: 'sim', format: 'json' },
    collected_at: collectedAt,
    http: { status: 200, ok: true },
    response: response ?? structuredClone(BLOG_BODY),
  };
}

function makeTrendEnvelope({ collectedAt = COLLECTED, response, source = 'naver-api-hub-trend' } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: '/search-trend/v1/search',
    method: 'POST',
    request: {
      startDate: '2026-09-01',
      endDate: '2026-09-09',
      timeUnit: 'date',
      keywordGroups: [{ groupName: '업무 자동화', keywords: ['엑셀 자동화', '엑셀 매크로'] }],
    },
    collected_at: collectedAt,
    http: { status: 200, ok: true },
    response: response ?? structuredClone(TREND_BODY),
  };
}

function makeFailureEnvelope({ status, kind, message, riskFlags, collectedAt = COLLECTED, source = 'naver-api-hub-blog', code } = {}) {
  return {
    schema_version: 1,
    provider: 'naver-api-hub',
    source,
    endpoint: source === 'naver-api-hub-trend' ? '/search-trend/v1/search' : '/search/v1/blog',
    method: source === 'naver-api-hub-trend' ? 'POST' : 'GET',
    request: source === 'naver-api-hub-trend'
      ? { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', keywordGroups: [{ groupName: '업무 자동화', keywords: ['엑셀 자동화'] }] }
      : { query: '엑셀 자동화', display: 10, start: 1, sort: 'sim', format: 'json' },
    collected_at: collectedAt,
    http: { status, ok: false },
    error: { kind, code, message, ...(riskFlags ? { risk_flags: riskFlags } : {}) },
  };
}

// ---------------------------------------------------------------------------
// deriveBlogSignals
// ---------------------------------------------------------------------------

test('Given a successful blog response, when blog signals are derived, then totals and postdate extent are deterministic metadata', () => {
  assert.deepEqual(deriveBlogSignals(BLOG_BODY), {
    source: 'naver-api-hub-blog',
    total: 2,
    item_count: 2,
    earliest_postdate: '20260908',
    latest_postdate: '20260909',
  });
});

test('Given an empty blog response, when blog signals are derived, then item count is zero and no postdate extent is reported', () => {
  assert.deepEqual(deriveBlogSignals({ total: 0, items: [] }), {
    source: 'naver-api-hub-blog',
    total: 0,
    item_count: 0,
    earliest_postdate: null,
    latest_postdate: null,
  });
});

test('Given a blog body with bold tags and extra fields, when blog signals are derived, then text is normalized and only signal fields are returned', () => {
  const raw = {
    lastBuildDate: 'Wed, 09 Sep 2026 00:00:00 +0900',
    total: 2,
    start: 1,
    display: 2,
    items: [
      { title: '<b>엑셀 자동화</b> 방법', description: '설명', link: 'https://blog.example.test/1', postdate: '20260907' },
      { title: '두 번째 글', description: '설명 2', link: 'https://blog.example.test/2', postdate: '20260909' },
    ],
  };
  const signals = deriveBlogSignals(raw);
  assert.deepEqual(signals, {
    source: 'naver-api-hub-blog',
    total: 2,
    item_count: 2,
    earliest_postdate: '20260907',
    latest_postdate: '20260909',
  });
  assert.equal(signals.latest_postdate.includes('<'), false);
});

test('Given a shape-invalid blog response, when blog signals are derived, then an AnalysisError is thrown', () => {
  assert.throws(() => deriveBlogSignals({ total: 1, items: [{ title: 'missing fields' }] }), AnalysisError);
});

// ---------------------------------------------------------------------------
// deriveTrendSignals
// ---------------------------------------------------------------------------

test('Given a successful trend response, when trend signals are derived, then per-group latest/max/average ratio metadata is deterministic', () => {
  const signals = deriveTrendSignals(TREND_BODY);

  assert.deepEqual(
    { source: signals.source, start_date: signals.start_date, end_date: signals.end_date, time_unit: signals.time_unit, group_count: signals.group_count },
    { source: 'naver-api-hub-trend', start_date: '2026-09-01', end_date: '2026-09-09', time_unit: 'date', group_count: 2 },
  );

  const [first, second] = signals.groups;
  assert.equal(first.title, '업무 자동화');
  assert.deepEqual(first.keywords, ['엑셀 자동화', '엑셀 매크로']);
  assert.equal(first.data_count, 2);
  assert.equal(first.latest_period, '2026-09-09');
  assert.equal(first.latest_ratio, 100);
  assert.equal(first.max_period, '2026-09-09');
  assert.equal(first.max_ratio, 100);
  assert.equal(first.average_ratio, (61.23 + 100) / 2);

  assert.equal(second.title, '개발 생산성');
  assert.equal(second.data_count, 1);
  assert.equal(second.latest_ratio, 42.5);
  assert.equal(second.max_ratio, 42.5);
  assert.equal(second.average_ratio, 42.5);
});

test('Given trend signals, when serialized, then no score or rank field is ever produced', () => {
  const json = JSON.stringify(deriveTrendSignals(TREND_BODY));
  assert.equal(/"(?:score|rank)[A-Za-z_]*"/u.test(json), false);
  assert.equal(json.includes('ratio'), true);
});

test('Given a raw trend body where the request maximum ratio is 100, when trend signals are derived, then ratio stays a relative in-request value', () => {
  const raw = {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
    timeUnit: 'date',
    results: [{ title: 'g', keywords: ['k'], data: [{ period: '2026-09-01', ratio: 2 }, { period: '2026-09-09', ratio: 100 }] }],
  };
  const signals = deriveTrendSignals(raw);
  assert.equal(signals.groups[0].max_ratio, 100);
  assert.equal(signals.groups[0].latest_ratio, 100);
  assert.equal(signals.groups[0].latest_period, '2026-09-09');
  assert.equal(signals.groups[0].average_ratio, 51);
});

// ---------------------------------------------------------------------------
// analyzeCandidate: happy path and record shape
// ---------------------------------------------------------------------------

test('Given clean blog and trend evidence, when analyzed, then the record becomes ready-to-write with fresh evidence and no risk flags', () => {
  const record = analyzeCandidate(
    makeCandidate(),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );

  assert.deepEqual(Object.keys(record), [
    'category', 'head_keyword', 'related_keywords', 'search_intent', 'content_angle',
    'source', 'collected_at', 'freshness', 'risk_flags', 'evidence_available', 'status',
  ]);
  assert.equal(record.status, 'ready-to-write');
  assert.equal(record.evidence_available, true);
  assert.equal(record.freshness, 'fresh');
  assert.deepEqual(record.risk_flags, []);
  assert.deepEqual(record.source, ['naver-api-hub-blog', 'naver-api-hub-trend']);
  assert.equal(record.collected_at, '2026-09-09T00:00:00.000Z');
  assert.equal(record.head_keyword, '엑셀 자동화');
  assert.equal(record.related_keywords.length, 2);
  assert.equal(record.category, 'ai-it');
  assert.equal(record.search_intent, '방법');
  assert.deepEqual(normalizeWjKeywordRecord(record), record);
});

test('Given a single clean blog evidence with the newest timestamp, when analyzed, then one supported source is enough to promote', () => {
  const record = analyzeCandidate(
    makeCandidate(),
    [makeBlogEnvelope({ collectedAt: '2026-09-05T00:00:00.000Z' })],
    { now: fixedClock },
  );
  assert.equal(record.status, 'ready-to-write');
  assert.deepEqual(record.source, ['naver-api-hub-blog']);
  assert.equal(record.collected_at, '2026-09-05T00:00:00.000Z');
  assert.equal(record.freshness, 'fresh');
});

test('Given an existing candidate record and clean evidence, when analyzed, then prior metadata is preserved and the record promotes', () => {
  const prior = makeValidRecord({
    category: 'ai-it',
    head_keyword: '엑셀 자동화',
    related_keywords: ['엑셀 매크로', '업무 자동화'],
    status: 'researching',
    freshness: 'unknown',
    risk_flags: [],
    evidence_available: false,
  });
  const record = analyzeCandidate(prior, [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock });
  assert.equal(record.status, 'ready-to-write');
  assert.equal(record.evidence_available, true);
  assert.equal(record.collected_at, COLLECTED);
  assert.equal(record.freshness, 'fresh');
});

test('Given the same input twice with the same clock, when analyzed, then the result is byte-stable and deep-equal', () => {
  const first = analyzeCandidate(makeCandidate(), [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock });
  const second = analyzeCandidate(structuredClone(makeCandidate()), [makeTrendEnvelope(), makeBlogEnvelope()], { now: fixedClock });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

// ---------------------------------------------------------------------------
// analyzeCandidate: freshness boundaries
// ---------------------------------------------------------------------------

test('Given evidence collected within 7 days, when analyzed, then freshness is fresh and the record can promote', () => {
  for (const collectedAt of ['2026-09-09T00:00:00.000Z', '2026-09-08T23:59:59.000Z', '2026-09-02T00:00:00.000Z']) {
    const record = analyzeCandidate(makeCandidate(), [makeBlogEnvelope({ collectedAt })], { now: fixedClock });
    assert.equal(record.freshness, 'fresh', collectedAt);
    assert.equal(record.status, 'ready-to-write', collectedAt);
  }
});

test('Given evidence collected 8 to 30 days ago, when analyzed, then freshness is stale, stale_evidence is flagged, and promotion is blocked', () => {
  for (const collectedAt of ['2026-09-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z']) {
    const record = analyzeCandidate(makeCandidate(), [makeBlogEnvelope({ collectedAt })], { now: fixedClock });
    assert.equal(record.freshness, 'stale', collectedAt);
    assert.deepEqual(record.risk_flags, ['stale_evidence'], collectedAt);
    assert.equal(record.evidence_available, true, collectedAt);
    assert.equal(record.status, 'candidate', collectedAt);
    assert.equal(record.collected_at, collectedAt);
  }
});

test('Given evidence collected more than 30 days ago, when analyzed, then freshness is unknown with stale_evidence, and promotion is blocked', () => {
  const record = analyzeCandidate(makeCandidate(), [makeBlogEnvelope({ collectedAt: '2026-08-09T00:00:00.000Z' })], { now: fixedClock });
  assert.equal(record.freshness, 'unknown');
  assert.deepEqual(record.risk_flags, ['stale_evidence']);
  assert.equal(record.status, 'candidate');
});

test('Given the newest usable evidence, when analyzed, then freshness uses only successful evidence timestamps', () => {
  const record = analyzeCandidate(
    makeCandidate(),
    [
      makeBlogEnvelope({ collectedAt: '2026-08-20T00:00:00.000Z' }),
      makeTrendEnvelope({ collectedAt: '2026-09-09T00:00:00.000Z' }),
    ],
    { now: fixedClock },
  );
  assert.equal(record.freshness, 'fresh');
  assert.equal(record.collected_at, '2026-09-09T00:00:00.000Z');
  assert.equal(record.status, 'ready-to-write');
});

// ---------------------------------------------------------------------------
// analyzeCandidate: empty, malformed, API failure
// ---------------------------------------------------------------------------

test('Given empty blog and trend evidence, when analyzed, then empty_evidence is flagged and nothing promotes', () => {
  const record = analyzeCandidate(makeCandidate(), [
    makeBlogEnvelope({ response: { total: 0, items: [] } }),
    makeTrendEnvelope({ response: { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', results: [] } }),
  ], { now: fixedClock });
  assert.equal(record.evidence_available, false);
  assert.deepEqual(record.risk_flags, ['empty_evidence']);
  assert.equal(record.status, 'candidate');
  assert.equal(record.freshness, 'unknown');
  assert.deepEqual(record.source, ['naver-api-hub-blog', 'naver-api-hub-trend']);
});

test('Given a malformed JSON failure envelope, when analyzed, then malformed_response risk is retained and the record stays a candidate', () => {
  const envelope = makeFailureEnvelope({
    status: 0,
    kind: 'malformed_json',
    message: 'response body was not valid JSON',
    riskFlags: ['malformed_response'],
  });
  const record = analyzeCandidate(makeCandidate(), [envelope], { now: fixedClock });
  assert.equal(record.evidence_available, false);
  assert.deepEqual(record.risk_flags, ['malformed_response']);
  assert.equal(record.status, 'candidate');
  assert.equal(record.source.length, 1);
  assert.equal(record.source[0], 'naver-api-hub-blog');
});

test('Given an HTTP 200 body that violates the response shape, when analyzed, then malformed_response risk is flagged deterministically', () => {
  const envelope = makeBlogEnvelope({ response: { total: 1, items: [{ title: 'only title' }] } });
  const record = analyzeCandidate(makeCandidate(), [envelope], { now: fixedClock });
  assert.equal(record.evidence_available, false);
  assert.deepEqual(record.risk_flags, ['malformed_response']);
  assert.equal(record.status, 'candidate');
});

test('Given API failure envelopes for 401, 403, 429, and 500, when analyzed, then each keeps its failure risk and never promotes', () => {
  const cases = [
    [401, 'auth_missing', ['api_error', 'auth_missing']],
    [403, 'forbidden', ['api_error', 'forbidden']],
    [429, 'rate_limited', ['api_error', 'rate_limited']],
    [500, 'server_error', ['api_error']],
  ];
  for (const [status, kind, expectedRisk] of cases) {
    const record = analyzeCandidate(
      makeCandidate(),
      [makeFailureEnvelope({ status, kind, message: `fail ${status}` })],
      { now: fixedClock },
    );
    assert.equal(record.status, 'candidate', kind);
    assert.equal(record.evidence_available, false, kind);
    assert.deepEqual(record.risk_flags, expectedRisk, kind);
    assert.equal(record.freshness, 'unknown', kind);
  }
});

test('Given a mixed set of clean blog and failed trend evidence, when analyzed, then usable evidence exists but failure risk blocks promotion', () => {
  const record = analyzeCandidate(makeCandidate(), [
    makeBlogEnvelope(),
    makeFailureEnvelope({ source: 'naver-api-hub-trend', status: 429, kind: 'rate_limited', message: 'quota exceeded' }),
  ], { now: fixedClock });

  assert.equal(record.evidence_available, true);
  assert.deepEqual(record.risk_flags, ['api_error', 'rate_limited']);
  assert.equal(record.status, 'candidate');
  assert.deepEqual(record.source, ['naver-api-hub-blog', 'naver-api-hub-trend']);
});

test('Given a failed analysis run followed by a clean run, when analyzed again, then the failure risks are replaced by the clean result', () => {
  const failed = analyzeCandidate(makeCandidate(), [makeFailureEnvelope({ status: 429, kind: 'rate_limited', message: 'quota' })], { now: fixedClock });
  assert.deepEqual(failed.risk_flags, ['api_error', 'rate_limited']);
  assert.equal(failed.status, 'candidate');

  const clean = analyzeCandidate(failed, [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock });
  assert.deepEqual(clean.risk_flags, []);
  assert.equal(clean.status, 'ready-to-write');
});

// ---------------------------------------------------------------------------
// analyzeCandidate: sensitive topic, broad, insufficient related
// ---------------------------------------------------------------------------

test('Given sensitive-topic markers in the candidate text, when analyzed, then sensitive_topic blocks promotion', () => {
  const record = analyzeCandidate(
    makeCandidate({ head_keyword: '투자 수익률', content_angle: '공식 자료로 투자 수익 보장을 검증한다는 관점' }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.equal(record.evidence_available, true);
  assert.deepEqual(record.risk_flags, ['sensitive_topic']);
  assert.equal(record.status, 'candidate');
});

test('Given a sensitive marker only inside a related keyword, when analyzed, then sensitive_topic still blocks promotion', () => {
  const record = analyzeCandidate(
    makeCandidate({ related_keywords: ['건강기능식품', '영양제'] }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.equal(record.status, 'candidate');
  assert.deepEqual(record.risk_flags, ['sensitive_topic']);
});

test('Given benign health/economy wording without medical or financial claims, when analyzed, then no sensitive flag is added', () => {
  const health = analyzeCandidate(
    makeCandidate({ category: 'health', head_keyword: '수면 습관', related_keywords: ['수면 시간', '수면 환경'], content_angle: '공식 보건 자료를 바탕으로 생활에서 확인할 수 있는 범위를 설명합니다' }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.deepEqual(health.risk_flags, []);
  assert.equal(health.status, 'ready-to-write');

  const economy = analyzeCandidate(
    makeCandidate({ category: 'economy', head_keyword: '생활 물가', related_keywords: ['물가 지표', '공공 통계'], content_angle: '공공 통계의 기준과 일상에서 확인할 지점을 정리합니다' }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.deepEqual(economy.risk_flags, []);
  assert.equal(economy.status, 'ready-to-write');
});

test('Given a single-token head keyword, when analyzed, then broad_keyword blocks promotion', () => {
  const record = analyzeCandidate(
    makeCandidate({ head_keyword: '수면', related_keywords: ['수면 시간', '수면 환경'] }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.equal(record.evidence_available, true);
  assert.deepEqual(record.risk_flags, ['broad_keyword']);
  assert.equal(record.status, 'candidate');
});

test('Given fewer than two related keywords, when analyzed, then insufficient_related_keywords blocks promotion', () => {
  for (const related of [[], ['엑셀 매크로']]) {
    const record = analyzeCandidate(makeCandidate({ related_keywords: related }), [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock });
    assert.equal(record.status, 'candidate', JSON.stringify(related));
    assert.equal(record.risk_flags.includes('insufficient_related_keywords'), true);
  }
});

test('Given more than five related keywords, when analyzed, then promotion is blocked deterministically', () => {
  const record = analyzeCandidate(
    makeCandidate({ related_keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    [makeBlogEnvelope(), makeTrendEnvelope()],
    { now: fixedClock },
  );
  assert.equal(record.status, 'candidate');
});

// ---------------------------------------------------------------------------
// analyzeCandidate: deterministic handling of missing and terminal states
// ---------------------------------------------------------------------------

test('Given a discovery candidate with no evidence and no prior record fields, when analyzed, then a deterministic AnalysisError is thrown', () => {
  assert.throws(
    () => analyzeCandidate(makeCandidate(), [], { now: fixedClock }),
    AnalysisError,
  );
});

test('Given an existing record with no new evidence, when analyzed, then evidence stays unavailable and freshness is unknown', () => {
  const prior = makeValidRecord({ status: 'candidate', evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'] });
  const record = analyzeCandidate(prior, [], { now: fixedClock });
  assert.equal(record.status, 'candidate');
  assert.equal(record.evidence_available, false);
  assert.equal(record.freshness, 'unknown');
  assert.deepEqual(record.source, ['naver-api-hub-blog']);
});

test('Given a written or rejected record, when analyzed, then analysis refuses to change the terminal state', () => {
  const written = makeValidRecord({ status: 'written', evidence_available: true, related_keywords: ['엑셀 매크로', '업무 자동화'] });
  assert.throws(() => analyzeCandidate(written, [makeBlogEnvelope()], { now: fixedClock }), AnalysisError);

  const rejected = makeValidRecord({ status: 'rejected', evidence_available: false, risk_flags: [] });
  assert.throws(() => analyzeCandidate(rejected, [makeBlogEnvelope()], { now: fixedClock }), AnalysisError);
});

test('Given a ready-to-write record with newly failing evidence, when analyzed, then it deterministically regresses to candidate', () => {
  const prior = makeValidRecord({ status: 'ready-to-write', evidence_available: true });
  const record = analyzeCandidate(prior, [makeFailureEnvelope({ status: 500, kind: 'server_error', message: 'boom' })], { now: fixedClock });
  assert.equal(record.status, 'candidate');
  assert.equal(record.evidence_available, false);
  assert.deepEqual(record.risk_flags, ['api_error']);
});

test('Given a ready-to-write record with clean evidence, when analyzed again, then it stays ready-to-write', () => {
  const prior = makeValidRecord({ status: 'ready-to-write', evidence_available: true });
  const record = analyzeCandidate(prior, [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock });
  assert.equal(record.status, 'ready-to-write');
});

test('Given invalid candidate metadata or evidence, when analyzed, then deterministic errors are thrown', () => {
  assert.throws(() => analyzeCandidate({ ...makeCandidate(), search_intent: '정보' }, [makeBlogEnvelope()], { now: fixedClock }), AnalysisError);
  assert.throws(() => analyzeCandidate({ ...makeCandidate(), head_keyword: '   ' }, [makeBlogEnvelope()], { now: fixedClock }), AnalysisError);
  assert.throws(() => analyzeCandidate(makeCandidate(), [makeBlogEnvelope({ collectedAt: '2026-02-30T00:00:00.000Z' })], { now: fixedClock }), AnalysisError);
  assert.throws(() => analyzeCandidate(makeCandidate(), [{ not: 'an envelope' }], { now: fixedClock }), AnalysisError);
  assert.throws(() => analyzeCandidate(makeCandidate(), [makeBlogEnvelope(), 5], { now: fixedClock }), AnalysisError);
  assert.throws(() => analyzeCandidate(makeCandidate(), makeBlogEnvelope(), { now: 'not-a-function' }), AnalysisError);
});

test('Given unknown evidence sources, when analyzed, then deterministic rejection prevents provider confusion', () => {
  const envelope = { ...makeBlogEnvelope(), source: 'naver-web-search' };
  assert.throws(() => analyzeCandidate(makeCandidate(), [envelope], { now: fixedClock }), AnalysisError);
});

// ---------------------------------------------------------------------------
// transitionStatus: explicit event state machine
// ---------------------------------------------------------------------------

test('Given a candidate record, when collection starts, then the record moves to researching', () => {
  const record = makeValidRecord({ status: 'candidate', evidence_available: false });
  const next = transitionStatus(record, { type: 'collection_started' });
  assert.equal(next.status, 'researching');
  assert.deepEqual(normalizeWjKeywordRecord(next), next);
});

test('Given a researching record with analysis-ready fields, when analysis succeeds, then it moves to ready-to-write', () => {
  const record = makeValidRecord({
    status: 'researching',
    evidence_available: true,
    related_keywords: ['엑셀 매크로', '업무 자동화'],
    risk_flags: [],
  });
  const next = transitionStatus(record, { type: 'analysis_success' });
  assert.equal(next.status, 'ready-to-write');
});

test('Given a researching record without promotion preconditions, when analysis_success is requested, then the transition is rejected', () => {
  const withoutEvidence = makeValidRecord({ status: 'researching', evidence_available: false, risk_flags: [] });
  assert.throws(() => transitionStatus(withoutEvidence, { type: 'analysis_success' }), AnalysisError);

  const withRisk = makeValidRecord({ status: 'researching', evidence_available: true, risk_flags: ['sensitive_topic'] });
  assert.throws(() => transitionStatus(withRisk, { type: 'analysis_success' }), AnalysisError);
});

test('Given a researching or ready-to-write record, when analysis fails, then the record regresses to candidate with risks intact', () => {
  const researching = makeValidRecord({ status: 'researching', evidence_available: false, risk_flags: ['api_error'] });
  assert.equal(transitionStatus(researching, { type: 'analysis_failure' }).status, 'candidate');

  const ready = makeValidRecord({ status: 'ready-to-write', evidence_available: true, risk_flags: ['api_error'] });
  assert.equal(transitionStatus(ready, { type: 'analysis_failure' }).status, 'candidate');
});

test('Given a ready-to-write record, when a writer handoff with a reference is recorded, then it moves to written', () => {
  const record = makeValidRecord({ status: 'ready-to-write', evidence_available: true });
  const next = transitionStatus(record, { type: 'writer_handoff', reference: 'posts/excel-automation' });
  assert.equal(next.status, 'written');
});

test('Given a record without an explicit writer handoff event, when written is attempted, then the transition is rejected', () => {
  const record = makeValidRecord({ status: 'ready-to-write', evidence_available: true });
  assert.throws(() => transitionStatus(record, { type: 'writer_handoff' }), AnalysisError);
  assert.throws(() => transitionStatus(record, { type: 'writer_handoff', reference: '   ' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'candidate' }), { type: 'writer_handoff', reference: 'x' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'written' }), { type: 'writer_handoff', reference: 'x' }), AnalysisError);
});

test('Given a human reject event with a reason, when applied, then candidate, researching, and ready-to-write all become rejected', () => {
  for (const status of ['candidate', 'researching', 'ready-to-write']) {
    const next = transitionStatus(makeValidRecord({ status, evidence_available: true }), { type: 'reject', reason: 'not a WJ fit' });
    assert.equal(next.status, 'rejected', status);
  }
});

test('Given a reject event without a reason, when applied, then the transition is rejected', () => {
  const record = makeValidRecord({ status: 'candidate' });
  assert.throws(() => transitionStatus(record, { type: 'reject' }), AnalysisError);
  assert.throws(() => transitionStatus(record, { type: 'reject', reason: '' }), AnalysisError);
  assert.throws(() => transitionStatus(record, { type: 'reject', reason: 5 }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'rejected' }), { type: 'reject', reason: 'again' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'written' }), { type: 'reject', reason: 'again' }), AnalysisError);
});

test('Given a rejected record, when an explicit new seed run is recorded, then it returns to candidate', () => {
  const record = makeValidRecord({ status: 'rejected', evidence_available: false });
  const next = transitionStatus(record, { type: 'reseed', reference: 'run-2026-09-10' });
  assert.equal(next.status, 'candidate');
});

test('Given reseed without a reference or from a non-rejected state, when applied, then the transition is rejected', () => {
  const rejected = makeValidRecord({ status: 'rejected', evidence_available: false });
  assert.throws(() => transitionStatus(rejected, { type: 'reseed' }), AnalysisError);
  assert.throws(() => transitionStatus(rejected, { type: 'reseed', reference: '  ' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'candidate' }), { type: 'reseed', reference: 'x' }), AnalysisError);
});

test('Given an unknown event or an illegal state pair, when transition is applied, then a deterministic AnalysisError is thrown', () => {
  const candidate = makeValidRecord({ status: 'candidate', evidence_available: false });
  assert.throws(() => transitionStatus(candidate, { type: 'publish_now' }), AnalysisError);
  const researching = transitionStatus(candidate, { type: 'collection_started' });
  assert.equal(researching.status, 'researching');
  assert.throws(() => transitionStatus(researching, { type: 'collection_started' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'written' }), { type: 'collection_started' }), AnalysisError);
  assert.throws(() => transitionStatus(makeValidRecord({ status: 'rejected' }), { type: 'collection_started' }), AnalysisError);
  assert.throws(() => transitionStatus(null, { type: 'collection_started' }), AnalysisError);
});

test('Given a record, when any transition is applied, then the returned record is a normalized, unmutated-input copy', () => {
  const record = makeValidRecord({ status: 'candidate', evidence_available: false });
  const original = structuredClone(record);
  const next = transitionStatus(record, { type: 'collection_started' });
  assert.deepEqual(record, original);
  assert.notEqual(next, record);
  assert.equal(next.status, 'researching');
});

// ---------------------------------------------------------------------------
// output hygiene across analysis results
// ---------------------------------------------------------------------------

test('Given every analysis result and transition result, when inspected, then only the eleven WJ record fields are present', () => {
  const outputs = [
    analyzeCandidate(makeCandidate(), [makeBlogEnvelope(), makeTrendEnvelope()], { now: fixedClock }),
    analyzeCandidate(makeCandidate(), [makeFailureEnvelope({ status: 429, kind: 'rate_limited', message: 'quota' })], { now: fixedClock }),
    transitionStatus(makeValidRecord({ status: 'candidate', evidence_available: false }), { type: 'collection_started' }),
    transitionStatus(makeValidRecord({ status: 'rejected', evidence_available: false }), { type: 'reseed', reference: 'r1' }),
  ];
  const recordKeys = [
    'category', 'head_keyword', 'related_keywords', 'search_intent', 'content_angle',
    'source', 'collected_at', 'freshness', 'risk_flags', 'evidence_available', 'status',
  ];
  for (const output of outputs) {
    assert.deepEqual(Object.keys(output), recordKeys);
  }
});

test('Given analysis and transition outputs, when validated, then status, freshness, and risk flags stay in their documented enums', () => {
  const outputs = [
    analyzeCandidate(makeCandidate(), [makeBlogEnvelope()], { now: fixedClock }),
    analyzeCandidate(makeCandidate(), [makeFailureEnvelope({ status: 401, kind: 'auth_missing', message: 'no' })], { now: fixedClock }),
    transitionStatus(makeValidRecord({ status: 'ready-to-write', evidence_available: true }), { type: 'writer_handoff', reference: 'draft' }),
  ];
  for (const output of outputs) {
    assert.equal(STATUS_VALUES.includes(output.status), true);
    assert.equal(FRESHNESS_VALUES.includes(output.freshness), true);
    assert.deepEqual(output.risk_flags, [...new Set(output.risk_flags)].sort());
    for (const flag of output.risk_flags) assert.equal(RISK_FLAGS.includes(flag), true);
  }
});


test('Given a bare provider ApiFailure object as evidence on a record with sources, when analyzed, then failure risks apply deterministically', () => {
  const prior = makeValidRecord({
    status: 'researching',
    evidence_available: false,
    freshness: 'unknown',
    source: ['naver-api-hub-blog', 'naver-api-hub-trend'],
  });
  const record = analyzeCandidate(
    prior,
    { kind: 'rate_limited', status: 429, retryable: true, message: 'daily quota exceeded' },
    { now: fixedClock },
  );
  assert.equal(record.status, 'candidate');
  assert.equal(record.evidence_available, false);
  assert.deepEqual(record.risk_flags, ['api_error', 'rate_limited']);
  assert.deepEqual(record.source, ['naver-api-hub-blog', 'naver-api-hub-trend']);
  assert.equal(record.collected_at, prior.collected_at);
  assert.equal(record.freshness, 'unknown');
});

test('Given evidence collected after the injected clock date, when analyzed, then freshness is unknown without a stale flag', () => {
  const record = analyzeCandidate(
    makeCandidate(),
    [makeBlogEnvelope({ collectedAt: '2026-10-01T00:00:00.000Z' })],
    { now: fixedClock },
  );
  assert.equal(record.freshness, 'unknown');
  assert.deepEqual(record.risk_flags, []);
  assert.equal(record.evidence_available, true);
});

test('Given the exported sensitive marker list, when checked, then it is a frozen non-empty deterministic array', () => {
  assert.ok(Array.isArray(SENSITIVE_TOPIC_MARKERS));
  assert.ok(SENSITIVE_TOPIC_MARKERS.length > 0);
  assert.throws(() => SENSITIVE_TOPIC_MARKERS.push('x'), TypeError);
});

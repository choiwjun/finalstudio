import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  API_FAILURE_KINDS,
  FRESHNESS_VALUES,
  RISK_FLAGS,
  SEARCH_INTENTS,
  STATUS_VALUES,
  TREND_TIME_UNITS,
  ContractValidationError,
  isKeywordProvider,
  isValidBlogSearchResponse,
  isValidTrendResponse,
  normalizeApiFailure,
  normalizeBlogSearchRequest,
  normalizeBlogSearchResponse,
  normalizeKeywordProvider,
  normalizeRawEvidenceEnvelope,
  normalizeTrendRequest,
  normalizeTrendResponse,
  normalizeWjKeywordRecord,
  validateBlogSearchRequest,
  validateTrendRequest,
  validateWjKeywordRecord,
} from './lib/contracts.mjs';
import {
  fixturePath,
  loadFixture,
  loadFixtureText,
  makeValidRecord,
  readJsonFixture,
  readJsonl,
} from './test-helpers.mjs';

test('Given a minimal blog request, when normalized, then defaults are deterministic', () => {
  const normalized = normalizeBlogSearchRequest({ query: '  Excel 자동화  ' });

  assert.deepEqual(normalized, {
    query: 'Excel 자동화',
    display: 10,
    start: 1,
    sort: 'sim',
    format: 'json',
  });
  assert.deepEqual(validateBlogSearchRequest(normalized), normalized);
});

test('Given invalid blog request bounds, when validated, then a deterministic contract error is thrown', () => {
  for (const request of [
    { query: '' },
    { query: 'x', display: 0 },
    { query: 'x', display: 101 },
    { query: 'x', display: 1.5 },
    { query: 'x', start: 1001 },
    { query: 'x', sort: 'popular' },
    { query: 'x', format: 'xml' },
  ]) {
    assert.throws(() => validateBlogSearchRequest(request), ContractValidationError);
  }
});

test('Given a valid trend request, when normalized, then group and filter values are preserved', () => {
  const request = normalizeTrendRequest({
    startDate: '2026-09-01',
    endDate: '2026-09-09',
    timeUnit: 'date',
    keywordGroups: [
      { groupName: '업무 자동화', keywords: [' 엑셀 ', 'AI'] },
      { groupName: '개발', keywords: ['Node.js'] },
    ],
    device: 'pc',
    gender: 'm',
    ages: ['3', '4'],
  });

  assert.deepEqual(request, {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
    timeUnit: 'date',
    keywordGroups: [
      { groupName: '업무 자동화', keywords: ['엑셀', 'AI'] },
      { groupName: '개발', keywords: ['Node.js'] },
    ],
    device: 'pc',
    gender: 'm',
    ages: ['3', '4'],
  });
  assert.deepEqual(validateTrendRequest(request), request);
});

test('Given invalid trend dates or group counts, when validated, then the request is rejected', () => {
  const valid = {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
    timeUnit: 'date',
    keywordGroups: [{ groupName: 'x', keywords: ['x'] }],
  };

  for (const request of [
    { ...valid, startDate: '2026-02-30' },
    { ...valid, endDate: '2026-08-01' },
    { ...valid, timeUnit: 'year' },
    { ...valid, keywordGroups: [] },
    { ...valid, keywordGroups: Array.from({ length: 6 }, (_, index) => ({ groupName: `g${index}`, keywords: ['x'] })) },
    { ...valid, keywordGroups: [{ groupName: 'x', keywords: Array.from({ length: 21 }, () => 'x') }] },
  ]) {
    assert.throws(() => validateTrendRequest(request), ContractValidationError);
  }
});

test('Given successful blog and trend fixture bodies, when normalized, then typed response fields are returned', async () => {
  const blog = normalizeBlogSearchResponse(await readJsonFixture('blog-success.json'));
  const trend = normalizeTrendResponse(await readJsonFixture('trend-success.json'));

  assert.equal(blog.total, 2);
  assert.equal(blog.items[0].title, '엑셀 자동화로 <b>업무</b> 줄이기'.replaceAll('<b>', '').replaceAll('</b>', ''));
  assert.equal(blog.items[0].description.includes('<b>'), false);
  assert.equal(trend.results[0].data[0].ratio, 61.23);
  assert.equal(isValidBlogSearchResponse(blog), true);
  assert.equal(isValidTrendResponse(trend), true);
});

test('Given empty and malformed fixture bodies, when processed, then only the empty body validates as an empty response', async () => {
  const empty = await readJsonFixture('empty.json');
  assert.equal(normalizeBlogSearchResponse(empty).items.length, 0);
  assert.equal(normalizeTrendResponse(empty).results.length, 0);

  const malformed = await loadFixtureText('malformed.json');
  assert.throws(() => JSON.parse(malformed), SyntaxError);
  assert.throws(() => normalizeBlogSearchResponse({ total: 1, items: [{ title: 'missing fields' }] }), ContractValidationError);
});

test('Given API gateway, search, trend, and HTTP failure bodies, when normalized, then risk flags are explicit', async () => {
  const cases = [
    ['error-401.json', 401, 'auth_missing', 'auth_missing'],
    ['error-403.json', 403, 'forbidden', 'forbidden'],
    ['error-429.json', 429, 'rate_limited', 'rate_limited'],
    ['error-500.json', 500, 'server_error', 'api_error'],
    ['trend-validation.json', 400, 'validation_error', 'api_error'],
  ];

  for (const [name, status, kind, risk] of cases) {
    const failure = normalizeApiFailure({ status, body: await readJsonFixture(name) });
    assert.equal(failure.kind, kind);
    assert.equal(failure.status, status);
    assert.equal(failure.risk_flags.includes(risk), true);
    assert.equal(typeof failure.message, 'string');
    assert.equal(failure.message.includes('NCP_SECRET_SENTINEL'), false);
  }
  assert.deepEqual(API_FAILURE_KINDS.includes('malformed_json'), true);
});

test('Given a complete keyword record, when normalized, then enum arrays are stable and required fields remain', () => {
  const record = normalizeWjKeywordRecord({
    ...makeValidRecord(),
    risk_flags: ['stale_evidence', 'api_error', 'api_error'],
  });

  assert.deepEqual(Object.keys(record), [
    'category', 'head_keyword', 'related_keywords', 'search_intent', 'content_angle',
    'source', 'collected_at', 'freshness', 'risk_flags', 'evidence_available', 'status',
  ]);
  assert.deepEqual(record.risk_flags, ['api_error', 'stale_evidence']);
  assert.equal(SEARCH_INTENTS.includes(record.search_intent), true);
  assert.equal(FRESHNESS_VALUES.includes(record.freshness), true);
  assert.equal(STATUS_VALUES.includes(record.status), true);
});

test('Given a record with a missing required field or invalid ready state, when validated, then it is rejected', () => {
  const record = makeValidRecord();
  for (const field of Object.keys(record)) {
    const incomplete = { ...record };
    delete incomplete[field];
    assert.throws(() => validateWjKeywordRecord(incomplete), ContractValidationError, field);
  }
  assert.throws(() => validateWjKeywordRecord({ ...record, related_keywords: ['one'], status: 'ready-to-write' }), ContractValidationError);
  assert.throws(() => validateWjKeywordRecord({ ...record, evidence_available: false, status: 'ready-to-write' }), ContractValidationError);
});

test('Given an evidence envelope, when normalized, then headers and credential-bearing fields cannot enter raw evidence', () => {
  const envelope = normalizeRawEvidenceEnvelope({
    schema_version: 1,
    provider: 'naver-api-hub',
    source: 'naver-api-hub-blog',
    endpoint: '/search/v1/blog',
    method: 'GET',
    request: { query: '엑셀', display: 10 },
    collected_at: '2026-09-09T00:00:00.000Z',
    http: { status: 200, ok: true },
    response: { total: 0, items: [] },
  });
  assert.deepEqual(envelope.request, { query: '엑셀', display: 10 });
  assert.equal('headers' in envelope.request, false);
  assert.throws(() => normalizeRawEvidenceEnvelope({ ...envelope, request: { headers: { Authorization: 'NCP_SECRET_SENTINEL' } } }), ContractValidationError);
});

test('Given a provider-shaped object, when normalized, then the boundary accepts only the required methods', async () => {
  const provider = {
    providerId: 'naver-api-hub',
    searchBlogs: async (request) => ({ ...request, total: 0, items: [] }),
    searchTrends: async (request) => ({ ...request, results: [] }),
  };
  assert.equal(isKeywordProvider(provider), true);
  const normalized = normalizeKeywordProvider(provider);
  assert.equal(normalized.providerId, 'naver-api-hub');
  assert.deepEqual(await normalized.searchBlogs({ query: 'x' }), {
    total: 0, items: [], start: 1, display: 10,
  });
  assert.equal(isKeywordProvider({ providerId: 'x', searchBlogs() {} }), false);
});

test('Given every required fixture, when loaded, then the fixture helper resolves stable paths and JSON', async () => {
  const expected = [
    'blog-success.json', 'trend-success.json', 'empty.json', 'error-401.json',
    'error-403.json', 'error-429.json', 'error-500.json', 'trend-validation.json',
  ];
  for (const name of expected) {
    const fixture = await loadFixture(name);
    assert.equal(fixture.path, fixturePath(name));
    assert.equal(typeof fixture.text, 'string');
    assert.deepEqual(JSON.parse(fixture.text), fixture.json);
  }
  assert.equal(readJsonl(['{"status":"ok"}']).length, 1);
  assert.equal(typeof readFile, 'function');
  assert.equal(typeof TREND_TIME_UNITS[0], 'string');
  assert.equal(typeof RISK_FLAGS[0], 'string');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContractValidationError,
  isKeywordProvider,
  normalizeBlogSearchResponse,
  normalizeKeywordProvider,
  normalizeTrendRequest,
  normalizeTrendResponse,
} from './lib/contracts.mjs';
import {
  createNaverApiHubProvider,
  NAVER_API_HUB_BASE_URL,
} from './lib/naver-api-hub-provider.mjs';
import { readJsonFixture } from './test-helpers.mjs';

const CLIENT_ID_ENV = 'NCP_NAVER_API_HUB_CLIENT_ID';
const CLIENT_SECRET_ENV = 'NCP_NAVER_API_HUB_CLIENT_SECRET';
const CREDS = {
  [CLIENT_ID_ENV]: 'test-client-id',
  [CLIENT_SECRET_ENV]: 'test-client-secret',
};

const BLOG_REQUEST = { query: '엑셀 자동화' };
const TREND_REQUEST = {
  startDate: '2026-09-01',
  endDate: '2026-09-09',
  timeUnit: 'date',
  keywordGroups: [{ groupName: '업무 자동화', keywords: ['엑셀 자동화', '엑셀 매크로'] }],
};

function makeMockProvider({ body, status = 200, raw, env = CREDS, timeoutMs, fetchImpl } = {}) {
  const calls = [];
  const readCounts = [];
  const defaultFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    let reads = 0;
    const text = raw !== undefined ? raw : typeof body === 'string' ? body : JSON.stringify(body);
    readCounts.push(() => reads);
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        reads += 1;
        return text;
      },
    };
  };
  const provider = createNaverApiHubProvider({ fetchImpl: fetchImpl ?? defaultFetch, env, timeoutMs });
  return { provider, calls, readCounts, get singleRead() { return readCounts.every((fn) => fn() === 1); } };
}

test('Given a blog request and a success fixture body, when searchBlogs runs, then the GET URL, API HUB headers, and normalized response are exact', async () => {
  const { provider, calls, singleRead } = makeMockProvider({ body: await readJsonFixture('blog-success.json') });
  const result = await provider.searchBlogs(BLOG_REQUEST);

  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, `${NAVER_API_HUB_BASE_URL}/search/v1/blog`);
  assert.equal(url.searchParams.get('query'), '엑셀 자동화');
  assert.equal(url.searchParams.get('display'), '10');
  assert.equal(url.searchParams.get('start'), '1');
  assert.equal(url.searchParams.get('sort'), 'sim');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.deepEqual([...url.searchParams.keys()], ['query', 'display', 'start', 'sort', 'format']);

  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.body, undefined);
  assert.equal(call.init.headers.get('X-NCP-APIGW-API-KEY-ID'), CREDS[CLIENT_ID_ENV]);
  assert.equal(call.init.headers.get('X-NCP-APIGW-API-KEY'), CREDS[CLIENT_SECRET_ENV]);
  assert.equal(call.init.headers.has('X-Naver-Client-Id'), false);
  assert.equal(call.init.headers.get('content-type'), null);
  assert.equal(call.init.signal instanceof AbortSignal, true);

  assert.deepEqual(result, normalizeBlogSearchResponse(await readJsonFixture('blog-success.json')));
  assert.equal(result.items[0].title.includes('<b>'), false);
  assert.equal(singleRead, true);
});

test('Given an explicit blog pagination and sort, when serialized, then query parameters keep the documented order', async () => {
  const { provider, calls } = makeMockProvider({ body: { total: 0, items: [] } });
  await provider.searchBlogs({ query: 'Excel', display: 5, start: 3, sort: 'date' });
  const url = new URL(calls[0].url);
  assert.deepEqual(
    ['query', 'display', 'start', 'sort', 'format'].map((key) => url.searchParams.get(key)),
    ['Excel', '5', '3', 'date', 'json'],
  );
  assert.deepEqual([...url.searchParams.keys()], ['query', 'display', 'start', 'sort', 'format']);
});

test('Given a trend request and a success fixture body, when searchTrends runs, then the POST URL, JSON body, and normalized response are exact', async () => {
  const { provider, calls, singleRead } = makeMockProvider({ body: await readJsonFixture('trend-success.json') });
  const result = await provider.searchTrends(TREND_REQUEST);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, `${NAVER_API_HUB_BASE_URL}/search-trend/v1/search`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.get('content-type'), 'application/json');
  assert.equal(call.init.headers.get('X-NCP-APIGW-API-KEY-ID'), CREDS[CLIENT_ID_ENV]);
  assert.equal(call.init.headers.get('X-NCP-APIGW-API-KEY'), CREDS[CLIENT_SECRET_ENV]);
  assert.deepEqual(JSON.parse(call.init.body), normalizeTrendRequest(TREND_REQUEST));

  assert.deepEqual(result, normalizeTrendResponse(await readJsonFixture('trend-success.json')));
  assert.equal(result.results[0].data[0].ratio, 55.1);
  assert.equal(singleRead, true);
});

test('Given optional trend filters, when serialized, then device, gender, and ages are preserved in the POST body', async () => {
  const { provider, calls } = makeMockProvider({ body: { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', results: [] } });
  const request = { ...TREND_REQUEST, device: 'pc', gender: 'm', ages: ['3', '4'] };
  await provider.searchTrends(request);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.device, 'pc');
  assert.equal(sent.gender, 'm');
  assert.deepEqual(sent.ages, ['3', '4']);
});

test('Given empty results, when the provider parses them, then a normalized empty response is returned without a failure', async () => {
  const blog = makeMockProvider({ body: { total: 0, items: [] } });
  const trend = makeMockProvider({ body: { startDate: '2026-09-01', endDate: '2026-09-09', timeUnit: 'date', results: [] } });
  assert.deepEqual(await blog.provider.searchBlogs(BLOG_REQUEST), { total: 0, items: [] });
  const trendResult = await trend.provider.searchTrends(TREND_REQUEST);
  assert.deepEqual(trendResult.results, []);
});

test('Given no client credentials, when either search runs, then an auth_missing ApiFailure is returned without any fetch', async () => {
  for (const env of [{}, { [CLIENT_ID_ENV]: 'only-id' }, { [CLIENT_SECRET_ENV]: '  ' }]) {
    const { provider, calls } = makeMockProvider({ env });
    const failure = await provider.searchBlogs(BLOG_REQUEST);
    assert.equal(failure.kind, 'auth_missing');
    assert.equal(failure.status, 0);
    assert.equal(failure.retryable, false);
    assert.deepEqual(failure.risk_flags, ['auth_missing']);
    assert.equal(typeof failure.message, 'string');
    assert.equal(calls.length, 0);
  }
});

test('Given a gateway 401 error fixture, when searchBlogs runs, then an auth_missing ApiFailure with explicit risk is returned', async () => {
  const { provider } = makeMockProvider({ status: 401, body: await readJsonFixture('error-401.json') });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'auth_missing');
  assert.equal(failure.status, 401);
  assert.equal(failure.code, 'GW_AUTHENTICATION_FAILED');
  assert.equal(failure.message, 'Authentication failed');
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.risk_flags, ['api_error', 'auth_missing']);
});

test('Given search error bodies for 403, 429, and 500, when classified, then forbidden, rate_limited, and server_error kinds are returned', async () => {
  const forbidden = await makeMockProvider({ status: 403, body: await readJsonFixture('error-403.json') }).provider.searchBlogs(BLOG_REQUEST);
  assert.deepEqual(
    { kind: forbidden.kind, code: forbidden.code, retryable: forbidden.retryable, risk_flags: forbidden.risk_flags },
    { kind: 'forbidden', code: 'GW_FORBIDDEN', retryable: false, risk_flags: ['api_error', 'forbidden'] },
  );

  const limited = await makeMockProvider({ status: 429, body: await readJsonFixture('error-429.json') }).provider.searchBlogs(BLOG_REQUEST);
  assert.equal(limited.kind, 'rate_limited');
  assert.equal(limited.status, 429);
  assert.equal(limited.retryable, true);
  assert.equal(limited.risk_flags.includes('rate_limited'), true);

  const server = await makeMockProvider({ status: 500, body: await readJsonFixture('error-500.json') }).provider.searchBlogs(BLOG_REQUEST);
  assert.deepEqual(
    { kind: server.kind, code: server.code, retryable: server.retryable, risk_flags: server.risk_flags },
    { kind: 'server_error', code: 'INTERNAL_ERROR', retryable: true, risk_flags: ['api_error'] },
  );
});

test('Given a trend validation error body, when searchTrends runs, then the errMsg/errId shape is classified as validation_error', async () => {
  const { provider } = makeMockProvider({ status: 400, body: await readJsonFixture('trend-validation.json') });
  const failure = await provider.searchTrends(TREND_REQUEST);
  assert.equal(failure.kind, 'validation_error');
  assert.equal(failure.status, 400);
  assert.equal(failure.code, 'TREND_VALIDATION_ERROR');
  assert.equal(failure.message, 'Invalid keyword group');
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.risk_flags, ['api_error']);
});

test('Given a non-JSON error body, when classified, then the HTTP status still determines the failure kind', async () => {
  const { provider } = makeMockProvider({ status: 429, raw: '<html>rate limit page</html>' });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'rate_limited');
  assert.equal(failure.status, 429);
  assert.equal(failure.retryable, true);
  assert.equal(failure.risk_flags.includes('rate_limited'), true);
});

test('Given a malformed JSON success body, when parsed, then a malformed_json ApiFailure with the malformed_response risk is returned', async () => {
  const { provider, calls, singleRead } = makeMockProvider({ raw: '{"total": 1, "items": [' });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'malformed_json');
  assert.equal(failure.status, 0);
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.risk_flags, ['malformed_response']);
  assert.equal(calls.length, 1);
  assert.equal(singleRead, true);
});

test('Given parseable JSON that violates the response contract, when normalized, then a malformed_response ApiFailure is returned', async () => {
  const { provider } = makeMockProvider({ raw: JSON.stringify({ total: 1, items: [{ title: 'only title' }] }) });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'malformed_response');
  assert.equal(failure.status, 0);
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.risk_flags, ['malformed_response']);
});

test('Given a streaming response larger than the provider limit, when searchBlogs reads it, then the body is rejected before parsing', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(1_000_001)));
      controller.close();
    },
  });
  const provider = createNaverApiHubProvider({
    env: { [CLIENT_ID_ENV]: 'client-id', [CLIENT_SECRET_ENV]: 'client-secret' },
    fetchImpl: async () => ({ ok: true, status: 200, body, text: async () => 'should not be called' }),
  });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'malformed_response');
  assert.match(failure.message, /exceeded/iu);
  assert.deepEqual(failure.risk_flags, ['malformed_response']);
});

test('Given oversized upstream text fields, when normalized, then the response contract rejects them', () => {
  assert.throws(
    () => normalizeBlogSearchResponse({
      total: 1,
      items: [{ title: 'x'.repeat(301), description: 'description', link: 'https://example.test', postdate: '20260910' }],
    }),
    ContractValidationError,
  );
});

test('Given an aborted fetch, when handled, then a retryable network_error ApiFailure with the api_error risk is returned', async () => {
  const { provider } = makeMockProvider({
    fetchImpl: async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    },
  });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'network_error');
  assert.equal(failure.status, 0);
  assert.equal(failure.retryable, true);
  assert.deepEqual(failure.risk_flags, ['api_error']);
  assert.match(failure.message, /aborted/iu);
});

test('Given a fetch timeout via the provider-owned AbortSignal, when the signal fires, then a network_error ApiFailure is returned', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    // AbortSignal.timeout uses an unref'd timer, so the mock keeps the loop
    // alive until the provider-owned signal fires, mirroring a real fetch.
    const guard = setTimeout(() => reject(new Error('mock fetch was never aborted')), 2000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(guard);
      reject(init.signal.reason);
    });
  });
  const { provider } = makeMockProvider({ fetchImpl, timeoutMs: 20 });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(failure.kind, 'network_error');
  assert.equal(failure.status, 0);
  assert.equal(failure.retryable, true);
  assert.deepEqual(failure.risk_flags, ['api_error']);
  assert.match(failure.message, /timed out/iu);
});

test('Given a generic network failure, when handled, then a retryable network_error ApiFailure is returned', async () => {
  const { provider } = makeMockProvider({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const failure = await provider.searchTrends(TREND_REQUEST);
  assert.equal(failure.kind, 'network_error');
  assert.equal(failure.retryable, true);
  assert.equal(failure.risk_flags.includes('api_error'), true);
});

test('Given secret-bearing environment values, when every failure path runs, then returned errors never contain the credentials', async () => {
  const sentinel = ['SENTINEL', 'SECRET', '9f3a'].join('_');
  const env = { [CLIENT_ID_ENV]: `id-${sentinel}`, [CLIENT_SECRET_ENV]: sentinel };
  const scenarios = [
    ['blog', 401, 'error-401.json'],
    ['blog', 429, 'error-429.json'],
    ['blog', 500, 'error-500.json'],
    ['trend', 400, 'trend-validation.json'],
  ];
  for (const [kind, status, fixture] of scenarios) {
    const { provider } = makeMockProvider({ status, body: await readJsonFixture(fixture), env });
    const failure = kind === 'blog'
      ? await provider.searchBlogs(BLOG_REQUEST)
      : await provider.searchTrends(TREND_REQUEST);
    assert.equal(JSON.stringify(failure).includes(sentinel), false, fixture);
  }
  const malformed = makeMockProvider({ raw: '{', env });
  assert.equal(JSON.stringify(await malformed.provider.searchBlogs(BLOG_REQUEST)).includes(sentinel), false);
  const aborted = makeMockProvider({ env, fetchImpl: async () => { throw new DOMException('abort', 'AbortError'); } });
  assert.equal(JSON.stringify(await aborted.provider.searchBlogs(BLOG_REQUEST)).includes(sentinel), false);
});

test('Given invalid request inputs, when the provider serializes them, then deterministic contract errors are thrown before any fetch', async () => {
  for (const badRequest of [{ query: '' }, { query: 'x', display: 0 }, { query: 'x', start: 1001 }, { query: 'x', sort: 'popular' }, { query: 'x', format: 'xml' }]) {
    const { provider, calls } = makeMockProvider({ body: { total: 0, items: [] } });
    await assert.rejects(() => provider.searchBlogs(badRequest), ContractValidationError);
    assert.equal(calls.length, 0);
  }
  const { provider, calls } = makeMockProvider({ body: { startDate: 'x', endDate: 'y', timeUnit: 'date', results: [] } });
  await assert.rejects(() => provider.searchTrends({ ...TREND_REQUEST, startDate: '2026-02-30' }), ContractValidationError);
  assert.equal(calls.length, 0);
});

test('Given the created provider, when checked against the keyword contract, then it is a valid KeywordProvider and stays normalized through the wrapper', async () => {
  const { provider } = makeMockProvider({ body: await readJsonFixture('blog-success.json') });
  assert.equal(isKeywordProvider(provider), true);
  assert.equal(provider.providerId, 'naver-api-hub');
  const wrapped = normalizeKeywordProvider(provider);
  assert.deepEqual(await wrapped.searchBlogs(BLOG_REQUEST), normalizeBlogSearchResponse(await readJsonFixture('blog-success.json')));
});

test('Given a fixture transport without any real network, when both endpoints run, then the normalized results match the success fixtures', async () => {
  const blog = makeMockProvider({ body: await readJsonFixture('blog-success.json') });
  const trend = makeMockProvider({ body: await readJsonFixture('trend-success.json') });
  const [blogResult, trendResult] = await Promise.all([
    blog.provider.searchBlogs(BLOG_REQUEST),
    trend.provider.searchTrends(TREND_REQUEST),
  ]);
  assert.deepEqual(blogResult, normalizeBlogSearchResponse(await readJsonFixture('blog-success.json')));
  assert.deepEqual(trendResult, normalizeTrendResponse(await readJsonFixture('trend-success.json')));
});


test('Given an opaque configured credential echoed by upstream, when a failure is normalized, then the value is absent from the provider result', async () => {
  const opaque = 'qaOpaqueValue9Zp3';
  const env = { [CLIENT_ID_ENV]: 'qaClientId', [CLIENT_SECRET_ENV]: opaque };
  const { provider } = makeMockProvider({
    status: 401,
    body: { errorCode: '401', errorMessage: opaque },
    env,
  });
  const failure = await provider.searchBlogs(BLOG_REQUEST);
  assert.equal(JSON.stringify(failure).includes(opaque), false);
});

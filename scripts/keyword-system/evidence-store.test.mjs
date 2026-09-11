import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import {
  ContractValidationError,
  normalizeRawEvidenceEnvelope,
} from './lib/contracts.mjs';
import {
  EvidenceStoreError,
  buildFailureEnvelope,
  deriveSafeKey,
  evidenceRelativePath,
  makeEvidenceIndexEntry,
  makeRunId,
  resolveRawRoot,
  sanitizePathSegment,
  slugifySafeKey,
  stableSerialize,
  writeEvidence,
  writeFailureEvidence,
} from './lib/evidence-store.mjs';
import { readJsonFixture } from './test-helpers.mjs';

const COLLECTED_AT = '2026-09-09T00:00:00.000Z';
const RUN_ID = '20260909T000000Z-01234567';
const FIXED_CLOCK = () => new Date('2026-09-09T00:00:00.000Z');
const FIXED_RANDOM = () => '01234567';

const BLOG_RESPONSE = () => ({
  lastBuildDate: 'Wed, 09 Sep 2026 00:00:00 +0900',
  total: 2,
  start: 1,
  display: 2,
  items: [
    { title: '<b>엑셀 자동화</b>로 <b>업무</b> 줄이기', link: 'https://blog.example.test/excel-automation', description: '반복 업무를 <b>엑셀</b> 기능으로 줄이는 방법입니다.', postdate: '20260909' },
    { title: '엑셀 매크로 시작하기', link: 'https://blog.example.test/excel-macro', description: '작은 자동화부터 확인하는 순서입니다.', postdate: '20260908' },
  ],
});

const BLOG_REQUEST = () => ({ query: '엑셀 자동화', display: 10, start: 1, sort: 'sim', format: 'json' });

const TREND_REQUEST = () => ({
  startDate: '2026-09-01',
  endDate: '2026-09-09',
  timeUnit: 'date',
  keywordGroups: [
    { groupName: '업무 자동화', keywords: ['엑셀 자동화', '엑셀 매크로'] },
    { groupName: '개발 생산성', keywords: ['Node.js'] },
  ],
});

const BLOG_BASE = () => ({
  source: 'naver-api-hub-blog',
  endpoint: '/search/v1/blog',
  method: 'GET',
  request: BLOG_REQUEST(),
  response: BLOG_RESPONSE(),
  http: { status: 200, ok: true },
  collectedAt: COLLECTED_AT,
  runId: RUN_ID,
});

const TREND_BASE = () => ({
  source: 'naver-api-hub-trend',
  endpoint: '/search-trend/v1/search',
  method: 'POST',
  request: TREND_REQUEST(),
  response: {},
  http: { status: 200, ok: true },
  collectedAt: COLLECTED_AT,
  runId: RUN_ID,
});

async function withTempRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'wj-evidence-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Given a fixed clock and random, when makeRunId runs, then the documented UTC run-id shape is returned', () => {
  assert.equal(makeRunId({ clock: FIXED_CLOCK, random: FIXED_RANDOM }), '20260909T000000Z-01234567');
  const id = makeRunId({ clock: FIXED_CLOCK });
  assert.match(id, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u);
  assert.throws(() => makeRunId({ clock: FIXED_CLOCK, random: () => 'ABCDEF12' }), /runId/iu);
});

test('Given hostile or empty keyword text, when slugified, then a safe deterministic path segment is produced', () => {
  assert.equal(slugifySafeKey('엑셀 자동화'), '엑셀-자동화');
  assert.equal(slugifySafeKey('  엑셀   자동화  '), '엑셀-자동화');
  assert.equal(slugifySafeKey('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugifySafeKey('..'), 'keyword');
  assert.equal(slugifySafeKey('a/b'), 'a-b');
  assert.equal(slugifySafeKey('a\\b'), 'a-b');
  assert.equal(slugifySafeKey('a\u0000b'), 'a-b');
  assert.equal(slugifySafeKey('...'), 'keyword');
  assert.equal(slugifySafeKey(''), 'keyword');
  const long = '키'.repeat(300);
  const slug = slugifySafeKey(long);
  assert.ok(slug.length <= 130);
  assert.equal(slug.includes('/'), false);
  assert.equal(slug.includes('\\'), false);
  assert.ok(slug.startsWith('키'));
});

test('Given path-bearing or control text, when sanitized, then no traversal or control characters survive', () => {
  for (const sample of ['../..', '../../etc/passwd', 'a/b', 'a\\b', 'a\u0000b', '.', '..']) {
    const segment = sanitizePathSegment(sample);
    assert.ok(!segment.includes('/'));
    assert.ok(!segment.includes('\\'));
    assert.ok(!segment.includes('\u0000'));
    assert.ok(!['', '.', '..'].includes(segment));
  }
  assert.equal(sanitizePathSegment('normal-1'), 'normal-1');
  assert.equal(resolveRawRoot(undefined), resolve(process.cwd(), 'data', 'keywords', 'raw'));
  assert.equal(resolveRawRoot('/tmp/example'), resolve('/tmp/example'));
});

test('Given a request per source, when deriving a safe key and relative path, then canonical components result', () => {
  assert.equal(deriveSafeKey('naver-api-hub-blog', BLOG_REQUEST()), '엑셀 자동화');
  assert.equal(deriveSafeKey('naver-api-hub-trend', TREND_REQUEST()), '업무 자동화');
  assert.equal(
    evidenceRelativePath({ collectedAt: COLLECTED_AT, runId: RUN_ID, source: 'naver-api-hub-blog', safeKey: '엑셀 자동화' }),
    '2026/09/09/20260909T000000Z-01234567/naver-api-hub-blog-엑셀-자동화.json',
  );
  assert.equal(
    evidenceRelativePath({ collectedAt: COLLECTED_AT, runId: RUN_ID, source: 'naver-api-hub-trend', safeKey: '../../etc/passwd' }),
    '2026/09/09/20260909T000000Z-01234567/naver-api-hub-trend-etc-passwd.json',
  );
});

test('Given malformed run ids, when evidence paths are derived, then non-canonical dates and uppercase hex are rejected', () => {
  assert.throws(() => evidenceRelativePath({ collectedAt: COLLECTED_AT, runId: '20260909T000000Z-ABCDEF12', source: 'naver-api-hub-blog', safeKey: '엑셀 자동화' }), /runId/iu);
  assert.throws(() => evidenceRelativePath({ collectedAt: COLLECTED_AT, runId: '20261399T999999Z-abcdef12', source: 'naver-api-hub-blog', safeKey: '엑셀 자동화' }), /runId/iu);
});

test('Given a successful blog fixture, when evidence is written, then canonical dirs, envelope, and stable 2-space JSON result', async () => {
  await withTempRoot(async (root) => {
    const result = await writeEvidence({ ...BLOG_BASE(), rootDir: root });
    const expectedEnvelope = normalizeRawEvidenceEnvelope({
      schema_version: 1,
      provider: 'naver-api-hub',
      source: 'naver-api-hub-blog',
      endpoint: '/search/v1/blog',
      method: 'GET',
      request: BLOG_REQUEST(),
      collected_at: COLLECTED_AT,
      http: { status: 200, ok: true },
      response: BLOG_RESPONSE(),
    });

    assert.equal(result.path, join(root, '2026', '09', '09', RUN_ID, 'naver-api-hub-blog-엑셀-자동화.json'));
    assert.deepEqual(result.envelope, expectedEnvelope);
    assert.deepEqual(Object.keys(result.envelope), [
      'schema_version', 'provider', 'source', 'endpoint', 'method', 'request',
      'collected_at', 'http', 'response',
    ]);
    assert.deepEqual(Object.keys(result.envelope.request), ['query', 'display', 'start', 'sort', 'format']);
    assert.equal('headers' in result.envelope.request, false);
    assert.deepEqual(result.envelope.http, { status: 200, ok: true });

    const text = await readFile(result.path, 'utf8');
    assert.equal(text, stableSerialize(expectedEnvelope));
    assert.equal(text.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(text), expectedEnvelope);
    assert.ok(text.includes('\n  "schema_version": 1,\n'), 'top-level keys are indented by two spaces');
    assert.equal(text.includes('headers'), false);
  });
});

test('Given a successful trend fixture, when evidence is written, then keyword groups and ratio values are preserved', async () => {
  await withTempRoot(async (root) => {
    const trendBody = await readJsonFixture('trend-success.json');
    const result = await writeEvidence({ ...TREND_BASE(), response: trendBody, rootDir: root });
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(result.path, join(root, '2026', '09', '09', RUN_ID, 'naver-api-hub-trend-업무-자동화.json'));
    assert.deepEqual(parsed.request.keywordGroups[0], { groupName: '업무 자동화', keywords: ['엑셀 자동화', '엑셀 매크로'] });
    assert.equal(parsed.response.results[0].data[0].ratio, 61.23);
    assert.equal(parsed.http.ok, true);
    assert.equal(parsed.error, undefined);
  });
});

test('Given the same fixed clock, id, and inputs, when written twice, then byte output and relative path are identical', async () => {
  await withTempRoot(async (rootA) => {
    await withTempRoot(async (rootB) => {
      const first = await writeEvidence({ ...BLOG_BASE(), rootDir: rootA });
      const second = await writeEvidence({ ...BLOG_BASE(), rootDir: rootB });
      assert.equal(first.path.endsWith('2026/09/09/20260909T000000Z-01234567/naver-api-hub-blog-엑셀-자동화.json'), true);
      const [bytesA, bytesB] = await Promise.all([readFile(first.path), readFile(second.path)]);
      assert.deepEqual(bytesA, bytesB);
    });
  });
});

test('Given a failed rate-limited response, when failure evidence is written, then http.ok false, explicit error, and no secrets persist', async () => {
  await withTempRoot(async (root) => {
    const sentinel = 'NCP_SECRET_SENTINEL_9f';
    const result = await writeFailureEvidence({
      source: 'naver-api-hub-blog',
      endpoint: '/search/v1/blog',
      method: 'GET',
      request: BLOG_REQUEST(),
      http: { status: 429, ok: false },
      error: { kind: 'rate_limited', code: `HUB_${sentinel}`, message: `quota exceeded; authorization=Bearer ${sentinel}; retry later`, risk_flags: ['rate_limited'] },
      collectedAt: COLLECTED_AT,
      runId: RUN_ID,
      rootDir: root,
    });
    assert.equal(result.envelope.http.ok, false);
    assert.equal(result.envelope.http.status, 429);
    assert.equal(result.envelope.error.kind, 'rate_limited');
    assert.deepEqual(result.envelope.error.risk_flags, ['api_error', 'rate_limited']);
    assert.equal(result.envelope.response, undefined);

    const text = await readFile(result.path, 'utf8');
    assert.equal(text.includes(sentinel), false);
    assert.equal(text.includes('authorization=Bearer'), false);
    assert.equal(text.includes('"response"'), false);
    assert.deepEqual(result.indexEntry.http, { status: 429, ok: false });
    assert.equal(result.indexEntry.error_kind, 'rate_limited');
  });
});

test('Given a network failure with HTTP 0, when failure evidence is written, then the network_error kind is stored', async () => {
  await withTempRoot(async (root) => {
    const result = await writeFailureEvidence({
      source: 'naver-api-hub-trend',
      endpoint: '/search-trend/v1/search',
      method: 'POST',
      request: TREND_REQUEST(),
      http: { status: 0, ok: false },
      error: { kind: 'network_error', message: 'fetch failed: socket hang up' },
      collectedAt: COLLECTED_AT,
      runId: RUN_ID,
      rootDir: root,
    });
    assert.equal(result.envelope.http.status, 0);
    assert.equal(result.envelope.error.kind, 'network_error');
    assert.equal(result.envelope.response, undefined);
  });
});

test('Given http without an ok flag, when failure evidence is written, then ok is forced false', async () => {
  await withTempRoot(async (root) => {
    const result = await writeFailureEvidence({
      source: 'naver-api-hub-blog',
      endpoint: '/search/v1/blog',
      method: 'GET',
      request: BLOG_REQUEST(),
      http: { status: 401 },
      error: { kind: 'auth_missing', message: 'credential rejected' },
      collectedAt: COLLECTED_AT,
      runId: RUN_ID,
      rootDir: root,
    });
    assert.equal(result.envelope.http.ok, false);
    assert.equal(result.envelope.error.kind, 'auth_missing');
  });
});

test('Given an auth failure without any http detail, when failure evidence is written, then a representative status is derived', async () => {
  await withTempRoot(async (root) => {
    const result = await writeFailureEvidence({
      source: 'naver-api-hub-blog',
      endpoint: '/search/v1/blog',
      method: 'GET',
      request: BLOG_REQUEST(),
      error: { kind: 'auth_missing', message: 'NCP credentials are not configured' },
      collectedAt: COLLECTED_AT,
      runId: RUN_ID,
      rootDir: root,
    });
    assert.deepEqual(result.envelope.http, { status: 401, ok: false });
  });
});

test('Given an empty or malformed response, when writeEvidence runs, then nothing is persisted', async () => {
  await withTempRoot(async (root) => {
    for (const response of [
      { total: 0, items: [] },
      { total: 1, items: [{ title: 'missing fields' }] },
    ]) {
      await assert.rejects(
        () => writeEvidence({ ...BLOG_BASE(), response, rootDir: root }),
        ContractValidationError,
      );
      assert.deepEqual(await readdir(root), []);
    }
  });
});

test('Given a credential-bearing request key or header, when evidence is written, then the write is rejected before any IO', async () => {
  await withTempRoot(async (root) => {
    const sentinel = 'NCP_SECRET_SENTINEL_x7';
    await assert.rejects(
      () => writeEvidence({ ...BLOG_BASE(), request: { query: '엑셀', headers: { Authorization: sentinel } }, rootDir: root }),
      ContractValidationError,
    );
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(
      () => writeEvidence({ ...BLOG_BASE(), request: { query: '엑셀', client_secret: sentinel }, rootDir: root }),
      ContractValidationError,
    );
    assert.deepEqual(await readdir(root), []);
  });
});

test('Given a success response containing credential-looking text, when written, then serialized bytes contain no sentinel', async () => {
  await withTempRoot(async (root) => {
    const sentinel = 'NCP_SECRET_SENTINEL_k2';
    const response = BLOG_RESPONSE();
    response.items[0].title = `보고서 Bearer ${sentinel}`;
    response.items[0].description = `참고 client_secret=${sentinel}; apiKey=${sentinel}; 이후 내용`;
    const result = await writeEvidence({ ...BLOG_BASE(), response, rootDir: root });
    const text = await readFile(result.path, 'utf8');
    assert.equal(text.includes(sentinel), false);
    assert.equal(text.includes('Bearer'), false);
    assert.equal(text.includes('client_secret='), false);
    assert.equal(JSON.stringify(result.indexEntry).includes(sentinel), false);
  });
});

test('Given a failure envelope builder input with a secret, when built, then the error envelope is redacted without IO', () => {
  const sentinel = 'NCP_SECRET_SENTINEL_q4';
  const envelope = buildFailureEnvelope({
    source: 'naver-api-hub-trend',
    endpoint: '/search-trend/v1/search',
    method: 'POST',
    request: TREND_REQUEST(),
    error: { kind: 'rate_limited', code: sentinel, message: `limit reached; Bearer ${sentinel}` },
    collectedAt: COLLECTED_AT,
  });
  assert.equal(envelope.http.ok, false);
  assert.equal(JSON.stringify(envelope).includes(sentinel), false);
  assert.equal(envelope.error.kind, 'rate_limited');
});

test('Given hostile keywords and run ids, when written, then every resolved path stays inside the raw root', async () => {
  await withTempRoot(async (root) => {
    const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
    for (const [index, query] of ['../../etc/passwd', '/etc/passwd', '..\\..\\etc', 'a/b', '..'].entries()) {
      const result = await writeEvidence({ ...BLOG_BASE(), request: { ...BLOG_REQUEST(), query }, runId: `20260909T000000Z-${String(index + 1).padStart(8, '0')}`, rootDir: root });
      assert.ok(result.path.startsWith(rootWithSep), result.path);
      assert.ok(!result.path.split(sep).includes('..'));
    }
    await withTempRoot(async (cleanRoot) => {
      const hostileRun = { ...BLOG_BASE(), runId: '../../escape' };
      await assert.rejects(() => writeEvidence({ ...hostileRun, rootDir: cleanRoot }), EvidenceStoreError);
      assert.deepEqual(await readdir(cleanRoot), []);
    });
  });
});

test('Given an invalid collected time, when evidence is written, then a deterministic error occurs before any directory is created', async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      () => writeEvidence({ ...BLOG_BASE(), collectedAt: '2026-02-30T00:00:00.000Z', rootDir: root }),
      ContractValidationError,
    );
    assert.deepEqual(await readdir(root), []);
  });
});

test('Given a directory occupying the target file name, when evidence is written, then the atomic writer removes its partial temp file', async () => {
  await withTempRoot(async (root) => {
    const target = join(root, '2026', '09', '09', RUN_ID, 'naver-api-hub-blog-엑셀-자동화.json');
    await mkdir(target, { recursive: true });
    await assert.rejects(
      () => writeEvidence({ ...BLOG_BASE(), rootDir: root }),
      (error) => error instanceof Error && typeof error.code === 'string',
    );
    const entries = await readdir(join(root, '2026', '09', '09', RUN_ID));
    assert.deepEqual(entries, ['naver-api-hub-blog-엑셀-자동화.json']);
    assert.equal(entries.some((entry) => entry.endsWith('.tmp')), false);
  });
});

test('Given successful and failed envelopes, when an index entry is made, then it is JSON-stable and traceable', async () => {
  await withTempRoot(async (root) => {
    const ok = await writeEvidence({ ...BLOG_BASE(), rootDir: root });
    const entry = makeEvidenceIndexEntry({ envelope: ok.envelope, path: ok.path, runId: RUN_ID });
    assert.deepEqual(Object.keys(entry), [
      'schema_version', 'run_id', 'source', 'endpoint', 'method', 'collected_at', 'http', 'outcome', 'path',
    ]);
    assert.equal(entry.outcome, 'success');
    assert.equal(entry.http.ok, true);
    assert.equal(entry.path, ok.path);
    assert.equal(typeof JSON.stringify(entry), 'string');

    const bad = await writeFailureEvidence({
      source: 'naver-api-hub-blog',
      endpoint: '/search/v1/blog',
      method: 'GET',
      request: BLOG_REQUEST(),
      http: { status: 500, ok: false },
      error: { kind: 'server_error', message: 'upstream exploded' },
      collectedAt: COLLECTED_AT,
      runId: '20260909T000000Z-76543210',
      rootDir: root,
    });
    assert.equal(bad.indexEntry.outcome, 'failure');
    assert.equal(bad.indexEntry.error_kind, 'server_error');
    const parsed = JSON.parse(await readFile(bad.path, 'utf8'));
    assert.deepEqual(parsed.http, { status: 500, ok: false });
  });
});


test('Given an opaque credential in an upstream failure, when failure evidence is persisted with redaction values, then neither envelope nor bytes contain it', async () => {
  await withTempRoot(async (root) => {
    const opaque = 'qaOpaqueValue9Zp3';
    const result = await writeFailureEvidence({
      source: 'naver-api-hub-blog', endpoint: '/search/v1/blog', method: 'GET', request: BLOG_REQUEST(),
      http: { status: 401, ok: false },
      error: { kind: 'auth_missing', message: opaque }, collectedAt: COLLECTED_AT, runId: RUN_ID,
      rootDir: root, redactValues: [opaque],
    });
    assert.equal(JSON.stringify(result.envelope).includes(opaque), false);
    assert.equal((await readFile(result.path, 'utf8')).includes(opaque), false);
  });
});

test('Given an existing same-run source/key evidence file, when evidence is written again, then the second write is rejected and bytes remain unchanged', async () => {
  await withTempRoot(async (root) => {
    const first = await writeEvidence({ ...BLOG_BASE(), rootDir: root });
    const before = await readFile(first.path, 'utf8');
    await assert.rejects(() => writeEvidence({ ...BLOG_BASE(), response: { ...BLOG_RESPONSE(), total: 2 }, rootDir: root }));
    assert.equal(await readFile(first.path, 'utf8'), before);
  });
});


test('Given concurrent writes to one same-run evidence target, when both complete, then exactly one installs the target atomically', async () => {
  await withTempRoot(async (root) => {
    const writes = await Promise.allSettled([
      writeEvidence({ ...BLOG_BASE(), rootDir: root }),
      writeEvidence({ ...BLOG_BASE(), rootDir: root }),
    ]);
    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((result) => result.status === 'rejected').length, 1);
    const entries = await readdir(join(root, '2026', '09', '09', RUN_ID));
    assert.equal(entries.filter((entry) => entry.endsWith('.tmp')).length, 0);
  });
});

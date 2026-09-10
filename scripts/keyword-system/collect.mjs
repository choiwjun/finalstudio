import { access, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNaverApiHubProvider } from './lib/naver-api-hub-provider.mjs';
import { discoverCandidates } from './lib/discovery.mjs';
import { normalizeKeywordKey } from './lib/contracts.mjs';
import {
  deriveSafeKey,
  evidenceRelativePath,
  makeRunId,
  writeEvidence,
  writeFailureEvidence,
  writeStableJson,
  resolveRawRoot,
} from './lib/evidence-store.mjs';
import { appendEvidenceIndexEntry } from './lib/records-store.mjs';
import { directoryFdPath, removeVerifiedFile, withExclusiveFileLock } from './lib/file-lock.mjs';
import { assertContainedPath, assertSafeOutputDir } from './lib/output-boundary.mjs';
import { readSeedFile, parseArgs } from './discover.mjs';

const DEFAULT_OUT_DIR = resolve(process.cwd(), 'data/keywords');
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/naver-api-hub');
const ISO_DAY = (date) => date.toISOString().slice(0, 10);

export class CollectCliError extends Error {
  constructor(message) { super(message); this.name = 'CollectCliError'; this.code = 'COLLECT_CLI'; }
}

function fail(message) { throw new CollectCliError(message); }

async function writeBoundedJson(path, value) {
  return withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => writeStableJson(path, value, { installPath: join(directoryFdPath(directoryHandle), basename(path)) }));
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function sourceForUrl(url) {
  return String(url).includes('/search/v1/blog') ? 'blog' : 'trend';
}

function inferFixtureStatus(file) {
  const name = String(file).toLowerCase();
  const match = name.match(/(?:error[-_])?(401|403|429|500)/u);
  if (match) return Number(match[1]);
  if (name.includes('validation')) return 400;
  return 200;
}

async function selectFixtureFile(fixture, source) {
  let value = fixture;
  if (typeof value !== 'string' || value.trim() === '') fail('fixture path is required');
  value = resolve(value);
  let isDirectory = false;
  try { isDirectory = (await stat(value)).isDirectory(); } catch {
    // A short fixture name such as `success` is resolved against the
    // checked-in source-specific fixture files.
    const shortName = basename(value).replace(/\.json$/iu, '');
    const names = shortName === 'success'
      ? [`${source}-success.json`, 'success.json']
      : [basename(value).endsWith('.json') ? basename(value) : `${basename(value)}.json`];
    for (const name of names) {
      const named = resolve(FIXTURES, name);
      if (await pathExists(named)) { value = named; break; }
    }
  }
  try { isDirectory = (await stat(value)).isDirectory(); } catch { /* handled below */ }
  if (!isDirectory) {
    if (!(await pathExists(value))) fail('fixture path could not be read');
    const base = basename(value).toLowerCase();
    const siblingName = source === 'blog' ? 'blog-success.json' : 'trend-success.json';
    // A source-specific success fixture may be paired with its sibling. Any
    // explicit error/malformed fixture, however, is intentional for both
    // calls and must not silently fall back to a success body.
    const sourceSpecific = base.includes('blog') || base.includes('trend');
    if (!sourceSpecific || base.includes(source)) return value;
    const sibling = join(dirname(value), siblingName);
    return (await pathExists(sibling)) ? sibling : value;
  }
  const names = await readdir(value);
  const candidates = source === 'blog'
    ? ['blog.json', 'blog-success.json', 'success-blog.json', 'success.json']
    : ['trend.json', 'trend-success.json', 'success-trend.json', 'success.json'];
  for (const name of candidates) if (names.includes(name)) return join(value, name);
  const sourceMatch = names.find((name) => name.toLowerCase().includes(source) && name.endsWith('.json'));
  if (sourceMatch) return join(value, sourceMatch);
  const any = names.find((name) => name.endsWith('.json'));
  if (any) return join(value, any);
  fail('fixture directory contains no JSON fixture');
}

/**
 * Build a fixture transport with the same Response-like surface used by the
 * provider. Fixture mode never puts fake credentials, headers, or body text
 * on stdout/stderr.
 */
export function createFixtureFetch(fixture) {
  return async (url) => {
    const source = sourceForUrl(url);
    const file = await selectFixtureFile(fixture, source);
    const text = await readFile(file, 'utf8');
    const status = inferFixtureStatus(file);
    return {
      status,
      ok: status >= 200 && status < 300,
      async text() { return text; },
    };
  };
}

function repositoryRelativePath(filePath, outDir) {
  const file = resolve(filePath);
  const cwdRelative = relative(resolve(process.cwd()), file);
  if (cwdRelative !== '' && !cwdRelative.startsWith(`..${sep}`) && cwdRelative !== '..') return cwdRelative.split(sep).join('/');
  const outputParts = resolve(outDir).split(sep).filter(Boolean);
  const marker = outputParts.findIndex((part, index) => part === 'data' && outputParts[index + 1] === 'keywords');
  if (marker >= 0) {
    const tail = relative(resolve(outDir), file).split(sep).filter(Boolean);
    return [...outputParts.slice(marker, marker + 2), ...tail].join('/');
  }
  return relative(resolve(outDir), file).split(sep).join('/');
}

function dateRequest(now, candidate) {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - 30 * 86_400_000);
  return {
    startDate: ISO_DAY(start),
    endDate: ISO_DAY(end),
    timeUnit: 'date',
    keywordGroups: [{
      groupName: candidate.head_keyword,
      keywords: [candidate.head_keyword, ...candidate.related_keywords].slice(0, 20),
    }],
  };
}

function assertUniqueCandidates(candidates) {
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${normalizeKeywordKey(candidate.category)}\u0000${normalizeKeywordKey(candidate.head_keyword)}`;
    if (seen.has(key)) fail(`duplicate candidate in one collection run: ${candidate.category}/${candidate.head_keyword}`);
    seen.add(key);
  }
}

async function collectOne({ provider, candidate, collectedAt, runId, rawRoot, outDir, dryRun, seenTargets, redactionValues = [] }) {
  const requests = [
    { source: 'naver-api-hub-blog', endpoint: '/search/v1/blog', method: 'GET', request: { query: candidate.head_keyword, display: 10, start: 1, sort: 'date', format: 'json' }, call: () => provider.searchBlogs({ query: candidate.head_keyword, display: 10, start: 1, sort: 'date', format: 'json' }) },
    { source: 'naver-api-hub-trend', endpoint: '/search-trend/v1/search', method: 'POST', request: dateRequest(new Date(collectedAt), candidate), call: () => provider.searchTrends(dateRequest(new Date(collectedAt), candidate)) },
  ];
  const traces = [];
  let failures = 0;
  for (const item of requests) {
    let result;
    try { result = await item.call(); } catch { result = { kind: 'api_error', status: 0, message: 'keyword provider failed', risk_flags: ['api_error'] }; }
    const failed = result && typeof result.kind === 'string';
    const empty = !failed && ((item.source === 'naver-api-hub-blog' && Array.isArray(result?.items) && result.items.length === 0) || (item.source === 'naver-api-hub-trend' && Array.isArray(result?.results) && result.results.length === 0));
    if (failed || empty) failures += 1;
    if (dryRun) {
      traces.push({ source: item.source, outcome: failed ? 'failure' : empty ? 'empty' : 'success' });
      continue;
    }
    const safeKey = deriveSafeKey(item.source, item.request);
    const relativeRaw = evidenceRelativePath({ collectedAt, runId, source: item.source, safeKey });
    const target = resolve(rawRoot, relativeRaw);
    const targetKey = `${item.source}\u0000${normalizeKeywordKey(safeKey)}`;
    if (seenTargets.has(targetKey)) fail(`duplicate evidence target in one run: ${item.source}/${safeKey}`);
    seenTargets.add(targetKey);
    if (await pathExists(target)) fail(`evidence target already exists for this run: ${item.source}/${safeKey}`);
    let persisted;
    try {
      persisted = (failed || empty)
        ? await writeFailureEvidence({
          source: item.source,
          endpoint: item.endpoint,
          method: item.method,
          request: item.request,
          http: failed && Number.isInteger(result.status) && result.status > 0 ? { status: result.status, ok: false } : { status: 502, ok: false },
          error: failed ? result : { kind: 'api_error', message: 'empty response is not usable evidence', risk_flags: ['empty_evidence'] },
          collectedAt,
          runId,
          rootDir: rawRoot,
          redactValues: redactionValues,
        })
        : await writeEvidence({ source: item.source, endpoint: item.endpoint, method: item.method, request: item.request, response: result, http: { status: 200, ok: true }, collectedAt, runId, rootDir: rawRoot, redactValues: redactionValues });
      const indexEntry = { ...persisted.indexEntry, path: repositoryRelativePath(persisted.path, outDir) };
      const indexPath = await assertContainedPath(resolve(outDir, 'evidence-index.jsonl'), outDir);
      await appendEvidenceIndexEntry({ path: indexPath, entry: indexEntry });
      traces.push({ source: item.source, outcome: empty ? 'failure' : indexEntry.outcome, path: indexEntry.path, run_id: indexEntry.run_id, collected_at: indexEntry.collected_at });
    } catch {
      // An evidence file is not valid provenance until its index line exists.
      // Remove only the file installed by this attempt; the verified parent
      // handle prevents cleanup from following a swapped symlink.
      if (persisted?.path) await removeVerifiedFile(persisted.path).catch(() => {});
      failures += 1;
      traces.push({ source: item.source, outcome: 'failure' });
    }
  }
  return { traces, failures };
}

/** Collect raw provider evidence. A failure is persisted but makes the CLI non-zero. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  await assertSafeOutputDir(args.outDir);
  const seed = await readSeedFile(args.seedFile);
  const candidates = discoverCandidates(seed);
  assertUniqueCandidates(candidates);
  if (args.dryRun) {
    // Dry runs are planning-only. They may inspect fixture paths but must not
    // construct a provider or invoke fetch, including in credentialed mode.
    if (args.fixture) {
      await selectFixtureFile(args.fixture, 'blog');
      await selectFixtureFile(args.fixture, 'trend');
    }
    console.log(`collected ${candidates.length} candidate(s), 0 successful evidence call(s) (dry-run)`);
    return { ...args, candidates, traces: candidates.map((candidate) => ({ candidate: { category: candidate.category, head_keyword: candidate.head_keyword }, evidence: [{ source: 'naver-api-hub-blog', outcome: 'planned' }, { source: 'naver-api-hub-trend', outcome: 'planned' }] })) };
  }
  const now = new Date();
  const collectedAt = now.toISOString();
  const runId = makeRunId({ clock: () => now });
  const providerEnv = args.fixture
    ? { NCP_NAVER_API_HUB_CLIENT_ID: 'fixture-client', NCP_NAVER_API_HUB_CLIENT_SECRET: 'fixture-secret' }
    : process.env;
  const redactionValues = [providerEnv.NCP_NAVER_API_HUB_CLIENT_ID, providerEnv.NCP_NAVER_API_HUB_CLIENT_SECRET].filter((value) => typeof value === 'string' && value.length > 0);
  const provider = args.fixture
    ? createNaverApiHubProvider({ fetchImpl: createFixtureFetch(args.fixture), env: providerEnv })
    : createNaverApiHubProvider({ env: providerEnv });
  const rawPath = resolve(args.outDir, 'raw');
  await assertContainedPath(rawPath, args.outDir);
  const rawRoot = resolveRawRoot(rawPath);
  const seenTargets = new Set();
  const traces = [];
  let failures = 0;
  for (const candidate of candidates) {
    const result = await collectOne({ provider, candidate, collectedAt, runId, rawRoot, outDir: args.outDir, dryRun: false, seenTargets, redactionValues });
    traces.push({ candidate: { category: candidate.category, head_keyword: candidate.head_keyword }, evidence: result.traces });
    failures += result.failures;
  }
  const candidatesPath = await assertContainedPath(resolve(args.outDir, 'candidates.json'), args.outDir);
  const collectionPath = await assertContainedPath(resolve(args.outDir, 'collection.json'), args.outDir);
  await assertContainedPath(resolve(args.outDir, 'evidence-index.jsonl'), args.outDir);
  await writeBoundedJson(candidatesPath, candidates);
  await writeBoundedJson(collectionPath, { schema_version: 1, run_id: runId, collected_at: collectedAt, candidates: traces });
  console.log(`collected ${candidates.length} candidate(s), ${traces.reduce((sum, item) => sum + item.evidence.filter((evidence) => evidence.outcome === 'success').length, 0)} successful evidence call(s); outputs data/keywords/raw, data/keywords/evidence-index.jsonl, data/keywords/collection.json`);
  if (failures > 0) fail('one or more provider/evidence operations failed');
  return { ...args, candidates, runId, collectedAt, traces };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`keyword collection failed (${error?.code ?? 'COLLECT_CLI'})`);
    process.exitCode = 1;
  });
}

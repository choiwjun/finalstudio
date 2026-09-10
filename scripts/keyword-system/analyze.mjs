import { access, mkdir, readdir, readFile, rm, stat as statPath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCandidate } from './lib/analysis.mjs';
import { discoverCandidates } from './lib/discovery.mjs';
import { normalizeRawEvidenceEnvelope } from './lib/contracts.mjs';
import { readRecords, upsertRecords, writeReadyToWriteExport } from './lib/records-store.mjs';
import { readSeedFile } from './discover.mjs';
import { assertContainedPath, assertSafeOutputDir } from './lib/output-boundary.mjs';

const DEFAULT_OUT_DIR = resolve(process.cwd(), 'data/keywords');
const DEFAULT_RECORDS = resolve(DEFAULT_OUT_DIR, 'records.json');
const DEFAULT_RAW = resolve(DEFAULT_OUT_DIR, 'raw');

export class AnalyzeCliError extends Error {
  constructor(message) { super(message); this.name = 'AnalyzeCliError'; this.code = 'ANALYZE_CLI'; }
}
const fail = (message) => { throw new AnalyzeCliError(message); };

export function parseAnalyzeArgs(argv = []) {
  const result = { seedFile: resolve(process.cwd(), 'data/keywords/seeds.json'), outDir: DEFAULT_OUT_DIR, raw: DEFAULT_RAW, records: DEFAULT_RECORDS, rawExplicit: false, dryRun: false };
  const aliases = new Map([
    ['--seed-file', 'seedFile'], ['--out-dir', 'outDir'], ['--raw', 'raw'], ['--raw-dir', 'raw'],
    ['--evidence', 'raw'], ['--evidence-path', 'raw'], ['--raw-evidence', 'raw'],
    ['--records', 'records'], ['--records-path', 'records'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') { result.dryRun = true; continue; }
    const key = aliases.get(flag);
    if (!key) fail(`unknown argument ${JSON.stringify(flag)}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) fail(`${flag} requires a value`);
    result[key] = resolve(value);
    if (key === 'raw') result.rawExplicit = true;
    index += 1;
  }
  const hasOutDir = argv.includes('--out-dir');
  const hasRecords = argv.some((value) => ['--records', '--records-path'].includes(value));
  if (!hasOutDir && hasRecords) result.outDir = dirname(result.records);
  if (!hasRecords && result.outDir !== DEFAULT_OUT_DIR) result.records = join(result.outDir, 'records.json');
  if (!result.rawExplicit && result.outDir !== DEFAULT_OUT_DIR) result.raw = join(result.outDir, 'raw');
  return result;
}

async function readJson(path, label) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { fail(`${label} could not be read`); }
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}
async function readOptionalJson(path, label) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    fail(`${label} could not be read`);
  }
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}

async function filesUnder(path) {
  let info;
  try { info = await statPath(path); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    fail('raw evidence path could not be inspected');
  }
  if (info.isFile()) return [path];
  if (!info.isDirectory()) fail('raw evidence path must be a file or directory');
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(child));
    else if (entry.isFile()) {
      if (entry.name === '.gitkeep') continue;
      if (!entry.name.endsWith('.json')) fail('raw evidence directory contains a non-JSON file');
      result.push(child);
    } else fail('raw evidence directory contains an unsupported entry');
  }
  return result.sort();
}

function candidateKey(candidate) { return `${candidate.category}\u0000${candidate.head_keyword.normalize('NFC').toLowerCase()}`; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function loadCandidates(args) {
  const artifactPath = join(args.outDir, 'candidates.json');
  const parsed = await readOptionalJson(artifactPath, 'candidates artifact');
  if (parsed !== undefined) {
    if (!Array.isArray(parsed) || parsed.some((candidate) => !isObject(candidate) || typeof candidate.category !== 'string' || typeof candidate.head_keyword !== 'string')) fail('candidates artifact is malformed');
    return parsed;
  }
  const seed = await readSeedFile(args.seedFile);
  return discoverCandidates(seed);
}

async function loadCollectionManifest(outDir) {
  const parsed = await readOptionalJson(join(outDir, 'collection.json'), 'collection manifest');
  if (parsed === undefined) return undefined;
  if (!isObject(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.candidates)) fail('collection manifest is malformed');
  for (const entry of parsed.candidates) {
    if (!isObject(entry) || !isObject(entry.candidate) || typeof entry.candidate.category !== 'string' || typeof entry.candidate.head_keyword !== 'string' || !Array.isArray(entry.evidence) || entry.evidence.length === 0) fail('collection manifest contains an invalid evidence mapping');
    for (const evidence of entry.evidence) {
      if (!isObject(evidence) || typeof evidence.path !== 'string' || evidence.path.trim() === '' || evidence.path.startsWith('/') || evidence.path.includes('\\') || evidence.path.includes('/../') || evidence.path.startsWith('../')) fail('collection manifest contains an unsafe evidence path');
    }
  }
  return parsed;
}

function resolveManifestPath(value, outDir, raw) {
  if (value.startsWith('data/keywords/')) return resolve(outDir, value.slice('data/keywords/'.length));
  if (value.startsWith('raw/')) return resolve(outDir, value);
  return resolve(dirname(raw), value);
}

async function loadRawEnvelopes(paths) {
  const result = new Map();
  for (const path of paths) {
    let parsed;
    try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { fail('raw evidence contains malformed JSON'); }
    let envelope;
    try { envelope = normalizeRawEvidenceEnvelope(parsed); } catch { fail('raw evidence contains an invalid envelope'); }
    result.set(resolve(path), envelope);
  }
  return result;
}

function matchesEnvelope(envelope, candidate) {
  if (envelope.source === 'naver-api-hub-blog') return envelope.request?.query === candidate.head_keyword;
  return Array.isArray(envelope.request?.keywordGroups) && envelope.request.keywordGroups.some((group) => group.groupName === candidate.head_keyword || group.keywords?.includes(candidate.head_keyword));
}

async function evidenceForCandidate(candidate, manifest, args, rawEnvelopes) {
  if (manifest !== undefined) {
    const mapping = manifest.candidates.find((entry) => candidateKey(entry.candidate) === candidateKey(candidate));
    if (!mapping) fail('collection manifest is missing a candidate evidence mapping');
    const envelopes = [];
    for (const entry of mapping.evidence) {
      const path = await assertContainedPath(resolveManifestPath(entry.path, args.outDir, args.raw), args.outDir);
      const envelope = rawEnvelopes.get(resolve(path));
      if (envelope === undefined) fail('collection manifest references missing raw evidence');
      envelopes.push(envelope);
    }
    return envelopes;
  }
  const matched = [...rawEnvelopes.values()].filter((envelope) => matchesEnvelope(envelope, candidate));
  if (matched.length === 0) fail('missing raw evidence for candidate');
  return matched;
}

function buildAnalysisEvents(analysed, existingMap) {
  const events = {};
  for (const record of analysed) {
    const previous = existingMap.get(candidateKey(record));
    if (previous === undefined && record.status === 'ready-to-write') events[candidateKey(record)] = { type: 'analysis_success' };
    else if (previous !== undefined && previous.status !== record.status) {
      const type = record.status === 'ready-to-write'
        ? 'analysis_success'
        : record.status === 'candidate' && ['researching', 'ready-to-write'].includes(previous.status)
          ? 'analysis_failure'
          : undefined;
      if (type !== undefined) events[candidateKey(record)] = { type };
    }
  }
  return events;
}

/** Analyze raw evidence and update only canonical records and the manual export. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseAnalyzeArgs(argv);
  await assertSafeOutputDir(args.outDir);
  const recordsPath = await assertContainedPath(args.records, args.outDir);
  const rawPath = await assertContainedPath(args.raw, args.outDir);
  const readyPath = await assertContainedPath(join(args.outDir, 'ready-to-write.json'), args.outDir);
  const decisionsPath = await assertContainedPath(join(args.outDir, 'decisions.jsonl'), args.outDir);
  if (!args.dryRun) {
    await rm(readyPath, { force: true });
    try { await access(decisionsPath); } catch { await mkdir(args.outDir, { recursive: true }); await writeFile(decisionsPath, '', 'utf8'); }
  }
  const candidates = await loadCandidates(args);
  const manifest = args.rawExplicit ? undefined : await loadCollectionManifest(args.outDir);
  const rawFiles = await filesUnder(rawPath);
  const rawEnvelopes = await loadRawEnvelopes(rawFiles);
  const existing = await readRecords(recordsPath);
  const existingMap = new Map(existing.map((record) => [candidateKey(record), record]));
  for (const candidate of candidates) {
    const previous = existingMap.get(candidateKey(candidate));
    if (previous && (previous.status === 'written' || previous.status === 'rejected')) fail('invalid transition for terminal record');
  }
  const now = new Date();
  const analysed = [];
  let failures = 0;
  for (const candidate of candidates) {
    try {
      const evidence = await evidenceForCandidate(candidate, manifest, args, rawEnvelopes);
      const previous = existingMap.get(candidateKey(candidate));
      const input = previous ? { ...candidate, status: previous.status, source: previous.source, collected_at: previous.collected_at } : candidate;
      const record = analyzeCandidate(input, evidence, { now: () => now });
      analysed.push(record);
      if (!record.evidence_available || record.risk_flags.some((flag) => ['api_error', 'rate_limited', 'auth_missing', 'forbidden', 'malformed_response', 'empty_evidence'].includes(flag))) failures += 1;
    } catch { failures += 1; }
  }
  let records = existing;
  if (!args.dryRun) {
    await mkdir(args.outDir, { recursive: true });
    if (analysed.length > 0) records = await upsertRecords(analysed, { path: recordsPath, decisionsPath, events: buildAnalysisEvents(analysed, existingMap) });
    if (failures > 0) await writeReadyToWriteExport([], { path: readyPath });
    else await writeReadyToWriteExport(records, { path: readyPath, recordsPath });
  }
  console.log(`analyzed ${analysed.length} candidate(s), ${analysed.filter((record) => record.status === 'ready-to-write').length} ready-to-write candidate(s)${args.dryRun ? ' (dry-run)' : ''}`);
  if (failures > 0) fail('one or more candidates lacked clean evidence or had an invalid transition');
  return { ...args, records, analysed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`keyword analysis failed (${error?.code ?? 'ANALYZE_CLI'})`);
    process.exitCode = 1;
  });
}

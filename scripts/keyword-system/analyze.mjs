import { access, mkdir, readdir, readFile, stat as statPath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCandidate } from './lib/analysis.mjs';
import { discoverCandidates } from './lib/discovery.mjs';
import { normalizeRawEvidenceEnvelope } from './lib/contracts.mjs';
import { readRecords, upsertRecords, writeReadyToWriteExport } from './lib/records-store.mjs';
import { readSeedFile } from './discover.mjs';

const DEFAULT_OUT_DIR = resolve(process.cwd(), 'data/keywords');
const DEFAULT_RECORDS = resolve(DEFAULT_OUT_DIR, 'records.json');
const DEFAULT_RAW = resolve(DEFAULT_OUT_DIR, 'raw');

export class AnalyzeCliError extends Error {
  constructor(message) { super(message); this.name = 'AnalyzeCliError'; this.code = 'ANALYZE_CLI'; }
}
function fail(message) { throw new AnalyzeCliError(message); }

export function parseAnalyzeArgs(argv = []) {
  const result = { seedFile: resolve(process.cwd(), 'data/keywords/seeds.json'), outDir: DEFAULT_OUT_DIR, raw: DEFAULT_RAW, records: DEFAULT_RECORDS, dryRun: false };
  const aliases = new Map([
    ['--seed-file', 'seedFile'], ['--out-dir', 'outDir'], ['--raw', 'raw'], ['--raw-dir', 'raw'],
    ['--evidence', 'raw'], ['--evidence-path', 'raw'], ['--raw-evidence', 'raw'], ['--records', 'records'], ['--records-path', 'records'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') { result.dryRun = true; continue; }
    const key = aliases.get(flag);
    if (!key) fail(`unknown argument ${JSON.stringify(flag)}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) fail(`${flag} requires a value`);
    result[key] = resolve(value);
    index += 1;
  }
  const hasOutDir = argv.includes('--out-dir');
  const hasRecords = argv.some((value) => ['--records', '--records-path'].includes(value));
  const hasRaw = argv.some((value) => ['--raw', '--raw-dir', '--evidence', '--evidence-path', '--raw-evidence'].includes(value));
  // When only --records is supplied, put sibling artifacts beside it. An
  // explicit --out-dir remains authoritative for temporary workspaces.
  if (!hasOutDir && hasRecords) result.outDir = dirname(result.records);
  if (!hasRecords && result.outDir !== DEFAULT_OUT_DIR) result.records = join(result.outDir, 'records.json');
  if (!hasRaw && result.outDir !== DEFAULT_OUT_DIR) result.raw = join(result.outDir, 'raw');
  return result;
}

async function readJson(path, label) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { fail(`${label} could not be read`); }
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}

async function filesUnder(path) {
  let stat;
  try {
    stat = await statPath(path);
  } catch { return []; }
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(child));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(child);
  }
  return result;
}

function candidateKey(candidate) { return `${candidate.category}\u0000${candidate.head_keyword.normalize('NFC').toLowerCase()}`; }

function resolveEvidencePath(value, outDir, raw) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  if (value.startsWith('data/keywords/')) {
    return resolve(outDir, value.slice('data/keywords/'.length));
  }
  if (value.startsWith('raw/')) return resolve(outDir, value);
  if (value.startsWith('/')) return resolve(value);
  return resolve(dirname(raw), value);
}

async function loadCollectionManifest(outDir) {
  const path = join(outDir, 'collection.json');
  try {
    const parsed = await readJson(path, 'collection manifest');
    if (parsed && Array.isArray(parsed.candidates)) return parsed;
  } catch { /* fallback to scanning raw evidence */ }
  return undefined;
}

async function loadCandidates(args) {
  const path = join(args.outDir, 'candidates.json');
  try {
    const parsed = await readJson(path, 'candidates artifact');
    if (Array.isArray(parsed)) return parsed;
  } catch { /* explicit seed remains the source of truth */ }
  const seed = await readSeedFile(args.seedFile);
  return discoverCandidates(seed);
}

async function loadEnvelopes(paths) {
  const envelopes = [];
  for (const path of paths) {
    let parsed;
    try { parsed = await readJson(path, 'raw evidence'); } catch { fail('raw evidence is missing or unreadable'); }
    try { envelopes.push(normalizeRawEvidenceEnvelope(parsed)); } catch { fail('raw evidence has an invalid envelope'); }
  }
  return envelopes;
}

function matchesEnvelope(envelope, candidate) {
  if (envelope.source === 'naver-api-hub-blog') return envelope.request?.query === candidate.head_keyword;
  const groups = envelope.request?.keywordGroups;
  return Array.isArray(groups) && groups.some((group) => group.groupName === candidate.head_keyword || group.keywords?.includes(candidate.head_keyword));
}

async function evidenceForCandidate(candidate, manifest, args, allFiles) {
  if (manifest) {
    const item = manifest.candidates.find((entry) => entry.candidate && candidateKey(entry.candidate) === candidateKey(candidate));
    if (item) {
      const paths = (item.evidence ?? []).map((entry) => resolveEvidencePath(entry.path, args.outDir, args.raw)).filter(Boolean);
      if (paths.length === 0) fail(`missing raw evidence for ${candidate.head_keyword}`);
      return loadEnvelopes(paths);
    }
  }
  const parsed = [];
  for (const path of allFiles) {
    try {
      const value = normalizeRawEvidenceEnvelope(JSON.parse(await readFile(path, 'utf8')));
      if (matchesEnvelope(value, candidate)) parsed.push(value);
    } catch { /* unrelated or incomplete files are reported by their candidate match */ }
  }
  if (parsed.length === 0) fail(`missing raw evidence for ${candidate.head_keyword}`);
  return parsed;
}

/** Analyze persisted raw evidence and update only the canonical/manual stores. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseAnalyzeArgs(argv);
  const candidates = await loadCandidates(args);
  const manifest = await loadCollectionManifest(args.outDir);
  const allFiles = await filesUnder(args.raw);
  const existing = await readRecords(args.records);
  const existingMap = new Map(existing.map((record) => [candidateKey(record), record]));
  // Terminal records require explicit human events. Refuse the complete run
  // before any non-terminal sibling can be persisted.
  for (const candidate of candidates) {
    const prior = existingMap.get(candidateKey(candidate));
    if (prior && (prior.status === 'written' || prior.status === 'rejected')) fail('invalid transition for terminal record');
  }
  const now = new Date();
  const analysed = [];
  let failures = 0;
  for (const candidate of candidates) {
    let evidence;
    try {
      evidence = await evidenceForCandidate(candidate, manifest, args, allFiles);
      const prior = existingMap.get(candidateKey(candidate));
      const input = prior ? { ...candidate, status: prior.status, source: prior.source, collected_at: prior.collected_at } : candidate;
      const record = analyzeCandidate(input, evidence, { now: () => now });
      analysed.push(record);
      if (!record.evidence_available || record.risk_flags.some((flag) => ['api_error', 'rate_limited', 'auth_missing', 'forbidden', 'malformed_response', 'empty_evidence'].includes(flag))) failures += 1;
    } catch {
      failures += 1;
    }
  }
  let records = existing;
  if (!args.dryRun) {
    const decisionsPath = join(args.outDir, 'decisions.jsonl');
    await mkdir(args.outDir, { recursive: true });
    try { await access(decisionsPath); } catch { await writeFile(decisionsPath, '', 'utf8'); }
    if (analysed.length > 0) records = await upsertRecords(analysed, { path: args.records, decisionsPath });
    else if (candidates.length > 0) fail('no candidate could be analyzed');
    await writeReadyToWriteExport(records, { path: join(args.outDir, 'ready-to-write.json') });
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

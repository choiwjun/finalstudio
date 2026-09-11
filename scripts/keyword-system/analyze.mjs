import { lstat, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCandidate } from './lib/analysis.mjs';
import { discoverCandidates } from './lib/discovery.mjs';
import { normalizeKeywordKey, normalizeRawEvidenceEnvelope } from './lib/contracts.mjs';
import { readRecords, upsertRecords, writeReadyToWriteExport } from './lib/records-store.mjs';
import { readSeedFile } from './discover.mjs';
import { appendFileAtDirectory, assertDirectoryHandleIdentity, assertFileHandleIdentity, assertFilePathIdentity, directoryFdPath, openReadOnlyFileAtDirectory, openVerifiedChildDirectory, openVerifiedDirectory, removeVerifiedFile, snapshotFileIdentity } from './lib/file-lock.mjs';
import { isCanonicalRunId } from './lib/evidence-store.mjs';
import { assertContainedPath, assertSafeOutputDir } from './lib/output-boundary.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SEED_FILE = resolve(REPOSITORY_ROOT, 'data/keywords/seeds.json');
const DEFAULT_OUT_DIR = resolve(REPOSITORY_ROOT, 'data/keywords');
const DEFAULT_RECORDS = resolve(DEFAULT_OUT_DIR, 'records.json');
const DEFAULT_RAW = resolve(DEFAULT_OUT_DIR, 'raw');

export class AnalyzeCliError extends Error {
  constructor(message) { super(message); this.name = 'AnalyzeCliError'; this.code = 'ANALYZE_CLI'; }
}
const fail = (message) => { throw new AnalyzeCliError(message); };

export function parseAnalyzeArgs(argv = []) {
  const result = { seedFile: DEFAULT_SEED_FILE, outDir: DEFAULT_OUT_DIR, raw: DEFAULT_RAW, records: DEFAULT_RECORDS, rawExplicit: false, dryRun: false };
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

async function readVerifiedText(path, label, optional = false) {
  const filePath = resolve(path);
  const expected = await snapshotFileIdentity(filePath);
  if (expected.parentIdentity === undefined || expected.fileIdentity === undefined) {
    if (optional) return undefined;
    fail(`${label} could not be read`);
  }
  let directoryHandle;
  try { directoryHandle = await openVerifiedDirectory(dirname(filePath), { create: false }); }
  catch { fail(`${label} could not be read`); }
  let file;
  try {
    await assertDirectoryHandleIdentity(directoryHandle, expected.parentIdentity);
    try { file = await openReadOnlyFileAtDirectory(directoryHandle, basename(filePath), { expectedIdentity: expected.fileIdentity }); }
    catch { fail(`${label} could not be read`); }
    await assertFileHandleIdentity(file);
    await assertFilePathIdentity(directoryHandle, basename(filePath), file.identity);
    const text = await file.handle.readFile('utf8');
    await assertFileHandleIdentity(file);
    await assertFilePathIdentity(directoryHandle, basename(filePath), file.identity);
    return text;
  } finally {
    await file?.handle.close().catch(() => {});
    await directoryHandle.close().catch(() => {});
  }
}
async function readJson(path, label) {
  const text = await readVerifiedText(path, label);
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}
async function readOptionalJson(path, label) {
  const text = await readVerifiedText(path, label, true);
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}

async function filesUnder(path) {
  const rootPath = resolve(path);
  let rootHandle;
  try { rootHandle = await openVerifiedDirectory(rootPath, { create: false }); }
  catch (error) {
    if (error?.code === 'ENOENT') return { files: [], directories: [] };
    if (error?.code !== 'ENOTDIR') fail('raw evidence path could not be inspected');
    let parentHandle;
    try { parentHandle = await openVerifiedDirectory(dirname(rootPath), { create: false }); }
    catch (parentError) { if (parentError?.code === 'ENOENT') return { files: [], directories: [] }; throw parentError; }
    try {
      const file = await openReadOnlyFileAtDirectory(parentHandle, basename(rootPath));
      return { files: [{ path: rootPath, parentHandle, file }], directories: [parentHandle] };
    } catch (fileError) {
      await parentHandle.close().catch(() => {});
      if (fileError?.code === 'ENOENT') return { files: [], directories: [] };
      throw fileError;
    }
  }
  const directories = [rootHandle];
  const files = [];
  async function walk(directoryHandle, directoryPath) {
    const entries = await readdir(directoryFdPath(directoryHandle), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        const childHandle = await openVerifiedChildDirectory(directoryHandle, entry.name);
        directories.push(childHandle);
        await walk(childHandle, childPath);
      } else if (entry.isFile()) {
        if (entry.name === '.gitkeep') continue;
        if (!entry.name.endsWith('.json')) fail('raw evidence directory contains a non-JSON file');
        const expectedIdentity = await lstat(join(directoryFdPath(directoryHandle), entry.name));
        if (expectedIdentity.isSymbolicLink() || !expectedIdentity.isFile()) fail('raw evidence directory contains an unsupported entry');
        files.push({ path: childPath, parentHandle: directoryHandle, file: await openReadOnlyFileAtDirectory(directoryHandle, entry.name, { expectedIdentity }) });
      } else fail('raw evidence directory contains an unsupported entry');
    }
  }
  try { await walk(rootHandle, rootPath); return { files, directories }; }
  catch (error) {
    await Promise.all(files.map((entry) => entry.file.handle.close().catch(() => {})));
    await Promise.all(directories.map((entry) => entry.close().catch(() => {})));
    throw error;
  }
}

function candidateKey(candidate) { return `${normalizeKeywordKey(candidate.category)}\u0000${normalizeKeywordKey(candidate.head_keyword)}`; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function loadCandidates(args) {
  const artifactPath = join(args.outDir, 'candidates.json');
  const parsed = await readOptionalJson(artifactPath, 'candidates artifact');
  if (parsed !== undefined) {
    if (!Array.isArray(parsed) || parsed.some((candidate) => !isObject(candidate) || typeof candidate.category !== 'string' || typeof candidate.head_keyword !== 'string')) fail('candidates artifact is malformed');
    const keys = new Set();
    for (const candidate of parsed) { const key = candidateKey(candidate); if (keys.has(key)) fail('candidates artifact contains duplicate candidates'); keys.add(key); }
    return parsed;
  }
  const seed = await readSeedFile(args.seedFile);
  return discoverCandidates(seed);
}

function runIdFromPath(path) {
  const match = path.match(/(?:^|[/\\])([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})(?:[/\\]|$)/u);
  return match?.[1] && isCanonicalRunId(match[1]) ? match[1] : undefined;
}

async function loadCollectionManifest(outDir) {
  const parsed = await readOptionalJson(join(outDir, 'collection.json'), 'collection manifest');
  if (parsed === undefined) fail('collection manifest is required for collected analysis');
  if (!isObject(parsed) || parsed.schema_version !== 1 || typeof parsed.run_id !== 'string' || runIdFromPath(parsed.run_id) !== parsed.run_id || typeof parsed.collected_at !== 'string' || !Array.isArray(parsed.candidates)) fail('collection manifest is malformed');
  const keys = new Set();
  for (const entry of parsed.candidates) {
    if (!isObject(entry) || !isObject(entry.candidate) || typeof entry.candidate.category !== 'string' || typeof entry.candidate.head_keyword !== 'string' || !Array.isArray(entry.evidence) || entry.evidence.length !== 2) fail('collection manifest contains an invalid evidence mapping');
    const key = candidateKey(entry.candidate);
    if (keys.has(key)) fail('collection manifest contains duplicate candidate mappings');
    keys.add(key);
    const sources = new Set();
    for (const evidence of entry.evidence) {
      if (!isObject(evidence) || typeof evidence.path !== 'string' || evidence.path.trim() === '' || isAbsolute(evidence.path) || evidence.path.includes('\\') || evidence.path.includes('/../') || evidence.path.startsWith('../') || !['success', 'failure'].includes(evidence.outcome) || evidence.run_id !== parsed.run_id || evidence.collected_at !== parsed.collected_at || !['naver-api-hub-blog', 'naver-api-hub-trend'].includes(evidence.source) || sources.has(evidence.source)) fail('collection manifest contains an invalid evidence mapping');
      sources.add(evidence.source);
    }
    if (sources.size !== 2) fail('collection manifest is missing a required collection source');
  }
  return parsed;
}

function resolveManifestPath(value, outDir, raw) {
  if (value.startsWith('data/keywords/')) return resolve(outDir, value.slice('data/keywords/'.length));
  if (value.startsWith('raw/')) return resolve(outDir, value);
  return resolve(dirname(raw), value);
}

async function loadRawEnvelopes(rawFiles) {
  const result = new Map();
  try {
    for (const entry of rawFiles.files) {
      await assertFileHandleIdentity(entry.file);
      await assertFilePathIdentity(entry.parentHandle, basename(entry.path), entry.file.identity);
      let parsed;
      try { parsed = JSON.parse(await entry.file.handle.readFile('utf8')); } catch { fail('raw evidence contains malformed JSON'); }
      await assertFileHandleIdentity(entry.file);
      await assertFilePathIdentity(entry.parentHandle, basename(entry.path), entry.file.identity);
      let envelope;
      try { envelope = normalizeRawEvidenceEnvelope(parsed); } catch { fail('raw evidence contains an invalid envelope'); }
      const path = resolve(entry.path);
      result.set(path, { envelope, path, runId: runIdFromPath(path) });
    }
    return result;
  } finally {
    await Promise.all(rawFiles.files.map((entry) => entry.file.handle.close().catch(() => {})));
    await Promise.all(rawFiles.directories.map((entry) => entry.close().catch(() => {})));
  }
}

function matchesEnvelope(envelope, candidate) {
  if (envelope.source === 'naver-api-hub-blog') return normalizeKeywordKey(envelope.request?.query) === normalizeKeywordKey(candidate.head_keyword);
  return Array.isArray(envelope.request?.keywordGroups) && envelope.request.keywordGroups.some((group) => normalizeKeywordKey(group.groupName) === normalizeKeywordKey(candidate.head_keyword));
}

function outcomeForEnvelope(envelope) { return envelope.http.ok ? 'success' : 'failure'; }

function assertEvidencePathUnderRaw(path, raw) {
  const suffix = relative(resolve(raw), resolve(path));
  if (suffix === '..' || suffix.startsWith(`..${requireSep()}`) || isAbsolute(suffix)) fail('collection evidence path is outside raw evidence');
}
function requireSep() { return process.platform === 'win32' ? '\\' : '/'; }
function canonicalEvidencePath(value, outDir, raw) {
  const path = resolveManifestPath(value, outDir, raw);
  assertEvidencePathUnderRaw(path, raw);
  return resolve(path);
}
function samePathSet(left, right) { return left.size === right.size && [...left].every((path) => right.has(path)); }

function validateRawSet(candidates, rawEnvelopes, { requireRunId = false } = {}) {
  if (rawEnvelopes.size === 0) fail('raw evidence set is empty');
  for (const item of rawEnvelopes.values()) {
    if (requireRunId && !item.runId) fail('raw evidence path is missing a valid run id');
    const matches = candidates.filter((candidate) => matchesEnvelope(item.envelope, candidate));
    if (matches.length !== 1) fail('raw evidence is not bound to exactly one candidate');
  }
}

async function loadEvidenceIndex(path) {
  const text = await readVerifiedText(path, 'evidence index');
  const entries = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === '') continue;
    try { const entry = JSON.parse(line); if (!isObject(entry)) throw new Error(); entries.push(entry); }
    catch { fail(`evidence index line ${index + 1} is not valid JSON`); }
  }
  return entries;
}

function validateManifestIndex(manifest, entries, args, rawEnvelopes) {
  const byPath = new Map();
  for (const entry of entries) {
    if (typeof entry.path !== 'string' || isAbsolute(entry.path) || entry.path.includes('\\') || entry.path.startsWith('../') || entry.path.includes('/../')) fail('evidence index contains duplicate or invalid paths');
    const path = canonicalEvidencePath(entry.path, args.outDir, args.raw);
    if (byPath.has(path) || entry.run_id !== runIdFromPath(path)) fail('evidence index contains duplicate or non-canonical paths');
    byPath.set(path, entry);
  }
  const assignedPaths = new Set();
  for (const mapping of manifest.candidates) for (const evidence of mapping.evidence) {
    const path = canonicalEvidencePath(evidence.path, args.outDir, args.raw);
    if (assignedPaths.has(path)) fail('collection manifest reuses raw evidence path across candidates');
    assignedPaths.add(path);
    const indexed = byPath.get(path);
    if (!indexed || indexed.source !== evidence.source || indexed.outcome !== evidence.outcome || indexed.run_id !== evidence.run_id || indexed.collected_at !== evidence.collected_at) fail('collection manifest evidence is not backed by a consistent evidence index');
  }
  const currentIndexPaths = new Set([...byPath.entries()].filter(([, entry]) => entry.run_id === manifest.run_id).map(([path]) => path));
  const currentRawPaths = new Set([...rawEnvelopes.values()].filter((item) => item.runId === manifest.run_id).map((item) => item.path));
  if (!samePathSet(assignedPaths, currentIndexPaths) || !samePathSet(assignedPaths, currentRawPaths)) fail('current collection run contains unreferenced or missing evidence');
}

async function evidenceForCandidate(candidate, manifest, args, rawEnvelopes) {
  const mapping = manifest?.candidates.find((entry) => candidateKey(entry.candidate) === candidateKey(candidate));
  if (manifest !== undefined) {
    if (!mapping) fail('collection manifest is missing a candidate evidence mapping');
    const envelopes = [];
    const seenPaths = new Set();
    const sources = new Set();
    for (const entry of mapping.evidence) {
      const path = await assertContainedPath(resolveManifestPath(entry.path, args.outDir, args.raw), args.outDir);
      assertEvidencePathUnderRaw(path, args.raw);
      if (seenPaths.has(path)) fail('collection manifest references duplicate raw evidence');
      seenPaths.add(path);
      const item = rawEnvelopes.get(resolve(path));
      if (item === undefined || item.runId !== manifest.run_id) fail('collection manifest references missing raw evidence');
      if (item.envelope.source !== entry.source || outcomeForEnvelope(item.envelope) !== entry.outcome || item.envelope.collected_at !== manifest.collected_at || !matchesEnvelope(item.envelope, candidate)) fail('collection manifest evidence does not match its candidate');
      sources.add(item.envelope.source);
      envelopes.push(item.envelope);
    }
    if (sources.size !== 2) fail('collection manifest evidence is incomplete');
    return envelopes;
  }
  const matched = [...rawEnvelopes.values()].filter((item) => matchesEnvelope(item.envelope, candidate));
  const sources = new Set(matched.map((item) => item.envelope.source));
  const runs = new Set(matched.map((item) => item.runId));
  if (matched.length !== 2 || sources.size !== 2 || matched.some((item) => !item.runId) || runs.size !== 1) fail('raw evidence set is incomplete for candidate');
  return matched.map((item) => item.envelope);
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
  const indexPath = await assertContainedPath(join(args.outDir, 'evidence-index.jsonl'), args.outDir);
  if (!args.dryRun) {
    await removeVerifiedFile(readyPath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    await removeVerifiedFile(`${readyPath}.commit.json`).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    // Invalidate stale actionable state immediately, including validation
    // failures before raw/manifest loading has begun.
    await writeReadyToWriteExport([], { path: readyPath });
    const outputHandle = await openVerifiedDirectory(args.outDir);
    try { await appendFileAtDirectory(outputHandle, 'decisions.jsonl', ''); }
    finally { await outputHandle.close().catch(() => {}); }
  }
  const candidates = await loadCandidates(args);
  const manifest = args.rawExplicit ? undefined : await loadCollectionManifest(args.outDir);
  if (manifest !== undefined) {
    const candidateKeys = new Set(candidates.map(candidateKey));
    const manifestKeys = new Set(manifest.candidates.map((entry) => candidateKey(entry.candidate)));
    if (candidateKeys.size !== manifestKeys.size || [...candidateKeys].some((key) => !manifestKeys.has(key))) fail('collection manifest does not cover the complete candidate set');
  }
  const rawFiles = await filesUnder(rawPath);
  const rawEnvelopes = await loadRawEnvelopes(rawFiles);
  if (manifest === undefined) validateRawSet(candidates, rawEnvelopes, { requireRunId: args.rawExplicit });
  if (manifest !== undefined) validateManifestIndex(manifest, await loadEvidenceIndex(indexPath), args, rawEnvelopes);
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
    // A run is one provenance unit. Never persist clean siblings when another
    // candidate failed; leave canonical records untouched and invalidate the
    // actionable projection instead.
    if (failures === 0 && analysed.length > 0) records = await upsertRecords(analysed, { path: recordsPath, decisionsPath, events: buildAnalysisEvents(analysed, existingMap) });
    if (failures > 0) await writeReadyToWriteExport([], { path: readyPath });
    else await writeReadyToWriteExport(records, { path: readyPath, recordsPath });
  }
  console.log(`analyzed ${analysed.length} candidate(s), ${analysed.filter((record) => record.status === 'ready-to-write').length} ready-to-write candidate(s)${args.dryRun ? ' (dry-run)' : '; outputs data/keywords/records.json, data/keywords/ready-to-write.json'}`);
  if (failures > 0) fail('one or more candidates lacked clean evidence or had an invalid transition');
  return { ...args, records, analysed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`keyword analysis failed (${error?.code ?? 'ANALYZE_CLI'})`);
    process.exitCode = 1;
  });
}

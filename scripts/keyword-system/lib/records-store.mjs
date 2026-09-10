import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { normalizeKeywordKey, normalizeWjKeywordRecord } from './contracts.mjs';
import { stableSortRecords, transitionStatus } from './analysis.mjs';
import { writeStableJson } from './evidence-store.mjs';
import { appendFileAtDirectory, directoryFdPath, openVerifiedDirectory, readFileAtDirectory, removeFileAtDirectory, withExclusiveFileLock, writeStableTextAtDirectory } from './file-lock.mjs';

/** Errors raised by the canonical records and human-decision stores. */
export class RecordsStoreError extends Error {
  constructor(message) { super(message); this.name = 'RecordsStoreError'; this.code = 'RECORDS_STORE'; }
}
const fail = (message) => { throw new RecordsStoreError(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const eventTypes = new Set(['collection_started', 'analysis_success', 'analysis_failure', 'writer_handoff', 'reject', 'reseed']);

function pathFrom(value, fallback) {
  if (typeof value === 'string' && value.trim() !== '') return resolve(value);
  if (isObject(value)) {
    const candidate = value.path ?? value.recordsPath ?? value.file ?? value.decisionsPath ?? value.decisionPath ?? value.exportPath ?? value.readyPath;
    if (typeof candidate === 'string' && candidate.trim() !== '') return resolve(candidate);
    if (typeof value.outDir === 'string' && value.outDir.trim() !== '') return resolve(value.outDir, fallback);
  }
  if (fallback === undefined) fail('a file path is required');
  return resolve(process.cwd(), 'data', 'keywords', fallback);
}
function recordsPathFor(value) { return typeof value === 'string' ? pathFrom(value) : pathFrom(value, 'records.json'); }
function decisionsPathFor(value, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit);
  if (isObject(value) && typeof value.decisionsPath === 'string' && value.decisionsPath.trim() !== '') return resolve(value.decisionsPath);
  return resolve(dirname(recordsPathFor(value)), 'decisions.jsonl');
}

async function parseJson(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail(`records file is not valid JSON: ${path}`); }
  if (!Array.isArray(parsed)) fail(`records file must contain an array: ${path}`);
  try { return parsed.map((record) => normalizeWjKeywordRecord(record)); } catch (error) {
    fail(`records file contains an invalid record: ${error instanceof Error ? error.message : 'invalid record'}`);
  }
}
async function readJsonl(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return text.split(/\r?\n/u).filter((line) => line.trim() !== '').map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (!isObject(value)) fail(`decision line ${index + 1} must be an object`);
      return normalizeDecision(value);
    } catch (error) {
      if (error instanceof RecordsStoreError) throw error;
      fail(`decision line ${index + 1} is not valid JSON`);
    }
  });
}
function recordKey(record) { return `${normalizeKeywordKey(record.category)}\u0000${normalizeKeywordKey(record.head_keyword)}`; }
function eventType(value) {
  const type = value?.type ?? value?.event;
  return typeof type === 'string' ? type.trim() : '';
}
function decisionMatches(decision, record, type) {
  return eventType(decision) === type && recordKey(decision) === recordKey(record);
}
function normalizeDecision(input) {
  if (!isObject(input)) fail('decision must be an object');
  const type = eventType(input);
  if (!eventTypes.has(type)) fail('decision.type must be a known transition event');
  if (!nonEmpty(input.category) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.category.trim())) fail('decision.category must be lowercase kebab-case');
  if (!nonEmpty(input.head_keyword)) fail('decision.head_keyword must be non-empty');
  const result = { schema_version: 1, type, category: input.category.trim(), head_keyword: input.head_keyword.normalize('NFC').replace(/\s+/gu, ' ').trim() };
  if (type === 'writer_handoff' || type === 'reseed') {
    if (!nonEmpty(input.reference)) fail(`${type} decision requires a non-empty reference`);
    result.reference = input.reference.trim();
  }
  if (type === 'writer_handoff' || type === 'reject') {
    if (!nonEmpty(input.reason)) fail(`${type} decision requires a non-empty human reason`);
    result.reason = input.reason.trim();
  }
  if (input.recorded_at !== undefined) {
    if (!nonEmpty(input.recorded_at)) fail('decision.recorded_at must be non-empty when supplied');
    result.recorded_at = input.recorded_at;
  }
  return result;
}
function explicitEvent(config, record) {
  let event = config?.event;
  const key = recordKey(record);
  if (config?.events instanceof Map) event = config.events.get(key) ?? event;
  else if (isObject(config?.events)) event = config.events[key] ?? event;
  else if (Array.isArray(config?.events)) event = config.events.find((item) => recordKey(item ?? {}) === key) ?? event;
  if (event === undefined && config?.writerHandoff !== undefined && record.status === 'written') {
    const handoff = isObject(config.writerHandoff) ? config.writerHandoff : { reference: config.writerHandoff };
    event = { ...handoff, type: 'writer_handoff' };
  }
  if (event === undefined && config?.writer_handoff !== undefined && record.status === 'written') {
    const handoff = isObject(config.writer_handoff) ? config.writer_handoff : { reference: config.writer_handoff };
    event = { ...handoff, type: 'writer_handoff' };
  }
  if (event === undefined) return undefined;
  if (!isObject(event) || !eventType(event)) fail('transition event must be an object with a type');
  return { ...event, type: eventType(event), category: record.category, head_keyword: record.head_keyword };
}

function requireExplicitTransition(previous, next, event) {
  if (event !== undefined) {
    const base = event.type === 'analysis_success'
      ? { ...next, status: previous?.status ?? 'candidate' }
      : (previous ?? { ...next, status: 'candidate' });
    let transitioned;
    try { transitioned = transitionStatus(base, event); }
    catch (error) { fail(`event ${event.type} cannot transition to ${next.status}: ${error instanceof Error ? error.message : 'invalid transition'}`); }
    if (transitioned.status !== next.status) fail(`event ${event.type} cannot produce status ${next.status}`);
  }
  if (!previous) {
    if (next.status === 'candidate' && event === undefined) return;
    if (next.status === 'written') fail(`written requires an existing ready-to-write record: ${next.head_keyword}`);
    if (event === undefined) fail(`status ${next.status} requires an explicit transition event: ${next.head_keyword}`);
    return;
  }
  if (previous.status === 'written') {
    if (event !== undefined || next.status !== 'written' || JSON.stringify(previous) !== JSON.stringify(next)) fail(`written record cannot be changed: ${next.head_keyword}`);
    return;
  }
  if (previous.status === 'rejected' && next.status === 'rejected') {
    if (event !== undefined || JSON.stringify(previous) !== JSON.stringify(next)) fail(`rejected record cannot be changed without reseed: ${next.head_keyword}`);
    return;
  }
  if (previous.status !== next.status && event === undefined) fail(`status transition ${previous.status} -> ${next.status} requires an explicit event`);
}

function eventDecision(event, record) {
  if (!event || !['writer_handoff', 'reject', 'reseed'].includes(event.type)) return undefined;
  return normalizeDecision({ ...event, category: record.category, head_keyword: record.head_keyword });
}

/** Read and validate the stable canonical records array. */
export async function readRecords(input = undefined) {
  return stableSortRecords(await parseJson(recordsPathFor(input)));
}

/** Append one validated decision as one JSONL line under an exclusive lock. */
export async function appendDecision(input, options = {}) {
  const wrapped = isObject(input) && input.decision !== undefined;
  const decisionInput = wrapped ? input.decision : input;
  const config = wrapped || (isObject(input) && ['path', 'decisionsPath', 'decisionPath'].some((key) => input[key] !== undefined)) ? input : options;
  const path = pathFrom(config, 'decisions.jsonl');
  const decision = normalizeDecision(decisionInput);
  return withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => {
    await appendFileAtDirectory(directoryHandle, basename(path), `${JSON.stringify(decision)}\n`);
    return decision;
  });
}

/** Atomically merge records by category/head keyword while enforcing every legal state transition. */
export async function upsertRecords(input, options = {}) {
  let incoming;
  let config;
  if (Array.isArray(input)) { incoming = input; config = typeof options === 'string' ? { path: options } : isObject(options) ? options : {}; }
  else if (typeof input === 'string' && Array.isArray(options)) { incoming = options; config = { path: input }; }
  else if (isObject(input) && Array.isArray(input.records)) { incoming = input.records; config = { ...input, ...options }; }
  else fail('upsertRecords requires an array of records');
  const path = recordsPathFor(config);
  const decisionsPath = decisionsPathFor(config, config.decisionsPath);
  const normalized = incoming.map((record) => {
    try { return normalizeWjKeywordRecord(record); } catch (error) { fail(`invalid record: ${error instanceof Error ? error.message : 'invalid record'}`); }
  });
  const keys = new Set();
  for (const record of normalized) {
    if (keys.has(recordKey(record))) fail(`duplicate record in upsert: ${record.category}/${record.head_keyword}`);
    keys.add(recordKey(record));
  }
  return withExclusiveFileLock(`${path}.workflow.lock`, async () => withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => {
    const existing = await parseJson(path);
    const byKey = new Map(existing.map((record) => [recordKey(record), record]));
    const decisions = await readJsonl(decisionsPath);
    const events = normalized.map((record) => ({ record, previous: byKey.get(recordKey(record)), event: explicitEvent(config, record) }));
    for (const { record, previous, event } of events) requireExplicitTransition(previous, record, event);
    const additions = [];
    for (const { record, event } of events) {
      const decision = eventDecision(event, record);
      if (decision && !decisions.some((entry) => decisionMatches(entry, record, decision.type)) && !additions.some((entry) => decisionMatches(entry, record, decision.type))) additions.push(decision);
    }
    for (const { record } of events) {
      if (record.status === 'written' && !decisions.some((entry) => decisionMatches(entry, record, 'writer_handoff')) && !additions.some((entry) => decisionMatches(entry, record, 'writer_handoff'))) fail(`written requires a writer handoff decision: ${record.head_keyword}`);
      if (record.status === 'rejected' && !decisions.some((entry) => decisionMatches(entry, record, 'reject')) && !additions.some((entry) => decisionMatches(entry, record, 'reject'))) fail(`rejected requires a human reject decision: ${record.head_keyword}`);
      if (byKey.get(recordKey(record))?.status === 'rejected' && record.status === 'candidate' && !decisions.some((entry) => decisionMatches(entry, record, 'reseed')) && !additions.some((entry) => decisionMatches(entry, record, 'reseed'))) fail(`reseed requires a decision: ${record.head_keyword}`);
    }
    for (const record of normalized) byKey.set(recordKey(record), record);
    const output = stableSortRecords([...byKey.values()]);
    let originalRecords;
    try { originalRecords = await readFile(path, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    let originalDecisions;
    try { originalDecisions = await readFile(decisionsPath, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    try {
      await writeStableJson(path, output, { installPath: join(directoryFdPath(directoryHandle), basename(path)) });
      for (const decision of additions) await appendDecision({ path: decisionsPath, decision });
      return output;
    } catch (error) {
      // Roll back both sides. This keeps an interrupted decision/record pair
      // from becoming a contradictory audit trail.
      try {
        if (originalRecords === undefined) await removeFileAtDirectory(directoryHandle, basename(path));
        else await writeStableTextAtDirectory(directoryHandle, basename(path), originalRecords);
      } catch { /* preserve the original failure */ }
      try {
        const decisionHandle = await openVerifiedDirectory(dirname(decisionsPath), { create: false });
        try {
          if (originalDecisions === undefined) await removeFileAtDirectory(decisionHandle, basename(decisionsPath));
          else await writeStableTextAtDirectory(decisionHandle, basename(decisionsPath), originalDecisions);
        } finally { await decisionHandle.close().catch(() => {}); }
      } catch { /* preserve the original failure */ }
      throw error;
    }
  }));
}

/** Write the manual ready-to-write export. This function never invokes a writer. */
export async function writeReadyToWriteExport(input, options = {}) {
  let records;
  let config;
  if (Array.isArray(input)) { records = input; config = typeof options === 'string' ? { path: options } : isObject(options) ? options : {}; }
  else if (isObject(input) && Array.isArray(input.records)) { records = input.records; config = { ...input, ...options }; }
  else fail('writeReadyToWriteExport requires an array of records');
  const path = pathFrom(config, 'ready-to-write.json');
  const commitPath = `${path}.commit.json`;
  const workflowPath = typeof config.recordsPath === 'string' ? `${resolve(config.recordsPath)}.workflow.lock` : `${path}.workflow.lock`;
  return withExclusiveFileLock(workflowPath, async () => withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => {
    let source = records;
    if (typeof config.recordsPath === 'string') {
      const recordsDirectory = dirname(resolve(config.recordsPath));
      const sourceHandle = recordsDirectory === dirname(path) ? directoryHandle : await openVerifiedDirectory(recordsDirectory, { create: false });
      try {
        source = await readFileAtDirectory(sourceHandle, basename(config.recordsPath), 'utf8').then((text) => {
          try { return JSON.parse(text); } catch { fail('records source is not valid JSON'); }
        });
      } finally { if (sourceHandle !== directoryHandle) await sourceHandle.close().catch(() => {}); }
    }
    const normalized = stableSortRecords(source.map((record) => normalizeWjKeywordRecord(record)));
    const ready = normalized.filter((record) => record.status === 'ready-to-write');
    const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    try {
      await writeStableJson(path, ready, { installPath: join(directoryFdPath(directoryHandle), basename(path)) });
      await writeStableJson(commitPath, { schema_version: 1, records_sha256: digest, ready_count: ready.length }, { installPath: join(directoryFdPath(directoryHandle), basename(commitPath)) });
    } catch (error) {
      await removeFileAtDirectory(directoryHandle, basename(path)).catch(() => {});
      await removeFileAtDirectory(directoryHandle, basename(commitPath)).catch(() => {});
      throw error;
    }
    return ready;
  }));
}

/**
 * Read the manual export only when its commit marker matches canonical records.
 * Consumers must use this gate instead of treating the projection bytes alone
 * as actionable.
 */
export async function readReadyToWriteExport(input, options = {}) {
  const config = typeof input === 'string' ? { path: input, ...(isObject(options) ? options : {}) } : isObject(input) ? { ...input, ...options } : {};
  const path = pathFrom(config, 'ready-to-write.json');
  const recordsPath = typeof config.recordsPath === 'string' ? resolve(config.recordsPath) : resolve(dirname(path), 'records.json');
  return withExclusiveFileLock(`${recordsPath}.workflow.lock`, async () => withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => {
    let ready;
    let marker;
    let records;
    let recordsHandle;
    try {
      ready = JSON.parse(await readFileAtDirectory(directoryHandle, basename(path), 'utf8'));
      marker = JSON.parse(await readFileAtDirectory(directoryHandle, basename(`${path}.commit.json`), 'utf8'));
      recordsHandle = dirname(recordsPath) === dirname(path) ? directoryHandle : await openVerifiedDirectory(dirname(recordsPath), { create: false });
      records = JSON.parse(await readFileAtDirectory(recordsHandle, basename(recordsPath), 'utf8'));
    } catch { fail('ready-to-write export is not committed'); }
    finally { if (recordsHandle && recordsHandle !== directoryHandle) await recordsHandle.close().catch(() => {}); }
    if (!Array.isArray(ready) || !isObject(marker) || marker.schema_version !== 1 || typeof marker.records_sha256 !== 'string' || !Array.isArray(records)) fail('ready-to-write export is not committed');
    const normalizedRecords = stableSortRecords(records.map((record) => normalizeWjKeywordRecord(record)));
    const digest = createHash('sha256').update(JSON.stringify(normalizedRecords)).digest('hex');
    if (digest !== marker.records_sha256) fail('ready-to-write export is stale');
    const expected = stableSortRecords(normalizedRecords.filter((record) => record.status === 'ready-to-write'));
    const normalized = stableSortRecords(ready.map((record) => normalizeWjKeywordRecord(record)));
    if (JSON.stringify(expected) !== JSON.stringify(normalized) || marker.ready_count !== expected.length) fail('ready-to-write export does not match canonical records');
    return normalized;
  }));
}

/** Append one evidence index line without allowing absolute or traversal paths. */
export async function appendEvidenceIndexEntry(input, options = {}) {
  const wrapped = isObject(input) && input.entry !== undefined;
  const entry = wrapped ? input.entry : input;
  if (!isObject(entry)) fail('evidence index entry must be an object');
  const path = pathFrom(wrapped ? input : options, 'evidence-index.jsonl');
  const normalized = { ...entry };
  if (typeof normalized.path !== 'string' || normalized.path.startsWith('/') || normalized.path.includes('\\') || normalized.path === '..' || normalized.path.startsWith('../') || normalized.path.includes('/../')) fail('evidence index path must be repository-relative');
  return withExclusiveFileLock(`${path}.lock`, async ({ directoryHandle }) => {
    await appendFileAtDirectory(directoryHandle, basename(path), `${JSON.stringify(normalized)}\n`);
    return normalized;
  });
}

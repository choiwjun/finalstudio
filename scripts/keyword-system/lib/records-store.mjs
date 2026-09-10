import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeWjKeywordRecord } from './contracts.mjs';
import { stableSortRecords, transitionStatus } from './analysis.mjs';
import { writeStableJson } from './evidence-store.mjs';
import { withExclusiveFileLock } from './file-lock.mjs';

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
      return value;
    } catch (error) {
      if (error instanceof RecordsStoreError) throw error;
      fail(`decision line ${index + 1} is not valid JSON`);
    }
  });
}
function recordKey(record) { return `${record.category}\u0000${record.head_keyword}`; }
function eventType(value) {
  const type = value?.type ?? value?.event;
  return typeof type === 'string' ? type.trim() : '';
}
function decisionMatches(decision, record, type) {
  return eventType(decision) === type && decision.category === record.category && decision.head_keyword === record.head_keyword;
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
  else if (Array.isArray(config?.events)) event = config.events.find((item) => item?.category === record.category && item?.head_keyword === record.head_keyword) ?? event;
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
  if (!previous) {
    if (next.status === 'candidate') return;
    if (next.status === 'written') fail(`written requires an existing ready-to-write record: ${next.head_keyword}`);
    if (!event) fail(`status ${next.status} requires an explicit transition event: ${next.head_keyword}`);
    const base = { ...next, status: 'candidate' };
    const transitioned = transitionStatus(base, event);
    if (transitioned.status !== next.status) fail(`event ${event.type} cannot create status ${next.status}`);
    return;
  }
  if (previous.status === 'written') {
    if (next.status !== 'written' || JSON.stringify(previous) !== JSON.stringify(next)) fail(`written record cannot be changed: ${next.head_keyword}`);
    return;
  }
  if (previous.status === 'rejected' && next.status === 'rejected') {
    if (JSON.stringify(previous) !== JSON.stringify(next)) fail(`rejected record cannot be changed without reseed: ${next.head_keyword}`);
    return;
  }
  if (previous.status === next.status) return;
  if (!event) fail(`status transition ${previous.status} -> ${next.status} requires an explicit event`);
  const base = event.type === 'analysis_success'
    ? { ...next, status: previous.status }
    : previous;
  const transitioned = transitionStatus(base, event);
  if (transitioned.status !== next.status) fail(`event ${event.type} cannot transition ${previous.status} -> ${next.status}`);
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
  return withExclusiveFileLock(`${path}.lock`, async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(decision)}\n`, 'utf8');
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
  return withExclusiveFileLock(`${path}.lock`, async () => {
    const existing = await parseJson(path);
    const byKey = new Map(existing.map((record) => [recordKey(record), record]));
    let decisions = await readJsonl(decisionsPath);
    const events = normalized.map((record) => ({ record, previous: byKey.get(recordKey(record)), event: explicitEvent(config, record) }));
    for (const { record, previous, event } of events) requireExplicitTransition(previous, record, event);
    for (const { record, event } of events) {
      const decision = eventDecision(event, record);
      if (decision && !decisions.some((entry) => decisionMatches(entry, record, decision.type))) {
        await appendDecision({ path: decisionsPath, decision });
        decisions = await readJsonl(decisionsPath);
      }
    }
    for (const { record } of events) {
      if (record.status === 'written' && !decisions.some((entry) => decisionMatches(entry, record, 'writer_handoff'))) fail(`written requires a writer handoff decision: ${record.head_keyword}`);
      if (record.status === 'rejected' && !decisions.some((entry) => decisionMatches(entry, record, 'reject'))) fail(`rejected requires a human reject decision: ${record.head_keyword}`);
      if (byKey.get(recordKey(record))?.status === 'rejected' && record.status === 'candidate' && !decisions.some((entry) => decisionMatches(entry, record, 'reseed'))) fail(`reseed requires a decision: ${record.head_keyword}`);
      byKey.set(recordKey(record), record);
    }
    const output = stableSortRecords([...byKey.values()]);
    await writeStableJson(path, output);
    return output;
  });
}

/** Write the manual ready-to-write export. This function never invokes a writer. */
export async function writeReadyToWriteExport(input, options = {}) {
  let records;
  let config;
  if (Array.isArray(input)) { records = input; config = typeof options === 'string' ? { path: options } : isObject(options) ? options : {}; }
  else if (isObject(input) && Array.isArray(input.records)) { records = input.records; config = { ...input, ...options }; }
  else fail('writeReadyToWriteExport requires an array of records');
  const path = pathFrom(config, 'ready-to-write.json');
  return withExclusiveFileLock(`${path}.lock`, async () => {
    const source = typeof config.recordsPath === 'string' ? await parseJson(resolve(config.recordsPath)) : records;
    const normalized = source.map((record) => normalizeWjKeywordRecord(record));
    const ready = stableSortRecords(normalized.filter((record) => record.status === 'ready-to-write'));
    await writeStableJson(path, ready);
    return ready;
  });
}

/** Append one evidence index line without allowing absolute or traversal paths. */
export async function appendEvidenceIndexEntry(input, options = {}) {
  const wrapped = isObject(input) && input.entry !== undefined;
  const entry = wrapped ? input.entry : input;
  if (!isObject(entry)) fail('evidence index entry must be an object');
  const path = pathFrom(wrapped ? input : options, 'evidence-index.jsonl');
  const normalized = { ...entry };
  if (typeof normalized.path !== 'string' || normalized.path.startsWith('/') || normalized.path.includes('\\') || normalized.path === '..' || normalized.path.startsWith('../') || normalized.path.includes('/../')) fail('evidence index path must be repository-relative');
  return withExclusiveFileLock(`${path}.lock`, async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  });
}

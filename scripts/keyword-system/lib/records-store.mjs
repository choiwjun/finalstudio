import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeWjKeywordRecord } from './contracts.mjs';
import { stableSortRecords } from './analysis.mjs';
import { writeStableJson } from './evidence-store.mjs';

/** Errors raised by the canonical records and human-decision stores. */
export class RecordsStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecordsStoreError';
    this.code = 'RECORDS_STORE';
  }
}

const fail = (message) => { throw new RecordsStoreError(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

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

function recordsPathFor(value) {
  if (typeof value === 'string') return pathFrom(value);
  return pathFrom(value, 'records.json');
}

function decisionsPathFor(value, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit);
  if (isObject(value) && typeof value.decisionsPath === 'string' && value.decisionsPath.trim() !== '') return resolve(value.decisionsPath);
  return resolve(dirname(recordsPathFor(value)), 'decisions.jsonl');
}


async function parseJson(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
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
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
  return lines.map((line, index) => {
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

function decisionType(value) {
  const type = value?.type ?? value?.event;
  return typeof type === 'string' ? type.trim() : '';
}

function decisionMatches(decision, record, type) {
  return decisionType(decision) === type
    && decision.category === record.category
    && decision.head_keyword === record.head_keyword;
}

function normalizeDecision(input) {
  if (!isObject(input)) fail('decision must be an object');
  const type = decisionType(input);
  if (!['collection_started', 'analysis_success', 'analysis_failure', 'writer_handoff', 'reject', 'reseed'].includes(type)) {
    fail('decision.type must be a known transition event');
  }
  if (!nonEmpty(input.category) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.category.trim())) fail('decision.category must be a lowercase kebab-case value');
  if (!nonEmpty(input.head_keyword)) fail('decision.head_keyword must be non-empty');
  const result = {
    schema_version: 1,
    type,
    category: input.category.trim(),
    head_keyword: input.head_keyword.normalize('NFC').replace(/\s+/gu, ' ').trim(),
  };
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

/** Read and validate the stable canonical records array. */
export async function readRecords(input = undefined) {
  const path = recordsPathFor(input);
  return stableSortRecords(await parseJson(path));
}

/**
 * Append one human/system decision as one JSONL record. The file is never
 * rewritten, and writer handoffs require both a reference and a reason.
 * Accepts appendDecision(decision, { path }) and
 * appendDecision({ decision, path }) forms.
 */
export async function appendDecision(input, options = {}) {
  const wrapped = isObject(input) && input.decision !== undefined;
  const decisionInput = wrapped ? input.decision : input;
  const path = pathFrom(wrapped || (isObject(input) && ['path', 'decisionsPath', 'decisionPath'].some((key) => input[key] !== undefined)) ? input : options, 'decisions.jsonl');
  const decision = normalizeDecision(decisionInput);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(decision)}\n`, 'utf8');
  return decision;
}

async function decisionList(path) { return readJsonl(path); }

function explicitWriterDecision(options, record) {
  const candidate = options?.writerHandoff ?? options?.writer_handoff;
  if (candidate === undefined) return undefined;
  const value = isObject(candidate) ? candidate : { reference: candidate };
  return normalizeDecision({ ...value, type: 'writer_handoff', category: record.category, head_keyword: record.head_keyword });
}

function ensureStatusTransition(previous, next, decisions, options) {
  if (!previous) {
    if (next.status === 'written') fail(`written requires an existing ready-to-write record and writer handoff decision for ${next.head_keyword}`);
    if (next.status === 'rejected' && !decisions.some((entry) => decisionMatches(entry, next, 'reject'))) fail(`rejected requires a human reject decision for ${next.head_keyword}`);
    return;
  }
  if (previous.status === 'written') {
    if (next.status !== 'written' || JSON.stringify(previous) !== JSON.stringify(next)) fail(`written record cannot be changed without a separate writer workflow: ${next.head_keyword}`);
    return;
  }
  if (previous.status === 'rejected') {
    if (next.status !== 'candidate' || !decisions.some((entry) => decisionMatches(entry, next, 'reseed'))) fail(`rejected record requires an explicit reseed decision: ${next.head_keyword}`);
  }
  if (next.status === 'written' && previous.status !== 'ready-to-write') fail(`writer handoff is only valid from ready-to-write: ${next.head_keyword}`);
  if (next.status === 'rejected' && !decisions.some((entry) => decisionMatches(entry, next, 'reject'))) fail(`rejected requires a human reject decision for ${next.head_keyword}`);
}

/**
 * Validate, merge by (category, head_keyword), and atomically write records.
 * Incoming records replace the same key, but terminal states cannot be
 * bypassed. A written record is accepted only after an explicit persisted or
 * supplied writer handoff decision.
 */
export async function upsertRecords(input, options = {}) {
  let incoming;
  let config;
  if (Array.isArray(input)) { incoming = input; config = typeof options === 'string' ? { path: options } : isObject(options) ? options : {}; }
  else if (typeof input === 'string' && Array.isArray(options)) { config = { path: input }; incoming = options; }
  else if (isObject(input) && Array.isArray(input.records)) { incoming = input.records; config = { ...input, ...options }; }
  else fail('upsertRecords requires an array of records');
  const path = recordsPathFor(config);
  const decisionsPath = decisionsPathFor(config, config.decisionsPath);
  const normalized = incoming.map((record) => {
    try { return normalizeWjKeywordRecord(record); } catch (error) { fail(`invalid record: ${error instanceof Error ? error.message : 'invalid record'}`); }
  });
  const duplicateKeys = new Set();
  for (const record of normalized) {
    const key = recordKey(record);
    if (duplicateKeys.has(key)) fail(`duplicate record in upsert: ${record.category}/${record.head_keyword}`);
    duplicateKeys.add(key);
  }
  let decisions = await decisionList(decisionsPath);
  const existing = await parseJson(path);
  const byKey = new Map(existing.map((record) => [recordKey(record), record]));
  // Validate terminal/source state before appending a supplied handoff. This
  // prevents a failed transition from leaving a misleading decision behind.
  for (const record of normalized) {
    if (record.status !== 'written') continue;
    const previous = byKey.get(recordKey(record));
    if (!previous || (previous.status !== 'ready-to-write' && previous.status !== 'written')) {
      fail(`writer handoff is only valid from ready-to-write: ${record.head_keyword}`);
    }
  }
  for (const record of normalized) {
    if (record.status !== 'written') continue;
    const handoff = explicitWriterDecision(config, record);
    if (handoff !== undefined && byKey.get(recordKey(record))?.status !== 'written') {
      await appendDecision({ path: decisionsPath, decision: handoff });
      decisions = await decisionList(decisionsPath);
    }
  }
  for (const record of normalized) {
    const previous = byKey.get(recordKey(record));
    ensureStatusTransition(previous, record, decisions, config);
    if (record.status === 'written' && !decisions.some((entry) => decisionMatches(entry, record, 'writer_handoff'))) {
      fail(`written requires an explicit writer handoff decision for ${record.head_keyword}`);
    }
    byKey.set(recordKey(record), record);
  }
  const output = stableSortRecords([...byKey.values()]);
  await writeStableJson(path, output);
  return output;
}

/** Write a stable manual handoff export. This does not invoke any writer. */
export async function writeReadyToWriteExport(input, options = {}) {
  let records;
  let config;
  if (Array.isArray(input)) { records = input; config = typeof options === 'string' ? { path: options } : isObject(options) ? options : {}; }
  else if (isObject(input) && Array.isArray(input.records)) { records = input.records; config = { ...input, ...options }; }
  else fail('writeReadyToWriteExport requires an array of records');
  const normalized = records.map((record) => normalizeWjKeywordRecord(record));
  const ready = stableSortRecords(normalized.filter((record) => record.status === 'ready-to-write'));
  const path = pathFrom(config, 'ready-to-write.json');
  await writeStableJson(path, ready);
  return ready;
}

/** Append an evidence-index JSONL entry while preserving repository-relative paths. */
export async function appendEvidenceIndexEntry(input, options = {}) {
  const wrapped = isObject(input) && input.entry !== undefined;
  const entry = wrapped ? input.entry : input;
  if (!isObject(entry)) fail('evidence index entry must be an object');
  const path = pathFrom(wrapped ? input : options, 'evidence-index.jsonl');
  const normalized = { ...entry };
  if (typeof normalized.path !== 'string' || normalized.path.startsWith('/') || normalized.path.includes('\\') || normalized.path === '..' || normalized.path.startsWith('../') || normalized.path.includes('/../')) fail('evidence index path must be repository-relative');
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

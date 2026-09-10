import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, access, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeValidRecord, readJsonl } from './test-helpers.mjs';
import {
  readRecords,
  upsertRecords,
  writeReadyToWriteExport,
  appendDecision,
} from './lib/records-store.mjs';

async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'wj-records-'));
  return { root, records: join(root, 'data/keywords/records.json'), decisions: join(root, 'data/keywords/decisions.jsonl'), ready: join(root, 'data/keywords/ready-to-write.json') };
}

test('records store reads a missing file as an empty stable collection and upserts sorted canonical records', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const first = makeValidRecord({ category: 'health', head_keyword: '수면 습관' });
  const second = makeValidRecord({ category: 'ai-it', head_keyword: '엑셀 자동화' });
  const result = await upsertRecords([first, second], { path: paths.records });
  assert.deepEqual(result.map((item) => item.category), ['ai-it', 'health']);
  assert.deepEqual(await readRecords(paths.records), result);
  assert.equal((await readFile(paths.records, 'utf8')).endsWith('\n'), true);
});

test('upsert replaces one category/head key without duplicates and ready export includes only ready records', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const candidate = makeValidRecord({ status: 'candidate', evidence_available: false, freshness: 'unknown', risk_flags: [], source: ['naver-api-hub-blog'] });
  const ready = makeValidRecord({ status: 'ready-to-write' });
  await upsertRecords([candidate], { path: paths.records });
  const records = await upsertRecords([ready], { path: paths.records });
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'ready-to-write');
  const exported = await writeReadyToWriteExport(records, { path: paths.ready });
  assert.deepEqual(exported, records);
  assert.deepEqual(JSON.parse(await readFile(paths.ready, 'utf8')), records);
});

test('written records require an explicit writer handoff decision with both reference and reason', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const ready = makeValidRecord({ status: 'ready-to-write' });
  const written = makeValidRecord({ status: 'written' });
  await upsertRecords([ready], { path: paths.records });
  await assert.rejects(() => upsertRecords([written], { path: paths.records, decisionsPath: paths.decisions }), /writer handoff|decision/iu);
  await appendDecision({ path: paths.decisions, decision: { type: 'writer_handoff', category: written.category, head_keyword: written.head_keyword, reference: 'drafts/excel.md', reason: 'human selected' } });
  const persisted = await upsertRecords([written], { path: paths.records, decisionsPath: paths.decisions });
  assert.equal(persisted[0].status, 'written');
  const lines = readJsonl((await readFile(paths.decisions, 'utf8')).split('\n'));
  assert.equal(lines[0].reference, 'drafts/excel.md');
  assert.equal(lines[0].reason, 'human selected');
});

test('decisions are append-only and reject missing human reasons or references', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  await assert.rejects(() => appendDecision({ path: paths.decisions, decision: { type: 'reject', category: 'ai-it', head_keyword: 'x' } }), /reason/iu);
  await assert.rejects(() => appendDecision({ path: paths.decisions, decision: { type: 'writer_handoff', category: 'ai-it', head_keyword: 'x', reason: 'selected' } }), /reference/iu);
  await appendDecision({ path: paths.decisions, decision: { type: 'reject', category: 'ai-it', head_keyword: 'x', reason: 'not useful' } });
  await appendDecision({ path: paths.decisions, decision: { type: 'reseed', category: 'ai-it', head_keyword: 'x', reference: 'seed-2' } });
  const lines = (await readFile(paths.decisions, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, undefined);
  assert.equal(JSON.parse(lines[0]).reason, 'not useful');
});


test('upsert uses an atomic replacement and does not leave temporary files after a target write failure', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  await mkdir(paths.records, { recursive: true });
  await assert.rejects(() => upsertRecords([makeValidRecord()], { path: paths.records }));
  assert.deepEqual(await readdir(paths.records), []);
});

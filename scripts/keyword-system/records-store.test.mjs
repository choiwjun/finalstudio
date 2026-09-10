import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, access, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  const records = await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
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
  await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
  await assert.rejects(() => upsertRecords([written], { path: paths.records, decisionsPath: paths.decisions }), /writer handoff|decision|transition/iu);
  await appendDecision({ path: paths.decisions, decision: { type: 'writer_handoff', category: written.category, head_keyword: written.head_keyword, reference: 'drafts/excel.md', reason: 'human selected' } });
  const persisted = await upsertRecords([written], { path: paths.records, decisionsPath: paths.decisions, event: { type: 'writer_handoff', reference: 'drafts/excel.md', reason: 'human selected' } });
  assert.equal(persisted[0].status, 'written');
  const lines = readJsonl((await readFile(paths.decisions, 'utf8')).split('\n'));
  assert.equal(lines[0].type, 'writer_handoff');
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


test('records store rejects illegal status pairs unless the matching transition event is explicit', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const candidate = makeValidRecord({ evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'], status: 'candidate' });
  const ready = makeValidRecord({ status: 'ready-to-write' });
  await upsertRecords([candidate], { path: paths.records });
  await assert.rejects(() => upsertRecords([ready], { path: paths.records }), /transition|analysis_success/iu);
  await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
  const failed = makeValidRecord({ status: 'candidate', evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'], risk_flags: ['api_error'] });
  await assert.rejects(() => upsertRecords([failed], { path: paths.records }), /transition|analysis_failure/iu);
  const output = await upsertRecords([failed], { path: paths.records, event: { type: 'analysis_failure' } });
  assert.equal(output[0].status, 'candidate');
});

test('concurrent upserts preserve both records under the canonical store lock', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const records = Array.from({ length: 8 }, (_, index) => makeValidRecord({
    category: 'ai-it', head_keyword: `키워드 ${index}`, related_keywords: ['관련어 하나', '관련어 둘'],
  }));
  const workers = await Promise.all(records.map((record) => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import {upsertRecords} from './scripts/keyword-system/lib/records-store.mjs'; await upsertRecords([JSON.parse(process.argv[1])], {path: process.argv[2]});", JSON.stringify(record), paths.records], { cwd: resolve(new URL('..', import.meta.url).pathname, '..') });
    let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(stderr)));
  })));
  assert.equal(workers.length, records.length);
  assert.equal((await readRecords(paths.records)).length, records.length);
});


test('records store rejects every illegal status pair without the matching Task 5 event', async (t) => {
  const pairs = [
    ['candidate', 'written'], ['candidate', 'rejected'],
    ['researching', 'written'], ['ready-to-write', 'researching'], ['ready-to-write', 'written'],
    ['rejected', 'candidate'], ['written', 'candidate'],
  ];
  for (const [from, to] of pairs) {
    const paths = await temp();
    t.after(() => rm(paths.root, { recursive: true, force: true }));
    const base = makeValidRecord({ status: from, evidence_available: from !== 'candidate', freshness: 'fresh' });
    // Seed terminal/active states directly for this matrix probe.
    await (await import('node:fs/promises')).mkdir(join(paths.root, 'data/keywords'), { recursive: true });
    await writeFile(paths.records, JSON.stringify([base]));
    const next = makeValidRecord({ status: to, evidence_available: to !== 'candidate', freshness: to === 'candidate' ? 'unknown' : 'fresh' });
    await assert.rejects(() => upsertRecords([next], { path: paths.records }), /transition|event|decision|written|rejected/iu, `${from} -> ${to}`);
  }
});

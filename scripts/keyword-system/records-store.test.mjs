import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, access, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeValidRecord, readJsonl } from './test-helpers.mjs';
import {
  readRecords,
  upsertRecords,
  writeReadyToWriteExport,
  readReadyToWriteExport,
  appendDecision,
} from './lib/records-store.mjs';
import { withExclusiveFileLock } from './lib/file-lock.mjs';

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


test('supplied events cannot contradict unchanged records or create a mismatched new record', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const candidate = makeValidRecord({ status: 'candidate', evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'] });
  await upsertRecords([candidate], { path: paths.records });
  await assert.rejects(() => upsertRecords([candidate], { path: paths.records, event: { type: 'reject', reason: 'not this event' } }), /event|transition|status/iu);
  await assert.rejects(() => upsertRecords([candidate], { path: paths.records, event: { type: 'collection_started' } }), /status|transition/iu);
  await assert.rejects(() => upsertRecords([makeValidRecord({ status: 'candidate' })], { path: paths.records, event: { type: 'reject', reason: 'new reject does not produce candidate' } }), /status|transition/iu);
  const ready = makeValidRecord({ status: 'ready-to-write' });
  await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
  await assert.doesNotReject(() => upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } }));
  assert.deepEqual(readJsonl((await readFile(paths.decisions, 'utf8').catch(() => '')).split('\n')), []);
});

test('a live stale lock is never reclaimed and concurrent entrants do not overlap', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const lockPath = join(paths.root, 'data/keywords/live.lock');
  let active = 0; let maxActive = 0;
  const owner = withExclusiveFileLock(lockPath, async () => {
    active += 1; maxActive = Math.max(maxActive, active);
    await utimes(lockPath, new Date(0), new Date(0));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    active -= 1;
  }, { staleMs: 0 });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  const contender = withExclusiveFileLock(lockPath, async () => { active += 1; maxActive = Math.max(maxActive, active); active -= 1; }, { timeoutMs: 40, staleMs: 0 }).catch((error) => error);
  const result = await contender; await owner;
  assert.equal(result.code, 'FILE_LOCK'); assert.equal(maxActive, 1);
});

test('ready projection failure removes both the projection and its commit marker', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const marker = `${paths.ready}.commit.json`; await mkdir(marker, { recursive: true });
  await assert.rejects(() => writeReadyToWriteExport([makeValidRecord({ status: 'ready-to-write' })], { path: paths.ready }), /EISDIR|directory|commit|output/iu);
  await assert.rejects(() => access(paths.ready));
  await assert.rejects(() => access(marker));
});


test('ready consumers reject a projection whose records generation no longer matches', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const ready = makeValidRecord({ status: 'ready-to-write' });
  await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
  await writeReadyToWriteExport([ready], { path: paths.ready, recordsPath: paths.records });
  assert.deepEqual(await readReadyToWriteExport(paths.ready, { recordsPath: paths.records }), [ready]);
  await writeFile(paths.records, '[]\n');
  await assert.rejects(() => readReadyToWriteExport(paths.ready, { recordsPath: paths.records }), /stale|match|committed/iu);
});


test('dead stale owner recovery lets B enter while C cannot overlap B', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const lockPath = join(paths.root, 'data/keywords/dead.lock');
  await mkdir(join(paths.root, 'data/keywords'), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ token: 'owner-A', pid: 99999999 }) + '\n'); await utimes(lockPath, new Date(0), new Date(0));
  let active = 0; let maxActive = 0; let entered;
  const enteredPromise = new Promise((resolvePromise) => { entered = resolvePromise; });
  const b = withExclusiveFileLock(lockPath, async () => { active += 1; maxActive = Math.max(maxActive, active); entered(); await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); active -= 1; }, { staleMs: 0 });
  await enteredPromise;
  const c = await withExclusiveFileLock(lockPath, async () => { active += 1; maxActive = Math.max(maxActive, active); active -= 1; }, { timeoutMs: 35, staleMs: 0 }).catch((error) => error);
  await b;
  assert.equal(c.code, 'FILE_LOCK'); assert.equal(maxActive, 1);
});


test('nested records and ready projections use independently verified parent FDs', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const nested = join(paths.root, 'data/keywords/a/b');
  const recordsPath = join(nested, 'records.json'); const readyPath = join(nested, 'ready-to-write.json');
  await mkdir(nested, { recursive: true });
  const ready = makeValidRecord({ status: 'ready-to-write' });
  await upsertRecords([ready], { path: recordsPath, event: { type: 'analysis_success' } });
  await writeReadyToWriteExport([ready], { path: readyPath, recordsPath });
  assert.deepEqual(await readReadyToWriteExport(readyPath, { recordsPath }), [ready]);
});

test('replacing an acquired lock pathname cannot be removed by the old owner', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const lockPath = join(paths.root, 'data/keywords/replaced.lock');
  let entered; const enteredPromise = new Promise((resolvePromise) => { entered = resolvePromise; });
  const owner = withExclusiveFileLock(lockPath, async () => {
    entered();
    const replacement = `${lockPath}.replacement`;
    await rename(lockPath, replacement);
    await writeFile(lockPath, JSON.stringify({ token: 'owner-B', pid: process.pid }) + '\n');
  });
  await enteredPromise; await owner;
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'owner-B');
  await rm(lockPath, { force: true }); await rm(`${lockPath}.replacement`, { force: true });
});


test('malformed persisted decisions never authorize terminal status changes', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const ready = makeValidRecord({ status: 'ready-to-write' }); const written = makeValidRecord({ status: 'written' });
  await upsertRecords([ready], { path: paths.records, event: { type: 'analysis_success' } });
  await writeFile(paths.decisions, JSON.stringify({ type: 'writer_handoff', category: written.category, head_keyword: written.head_keyword }) + '\n');
  await assert.rejects(() => upsertRecords([written], { path: paths.records, decisionsPath: paths.decisions, event: { type: 'writer_handoff', reference: 'draft.md', reason: 'human selected' } }), /reference|reason|decision/iu);
  assert.equal(JSON.parse(await readFile(paths.records, 'utf8'))[0].status, 'ready-to-write');
});


test('decision append failure rolls records back before any terminal state can survive', async (t) => {
  const paths = await temp(); t.after(() => rm(paths.root, { recursive: true, force: true }));
  const candidate = makeValidRecord({ status: 'candidate', evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'] });
  await upsertRecords([candidate], { path: paths.records });
  const outside = join(paths.root, 'outside-decisions'); await writeFile(outside, ''); await rm(paths.decisions, { force: true }); await symlink(outside, paths.decisions);
  const rejected = makeValidRecord({ status: 'rejected', evidence_available: false, freshness: 'unknown', source: ['naver-api-hub-blog'], risk_flags: ['api_error'] });
  await assert.rejects(() => upsertRecords([rejected], { path: paths.records, decisionsPath: paths.decisions, event: { type: 'reject', reason: 'human review' } }), /symlink|decision|lock/iu);
  assert.equal(JSON.parse(await readFile(paths.records, 'utf8'))[0].status, 'candidate');
  assert.equal(await readFile(outside, 'utf8'), '');
});

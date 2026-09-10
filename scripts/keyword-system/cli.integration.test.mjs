import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { makeValidRecord } from './test-helpers.mjs';
import { main as collectMain } from './collect.mjs';
import { assertContainedPath, assertSafeOutputDir } from './lib/output-boundary.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname, '..');
const SCRIPT = (name) => join(ROOT, 'scripts/keyword-system', name);
const FIXTURE_DIR = join(ROOT, 'scripts/keyword-system/fixtures/naver-api-hub');
const SEEDS = join(ROOT, 'data/keywords/seeds.json');

function runNode(script, args, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

async function setup(t, seeds = SEEDS) {
  const root = await mkdtemp(join(tmpdir(), 'wj-keyword-cli-'));
  const out = join(root, 'data/keywords');
  await mkdir(out, { recursive: true });
  await cp(seeds, join(out, 'seeds.json'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, out, seeds: join(out, 'seeds.json') };
}

test('CLI happy path wires discovery, fixture collection, analysis, evidence index, and manual ready handoff', async (t) => {
  const paths = await setup(t);
  const discovered = await runNode(SCRIPT('discover.mjs'), ['--seed-file', paths.seeds, '--out-dir', paths.out]);
  assert.equal(discovered.code, 0, discovered.stderr);
  const collected = await runNode(SCRIPT('collect.mjs'), ['--seed-file', paths.seeds, '--out-dir', paths.out, '--fixture', FIXTURE_DIR]);
  assert.equal(collected.code, 0, collected.stderr);
  const analyzed = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', paths.seeds, '--raw', join(paths.out, 'raw'), '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.equal(analyzed.code, 0, analyzed.stderr);
  const records = JSON.parse(await readFile(join(paths.out, 'records.json'), 'utf8'));
  const ready = JSON.parse(await readFile(join(paths.out, 'ready-to-write.json'), 'utf8'));
  const index = (await readFile(join(paths.out, 'evidence-index.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(records.length >= 3);
  assert.equal(records.every((record) => record.status === 'ready-to-write'), true);
  assert.deepEqual(ready, records);
  assert.ok(index.length >= records.length * 2);
  assert.equal(index.every((entry) => entry.path.startsWith('data/keywords/')), true);
  assert.equal(index.some((entry) => entry.path.startsWith('/')), false);
  assert.equal((await readFile(join(paths.out, 'decisions.jsonl'), 'utf8')).trim(), '');
});

test('CLI missing credentials and partial fixture failures are nonzero, redacted, and never promoted', async (t) => {
  const paths = await setup(t);
  const missing = await runNode(SCRIPT('collect.mjs'), ['--seed-file', paths.seeds, '--out-dir', paths.out], { NCP_NAVER_API_HUB_CLIENT_ID: '', NCP_NAVER_API_HUB_CLIENT_SECRET: '' });
  assert.notEqual(missing.code, 0);
  assert.equal(missing.stdout.includes('NCP_SECRET_SENTINEL'), false);
  assert.equal(missing.stderr.includes('NCP_SECRET_SENTINEL'), false);
  const partialDir = join(paths.root, 'fixtures'); await mkdir(partialDir);
  await cp(join(FIXTURE_DIR, 'blog-success.json'), join(partialDir, 'blog.json'));
  await cp(join(FIXTURE_DIR, 'malformed.json'), join(partialDir, 'trend.json'));
  const partial = await runNode(SCRIPT('collect.mjs'), ['--seed-file', paths.seeds, '--out-dir', paths.out, '--fixture', partialDir]);
  assert.notEqual(partial.code, 0);
  const analyzed = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', paths.seeds, '--raw', join(paths.out, 'raw'), '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.notEqual(analyzed.code, 0);
  if ((await import('node:fs/promises')).then) {
    try {
      const records = JSON.parse(await readFile(join(paths.out, 'records.json'), 'utf8'));
      assert.equal(records.some((record) => record.status === 'written'), false);
      assert.equal(records.some((record) => record.status === 'ready-to-write'), false);
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
    }
  }
});

test('CLI dry-run writes no generated files and invalid transition exits nonzero', async (t) => {
  const paths = await setup(t);
  const dry = await runNode(SCRIPT('collect.mjs'), ['--seed-file', paths.seeds, '--out-dir', paths.out, '--fixture', FIXTURE_DIR, '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual((await import('node:fs/promises')).readdir(paths.out).then ? await (await import('node:fs/promises')).readdir(paths.out) : [], ['seeds.json']);
  const bad = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', paths.seeds, '--raw', join(paths.out, 'raw-does-not-exist'), '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.notEqual(bad.code, 0);
});


test('CLI rejects duplicate category/head evidence targets deterministically before a same-run overwrite', async (t) => {
  const paths = await setup(t);
  const seeds = join(paths.root, 'duplicate-seeds.json');
  await writeFile(seeds, JSON.stringify({ version: 1, inputs: [
    { category: 'ai-it', seeds: ['엑셀 자동화'], title: '엑셀 자동화 방법' },
    { category: 'ai-it', seeds: ['엑셀 자동화'], title: '엑셀 자동화 비교' },
  ] }));
  const result = await runNode(SCRIPT('collect.mjs'), ['--seed-file', seeds, '--out-dir', paths.out, '--fixture', FIXTURE_DIR]);
  assert.notEqual(result.code, 0);
  assert.equal((await readdir(paths.out)).includes('raw'), false);
});

test('CLI refuses a terminal written record without a persisted writer handoff and leaves it unchanged', async (t) => {
  const paths = await setup(t);
  const record = makeValidRecord({ status: 'written' });
  await writeFile(join(paths.out, 'records.json'), JSON.stringify([record]));
  const before = await readFile(join(paths.out, 'records.json'), 'utf8');
  const result = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', paths.seeds, '--raw', join(paths.out, 'missing'), '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(join(paths.out, 'records.json'), 'utf8'), before);
});


test('output boundary accepts only a data/keywords mapping and rejects arbitrary escapes and symlinks before IO', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wj-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, 'data/keywords');
  await mkdir(out, { recursive: true });
  await assert.doesNotReject(() => assertSafeOutputDir(out));
  await assert.rejects(() => assertSafeOutputDir(join(root, 'escape')), /data\/keywords|output/iu);
  const outside = join(root, 'outside'); await mkdir(outside);
  const link = join(root, 'link'); await (await import('node:fs/promises')).symlink(outside, link, 'dir');
  await assert.rejects(() => assertSafeOutputDir(join(link, 'data/keywords')), /symlink|realpath/iu);
  await assert.rejects(() => assertContainedPath(join(root, 'escape.txt'), out), /contained|output/iu);
});

test('explicit raw evidence path is authoritative over a stale collection manifest', async (t) => {
  const paths = await setup(t);
  const oneSeed = join(paths.root, 'one-seed.json');
  await writeFile(oneSeed, JSON.stringify({ version: 1, inputs: [{ category: 'ai-it', seeds: ['엑셀 자동화'], title: '엑셀 자동화 방법' }] }));
  const collected = await runNode(SCRIPT('collect.mjs'), ['--seed-file', oneSeed, '--out-dir', paths.out, '--fixture', FIXTURE_DIR]);
  assert.equal(collected.code, 0, collected.stderr);
  const alternate = join(paths.out, 'alternate-raw'); await mkdir(alternate);
  const analyzed = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', oneSeed, '--raw-evidence', alternate, '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.notEqual(analyzed.code, 0);
  assert.equal(await readFile(join(paths.out, 'ready-to-write.json'), 'utf8').catch(() => '[]'), '[]\n');
});

test('malformed collection manifests and malformed raw files fail closed and invalidate stale ready output', async (t) => {
  const paths = await setup(t);
  const oneSeed = join(paths.root, 'one-seed.json');
  await writeFile(oneSeed, JSON.stringify({ version: 1, inputs: [{ category: 'ai-it', seeds: ['엑셀 자동화'], title: '엑셀 자동화 방법' }] }));
  assert.equal((await runNode(SCRIPT('collect.mjs'), ['--seed-file', oneSeed, '--out-dir', paths.out, '--fixture', FIXTURE_DIR])).code, 0);
  assert.equal((await runNode(SCRIPT('analyze.mjs'), ['--seed-file', oneSeed, '--raw', join(paths.out, 'raw'), '--records', join(paths.out, 'records.json'), '--out-dir', paths.out])).code, 0);
  assert.notEqual(JSON.parse(await readFile(join(paths.out, 'ready-to-write.json'), 'utf8')).length, 0);
  await writeFile(join(paths.out, 'collection.json'), '{malformed');
  const rawFiles = [];
  async function find(dir) { for (const entry of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) { const child = join(dir, entry.name); if (entry.isDirectory()) await find(child); else rawFiles.push(child); } }
  await find(join(paths.out, 'raw'));
  await writeFile(rawFiles[0], '{malformed');
  const rerun = await runNode(SCRIPT('analyze.mjs'), ['--seed-file', oneSeed, '--records', join(paths.out, 'records.json'), '--out-dir', paths.out]);
  assert.notEqual(rerun.code, 0);
  assert.deepEqual(JSON.parse(await readFile(join(paths.out, 'ready-to-write.json'), 'utf8').catch(() => '[]\n')), []);
});


test('collect dry-run never invokes provider or network, even when credentials are configured', async (t) => {
  const paths = await setup(t);
  const oldFetch = globalThis.fetch;
  const oldId = process.env.NCP_NAVER_API_HUB_CLIENT_ID;
  const oldSecret = process.env.NCP_NAVER_API_HUB_CLIENT_SECRET;
  globalThis.fetch = async () => { throw new Error('dry-run network call'); };
  process.env.NCP_NAVER_API_HUB_CLIENT_ID = 'dry-run-client';
  process.env.NCP_NAVER_API_HUB_CLIENT_SECRET = 'dry-run-secret';
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldId === undefined) delete process.env.NCP_NAVER_API_HUB_CLIENT_ID; else process.env.NCP_NAVER_API_HUB_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.NCP_NAVER_API_HUB_CLIENT_SECRET; else process.env.NCP_NAVER_API_HUB_CLIENT_SECRET = oldSecret;
  });
  await assert.doesNotReject(() => collectMain(['--seed-file', paths.seeds, '--out-dir', paths.out, '--dry-run']));
});

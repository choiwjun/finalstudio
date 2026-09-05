#!/usr/bin/env node
/**
 * 로컬 관리 서버 — 대시보드(/admin, 개발 환경)에서 글 편집·삭제·상태 변경(발행)·새 글 작성을 가능하게 한다.
 *
 *   npm run admin   →  http://127.0.0.1:4322 (localhost 전용 바인딩)
 *
 * 보안 원칙:
 *   - 127.0.0.1에만 바인딩 (외부 노출 없음). CORS는 개발 서버 오리진만 허용.
 *   - 운영 정적 사이트와 무관하며, 이 서버 없이도 사이트는 정상 빌드·배포된다.
 *   - 삭제는 실제 삭제가 아니라 .trash/ 로 이동 (실수 복구용).
 * 발행 게이트: status 변경 시 콘텐츠 계약(scripts/lib/content-contract.mjs)을 강제한다.
 *   scheduled는 publishAt, published는 testedAt + 실명 author가 필요하다.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { ALLOWED_STATUS, parseFrontmatter, validatePost } from './lib/content-contract.mjs';

const ROOT = process.cwd();
const POSTS = join(ROOT, 'src', 'content', 'posts');
const TRASH = join(ROOT, '.trash');
const PORT = Number(process.env.ADMIN_PORT ?? 4322);
const DEV_PORT = Number(process.env.DEV_PORT ?? 4321);
const SUPERVISE_DEV = !process.argv.includes('--no-dev');
const ALLOWED_ORIGINS = new Set([`http://localhost:${DEV_PORT}`, `http://127.0.0.1:${DEV_PORT}`]);

/**
 * 개발 서버(astro dev)는 콘텐츠 변경을 감시하지 않고, 실행 중 재동기화도 없으며
 * 증분 sync는 삭제를 반영하지 못한다(이 환경에서 실측). 따라서 이 서버가 개발 서버를
 * 직접 관리(supervise)한다: 글 변경 시 sync 후 개발 서버를 재시작해 스토어를 새로 읽힌다.
 * 운영 빌드(astro build)는 항상 파일을 새로 읽으므로 영향이 없다.
 */
let devChild = null;

const spawnDev = () => {
  if (!SUPERVISE_DEV) return;
  devChild = spawn('node', [join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'dev', '--host', 'localhost', '--port', String(DEV_PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? '' },
  });
  devChild.on('exit', (code) => {
    if (devChild) console.log(`[admin] 개발 서버 종료 (code ${code}) — 자동으로 재시작합니다.`);
  });
};

const killDev = () => new Promise((done) => {
  if (!devChild?.pid) return done();
  const pid = devChild.pid;
  devChild = null;
  if (process.platform === 'win32') {
    // esbuild 등 하위 프로세스까지 종료
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', done);
  } else {
    devChild = null;
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
    setTimeout(done, 500);
  }
});

const resyncDev = async () => {
  if (!SUPERVISE_DEV) {
    // 단독 모드: 스토어만 갱신 (실행 중인 개발 서버는 다음 시작 때 반영)
    try {
      execFileSync('node', [join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'sync'], { cwd: ROOT, stdio: 'ignore', timeout: 120_000 });
    } catch { /* 무시 */ }
    return;
  }
  await killDev();
  spawnDev();
};

const cors = (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
};

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolveBody, reject) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > 2_000_000) { reject(new Error('payload too large')); req.destroy(); }
  });
  req.on('end', () => {
    try { resolveBody(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); }
  });
  req.on('error', reject);
});

/** 경로 탐색 차단: 파일명은 src/content/posts 바로 아래의 .md 만 허용 */
const safeFile = (file) =>
  typeof file === 'string' &&
  /^[^/\\]+$/.test(file) &&
  file.endsWith('.md') &&
  !file.startsWith('.');

const listPosts = () => readdirSync(POSTS).filter((f) => f.endsWith('.md')).map((file) => {
  const fm = parseFrontmatter(readFileSync(join(POSTS, file), 'utf8'));
  const get = fm?.get ?? (() => undefined);
  return {
    file,
    title: get('title'),
    description: get('description'),
    status: get('status'),
    topic: get('topic'),
    pubDate: get('pubDate'),
    publishAt: get('publishAt'),
    testedAt: get('testedAt'),
    author: get('author'),
  };
});

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const file = url.searchParams.get('file') ?? '';

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      return send(res, 200, { ok: true, version: 1 });
    }

    if (req.method === 'GET' && url.pathname === '/api/posts') {
      return send(res, 200, { posts: listPosts() });
    }

    if (req.method === 'GET' && url.pathname === '/api/post') {
      if (!safeFile(file) || !existsSync(join(POSTS, file))) return send(res, 404, { error: '파일을 찾을 수 없습니다.' });
      return send(res, 200, { file, content: readFileSync(join(POSTS, file), 'utf8') });
    }

    if (req.method === 'PUT' && url.pathname === '/api/posts') {
      const { file: newFile, content } = await readBody(req);
      if (!safeFile(newFile)) return send(res, 400, { error: '파일명은 영문/한글 파일명.md 형태여야 하며 경로를 포함할 수 없습니다.' });
      if (typeof content !== 'string' || content.trim() === '') return send(res, 400, { error: '내용이 비어 있습니다.' });
      const errors = validatePost(newFile, content);
      if (errors.length) return send(res, 422, { error: '콘텐츠 계약 위반', details: errors });
      const isNew = !existsSync(join(POSTS, newFile));
      writeFileSync(join(POSTS, newFile), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      void resyncDev();
      return send(res, 200, { ok: true, created: isNew });
    }

    if (req.method === 'POST' && url.pathname === '/api/status') {
      const body = await readBody(req);
      const { status, publishAt, testedAt, author } = body;
      if (!safeFile(body.file) || !existsSync(join(POSTS, body.file))) return send(res, 404, { error: '파일을 찾을 수 없습니다.' });
      if (!ALLOWED_STATUS.has(status)) return send(res, 400, { error: `status는 draft|scheduled|published 중 하나여야 합니다. (받은 값: ${status})` });

      const original = readFileSync(join(POSTS, body.file), 'utf8');
      const fm = parseFrontmatter(original);
      if (!fm) return send(res, 422, { error: 'frontmatter가 없습니다.' });

      let next = fm.set('status', status);
      if (status === 'scheduled') {
        const value = publishAt ?? fm.get('publishAt');
        if (!value) return send(res, 422, { error: '예약 발행은 publishAt(예약일)이 필요합니다.' });
        next = parseFrontmatter(next).set('publishAt', value);
      }
      if (status !== 'draft') {
        const tested = testedAt ?? fm.get('testedAt');
        const who = author ?? fm.get('author');
        if (!tested || tested === 'TBD') return send(res, 422, { error: '공개(status != draft)에는 testedAt(테스트 날짜)이 필요합니다 — 사람 검증 게이트.' });
        if (!who || who === 'TBD') return send(res, 422, { error: '공개(status != draft)에는 실명 author가 필요합니다.' });
        next = parseFrontmatter(next).set('testedAt', tested);
        next = parseFrontmatter(next).set('author', who);
      }

      const errors = validatePost(body.file, next);
      if (errors.length) return send(res, 422, { error: '변경 결과가 콘텐츠 계약을 위반합니다', details: errors });
      writeFileSync(join(POSTS, body.file), next, 'utf8');
      void resyncDev();
      return send(res, 200, { ok: true, status });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/post') {
      if (!safeFile(file) || !existsSync(join(POSTS, file))) return send(res, 404, { error: '파일을 찾을 수 없습니다.' });
      mkdirSync(TRASH, { recursive: true });
      const target = join(TRASH, `${Date.now()}-${file}`);
      renameSync(join(POSTS, file), target);
      void resyncDev();
      return send(res, 200, { ok: true, movedTo: target });
    }

    if (req.method === 'POST' && url.pathname === '/api/check') {
      const output = await new Promise((resolveCheck) => {
        execFile('node', [join(ROOT, 'scripts', 'check-content.mjs')], { cwd: ROOT }, (err, stdout, stderr) => {
          resolveCheck({ ok: !err, output: `${stdout}${stderr}`.trim() });
        });
      });
      return send(res, 200, output);
    }

    return send(res, 404, { error: '알 수 없는 경로' });
  } catch (err) {
    return send(res, 400, { error: err?.message ?? '요청 처리 실패' });
  }
});

if (SUPERVISE_DEV) spawnDev();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[admin] 관리 서버 실행: http://127.0.0.1:${PORT} (localhost 전용)`);
  console.log('[admin] 대시보드(http://localhost:4321/admin/)에서 편집·삭제·상태 변경을 사용할 수 있습니다.');
  console.log(`[admin] 삭제된 글은 ${resolve(TRASH)} 로 이동됩니다.`);
});

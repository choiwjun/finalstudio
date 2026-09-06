#!/usr/bin/env node
/**
 * 썸네일·커버 이미지 생성기 (본문 UI 스크린샷은 사람이 직접 촬영 — AI 이미지로 대체 금지)
 *
 * 사용법:
 *   npm run image -- --slug excel-linked-picture                 # Codex OAuth + $imagegen으로 생성
 *   npm run image -- --slug excel-linked-picture --engine manual # ChatGPT Images용 프롬프트 출력
 *   npm run image -- --slug excel-linked-picture --attach 받은파일.png  # 생성한 이미지 등록
 *
 * 동작:
 *   1) 글 파일(src/content/posts/<slug>.md)에서 제목·주제를 읽어 이미지 프롬프트를 만든다
 *   2) codex 모드: 인증된 Codex 세션에서 `$imagegen` 실행 → public/images/<slug>.png 저장
 *      manual 모드: 같은 프롬프트를 ChatGPT Images에 붙여넣어 이미지를 받는 안내 출력
 *   3) 이미지가 생기면 글 frontmatter에 `image: /images/<slug>.png`를 기록하고 astro sync
 *
 * 인증:
 *   `npm install -g @openai/codex` 후 `codex login` 필요.
 *   이미지 생성은 Codex/ChatGPT 사용량으로 처리하며 API 키를 사용하지 않는다.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseFrontmatter } from '../lib/content-contract.mjs';

const ROOT = process.cwd();
const IMAGES_DIR = join(ROOT, 'public', 'images');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const fail = (msg) => { console.error(`[image] 오류: ${msg}`); process.exit(1); };

const slug = (getArg('slug') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
if (!slug) fail('--slug <영어슬러그> 가 필요합니다. 예: npm run image -- --slug excel-linked-picture');

const postPath = join(POSTS_DIR, `${slug}.md`);
if (!existsSync(postPath)) fail(`글 파일이 없습니다: ${postPath} — 글을 먼저 저장하세요.`);

const ENGINE = getArg('engine') ?? process.env.IMAGE_ENGINE ?? 'codex';
const CODEX_MODEL = process.env.CODEX_MODEL;
const TARGET = `/images/${slug}.png`;
const targetPath = join(IMAGES_DIR, `${slug}.png`);

/* ── 프롬프트 생성 (글의 제목·주제 기반) ─────────────────── */
const raw = readFileSync(postPath, 'utf8');
const { get } = parseFrontmatter(raw);
const title = (get('title') ?? '').replace(/^["']+|["']+$/g, '');
const topic = get('topic') ?? 'personal notes';
const scene = 'a calm, editorial still life that suggests the post topic without showing readable screens or brand marks';
const imagePrompt = [
  'Flat, modern vector-style illustration for a Korean personal blog cover.',
  `Category: "${topic}". Theme: "${title}" — visualize with ${scene}.`,
  'Warm paper-white palette with one calm accent color, generous white space, minimal shapes,',
  'subtle depth, light texture, professional and personal mood.',
  'Strictly no letters, no words, no numbers, no logos, no readable text in the image, no people.',
  'Landscape 3:2 composition.',
].join(' ');

const CODEX_JS = (() => {
  if (process.platform === 'win32') {
    const candidate = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return existsSync(candidate) ? candidate : undefined;
  }
  const home = process.env.HOME ?? '';
  return [
    '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
    join(home, '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ].find((p) => existsSync(p));
})();

const CODEX_BIN = (() => {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(lookup, ['codex'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || undefined;
  } catch {
    return undefined;
  }
})();

const CODEX_COMMAND = CODEX_JS
  ? { executable: process.execPath, prefix: [CODEX_JS], shell: false }
  : CODEX_BIN
    ? { executable: CODEX_BIN, prefix: [], shell: process.platform === 'win32' }
    : undefined;

const codexRun = (prompt) => new Promise((resolveP, rejectP) => {
  if (!CODEX_COMMAND) return rejectP(new Error('codex CLI가 설치되어 있지 않습니다 (npm install -g @openai/codex).'));
  const codexArgs = ['exec', '--sandbox', 'workspace-write', '--ephemeral'];
  if (CODEX_MODEL) codexArgs.push('-m', CODEX_MODEL);
  codexArgs.push('--', prompt);
  const child = spawn(CODEX_COMMAND.executable, [...CODEX_COMMAND.prefix, ...codexArgs], {
    cwd: ROOT,
    shell: CODEX_COMMAND.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (data) => { out += data; });
  child.stderr.on('data', (data) => { err += data; });
  child.on('error', rejectP);
  child.on('close', (code) => {
    if (code === 0) resolveP(out);
    else rejectP(new Error(`codex 이미지 생성 실패 (exit ${code})\n${err.slice(-800)}`));
  });
});

const setImageFrontmatter = () => {
  if (!existsSync(targetPath)) fail('이미지 파일이 아직 없습니다.');
  let text = readFileSync(postPath, 'utf8');
  text = parseFrontmatter(text).set('image', TARGET);
  writeFileSync(postPath, text, 'utf8');
  try {
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'sync'], { cwd: ROOT, stdio: 'ignore', timeout: 120_000 });
  } catch { /* dev 서버 없으면 무시 */ }
  console.log(`[image] 등록 완료: ${postPath} → image: ${TARGET}`);
};

/* ── 모드 1: 수동 생성 이미지 등록 ───────────────────────── */
if (getArg('attach')) {
  const src = resolve(getArg('attach'));
  if (!existsSync(src)) fail(`붙일 파일이 없습니다: ${src}`);
  mkdirSync(IMAGES_DIR, { recursive: true });
  copyFileSync(src, targetPath);
  setImageFrontmatter();
  process.exit(0);
}

/* ── 모드 2: ChatGPT 수동 생성 안내 (선택) ───────────────── */
if (ENGINE === 'manual') {
  console.log('[image] ChatGPT Images 수동 생성 모드:\n');
  console.log('  1) ChatGPT(구독 플랜)에 아래 프롬프트를 붙여넣어 이미지를 생성하세요:\n');
  console.log(`--- 이미지 프롬프트 (복사) ---\n${imagePrompt}\n--- 여기까지 ---\n`);
  console.log(`  2) 받은 이미지를 다음 명령으로 등록하세요:`);
  console.log(`     npm run image -- --slug ${slug} --attach "받은이미지.png"`);
  console.log(`\n  ※ 등록하면 ${targetPath} 로 복사되고 글 frontmatter에 image 필드가 기록됩니다.`);
  // 명시적 수동 모드는 정상 종료하며, 생성 파일 등록은 --attach로 마무리한다.
  process.exit(0);
}

/* ── 모드 3: Codex OAuth + $imagegen ─────────────────────── */
if (ENGINE !== 'codex') fail('이미지 엔진은 codex 또는 manual만 지원합니다. API 키 방식은 사용하지 않습니다.');
if (!CODEX_COMMAND) fail('codex CLI가 없습니다. `npm install -g @openai/codex` 후 `codex login`을 실행하세요.');

console.log('[image] Codex OAuth + $imagegen으로 생성 중...');
try {
  await codexRun([
    '$imagegen',
    '이 작업공간의 글을 위한 커버 이미지를 생성하세요.',
    `프롬프트: ${imagePrompt}`,
    `생성한 최종 이미지를 반드시 ${targetPath} 경로에 PNG 파일로 저장하세요.`,
    '이 파일 외에는 어떤 파일도 수정하지 마세요. 이미지 저장이 끝나면 경로만 짧게 답하세요.',
  ].join('\n'));
} catch (error) {
  fail(error instanceof Error ? error.message : 'Codex 이미지 생성에 실패했습니다.');
}
if (!existsSync(targetPath)) fail(`Codex가 이미지를 저장하지 않았습니다: ${targetPath}`);
console.log(`[image] 저장 완료: ${targetPath}`);
setImageFrontmatter();

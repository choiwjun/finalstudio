#!/usr/bin/env node
/**
 * 썸네일·커버 이미지 생성기 (본문 UI 스크린샷은 사람이 직접 촬영 — AI 이미지로 대체 금지)
 *
 * 사용법:
 *   npm run image -- --slug excel-linked-picture                 # API로 자동 생성 (OPENAI_API_KEY 필요)
 *   npm run image -- --slug excel-linked-picture --engine manual # ChatGPT용 프롬프트를 출력 (수동 생성)
 *   npm run image -- --slug excel-linked-picture --attach 받은파일.png  # 수동 생성 이미지 등록
 *
 * 동작:
 *   1) 글 파일(src/content/posts/<slug>.md)에서 제목·주제를 읽어 이미지 프롬프트를 만든다
 *   2) api 모드: OpenAI Images API(gpt-image-1) 호출 → public/images/<slug>.png 저장
 *      manual 모드: 같은 프롬프트를 ChatGPT(구독)에 붙여넣어 이미지를 받는 안내 출력
 *   3) 이미지가 생기면 글 frontmatter에 `image: /images/<slug>.png`를 기록하고 astro sync
 *
 * 환경변수:
 *   OPENAI_API_KEY   api 모드 필수
 *   OPENAI_BASE_URL  선택 (기본 https://api.openai.com/v1)
 *   IMAGES_MODEL     선택 (기본 gpt-image-1)
 *   IMAGES_QUALITY   선택 (low | medium | high — 기본 medium, 장당 약 $0.02~0.07)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const IMAGES_MODEL = process.env.IMAGES_MODEL ?? 'gpt-image-1';
const IMAGES_QUALITY = process.env.IMAGES_QUALITY ?? 'medium';
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

/* ── 모드 2: ChatGPT 수동 생성 안내 (구독 플랜) ──────────── */
if (getArg('engine') === 'manual' || !API_KEY) {
  if (!API_KEY) console.log('[image] OPENAI_API_KEY가 없어 API 자동 생성을 건너뜁니다 — ChatGPT 수동 모드 안내:\n');
  console.log('  1) ChatGPT(구독 플랜)에 아래 프롬프트를 붙여넣어 이미지를 생성하세요:\n');
  console.log(`--- 이미지 프롬프트 (복사) ---\n${imagePrompt}\n--- 여기까지 ---\n`);
  console.log(`  2) 받은 이미지를 다음 명령으로 등록하세요:`);
  console.log(`     npm run image -- --slug ${slug} --attach "받은이미지.png"`);
  console.log(`\n  ※ 등록하면 ${targetPath} 로 복사되고 글 frontmatter에 image 필드가 기록됩니다.`);
  // 명시적 수동 모드는 정상 종료, API 키 없는 폴백은 실패 종료 (CI에서 감지 가능)
  process.exit(getArg('engine') === 'manual' ? 0 : 1);
}

/* ── 모드 3: API 자동 생성 ───────────────────────────────── */
console.log(`[image] 생성 중... (${IMAGES_MODEL}, quality=${IMAGES_QUALITY})`);
const res = await fetch(`${BASE_URL}/images/generations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ model: IMAGES_MODEL, prompt: imagePrompt, size: '1536x1024', quality: IMAGES_QUALITY, n: 1 }),
});
if (!res.ok) {
  const detail = await res.text().catch(() => '');
  fail(`이미지 API 호출 실패 (${res.status}): ${detail.slice(0, 300)}`);
}
const data = await res.json();
const b64 = data.data?.[0]?.b64_json;
if (!b64) fail('API 응답에 이미지(b64_json)가 없습니다.');
mkdirSync(IMAGES_DIR, { recursive: true });
writeFileSync(targetPath, Buffer.from(b64, 'base64'));
console.log(`[image] 저장 완료: ${targetPath}`);
setImageFrontmatter();

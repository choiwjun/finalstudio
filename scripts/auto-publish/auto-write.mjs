#!/usr/bin/env node
/**
 * 자동 글발행 코어 — ChatGPT 3단계 파이프라인을 명령 한 줄로 실행한다.
 *
 *   npm run auto:write "엑셀 VLOOKUP 다른 시트 데이터 가져오기" --level 완전초보 --stage 도구 --topic productivity
 *
 * 동작:
 *   1단계 초안(BRAND+VOICE+writer 프롬프트) → 2단계 윤문 → 3단계 검수(90점 게이트, 미달 시 재수정)
 *   → scripts/auto-publish/convert-post.mjs 호출 → status: draft로 저장
 *
 * 모드:
 *   (기본)            LLM 엔진 3단계 전부 자동 실행
 *   --calendar <파일>  편집 캘린더에서 다음 미완료 주제를 가져와 자동 실행 후 체크 표시 (GitHub Actions용)
 *   --input <파일>     이미 작성된 초안에 2단계 윤문 + 3단계 검수만 적용
 *   --from-final <파일> 엔진 없이 변환·저장만 수행 (ChatGPT 수동 흐름 마무리용)
 *
 * 엔진 (--engine codex|api, 기본: OPENAI_API_KEY 있으면 api, 없으면 codex):
 *   codex  Codex CLI가 ChatGPT 구독 계정(OAuth 로그인)으로 3단계 실행 — API 과금 없음.
 *          사전 준비: `npm install -g @openai/codex` 후 `codex login` (브라우저에서 ChatGPT 로그인)
 *   api    OpenAI 호환 API를 API 키로 호출 (GitHub Actions 등 서버 자동화용)
 *
 * 환경변수 (codex·api 둘 다 없으면 수동 모드 안내를 출력하고 종료):
 *   OPENAI_API_KEY   api 엔진 필수 (글 1장당 약 $0.01~0.05 — gpt-4o-mini 기준)
 *   OPENAI_BASE_URL  선택 (기본 https://api.openai.com/v1 — 호환 API 사용 시 변경)
 *   AUTO_MODEL       선택, api 엔진 (기본 gpt-4o-mini)
 *   AUTO_ENGINE      선택 (codex | api — --engine보다 약함)
 *   CODEX_MODEL      선택, codex 엔진 (기본: ChatGPT 플랜 기본 모델)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const PROMPTS_DIR = join(ROOT, '.planning', 'prompts');
const OUT_DIR = join(ROOT, 'out', 'auto-publish');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const readDoc = (p) => {
  const full = resolve(ROOT, p);
  if (!existsSync(full)) fail(`파일이 없습니다: ${p}`);
  return readFileSync(full, 'utf8');
};

/** 프롬프트 파일에서 "프롬프트 (여기부터 복사) ~ (여기까지 복사)" 구간만 추출 */
const extractPromptSection = (text) => {
  const m = text.match(/## 프롬프트 \(여기부터 복사\)\n([\s\S]*?)## 프롬프트 \(여기까지 복사\)/);
  return (m ? m[1] : text).trim();
};

const readFrontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { front: '', body: text };
  const get = (key) => m[1].match(new RegExp(`^${key}:\\s*"?(.+?)"?$`, 'm'))?.[1]?.trim();
  return { front: m[1], body: text.slice(m[0].length).trimStart(), get };
};

const stripFences = (text) => text.replace(/^```(?:markdown)?\n/, '').replace(/\n```$/, '').trim();

// 검수 응답에는 최종 채점표가 붙을 수 있다. 저장 대상은 채점표가 아닌
// frontmatter부터 시작하는 글 본문이어야 하므로, 본문을 안전하게 추출한다.
const extractArticle = (text, fallback) => {
  const start = text.search(/^---\n/m);
  if (start === -1) return fallback;
  const scoreHeading = text.match(/^---\s*최종 채점\s*---/m);
  const end = scoreHeading?.index > start ? scoreHeading.index : text.length;
  const article = text.slice(start, end).trim();
  return article.startsWith('---\n') && /^---\n[\s\S]*?\n---/.test(article) ? article : fallback;
};

const topicArg = getArg('topic');
const levelArg = getArg('level');
const stageArg = getArg('stage');
const tone = getArg('tone') ?? '해요체';
const slug = getArg('slug');
const angleArg = getArg('angle');
const calendarPath = getArg('calendar');
const inputPath = getArg('input');
const finalPath = getArg('from-final');
const positionalTopic = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].match(/^--(topic|level|stage|tone|slug|angle|calendar|input|from-final)$/)));

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.AUTO_MODEL ?? 'gpt-4o-mini';
const CODEX_MODEL = process.env.CODEX_MODEL;

const fail = (msg) => { console.error(`[auto-write] 오류: ${msg}`); process.exit(1); };

/* ── LLM 엔진: codex(ChatGPT 구독 OAuth) | api(API 키) ────── */
// Windows에서 npm 전역 codex는 .cmd 셔미이므로 실제 JS 진입점을 직접 호출한다.
const CODEX_JS = (() => {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  }
  const home = process.env.HOME ?? '';
  return [
    '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
    join(home, '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ].find((p) => existsSync(p));
})();

const codexRun = (codexArgs, stdinText) =>
  new Promise((resolveP, rejectP) => {
    if (!CODEX_JS) return rejectP(new Error('codex CLI가 설치되어 있지 않습니다 (npm install -g @openai/codex).'));
    const child = spawn(process.execPath, [CODEX_JS, ...codexArgs], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error(`codex ${codexArgs.join(' ')} 실패 (exit ${code})\n${err.slice(-500)}`));
    });
    if (stdinText) child.stdin.write(stdinText);
    child.stdin.end();
  });

const codexLoggedIn = async () => {
  try {
    await codexRun(['login', 'status']);
    return true;
  } catch {
    return false;
  }
};

// codex exec 공식 패턴: stdin 파이프 = 추가 컨텍스트(규칙·본문), 인자 = 지시문
const callCodex = async (system, user) => {
  const codexArgs = ['exec', '--sandbox', 'read-only', '--ephemeral'];
  if (CODEX_MODEL) codexArgs.push('-m', CODEX_MODEL);
  codexArgs.push(user);
  const out = await codexRun(codexArgs, system);
  return stripFences(out.trim());
};

const callChat = async (system, user) => {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    fail(`API 호출 실패 (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return stripFences(data.choices?.[0]?.message?.content ?? '');
};

const convert = (inputFile, topicTag, angle, fileSlug) => {
  const cmdArgs = [join(ROOT, 'scripts', 'auto-publish', 'convert-post.mjs'), inputFile, '--topic', topicTag, '--angle', angle];
  if (fileSlug) cmdArgs.push('--slug', fileSlug);
  return execFileSync('node', cmdArgs, { encoding: 'utf8', cwd: ROOT });
};

const markCalendarDone = (file, subject) => {
  const lines = readFileSync(file, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ]') && l.includes(subject));
  if (idx !== -1) {
    lines[idx] = lines[idx].replace('- [ ]', `- [x] (${new Date().toISOString().slice(0, 10)})`);
    writeFileSync(file, lines.join('\n'), 'utf8');
  }
};

/* ── 모드 3: 변환만 (API 불필요) ─────────────────────────── */
if (finalPath) {
  const text = readDoc(finalPath);
  const { get } = readFrontmatter(text);
  const topicTag = topicArg ?? get('topic');
  const angle = angleArg ?? get('angle');
  if (!['productivity', 'ai-workflows'].includes(topicTag)) fail('--topic productivity|ai-workflows 를 지정하세요.');
  if (!angle) fail('--angle "..." 을 지정하세요.');
  console.log(convert(finalPath, topicTag, angle, slug));
  process.exit(0);
}

/* ── 준비: 주제·옵션 결정 (CLI 플래그 > 캘린더 항목 순으로 우선) ── */
let subject = positionalTopic;
let calendarTopic;
let levelOverride;
let stageOverride;
let calendarFile;
if (calendarPath) {
  // 외부 let calendarFile에 할당한다 — 블록 안에서 const로 다시 선언하면
  // 마지막의 markCalendarDone(calendarFile, ...)이 undefined를 받아 [x] 표시가 동작하지 않는다.
  calendarFile = resolve(ROOT, calendarPath);
  if (!existsSync(calendarFile)) fail(`캘린더 파일이 없습니다: ${calendarPath}`);
  const line = readFileSync(calendarFile, 'utf8').split('\n').find((l) => l.startsWith('- [ ]'));
  if (!line) fail('캘린더에 미완료 주제가 없습니다.');
  const [s, lvl, stg, tag] = line.replace('- [ ]', '').split('|').map((x) => x.trim());
  if (!s) fail(`캘린더 항목 형식이 잘못됐습니다: ${line}`);
  subject = s;
  levelOverride = lvl;
  stageOverride = stg;
  if (tag && !topicArg) {
    if (!['productivity', 'ai-workflows'].includes(tag)) fail(`캘린더 주제 태그가 잘못됐습니다: ${tag}`);
    calendarTopic = tag;
  }
}
const topicTag = topicArg ?? calendarTopic;
const level = levelOverride ?? levelArg ?? '완전초보';
const stage = stageOverride ?? stageArg ?? '도구';

if (!subject && !inputPath) fail('주제가 필요합니다. 예: npm run auto:write "주제" --topic productivity');
if (!['productivity', 'ai-workflows'].includes(topicTag ?? '')) fail('--topic productivity|ai-workflows 를 지정하세요.');

/* ── 엔진 결정 + 수동 폴백 ───────────────────────────────── */
const ENGINE = getArg('engine') ?? process.env.AUTO_ENGINE ?? (API_KEY ? 'api' : 'codex');
if (!['codex', 'api'].includes(ENGINE)) fail('--engine codex|api 만 지원합니다.');
const callModel = ENGINE === 'codex' ? callCodex : callChat;

if (ENGINE === 'codex') {
  if (!CODEX_JS) {
    fail('codex CLI가 없습니다. `npm install -g @openai/codex` 후 터미널에서 `codex login` (브라우저에서 ChatGPT 계정 로그인)을 먼저 실행하세요.');
  }
  if (!(await codexLoggedIn())) {
    fail('codex가 로그인되어 있지 않습니다. 터미널에서 `codex login` 실행 → 브라우저에서 ChatGPT 계정으로 로그인하세요. (API 과금 없이 구독 플랜 사용량으로 실행됩니다)');
  }
  console.log('[auto-write] 엔진: codex — ChatGPT 구독(OAuth) 사용량으로 실행 (API 과금 없음)');
} else if (!API_KEY) {
  console.log(`[auto-write] OPENAI_API_KEY가 없어 api 엔진 실행을 건너뜁니다. 수동 모드 안내:\n`);
  console.log(`  주제: ${subject} / 독자: ${level} / 사다리: ${stage} / 주제태그: ${topicTag}`);
  console.log(`\n  1) ChatGPT에 다음 3개 파일을 순서대로 붙여넣어 진행 (같은 대화에서):`);
  console.log(`     - BRAND.md + VOICE.md + .planning/prompts/content-writer-prompt.md`);
  console.log(`     - .planning/prompts/chatgpt-humanize-prompt.md (윤문 — 필수)`);
  console.log(`     - .planning/prompts/chatgpt-review-prompt.md (검수 — 90점 이상)`);
  console.log(`\n  2) 검수 통과본을 파일로 저장한 뒤:`);
  console.log(`     npm run auto:write --from-final 검수통과본.md --topic ${topicTag} --angle "관점"`);
  console.log(`\n  ※ 구독으로 자동화하려면: npm install -g @openai/codex && codex login 후 다시 실행 (codex 엔진).`);
  console.log(`  ※ API 자동화를 원하면 .env에 OPENAI_API_KEY를 설정하세요 (글 1장당 약 $0.01~0.05).`);
  process.exit(1);
} else {
  console.log(`[auto-write] 엔진: api (${MODEL})`);
}

/* ── 1~3단계 실행 ───────────────────────────────────────── */
const runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const runDir = join(OUT_DIR, runId);
mkdirSync(runDir, { recursive: true });

const brand = readDoc('BRAND.md');
const voice = readDoc('VOICE.md');
const writerSystem = `${brand}\n\n---\n\n${voice}\n\n---\n\n${extractPromptSection(readDoc(join(PROMPTS_DIR, 'content-writer-prompt.md')))}`;
const humanizeSystem = extractPromptSection(readDoc(join(PROMPTS_DIR, 'chatgpt-humanize-prompt.md')));
const reviewSystem = extractPromptSection(readDoc(join(PROMPTS_DIR, 'chatgpt-review-prompt.md')));

let draft;
if (inputPath) {
  draft = readDoc(inputPath);
  console.log('[auto-write] 1단계 초안: --input 파일 사용');
} else {
  console.log(`[auto-write] 1단계 초안 생성 중... (${ENGINE === 'codex' ? 'codex' : MODEL})`);
  draft = await callModel(
    writerSystem,
    `주제/키워드: ${subject}\n대상 독자 수준: ${level}\n확장 사다리 단계: ${stage}\n문체: ${tone}`,
  );
  writeFileSync(join(runDir, '01-draft.md'), draft, 'utf8');
}

console.log('[auto-write] 2단계 윤문 중... (AI 티 제거, 구조·마커 보존)');
const humanized = await callModel(
  humanizeSystem,
  `${draft}\n\n(윤문 대상은 위 전체입니다. 프론트매터(--- 블록)와 검증 마커, 마크다운 구조는 그대로 유지하세요.)`,
);
writeFileSync(join(runDir, '02-humanized.md'), humanized, 'utf8');

const parseScore = (text) => {
  const score = Number(text.match(/총점:\s*(\d{1,3})\s*\/?\s*100/)?.[1] ?? NaN);
  return score >= 0 && score <= 100 ? score : NaN;
};
let reviewed = '';
let score = NaN;
let passes = 0;
const MAX_PASSES = Number(process.env.AUTO_MAX_PASSES ?? 2);
let finalText = humanized;
let candidate = humanized;

while (passes < MAX_PASSES) {
  passes += 1;
  console.log(`[auto-write] 3단계 검수 중... (${passes}/${MAX_PASSES})`);
  reviewed = await callModel(reviewSystem, candidate);
  writeFileSync(join(runDir, `03-review-${passes}.md`), reviewed, 'utf8');
  score = parseScore(reviewed);
  if (score >= 90) {
    finalText = extractArticle(reviewed, candidate);
    break;
  }
  if (passes < MAX_PASSES) {
    console.log(`[auto-write] 점수 ${score}점 — 치명적 결함을 수정한 최종본만 출력하도록 재요청합니다.`);
    const corrected = await callModel(
      reviewSystem,
      `${reviewed}\n\n(위 심사에서 감점된 부분을 모두 수정한 **최종 본문만** 출력하세요. 프론트매터·마커·구조는 유지.)`,
    );
    candidate = extractArticle(corrected, candidate);
    finalText = candidate;
  }
}
if (!(score >= 90)) {
  fail(`검수 점수 ${score}점 — 90점 게이트를 통과하지 못했습니다. out/auto-publish/${runId}/ 의 리포트를 확인하고 ChatGPT 수동 모드로 다듬으세요.`);
}

const saved = join(runDir, '04-final.md');
writeFileSync(saved, finalText, 'utf8');
console.log(`[auto-write] 90점 게이트 통과 (${score}점) — 중간 산출물: out/auto-publish/${runId}/`);

/* ── 4단계: 변환·저장 ───────────────────────────────────── */
const { get } = readFrontmatter(finalText);
const angle = angleArg ?? get('angle');
if (!angle) fail('angle을 확정할 수 없습니다. --angle "..." 을 지정하세요.');
console.log(convert(saved, topicTag, angle, slug));

if (calendarFile && subject) markCalendarDone(calendarFile, subject);
console.log('[auto-write] 완료. 다음: 사람 검증(테스트·스크린샷·마커 채우기) → npm run check:content → 승인·발행');

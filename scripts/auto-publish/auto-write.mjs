#!/usr/bin/env node
/**
 * 자동 글발행 코어 — ChatGPT 3단계 파이프라인을 명령 한 줄로 실행한다.
 *
 *   npm run auto:write "글 주제" --level 완전초보 --stage 도구 --topic 카테고리
 *
 * 동작:
 *   1단계 초안(BRAND+VOICE+writer 프롬프트, --best-of N이면 N개 생성 후 기계 점수로 선택)
 *   → 2단계 윤문 → 기계 검사(check-writing) + 독립 심사자 채점 → 3단계 수정 루프
 *   → 기계 게이트 통과 + 심사 90점 이상일 때만 저장
 *   → scripts/auto-publish/convert-post.mjs 호출 → status: draft로 저장
 *
 * 모드:
 *   (기본)            LLM 엔진 3단계 전부 자동 실행
 *   --calendar <파일>  편집 캘린더에서 다음 미완료 주제를 가져와 자동 실행 후 체크 표시 (로컬 Codex용)
 *   --input <파일>     이미 작성된 초안에 2단계 윤문 + 3단계 검수만 적용
 *   --from-final <파일> 엔진 없이 변환·저장만 수행 (ChatGPT 수동 흐름 마무리용)
 *   --notes <파일>     원자료(notes). experience·place-log·book-memo·photo-log 형식은 필수.
 *                      모델은 원자료에 없는 경험·수치를 만들 수 없다 (지어내기 방지)
 *
 * 게이트 (작가 ≠ 심사자 분리):
 *   - 기계 검사: scripts/check-writing.mjs — 문장·구조·형식·마커·출처 없는 주장을 결정론적으로 측정
 *   - 독립 심사: independent-judge-prompt.md — writer 컨텍스트를 배제한 맨 프롬프트로만 채점
 *   - 최종 저장 조건: 기계 검사 통과 && 독립 심사 90점 이상
 *
 * 엔진:
 *   codex  Codex CLI가 ChatGPT 계정(OAuth 로그인)으로 3단계 실행.
 *          사전 준비: `npm install -g @openai/codex` 후 `codex login`
 *
 * 환경변수:
 *   AUTO_ENGINE      codex만 지원 (기본: codex)
 *   CODEX_MODEL      선택 (기본: ChatGPT 플랜 기본 모델)
 *   AUTO_BEST_OF     1단계 초안 생성 수 (기본 1, --best-of로 우선)
 *   AUTO_MAX_PASSES  수정 루프 최대 횟수 (기본 2)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { analyzePost, extractMarkers } from '../check-writing.mjs';

const ROOT = process.cwd();
const PROMPTS_DIR = join(ROOT, '.planning', 'prompts');
const EDITORIAL_DIR = join(ROOT, '.editorial');
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
const tone = getArg('tone') ?? '합니다체';
const slug = getArg('slug');
const angleArg = getArg('angle');
const formatArg = getArg('format') ?? getArg('type');
const personaArg = getArg('persona');
const calendarPath = getArg('calendar');
const inputPath = getArg('input');
const finalPath = getArg('from-final');
const notesPath = getArg('notes');
const bestOfArg = getArg('best-of');
const positionalTopic = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].match(/^--(topic|level|stage|tone|slug|angle|format|type|persona|calendar|input|from-final|notes|best-of)$/)));

const CODEX_MODEL = process.env.CODEX_MODEL;

const fail = (msg) => { console.error(`[auto-write] 오류: ${msg}`); process.exit(1); };

const readJson = (p) => {
  try {
    return JSON.parse(readDoc(p));
  } catch (error) {
    fail(`JSON 파일을 읽을 수 없습니다: ${p} (${error instanceof Error ? error.message : String(error)})`);
  }
};

const editorialManifest = readJson(join(EDITORIAL_DIR, 'manifest.json'));
const editorialVersion = editorialManifest.version ?? 'unversioned';
const format = formatArg ?? editorialManifest.defaultFormat ?? 'how-to';
const personaName = personaArg ?? editorialManifest.defaultPersona;
const blueprintPath = editorialManifest.modules?.blueprints?.[format];
const personaPath = editorialManifest.modules?.personas?.[personaName];

if (!blueprintPath) fail(`지원하지 않는 글 유형입니다: ${format}`);
if (!personaPath) fail(`페르소나를 찾을 수 없습니다: ${personaName}`);

/* 경험 계열 형식은 원자료 없이 생성하면 경험을 지어낼 수밖에 없다 — 원자료를 필수로 강제한다. */
const NOTES_REQUIRED = new Set(['experience', 'place-log', 'book-memo', 'photo-log']);
if (NOTES_REQUIRED.has(format) && !notesPath) {
  fail(`형식 ${format}은(는) 원자료가 필요합니다. --notes <파일>로 사람이 남긴 메모·기록을 제공하세요 (notes/README.md 참고).`);
}
const notesContent = notesPath ? readDoc(notesPath) : undefined;

const editorialModules = {
  constitution: readDoc(editorialManifest.modules.constitution),
  styleGuide: readDoc(editorialManifest.modules.styleGuide),
  blueprint: readDoc(blueprintPath),
  persona: readJson(personaPath),
  exemplar: editorialManifest.modules?.exemplars?.[format]
    ? readDoc(editorialManifest.modules.exemplars[format])
    : undefined,
};
const judgePromptPath = editorialManifest.modules?.prompts?.judge ?? join(PROMPTS_DIR, 'independent-judge-prompt.md');
const judgeSystem = extractPromptSection(readDoc(judgePromptPath));

const moduleText = [
  `EDITORIAL_SYSTEM_VERSION: ${editorialVersion}`,
  `SELECTED_PERSONA: ${personaName}`,
  `SELECTED_FORMAT: ${format}`,
  '--- 편집 헌법 ---',
  editorialModules.constitution,
  '--- 문체 가이드 ---',
  editorialModules.styleGuide,
  '--- 글 유형 템플릿 ---',
  editorialModules.blueprint,
  '--- 페르소나 ---',
  JSON.stringify(editorialModules.persona, null, 2),
  editorialModules.exemplar ? '--- exemplar (이 형식의 문체·구조 기준 발췌 — 베끼지 말고 수준의 기준으로만) ---' : undefined,
  editorialModules.exemplar ?? undefined,
].filter((x) => x !== undefined).join('\n\n');

const hashText = (text) => createHash('sha256').update(text).digest('hex');

/* ── LLM 엔진: codex(ChatGPT OAuth) ───────────────────────── */
// Windows에서 npm 전역 codex는 .cmd 셔미이므로 실제 JS 진입점을 직접 호출한다.
// standalone Codex 설치본(예: ~/.local/bin/codex)도 지원한다.
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

const codexRun = (codexArgs, stdinText) =>
  new Promise((resolveP, rejectP) => {
    if (!CODEX_COMMAND) return rejectP(new Error('codex CLI가 설치되어 있지 않습니다 (npm install -g @openai/codex).'));
    const child = spawn(CODEX_COMMAND.executable, [...CODEX_COMMAND.prefix, ...codexArgs], {
      cwd: ROOT,
      shell: CODEX_COMMAND.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
  // 초안은 YAML frontmatter(`---`)로 시작할 수 있으므로 CLI 옵션과 분리한다.
  codexArgs.push('--', user);
  const out = await codexRun(codexArgs, system);
  return stripFences(out.trim());
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
  if (!topicTag?.trim()) fail('--topic 카테고리이름을 지정하세요.');
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
    if (!tag?.trim()) fail(`캘린더 카테고리가 비어 있습니다: ${line}`);
    calendarTopic = tag;
  }
}
const topicTag = topicArg ?? calendarTopic;
const level = levelOverride ?? levelArg ?? '완전초보';
const stage = stageOverride ?? stageArg ?? '도구';

if (!subject && !inputPath) fail('주제가 필요합니다. 예: npm run auto:write "주제" --topic 카테고리');
if (!topicTag?.trim()) fail('--topic 카테고리이름을 지정하세요.');

/* ── 엔진 결정: Codex OAuth만 사용 ───────────────────────── */
const ENGINE = getArg('engine') ?? process.env.AUTO_ENGINE ?? 'codex';
if (ENGINE !== 'codex') {
  fail('이 파이프라인은 ChatGPT OAuth 기반 Codex만 지원합니다. `--engine codex`를 사용하세요.');
}
if (!CODEX_COMMAND) {
  fail('codex CLI가 없습니다. `npm install -g @openai/codex` 후 `codex login` (브라우저에서 ChatGPT 계정 로그인)을 먼저 실행하세요.');
}
if (!(await codexLoggedIn())) {
  fail('codex가 로그인되어 있지 않습니다. `codex login` 실행 후 브라우저에서 ChatGPT 계정으로 로그인하세요.');
}
const callModel = callCodex;
console.log('[auto-write] 엔진: codex — ChatGPT OAuth 세션으로 실행');

/* ── 게이트 상수와 작성자 입력 ───────────────────────────── */
const JUDGE_THRESHOLD = 90;
const BEST_OF = Math.max(1, Number(bestOfArg ?? process.env.AUTO_BEST_OF ?? 1));
const writerInput = [
  `주제/키워드: ${subject}`,
  `대상 독자 수준: ${level}`,
  `확장 사다리 단계: ${stage}`,
  `문체: ${tone}`,
  notesContent ? '\n--- 원자료 (유일한 사실·경험 재료 — 여기에 없는 경험·수치·장면을 만들지 마세요) ---' : undefined,
  notesContent,
].filter((x) => x !== undefined).join('\n');

/* ── 1~3단계 실행 ───────────────────────────────────────── */
const runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const runDir = join(OUT_DIR, runId);
mkdirSync(runDir, { recursive: true });

const brand = readDoc('BRAND.md');
const voice = readDoc('VOICE.md');
const baseEditorialSystem = `${moduleText}\n\n--- 브랜드 ---\n\n${brand}\n\n--- 기존 문체 계약 ---\n\n${voice}`;
const writerSystem = `${baseEditorialSystem}\n\n--- 작성 프롬프트 ---\n\n${extractPromptSection(readDoc(join(PROMPTS_DIR, 'content-writer-prompt.md')))}`;
const humanizeSystem = `${baseEditorialSystem}\n\n--- 윤문 프롬프트 ---\n\n${extractPromptSection(readDoc(join(PROMPTS_DIR, 'chatgpt-humanize-prompt.md')))}`;
const reviewSystem = `${baseEditorialSystem}\n\n--- 검수 프롬프트 ---\n\n${extractPromptSection(readDoc(join(PROMPTS_DIR, 'chatgpt-review-prompt.md')))}`;

writeFileSync(join(runDir, 'prompt-manifest.json'), JSON.stringify({
  version: editorialVersion,
  persona: personaName,
  format,
  model: CODEX_MODEL ?? 'ChatGPT plan default',
  engine: 'codex-oauth',
  gates: { mechanical: 'check-writing.mjs', independentJudge: JUDGE_THRESHOLD, bestOf: BEST_OF },
  modules: {
    constitution: hashText(editorialModules.constitution),
    styleGuide: hashText(editorialModules.styleGuide),
    blueprint: hashText(editorialModules.blueprint),
    persona: hashText(JSON.stringify(editorialModules.persona)),
    exemplar: editorialModules.exemplar ? hashText(editorialModules.exemplar) : null,
    judge: hashText(judgeSystem),
    brand: hashText(brand),
    voice: hashText(voice),
  },
}, null, 2), 'utf8');
console.log(`[auto-write] 편집 시스템 ${editorialVersion} / 페르소나 ${personaName} / 유형 ${format} / 게이트 기계검사+독립심사${JUDGE_THRESHOLD}점`);

let draft;
if (inputPath) {
  draft = readDoc(inputPath);
  console.log('[auto-write] 1단계 초안: --input 파일 사용');
} else if (BEST_OF === 1) {
  console.log('[auto-write] 1단계 초안 생성 중... (codex)');
  draft = await callModel(writerSystem, writerInput);
  writeFileSync(join(runDir, '01-draft.md'), draft, 'utf8');
} else {
  console.log(`[auto-write] 1단계 초안 생성 중... (codex, best-of ${BEST_OF})`);
  const candidates = [];
  for (let i = 1; i <= BEST_OF; i++) {
    const text = await callModel(writerSystem, writerInput);
    const candidateAnalysis = analyzePost(text, { format });
    writeFileSync(join(runDir, `01-draft-${i}.md`), text, 'utf8');
    candidates.push({ index: i, mechanicalFailures: candidateAnalysis.failures.length, mechanicalWarnings: candidateAnalysis.warnings.length });
    console.log(`[auto-write] 후보 ${i}: 기계 실패 ${candidateAnalysis.failures.length}건 / 경고 ${candidateAnalysis.warnings.length}건`);
  }
  const best = candidates.reduce((a, b) =>
    (b.mechanicalFailures < a.mechanicalFailures || (b.mechanicalFailures === a.mechanicalFailures && b.mechanicalWarnings < a.mechanicalWarnings) ? b : a));
  draft = (await Promise.all(candidates.map((c) => readFileSync(join(runDir, `01-draft-${c.index}.md`), 'utf8'))))[best.index - 1];
  writeFileSync(join(runDir, '01-draft-selection.json'), JSON.stringify({ bestOf: BEST_OF, selected: best.index, candidates }, null, 2), 'utf8');
  console.log(`[auto-write] 후보 ${best.index} 선택 (기계 점수 기준)`);
}

console.log('[auto-write] 2단계 윤문 중... (AI 티 제거, 구조·마커 보존)');
const humanized = await callModel(
  humanizeSystem,
  `${draft}\n\n(윤문 대상은 위 전체입니다. 프론트매터(--- 블록)와 검증 마커, 마크다운 구조는 그대로 유지하세요. SELECTED_FORMAT: ${format})`,
);
writeFileSync(join(runDir, '02-humanized.md'), humanized, 'utf8');
const expectedMarkers = extractMarkers(humanized);

const parseScore = (text) => {
  const score = Number(text.match(/총점:\s*(\d{1,3})\s*\/?\s*100/)?.[1] ?? NaN);
  return score >= 0 && score <= 100 ? score : NaN;
};

let candidate = humanized;
let finalText = humanized;
let judgeScore = NaN;
let analysis = analyzePost(candidate, { format, expectedMarkers });
const MAX_PASSES = Number(process.env.AUTO_MAX_PASSES ?? 2);
let passes = 0;

while (passes < MAX_PASSES) {
  passes += 1;
  console.log(`[auto-write] 3단계 판정 중... 기계 검사 + 독립 심사 (${passes}/${MAX_PASSES})`);
  analysis = analyzePost(candidate, { format, expectedMarkers });
  writeFileSync(join(runDir, `05-writing-check-${passes}.json`), JSON.stringify(analysis, null, 2), 'utf8');
  for (const f of analysis.failures) console.log(`  [기계 실패] [${f.check}] ${f.message}`);
  const judgeOutput = await callCodex(judgeSystem, `SELECTED_FORMAT: ${format}\n\n${candidate}`);
  judgeScore = parseScore(judgeOutput);
  writeFileSync(join(runDir, `03-judge-${passes}.md`), judgeOutput, 'utf8');
  console.log(`  [독립 심사] ${Number.isNaN(judgeScore) ? '점수 파싱 실패' : `${judgeScore}점`} / 기계 실패 ${analysis.failures.length}건`);
  if (analysis.pass && judgeScore >= JUDGE_THRESHOLD) {
    finalText = candidate;
    break;
  }
  if (passes < MAX_PASSES) {
    console.log('[auto-write] 게이트 미달 — 기계 실패 항목과 심사 지적을 반영한 수정본을 요청합니다.');
    const fixInput = [
      candidate,
      '\n(아래 두 심사 결과를 모두 해소한 **최종 본문만** 출력하세요. 프론트매터·검증 마커·마크다운 구조는 유지.)',
      '\n--- 기계 검사 실패 항목 (전부 해소할 것) ---',
      analysis.failures.map((f) => `- [${f.check}] ${f.message}`).join('\n') || '(없음)',
      '\n--- 독립 심사자 지적 ---',
      judgeOutput,
    ].join('\n');
    const corrected = await callModel(reviewSystem, fixInput);
    candidate = extractArticle(corrected, candidate);
    finalText = candidate;
  }
}

const finalCheck = analyzePost(finalText, { format, expectedMarkers });
writeFileSync(join(runDir, '05-writing-check-final.json'), JSON.stringify(finalCheck, null, 2), 'utf8');
if (!(finalCheck.pass && judgeScore >= JUDGE_THRESHOLD)) {
  fail(`게이트 미통과 — 기계 실패 ${finalCheck.failures.length}건, 독립 심사 ${Number.isNaN(judgeScore) ? '점수 없음' : `${judgeScore}점`}. out/auto-publish/${runId}/ 리포트를 확인하세요.`);
}
console.log(`[auto-write] 게이트 통과 — 기계 검사 실패 0건 / 독립 심사 ${judgeScore}점 — 중간 산출물: out/auto-publish/${runDir.split('/').pop()}/`);

/* ── 4단계: 변환·저장 ───────────────────────────────────── */
const saved = join(runDir, '04-final.md');
writeFileSync(saved, finalText, 'utf8');
const { get } = readFrontmatter(finalText);
const angle = angleArg ?? get('angle');
if (!angle) fail('angle을 확정할 수 없습니다. --angle "..." 을 지정하세요.');
console.log(convert(saved, topicTag, angle, slug));

if (calendarFile && subject) markCalendarDone(calendarFile, subject);
console.log('[auto-write] 완료. 다음: 사람 검증(테스트·스크린샷·마커 채우기) → npm run check:content → 승인·발행');

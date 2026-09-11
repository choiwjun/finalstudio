#!/usr/bin/env node
/**
 * 평가 실행기 — writing-cases를 실제 생성 파이프라인으로 돌리고 점수를 기록한다.
 *
 *   npm run auto:eval [-- --limit 2] [--id <case-id>] [--label before|after]
 *
 * 케이스당: 1단계 초안 → 2단계 윤문 → (기계 검사 + 독립 심사, 최대 2회 수정) → 강화 루프(enhancePasses, 기계 통과본 한정) → 기록
 * 산출물: out/evals/<실행시각>/results.json, out/evals/eval-<label>.json
 * 이전 라벨과 비교해 케이스별 점수·기계 실패 증감을 계산한다. 회귀는 --strict일 때만 실패 처리.
 * 이 스크립트는 저장소 파일을 수정하지 않는다 (out/에만 기록).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { analyzePost, extractMarkers } from './check-writing.mjs';
import { buildWriterEnvironment } from './auto-publish/writer-env.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const strict = args.includes('--strict');
const limit = Number(getArg('limit') ?? 2);
const onlyId = getArg('id');
const label = getArg('label') ?? (existsSync(join(ROOT, 'out', 'evals', 'baseline.json')) ? 'after' : 'before');

const fail = (msg) => { console.error(`[run-evals] 오류: ${msg}`); process.exit(1); };
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const readJson = (p) => {
  try {
    return JSON.parse(read(p));
  } catch (error) {
    fail(`JSON 파일을 읽을 수 없습니다: ${p} (${error instanceof Error ? error.message : String(error)})`);
  }
};
const parseJsonLine = (line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    fail(`평가 케이스 ${index + 1}행이 올바른 JSON이 아닙니다 (${error instanceof Error ? error.message : String(error)})`);
  }
};

const manifest = readJson('.editorial/manifest.json');
const NOTES_REQUIRED = new Set(manifest.generationGate?.notesRequiredFormats ?? []);
const JUDGE_THRESHOLD = manifest.generationGate?.independentJudgeMinScore ?? 90;
const MAX_PASSES = Number(process.env.AUTO_MAX_PASSES ?? 2);

const persona = readJson(manifest.modules.personas[manifest.defaultPersona]);
const moduleText = [
  `EDITORIAL_SYSTEM_VERSION: ${manifest.version}`,
  `SELECTED_PERSONA: ${manifest.defaultPersona}`,
  `SELECTED_FORMAT: {FORMAT}`,
  '--- 편집 헌법 ---',
  read(manifest.modules.constitution),
  '--- 문체 가이드 ---',
  read(manifest.modules.styleGuide),
  '--- 글 유형 템플릿 ---',
  '{BLUEPRINT}',
  '--- 페르소나 ---',
  JSON.stringify(persona, null, 2),
  '--- exemplar (문체·구조 기준 발췌 — 베끼지 말고 수준의 기준으로만) ---',
  '{EXEMPLAR}',
].join('\n\n');
const extractPromptSection = (text) => {
  const m = text.match(/## 프롬프트 \(여기부터 복사\)\n([\s\S]*?)## 프롬프트 \(여기까지 복사\)/);
  return (m ? m[1] : text).trim();
};
const judgeSystem = extractPromptSection(read(manifest.modules.prompts.judge));

const codexJs = process.platform === 'win32'
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  : ['/usr/local/lib/node_modules/@openai/codex/bin/codex.js', join(process.env.HOME ?? '', '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')].find((p) => existsSync(p));
const command = codexJs
  ? { executable: process.execPath, prefix: [codexJs], shell: false }
  : { executable: 'codex', prefix: [], shell: process.platform === 'win32' };

const runCodex = (system, user) => new Promise((resolveP, rejectP) => {
  const child = spawn(command.executable, [...command.prefix, 'exec', '--sandbox', 'read-only', '--ephemeral', '--', user], {
    cwd: ROOT,
    shell: command.shell,
    env: buildWriterEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', rejectP);
  child.on('close', (code) => (code === 0 ? resolveP(out) : rejectP(new Error(`codex 실패 (exit ${code})\n${err.slice(-400)}`))));
  child.stdin.end(system);
});
const stripFences = (t) => t.replace(/^```(?:markdown)?\n/, '').replace(/\n```$/, '').trim();
// 윤문 모델이 리포트(--- 윤문 리포트 --- 또는 ## 윤문 리포트 이하)를 본문 뒤에 붙이는 경우를 제거한다.
const stripReport = (t) => t.replace(/\n*(?:-{3,}\s*윤문 리포트\s*-{3,}|#{1,4}\s*윤문 리포트)[\s\S]*$/, '').trim();
const parseScore = (t) => Number(t.match(/총점:\s*(\d{1,3})\s*\/?\s*100/)?.[1] ?? NaN);
const extractArticle = (text) => {
  const start = text.search(/^---\n/m);
  return start === -1 ? null : text.slice(start).trim();
};

const cases = read('.editorial/evals/writing-cases.jsonl')
  .split(/\r?\n/).filter(Boolean)
  .map(parseJsonLine)
  .filter((c) => (onlyId ? c.id === onlyId : true));
if (cases.length === 0) fail(`평가 케이스를 찾을 수 없습니다 (id=${onlyId ?? '전체'})`);
const selected = cases.slice(0, limit);

const runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outDir = join(ROOT, 'out', 'evals', runId);
mkdirSync(outDir, { recursive: true });
console.log(`[run-evals] 라벨 ${label} / 케이스 ${selected.length}건 — out/evals/${runId}/`);

const results = [];
for (const item of selected) {
  console.log(`\n[run-evals] ${item.id} (${item.format}) — ${item.subject}`);
  const format = item.format;
  const blueprintPath = manifest.modules.blueprints[format];
  if (!blueprintPath) { results.push({ id: item.id, error: `블루프린트 없음: ${format}` }); continue; }
  let notes;
  if (NOTES_REQUIRED.has(format)) {
    const fixture = `.editorial/evals/fixtures/${item.id}.md`;
    if (!existsSync(resolve(ROOT, fixture))) { results.push({ id: item.id, error: `원자료 fixture 없음: ${fixture}` }); continue; }
    notes = read(fixture);
  }
  const blueprint = read(blueprintPath);
  const filled = moduleText
    .replaceAll('{FORMAT}', format)
    .replaceAll('{BLUEPRINT}', blueprint)
    .replaceAll('{EXEMPLAR}', read(manifest.modules.exemplars[format]));
  const writerSystem = `${filled}\n\n--- 작성 프롬프트 ---\n\n${extractPromptSection(read('.planning/prompts/content-writer-prompt.md'))}`;
  const humanizeForFormat = `${filled}\n\n--- 윤문 프롬프트 ---\n\n${extractPromptSection(read('.planning/prompts/chatgpt-humanize-prompt.md'))}`;
  const reviewForFormat = `${filled}\n\n--- 검수 프롬프트 ---\n\n${extractPromptSection(read('.planning/prompts/chatgpt-review-prompt.md'))}`;
  const writerInput = [
    `주제/키워드: ${item.subject}`,
    `대상 독자: ${item.audience ?? '일반 독자'}`,
    `문체: 합니다체`,
    notes ? '\n--- 원자료 (유일한 사실·경험 재료 — 여기에 없는 경험·수치·장면을 만들지 마세요) ---' : undefined,
    notes,
  ].filter((x) => x !== undefined).join('\n');

  try {
    let candidate = stripFences(await runCodex(writerSystem, writerInput));
    writeFileSync(join(outDir, `${item.id}-01-draft.md`), candidate, 'utf8');
    candidate = stripReport(stripFences(await runCodex(humanizeForFormat, `${candidate}\n\n(윤문 대상은 위 전체입니다. 프론트매터와 검증 마커, 마크다운 구조는 유지하세요. SELECTED_FORMAT: ${format})`)));
    writeFileSync(join(outDir, `${item.id}-02-humanized.md`), candidate, 'utf8');

    const expectedMarkers = extractMarkers(candidate);
    let score = NaN;
    let judgeText = '';
    let analysis = {};
    let passes = 0;
    let mechanicalPass = false;
    while (passes < MAX_PASSES) {
      passes += 1;
      analysis = analyzePost(candidate, { format, expectedMarkers, notes });
      const judge = stripFences(await runCodex(judgeSystem, `SELECTED_FORMAT: ${format}\n\n${candidate}`));
      score = parseScore(judge);
      judgeText = judge;
      mechanicalPass = analysis.pass;
      writeFileSync(join(outDir, `${item.id}-judge-${passes}.md`), judge, 'utf8');
      console.log(`  판정 ${passes}/${MAX_PASSES}: 기계 실패 ${analysis.failures.length}건 / 심사 ${Number.isNaN(score) ? '?' : score}점`);
      if (mechanicalPass && score >= JUDGE_THRESHOLD) break;
      if (passes < MAX_PASSES) {
        const fixInput = [
          candidate,
          '\n(아래 두 심사 결과를 모두 해소한 **최종 본문만** 출력하세요. 프론트매터·검증 마커·마크다운 구조는 유지.)',
          '\n--- 기계 검사 실패 항목 ---',
          analysis.failures.map((f) => `- [${f.check}] ${f.message}`).join('\n') || '(없음)',
          '\n--- 독립 심사자 지적 ---',
          judge,
        ].join('\n');
        const fixed = await runCodex(reviewForFormat, fixInput);
        const fixedRaw = extractArticle(stripFences(fixed));
        const fixedText = fixedRaw ? stripReport(fixedRaw) : candidate;
        const fixedAnalysis = analyzePost(fixedText, { format, expectedMarkers, notes });
        const better = fixedAnalysis.failures.length < analysis.failures.length
          || (fixedAnalysis.failures.length === analysis.failures.length && fixedAnalysis.pass && !analysis.pass);
        if (!better) {
          console.log('  수정 기각 — 악화 또는 동률이라 이전 본문 유지');
          break;
        }
        candidate = fixedText;
      }
    }

    // 마지막 패스에서 수정이 채택됐다면 analysis가 수정 전 본문 기준이므로 최종 본문으로 재분석한다.
    analysis = analyzePost(candidate, { format, expectedMarkers, notes });
    mechanicalPass = analysis.pass;

    /* ── 강화 루프: 게이트 통과본을 심사 최고점까지 끌어올린다 (auto-write 강화 루프와 동일 기준) ── */
    const enhancePasses = Math.max(0, Number(manifest.generationGate?.enhancePasses ?? 0));
    for (let e = 1; mechanicalPass && e <= enhancePasses; e++) {
      const enhanced = await runCodex(writerSystem, [
        candidate,
        '\n(아래 심사 지적을 반영해 더 나은 본문만 출력하세요. 프론트매터·검증 마커·마크다운 구조는 유지합니다. 이미 충분한 부분은 건드리지 마세요.)',
        '\n--- 독립 심사자 지적 ---',
        judgeText,
      ].join('\n'));
      const enhancedRaw = extractArticle(stripFences(enhanced));
      const enhancedText = enhancedRaw ? stripReport(enhancedRaw) : stripReport(stripFences(enhanced));
      const enhancedAnalysis = analyzePost(enhancedText, { format, expectedMarkers, notes });
      if (!enhancedAnalysis.pass) {
        console.log('  강화 기각 — 기계 실패 발생');
        writeFileSync(join(outDir, `${item.id}-enhance-${e}-rejected.md`), enhancedText, 'utf8');
        break;
      }
      const enhancedJudge = stripFences(await runCodex(judgeSystem, `SELECTED_FORMAT: ${format}\n\n${enhancedText}`));
      const enhancedScore = parseScore(enhancedJudge);
      writeFileSync(join(outDir, `${item.id}-enhance-${e}.md`), enhancedText, 'utf8');
      writeFileSync(join(outDir, `${item.id}-enhance-${e}-judge.md`), enhancedJudge, 'utf8');
      console.log(`  강화 ${e}/${enhancePasses}: 심사 ${Number.isNaN(enhancedScore) ? '?' : enhancedScore}점 (이전 ${Number.isNaN(score) ? '?' : score}점)`);
      if (Number.isNaN(enhancedScore) || enhancedScore <= score) {
        console.log('  강화 중단 — 점수 향상 없음, 이전 본문 유지');
        break;
      }
      candidate = enhancedText;
      analysis = enhancedAnalysis;
      score = enhancedScore;
      judgeText = enhancedJudge;
    }
    results.push({
      id: item.id,
      format,
      subject: item.subject,
      judgeScore: score,
      mechanicalPass,
      mechanicalFailures: analysis.failures.length,
      mechanicalWarnings: analysis.warnings.length,
      metrics: analysis.metrics,
      passes,
      passed: mechanicalPass && score >= JUDGE_THRESHOLD,
    });
  } catch (error) {
    results.push({ id: item.id, format, error: String(error.message ?? error).slice(0, 300) });
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  label,
  editorialVersion: manifest.version,
  cases: results,
  averages: {
    judgeScore: (() => {
      const v = results.map((r) => r.judgeScore).filter((n) => Number.isFinite(n));
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
    })(),
    passRate: results.length ? Math.round(results.filter((r) => r.passed).length / results.length * 100) : null,
  },
};
writeFileSync(join(outDir, 'results.json'), JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(join(ROOT, 'out', 'evals', `eval-${label}.json`), JSON.stringify(summary, null, 2), 'utf8');
if (label === 'before') writeFileSync(join(ROOT, 'out', 'evals', 'baseline.json'), JSON.stringify({ runId, label }, null, 2), 'utf8');

/* ── 전후 비교 ── */
const beforePath = join(ROOT, 'out', 'evals', label === 'after' ? 'eval-before.json' : '');
let regression = false;
if (label === 'after' && beforePath && existsSync(beforePath)) {
  const before = readJson(beforePath);
  const prev = Object.fromEntries(before.cases.map((c) => [c.id, c]));
  const comparison = results.map((r) => {
    const p = prev[r.id];
    if (!p || r.error || p.error) return { id: r.id, comparable: false };
    const scoreDelta = (Number.isFinite(r.judgeScore) ? r.judgeScore : 0) - (Number.isFinite(p.judgeScore) ? p.judgeScore : 0);
    const failuresDelta = (r.mechanicalFailures ?? 0) - (p.mechanicalFailures ?? 0);
    const isRegression = scoreDelta <= -3 || failuresDelta > 0;
    if (isRegression) regression = true;
    return { id: r.id, scoreDelta, failuresDelta, regression: isRegression };
  });
  writeFileSync(join(outDir, 'comparison.json'), JSON.stringify({ comparison, regression }, null, 2), 'utf8');
  console.log('\n[run-evals] 전후 비교:');
  for (const c of comparison) console.log(`  ${c.id}: 점수 ${c.scoreDelta >= 0 ? '+' : ''}${c.scoreDelta}, 기계 실패 ${c.failuresDelta >= 0 ? '+' : ''}${c.failuresDelta}${c.regression ? ' ← 회귀' : ''}`);
}

console.log(`\n[run-evals] 완료 — 평균 심사 ${summary.averages.judgeScore}점, 통과율 ${summary.averages.passRate}% — out/evals/${runId}/results.json`);
if (regression) {
  console.error('[run-evals] 회귀가 감지됐습니다. 프롬프트 변경을 재검토하세요.');
  if (strict) process.exit(1);
}

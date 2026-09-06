#!/usr/bin/env node
/**
 * Codex OAuth 기반 프롬프트 개선안 생성기.
 *
 * 이 명령은 편집 헌법·페르소나·평가 사례를 바탕으로 개선안을 만들지만
 * 저장소의 프롬프트를 직접 수정하지 않는다. 결과를 사람이 검토하고 diff를
 * 적용한 뒤 check:prompts와 실제 글 생성 평가를 다시 실행한다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log([
    '사용법:',
    '  npm run auto:improve',
    '  npm run auto:improve -- --input src/content/posts/example.md',
    '',
    '동작:',
    '  Codex OAuth로 최근 초안과 편집 모듈을 분석해 proposal-only 개선안을 생성합니다.',
    '  저장소의 편집 규칙은 자동으로 수정하지 않습니다.',
  ].join('\n'));
  process.exit(0);
}

const fail = (message) => {
  console.error(`[prompt-improve] 오류: ${message}`);
  process.exit(1);
};
const read = (file) => {
  const full = resolve(ROOT, file);
  if (!existsSync(full)) fail(`파일이 없습니다: ${file}`);
  return readFileSync(full, 'utf8');
};
const hash = (value) => createHash('sha256').update(value).digest('hex');

const manifest = JSON.parse(read('.editorial/manifest.json'));
const moduleFiles = [
  manifest.modules.constitution,
  manifest.modules.styleGuide,
  ...Object.values(manifest.modules.blueprints ?? {}),
  ...Object.values(manifest.modules.personas ?? {}),
];
const modules = moduleFiles.map((file) => ({ file, content: read(file) }));
const evalCases = read('.editorial/evals/writing-cases.jsonl');
const protectedFiles = manifest.selfImprovement?.protectedFiles ?? [];
const inputPath = getArg('input');
const input = inputPath ? read(inputPath) : '(이번 실행에서 별도 초안을 제공하지 않았습니다.)';
const runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outputDir = join(ROOT, 'out', 'prompt-lab', runId);
mkdirSync(outputDir, { recursive: true });

const codexJs = process.platform === 'win32'
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  : ['/usr/local/lib/node_modules/@openai/codex/bin/codex.js', join(process.env.HOME ?? '', '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]
    .find((file) => existsSync(file));
let codexBin;
try {
  codexBin = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
} catch {
  codexBin = undefined;
}
const command = codexJs
  ? { executable: process.execPath, prefix: [codexJs], shell: false }
  : codexBin
    ? { executable: codexBin, prefix: [], shell: process.platform === 'win32' }
    : undefined;
if (!command) fail('Codex CLI가 없습니다. `npm install -g @openai/codex` 후 `codex login`을 실행하세요.');

const runCodex = (instructions, context) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command.executable, [...command.prefix, 'exec', '--sandbox', 'read-only', '--ephemeral', '--', instructions], {
    cwd: ROOT,
    shell: command.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', rejectPromise);
  child.on('close', (code) => {
    if (code === 0) resolvePromise(stdout.trim());
    else rejectPromise(new Error(`Codex 실행 실패 (exit ${code})\n${stderr.slice(-800)}`));
  });
  child.stdin.end(context);
});

const context = [
  `WJ Blog 편집 시스템 버전: ${manifest.version}`,
  '당신은 WJ Blog의 프롬프트 편집자입니다.',
  '목표는 초안의 문장·구조·실행성을 개선하는 것입니다.',
  '편집 헌법, 발행 게이트, 사람 승인 규칙을 절대 완화하거나 수정하지 마세요.',
  '출력은 개선 제안일 뿐이며 파일을 직접 수정하지 않습니다.',
  '',
  '=== 현재 편집 모듈 ===',
  ...modules.map(({ file, content }) => `--- ${file} ---\n${content}`),
  '',
  '=== 평가 사례 ===',
  evalCases,
  '',
  '=== 분석할 초안 또는 운영 입력 ===',
  input,
].join('\n');

const instructions = [
  '현재 편집 시스템을 분석하고 다음 개선안을 한국어 Markdown으로 작성하세요.',
  '1. 반복되는 품질 문제를 최대 5개로 분류하세요.',
  '2. 기존 규칙 중 유지해야 할 것과 충돌하는 규칙을 구분하세요.',
  '3. 수정 대상 파일별로 구체적인 변경안을 제안하세요.',
  '4. 적용 가능한 unified diff를 하나의 diff 코드 블록으로 출력하세요.',
  '5. 각 변경이 어떤 평가 사례를 개선하는지 적으세요.',
  '6. 사람 검토가 필요한 위험과 회귀 가능성을 적으세요.',
  `다음 보호 파일은 diff 대상으로 제안하지 마세요: ${protectedFiles.join(', ')}`,
].join('\n');

const proposal = await runCodex(instructions, context);
const diff = proposal.match(/```diff\n([\s\S]*?)\n```/)?.[1]?.trim() ?? '# Codex가 적용 가능한 diff를 출력하지 않았습니다. proposal.md의 설명을 먼저 검토하세요.';
const snapshot = {
  generatedAt: new Date().toISOString(),
  engine: 'codex-oauth',
  editorialVersion: manifest.version,
  input: inputPath ?? null,
  moduleHashes: Object.fromEntries(modules.map(({ file, content }) => [file, hash(content)])),
  evaluationCases: evalCases.split(/\r?\n/).filter(Boolean).length,
  mode: manifest.selfImprovement?.mode ?? 'unknown',
};
writeFileSync(join(outputDir, 'proposal.md'), proposal.endsWith('\n') ? proposal : `${proposal}\n`, 'utf8');
writeFileSync(join(outputDir, 'proposal.diff'), `${diff}\n`, 'utf8');
writeFileSync(join(outputDir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`[prompt-improve] 개선안 저장: ${outputDir}`);
console.log('[prompt-improve] 저장소 파일은 수정하지 않았습니다. diff 검토 후 사람이 적용하세요.');

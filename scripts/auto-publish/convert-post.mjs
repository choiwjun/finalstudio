#!/usr/bin/env node
/**
 * AI 글 초안 → WJ Blog 콘텐츠 스키마 변환기
 *
 * 사용법:
 *   node scripts/auto-publish/convert-post.mjs <입력.md> --topic 카테고리 --angle "관점 한 문장"
 *   옵션: --slug 파일명(영어 소문자-하이픈)  --author 이름  --out 출력 경로(기본 src/content/posts)
 *
 * 규칙:
 *   - status는 항상 draft로 저장 (사람 검토 전까지 공개 불가 — CEO_PLAN 게이트)
 *   - aiAssisted는 항상 true (AI 초안 사실 고지)
 *   - claude-blog의 coverImage/ogImage/tags 등 스키마 밖 필드는 제거
 *     (실제 테스트 스크린샷만 사용한다는 편집 규칙 때문)
 *   - 기존 파일은 덮어쓰지 않음
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { detectContentRisks } from '../lib/content-risk.mjs';

const args = process.argv.slice(2);
const input = args[0];
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const topic = getArg('topic');
const angle = getArg('angle');
const slug = (getArg('slug') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const author = getArg('author') ?? 'TBD';

const fail = (msg) => {
  console.error(`[convert-post] 오류: ${msg}`);
  process.exit(1);
};

if (!input) fail('입력 파일 경로가 필요합니다. 예: node scripts/auto-publish/convert-post.mjs draft.md --topic 카테고리 --angle "..."');
if (!topic || topic.trim().length === 0 || topic.includes('\n')) fail('--topic에는 비어 있지 않은 카테고리 이름을 지정하세요.');
if (!angle) fail('--angle이 필요합니다. 이 글이 기존 글과 다르게 채택한 관점을 한 문장으로 적어주세요.');

const inputPath = resolve(input);
if (!existsSync(inputPath)) fail(`입력 파일이 없습니다: ${inputPath}`);

const raw = readFileSync(inputPath, 'utf8');
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
if (!fmMatch) fail('입력 파일에 frontmatter가 없습니다. claude-blog /blog write 출력인지 확인하세요.');

const parseSimple = (front, key) => {
  const m = front.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, '');
};

const title = parseSimple(fmMatch[1], 'title');
const description = parseSimple(fmMatch[1], 'description');
// 자동작성 프롬프트의 계약은 pubDate다. 예전 claude-blog 출력물의 date도
// 호환하되, pubDate가 있으면 그것을 우선한다.
const pubDateFromFrontmatter = parseSimple(fmMatch[1], 'pubDate') ?? parseSimple(fmMatch[1], 'date');
if (!title || !description) fail('frontmatter에 title/description이 없습니다.');
if (title.length > 40) console.warn(`[convert-post] 경고: 제목이 ${title.length}자입니다. 25자 내외(잘림 방지)를 권장합니다.`);
if (description.length < 50 || description.length > 110)
  console.warn(`[convert-post] 경고: description ${description.length}자 — 70~80자를 권장합니다.`);

const body = raw.slice(fmMatch[0].length).trimStart();
const warnings = [];
if (!/안\s*될\s*때/.test(body)) warnings.push('"안 될 때"(오류 해결) 섹션이 없습니다. 발행 전 반드시 추가하세요.');
if (!/FAQ|자주.{0,4}질문/.test(body)) warnings.push('FAQ 섹션이 없습니다. AEO 규칙상 필수입니다 (3~5개 질문).');
if (/Key Takeaways/.test(body)) warnings.push('요약 박스 라벨이 영어(Key Takeaways)입니다. "핵심 요약"으로 교체하세요.');
if (/\[(?:스크린샷|직접 확인 필요|테스트 필요|출처 URL 확인 필요)/.test(body)) {
  console.log('[convert-post] 확인: 검증 마커가 있습니다 — 사람 테스트 후 모두 채워야 합니다.');
}

const contentRisks = detectContentRisks(`${title}\n${description}\n${body}`);
if (contentRisks.length) {
  console.warn(`[convert-post] 추가 사람 검토 필요: ${contentRisks.map((risk) => risk.label).join(', ')}`);
}

const suggestedSlug = body.match(/^슬러그\s*(?:제안|추천)\s*:\s*[`'\"]?([a-z0-9]+(?:-[a-z0-9]+)*)[`'\"]?\s*$/im)?.[1] ?? '';

const pubDate = pubDateFromFrontmatter ?? new Date().toISOString().slice(0, 10);
let finalSlug = slug || suggestedSlug || `post-${pubDate}`;
const outDir = getArg('out') ?? join(process.cwd(), 'src', 'content', 'posts');
let outPath = resolve(outDir, `${finalSlug}.md`);
// 같은 날 여러 번 생성해도 덮어쓰지 않는다 — 숫자 접미사로 자동 분리한다.
let suffix = 2;
while (existsSync(outPath)) {
  if (slug) fail(`같은 이름의 글이 이미 있습니다: ${outPath} (--slug로 다른 이름 사용)`);
  finalSlug = `${suggestedSlug || `post-${pubDate}`}-${suffix}`;
  outPath = resolve(outDir, `${finalSlug}.md`);
  suffix += 1;
}

const front = [
  '---',
  `title: "${title.replace(/"/g, '\\"')}"`,
  `description: "${description.replace(/"/g, '\\"')}"`,
  `pubDate: ${pubDate}`,
  'status: draft',
  `topic: ${topic}`,
  `angle: "${angle.replace(/"/g, '\\"')}"`,
  `author: ${author}`,
  'sourceIds: []',
  'toolVersions: {}',
  `manualReview: ${contentRisks.length ? 'required' : 'none'}`,
  `manualReviewReasons: [${contentRisks.map((risk) => `"${risk.label}"`).join(', ')}]`,
  'aiAssisted: true',
  '---',
  '',
].join('\n');

writeFileSync(outPath, `${front}${body}\n`, 'utf8');

// 개발 서버는 콘텐츠 변경을 감시하지 않으므로 `astro sync`로 데이터 스토어를 갱신한다.
// (관리 서버가 개발 서버를 감독 중이면 관리 서버가 재시작까지 담당하므로 여기선 스토어만 갱신)
try {
  execFileSync('node', [join(process.cwd(), 'node_modules', 'astro', 'bin', 'astro.mjs'), 'sync'], { cwd: process.cwd(), stdio: 'ignore', timeout: 120_000 });
} catch { /* dev 서버 없으면 무시 */ }

console.log(`[convert-post] 저장 완료: ${outPath}`);
console.log('[convert-post] 상태: draft (사람 검토 전까지 공개되지 않습니다)');
if (suggestedSlug && !slug) console.log(`[convert-post] AI 제안 slug 사용: ${finalSlug}`);
warnings.forEach((w) => console.warn(`[convert-post] 경고: ${w}`));
console.log('[convert-post] 다음 단계: 실제 테스트 → 마커 채우기 → npm run check:content → 사람 승인');

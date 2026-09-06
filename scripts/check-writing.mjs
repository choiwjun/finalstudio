#!/usr/bin/env node
/**
 * 기계 문장·구조 검사기 — LLM 셀프채점을 대체하는 결정론적 게이트.
 *
 *   node scripts/check-writing.mjs <file.md> [--format how-to] [--json out.json] [--markers-from file.md]
 *
 * auto-write.mjs가 analyzePost()를 import해 90점 게이트 앞단의 기계 검증으로 사용한다.
 * 측정 항목: 문장 길이·문단 밀도·종결어미 혼용·수동태·금지 표현·이모지·병기 반복·
 * 문맥 의존 표현·형식별 구조·출처 없는 수치 주장·마커 무결성.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FAIL = 'fail';
const WARN = 'warn';

/** 형식별 규칙. minChars는 생성 루프 기준이며 발행 게이트(1,500자)와 별개다. */
export const FORMAT_RULES = {
  'how-to': { minChars: 1200, require: ['numbered-list', 'table'], forbid: [] },
  review: { minChars: 800, require: ['eval-criteria', 'cons'], forbid: [] },
  essay: { minChars: 500, require: [], forbid: ['faq'] },
  experience: { minChars: 500, require: [], forbid: [] },
  'place-log': { minChars: 400, require: [], forbid: [] },
  'book-memo': { minChars: 400, require: ['quote'], forbid: [] },
  'photo-log': { minChars: 300, require: ['image'], forbid: [] },
};

const MARKER_RE = /\[(직접 확인 필요|테스트 필요|스크린샷|출처 확인 필요)[^\]]*\]/g;

const FORBIDDEN_PHRASES = [
  '총정리', '꿀팁 대방출', '놓치면 후회', '게임 체인저', '결론적으로',
  '알아두면 좋은', '~라고 할 수 있습니다', '모두가 알다시피', '요즘 ~화가 되고 있는데',
];

const CONTEXT_DEPENDENT = [
  '위에서 말한', '위에서 설명한', '앞서 말한', '앞서 언급한', '아서 설명했듯', '앞서 본 것처럼',
];

const STRUCTURE_REQUIRE = {
  faq: { label: 'FAQ 섹션', test: (t) => /(^|\n)#{2,3}[^\n]*(FAQ|자주 묻는|자주 하는 질문)/i.test(t) },
  'numbered-list': { label: '번호 목록', test: (t) => /^\s*\d+[.)]\s+\S/m.test(t) },
  table: { label: '표', test: (t) => /^\|.+\|/m.test(t) },
  'eval-criteria': { label: '평가 기준', test: (t) => /평가 기준|판단 기준|이 기준으로/.test(t) },
  cons: { label: '단점', test: (t) => /단점|아쉬운|불편한 점/.test(t) },
  quote: { label: '인용(출처 발췌)', test: (t) => /^>\s+\S/m.test(t) },
  image: { label: '이미지', test: (t) => /!\[[^\]]*\]\([^)]+\)/.test(t) },
};

export const parseFrontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { front: '', body: text };
  return { front: m[1], body: text.slice(m[0].length).trimStart() };
};

/** 코드블록·표·헤딩·마커를 제거하고 본문 산문(목록 항목 포함)만 남긴다. */
const extractProse = (body) => {
  const lines = [];
  let inFence = false;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*\|/.test(line)) continue;
    if (/^#{1,6}\s/.test(line.trim())) continue;
    lines.push(line.replace(MARKER_RE, ' '));
  }
  return lines.join('\n');
};

/** 한국어 문장 분리 — 종결부(다./요./습니다.) 기준. 소수점은 뒤에 공백이 없어 자연 보호된다. */
export const splitSentences = (proseText) => {
  const guard = proseText.replace(/`[^`]*`/g, '〄').replace(/https?:\/\/\S+/g, '〄');
  return guard
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .map((s) => s.replace(/〄/g, '…'))
    .filter((s) => s.length > 0);
};

const countHaeyo = (sentences) =>
  // "~세요" 명령형은 합니다체 글과 자연스럽게 공존하므로 혼용으로 세지 않는다.
  sentences.filter((s) => {
    const t = s.trim();
    return /[요][.!?]?$/.test(t)
      && !/(합|입|됩|습)니다[.!?]?$/.test(t)
      && !/(세|셔|시)요[.!?]?$/.test(t)
      && !/십시오[.!?]?$/.test(t);
  }).length;

const countPassive = (sentences) =>
  sentences.filter((s) => /되어지|지어지|보여지|들려지|느껴지|생각되어지|이루어져/.test(s)).length;

const isHeading = (line) => /^#{1,6}\s/.test(line.trim());
const isListItem = (line) => /^\s*(?:[-*+]\s|\d+[.)]\s|>\s)/.test(line);
const isCaption = (line) => /^\s*\*[^*]+\*\s*$/.test(line.trim());
const isMediaLine = (line) => /^\s*!\[/.test(line.trim());
/** 검증 문장(직접 계산·테스트·확인한 결과 보고)과 범위 선언("~기준으로")은 사실 주장이 아니다. */
const isVerification = (s) =>
  /(계산|테스트|확인|측정|검증|실측)[^.!?]*(했|됐)(습니다|다)/.test(s)
  || /(기준으로|기준은|바탕으로)/.test(s)
  || /(세|셔|시)요[.!?]?$/.test(s.trim())
  || /십시오[.!?]?$/.test(s.trim());

/** 출처 없는 수치·사양 주장 추출 — 링크 없는 산문 문단의 수치 문장만. 헤딩·목록·캡션·검증 문장 제외. */
export const extractUnsourcedClaims = (body) => {
  const claims = [];
  let inFence = false;
  for (const para of body.split(/\n\s*\n/)) {
    if (/^```/.test(para.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*\|/.test(para)) continue;
    const lines = para.split('\n').filter((l) => l.trim() && !isHeading(l) && !isCaption(l) && !isMediaLine(l) && !/^\s*\d+[.)]\s/.test(l));
    if (lines.length === 0) continue;
    const hasLink = /\[[^\]]*\]\(https?:\/\//.test(para);
    if (hasLink) continue;
    const sentences = splitSentences(lines.join('\n').replace(MARKER_RE, ' '));
    for (const s of sentences) {
      if (!/[0-9]/.test(s)) continue;
      if (!/(버전|빌드|지원|요금|가격|무료|유료|배터리|용량|스펙|GB|MB|TB|cm|mm|km|kg|%|\d+\s*(개|명|일|시간|분|초|배|개월|년))/i.test(s)) continue;
      if (isVerification(s)) continue;
      claims.push(s.slice(0, 120));
    }
  }
  return [...new Set(claims)];
};

/**
 * @param {string} md - frontmatter 포함 전체 마크다운
 * @param {object} options - { format, expectedMarkers: string[] }
 */
export function analyzePost(md, options = {}) {
  const format = options.format ?? 'how-to';
  const rules = FORMAT_RULES[format] ?? FORMAT_RULES['how-to'];
  const { front, body } = parseFrontmatter(md);
  const failures = [];
  const warnings = [];
  const add = (severity, check, message) =>
    (severity === FAIL ? failures : warnings).push({ check, message });

  const prose = extractProse(body);
  const plain = prose.replace(/[#*_[\]()>~|-]/g, '');
  const chars = plain.replace(/\s/g, '').length;
  const sentences = splitSentences(prose);
  const paragraphs = prose.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // 목록 항목은 한 문단으로 묶지 않는다 — 각 항목을 독립 블록으로 계산한다.
  const proseBlocks = paragraphs.flatMap((p) =>
    p.split('\n').some((l) => isListItem(l) || isHeading(l))
      ? p.split('\n').filter((l) => l.trim() && !isHeading(l))
      : [p],
  );
  const sentPerPara = proseBlocks.map((p) => splitSentences(p).length).filter((n) => n > 0);

  const lens = sentences.map((s) => s.replace(/\s/g, '').length).filter((n) => n > 0);
  const meanLen = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
  const maxLen = lens.length ? Math.max(...lens) : 0;

  const metrics = {
    format,
    bodyChars: chars,
    sentences: sentences.length,
    meanSentenceChars: meanLen,
    maxSentenceChars: maxLen,
    paragraphs: paragraphs.length,
    maxSentencesPerParagraph: sentPerPara.length ? Math.max(...sentPerPara) : 0,
    haeyoEndings: countHaeyo(sentences),
    passiveHits: countPassive(sentences),
    markers: (body.match(MARKER_RE) ?? []).length,
    images: (body.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length,
    unsourcedClaims: extractUnsourcedClaims(body).length,
  };

  if (chars < rules.minChars) {
    add(FAIL, 'min-chars', `본문 ${chars}자 — ${format} 최소 ${rules.minChars}자 미달`);
  }
  if (meanLen > 55) add(FAIL, 'sentence-length', `평균 문장 ${meanLen}자 — 55자 초과`);
  else if (meanLen > 45) add(WARN, 'sentence-length', `평균 문장 ${meanLen}자 — 45자 권장 초과`);
  if (maxLen > 160) add(FAIL, 'sentence-max', `최장 문장 ${maxLen}자 — 160자 초과, 분할 필요`);

  if (metrics.maxSentencesPerParagraph > 5) {
    add(FAIL, 'paragraph-density', `한 문단 ${metrics.maxSentencesPerParagraph}문장 — 5문장 초과`);
  } else if (metrics.maxSentencesPerParagraph > 4) {
    add(WARN, 'paragraph-density', `한 문단 ${metrics.maxSentencesPerParagraph}문장 — 4문장 권장 초과`);
  }

  if (metrics.haeyoEndings > Math.max(1, sentences.length * 0.05)) {
    add(FAIL, 'speech-style', `해요체 종결 ${metrics.haeyoEndings}개 — 합니다체 혼용`);
  }
  if (metrics.passiveHits > 2) add(FAIL, 'passive', `피동 표현 ${metrics.passiveHits}건`);

  for (const phrase of FORBIDDEN_PHRASES) {
    if (body.includes(phrase)) add(FAIL, 'forbidden', `금지 표현: "${phrase}"`);
  }
  if (/\p{Extended_Pictographic}/u.test(body)) add(FAIL, 'emoji', '이모지 사용');

  const paren = (body.match(/[가-힣]\s*\([A-Za-z][^)]{1,24}\)/g) ?? []).length;
  if (paren > 3) add(FAIL, 'paren-english', `한글(영어) 병기 ${paren}회 — 첫 등장만 병기`);

  for (const phrase of CONTEXT_DEPENDENT) {
    if (body.includes(phrase)) add(FAIL, 'context-dependent', `문맥 의존 표현: "${phrase}"`);
  }

  for (const key of rules.require) {
    if (!STRUCTURE_REQUIRE[key]?.test(body)) {
      add(FAIL, 'structure', `${rules.label ?? format} 필수 요소 누락: ${STRUCTURE_REQUIRE[key]?.label ?? key}`);
    }
  }
  for (const key of rules.forbid) {
    if (STRUCTURE_REQUIRE[key]?.test(body)) {
      add(FAIL, 'structure', `${format} 형식에 부적합한 요소: ${STRUCTURE_REQUIRE[key]?.label}`);
    }
  }
  // FAQ는 how-to에서 권장이지만 사람이 확정한 최상위 글도 생략하므로 실패가 아니라 경고다.
  if (format === 'how-to' && !STRUCTURE_REQUIRE.faq.test(body)) {
    add(WARN, 'faq-missing', 'FAQ 섹션 권장 — 검색형 질문 3개 안팎 (생략도 허용)');
  }

  const claimSeverity = ['how-to', 'review'].includes(format) ? FAIL : WARN;
  for (const claim of extractUnsourcedClaims(body).slice(0, 10)) {
    add(claimSeverity, 'unsourced-claim', `출처 없는 수치 주장: "${claim}…" — 출처 링크 또는 [출처 확인 필요] 마커 필요`);
  }

  if (options.expectedMarkers) {
    for (const marker of options.expectedMarkers) {
      if (!body.includes(marker)) {
        add(FAIL, 'marker-integrity', `마커 유실: ${marker}`);
      }
    }
  }

  const titleMatch = front.match(/^title:\s*"?(.+?)"?\s*$/m);
  if (!titleMatch) add(FAIL, 'title', 'frontmatter title 누락');
  else if (titleMatch[1].length > 45) add(FAIL, 'title-length', `제목 ${titleMatch[1].length}자 — 45자 초과`);

  const descMatch = front.match(/^description:\s*"?(.+?)"?\s*$/m);
  if (descMatch && (descMatch[1].length < 60 || descMatch[1].length > 100)) {
    add(WARN, 'description-length', `description ${descMatch[1].length}자 — 60~100자 권장`);
  }

  return { metrics, failures, warnings, pass: failures.length === 0 };
}

export const extractMarkers = (md) => md.match(MARKER_RE) ?? [];

const main = () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const getOpt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
  };
  if (!file) {
    console.error('사용법: node scripts/check-writing.mjs <file.md> [--format how-to] [--json out.json] [--markers-from file.md]');
    process.exit(2);
  }
  const full = resolve(process.cwd(), file);
  if (!existsSync(full)) {
    console.error(`파일이 없습니다: ${file}`);
    process.exit(2);
  }
  const md = readFileSync(full, 'utf8');
  const markersFrom = getOpt('markers-from');
  const expectedMarkers = markersFrom && existsSync(resolve(process.cwd(), markersFrom))
    ? extractMarkers(readFileSync(resolve(process.cwd(), markersFrom), 'utf8'))
    : undefined;
  const result = analyzePost(md, { format: getOpt('format'), expectedMarkers });
  const out = getOpt('json');
  if (out) writeFileSync(resolve(process.cwd(), out), JSON.stringify(result, null, 2), 'utf8');

  console.log(`기계 검사: ${file} (${result.metrics.format}) — 본문 ${result.metrics.bodyChars}자, 문장 ${result.metrics.sentences}개, 평균 ${result.metrics.meanSentenceChars}자`);
  for (const w of result.warnings) console.log(`  경고: [${w.check}] ${w.message}`);
  for (const f of result.failures) console.error(`  실패: [${f.check}] ${f.message}`);
  console.log(result.pass ? `통과 (경고 ${result.warnings.length}건)` : `실패 (${result.failures.length}건)`);
  process.exit(result.pass ? 0 : 1);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main();
}

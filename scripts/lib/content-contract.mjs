/**
 * 콘텐츠 계약(content contract) 검증 — 단일 근거.
 * check-content.mjs와 관리 서버(admin-server.mjs)가 함께 사용한다.
 * 규칙: src/content.config.ts 스키마의 필수 필드 + 발행 게이트(사람 검증 증거) 요건.
 */

export const REQUIRED_KEYS = ['title', 'description', 'pubDate', 'status', 'topic', 'angle', 'author'];
export const ALLOWED_STATUS = new Set(['draft', 'scheduled', 'published']);
/** 발행 최소 분량 (공백 제외 본문 글자수). 구글 공식 기준은 없으나 커뮤니티 검증치 1,500자를 게이트로 채택. */
export const MIN_BODY_CHARS = 1500;
/** 사람이 채워야 하는 검증 마커. 공개되는 글에 남아 있으면 발행 게이트가 차단한다 (draft는 자유). */
export const UNRESOLVED_MARKER_RE =
  /\[(?:직접 확인 필요|출처 URL 확인 필요|테스트 필요|스크린샷)[^\]]*\]/;

/** frontmatter 블록 파싱. 없으면 null. */
export function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const front = match[1];
  const get = (key) => front.match(new RegExp(`^${key}:\\s*([^\\n]+)`, 'm'))?.[1]?.trim();
  const set = (key, value) => {
    const line = new RegExp(`^${key}:\\s*[^\\n]*$`, 'm');
    const replaced = line.test(front);
    const next = replaced
      ? front.replace(line, `${key}: ${value}`)
      : `${front}\n${key}: ${value}`;
    return text.replace(/^---\n[\s\S]*?\n---/, `---\n${next}\n---`);
  };
  return { front, get, set, raw: text };
}

/** 본문(마크다운, 공백 제외) 글자수 */
export function bodyCharCount(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  return body.replace(/\s/g, '').length;
}

/**
 * 게시물 1개 검증. 오류 문자열 배열 반환 (빈 배열 = 통과).
 * @param {string} file 표시용 파일명
 * @param {string} text 마크다운 전문
 */
export function validatePost(file, text) {
  const errors = [];
  const fm = parseFrontmatter(text);
  if (!fm) return [`${file}: missing front matter`];
  const { front } = fm;

  for (const key of REQUIRED_KEYS) {
    if (!new RegExp(`^${key}:\\s*.+$`, 'm').test(front)) errors.push(`${file}: missing ${key}`);
  }
  const status = front.match(/^status:\s*([^\n]+)/m)?.[1]?.trim();
  const author = front.match(/^author:\s*([^\n]+)/m)?.[1]?.trim();
  const testedAt = front.match(/^testedAt:\s*([^\n]+)/m)?.[1]?.trim();
  const topic = front.match(/^topic:\s*([^\n]+)/m)?.[1]?.trim();

  if (status && !ALLOWED_STATUS.has(status)) errors.push(`${file}: invalid status ${status}`);
  if (topic && !['productivity', 'ai-workflows'].includes(topic)) errors.push(`${file}: invalid topic ${topic}`);
  if (status === 'scheduled' && !/^publishAt:\s*.+$/m.test(front)) errors.push(`${file}: scheduled post needs publishAt`);
  if (status !== 'draft' && author === 'TBD') errors.push(`${file}: public posts need a real author`);
  if (status !== 'draft' && (!testedAt || testedAt === 'TBD')) errors.push(`${file}: public posts need testedAt`);
  // 발행 게이트: 초안은 자유롭되, 공개되는 글은 최소 분량(공백 제외 1,500자)을 강제한다
  if (status !== 'draft' && bodyCharCount(text) < MIN_BODY_CHARS) {
    errors.push(`${file}: public posts need at least ${MIN_BODY_CHARS} body characters (excluding whitespace)`);
  }
  // 발행 게이트: 검증 마커(사람이 채울 슬롯)가 남아 있으면 공개 차단 — "직접 테스트" 해자의 기계적 강제
  if (status !== 'draft' && UNRESOLVED_MARKER_RE.test(text)) {
    const found = (text.match(new RegExp(UNRESOLVED_MARKER_RE.source, 'g')) ?? []).slice(0, 3).join(', ');
    errors.push(`${file}: public posts must resolve all markers first (남은 마커: ${found})`);
  }
  return errors;
}

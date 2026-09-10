import { ContractValidationError, normalizeKeywordKey, SEARCH_INTENTS } from './contracts.mjs';

const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NUMERIC_ONLY_PATTERN = /^[\p{N}\s.,%]+$/u;

// Punctuation that separates keyword tokens. The ASCII period is intentionally
// excluded so technical tokens such as "Node.js" or "3.12" keep their dot.
const PUNCTUATION_PATTERN = /[(),;:!?\[\]{}「」『』〈〉《》"'`·、。？！：；…~〜]/gu;

// Token-edge characters stripped after punctuation separation so "설명합니다."
// normalizes to "설명합니다" while "Node.js" keeps its internal dot.
const TOKEN_EDGE_PATTERN = /^[\s.,;:!?…·~〜"'`]+|[\s.,;:!?…·~〜"'`]+$/gu;

const ZERO_WIDTH_PATTERN = /[\u200b-\u200d\ufeff]/gu;
const HTML_TAG_PATTERN = /<[^>]*>/gu;

export const DEFAULT_STOPWORDS = Object.freeze([
  // Korean function/connective tokens that carry no keyword meaning.
  '그', '그것', '그리고', '그러나', '그런데', '그래서', '하지만', '때문에',
  '따라서', '즉', '및', '또는', '등', '것', '수', '있는', '없는', '있다',
  '없다', '하는', '한다', '위한', '위해', '대한', '관한',
  // English function words.
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on',
  'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'how',
  'what', 'when', 'where', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'it', 'its', 'i', 'you', 'we', 'they', 'he', 'she',
  'me', 'my', 'your', 'our', 'their', 'not', 'no', 'yes', 'can', 'will',
  'would', 'should', 'could', 'may', 'might', 'than', 'then', 'there',
  'here', 'if', 'so',
]);

const INTENT_MARKERS = Object.freeze([
  { intent: '방법', markers: ['방법', '하는 법', '설정'] },
  { intent: '비교', markers: ['비교', '차이', '추천'] },
  { intent: '문제 해결', markers: ['문제', '오류', '안 될'] },
  { intent: '최신 이슈', markers: ['최신', '변경', '업데이트'] },
]);

const fail = (path, message) => { throw new ContractValidationError(path, message); };

/**
 * Normalize keyword text deterministically, in this order:
 *   Unicode NFC -> strip HTML tags -> remove zero-width characters ->
 *   split punctuation boundaries (period preserved inside tokens) ->
 *   collapse whitespace to single spaces -> trim -> strip token-edge dots.
 *
 * No network, LLM, randomness, locale data, or current time is involved.
 */
export function normalizeKeyword(text) {
  let value = String(text).normalize('NFC');
  value = value.replace(HTML_TAG_PATTERN, ' ');
  value = value.replace(ZERO_WIDTH_PATTERN, '');
  value = value.replace(PUNCTUATION_PATTERN, ' ');
  value = value.replace(/\s+/gu, ' ').trim();
  if (value === '') return '';
  const tokens = value.split(' ')
    .map((token) => token.replace(TOKEN_EDGE_PATTERN, ''))
    .filter((token) => token !== '');
  return tokens.join(' ');
}

const isNumericOnly = (text) => NUMERIC_ONLY_PATTERN.test(text);

const keywordKey = normalizeKeywordKey;

/**
 * Validate and normalize a versioned seed document:
 *   { "version": 1, "inputs": [{ category, seeds, title?, description?, intent? }] }
 *
 * `seeds` is required and non-empty; each seed must normalize to a non-empty,
 * non-numeric-only keyword. `intent`, when present, must be an allowed enum
 * value. Returns a deep-normalized copy. Unsupported categories, empty seeds,
 * numeric-only seeds, and invalid intents are input errors.
 */
export function parseSeedInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('seed', 'must be an object');
  if (input.version !== 1) fail('seed.version', 'must be 1');
  if (!Array.isArray(input.inputs) || input.inputs.length === 0) fail('seed.inputs', 'must be a non-empty array');
  const inputs = input.inputs.map((group, index) => normalizeGroup(group, `seed.inputs[${index}]`, { seedsRequired: true }));
  return { version: 1, inputs };
}

function normalizeGroup(input, path, { seedsRequired }) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail(path, 'must be an object');
  if (typeof input.category !== 'string' || !CATEGORY_PATTERN.test(String(input.category).trim().toLowerCase())) {
    fail(`${path}.category`, 'must be a lowercase kebab-case category');
  }
  const category = String(input.category).trim().toLowerCase();
  const seeds = normalizeSeeds(input.seeds, `${path}.seeds`, { required: seedsRequired });
  const result = { category, seeds };
  for (const field of ['title', 'description']) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') fail(`${path}.${field}`, 'must be a string');
    const normalized = normalizeKeyword(value);
    if (normalized !== '') result[field] = normalized;
  }
  if (input.intent !== undefined && input.intent !== null) {
    if (typeof input.intent !== 'string') fail(`${path}.intent`, 'must be a string');
    const intent = input.intent.trim();
    if (!SEARCH_INTENTS.includes(intent)) fail(`${path}.intent`, 'must be an allowed search intent');
    result.intent = intent;
  }
  return result;
}

function normalizeSeeds(seeds, path, { required }) {
  if (!required && seeds === undefined) return [];
  if (!Array.isArray(seeds)) fail(path, 'must be an array');
  if (required && seeds.length === 0) fail(path, 'must be a non-empty array');
  return seeds.map((seed, index) => {
    if (typeof seed !== 'string') fail(`${path}[${index}]`, 'must be a string');
    const normalized = normalizeKeyword(seed);
    if (normalized === '') fail(`${path}[${index}]`, 'must contain a non-empty keyword');
    if (isNumericOnly(normalized)) fail(`${path}[${index}]`, 'must not be numeric-only');
    return normalized;
  });
}

/**
 * Infer the search intent from `text` using fixed marker precedence:
 *   방법(방법|하는 법|설정) -> 비교(비교|차이|추천) ->
 *   문제 해결(문제|오류|안 될) -> 최신 이슈(최신|변경|업데이트) -> 개념.
 */
export function inferSearchIntent(text) {
  const normalized = normalizeKeyword(text);
  for (const entry of INTENT_MARKERS) {
    if (entry.markers.some((marker) => normalized.includes(marker))) return entry.intent;
  }
  return '개념';
}

/**
 * Derive 2-4 token contiguous phrases from `text` in first-appearance order.
 * Windows containing a token shorter than 2 chars or a stopword token are
 * dropped, as are numeric-only phrases. Deduplication happens at the caller.
 */
function derivePhrases(text, stopwords) {
  const tokens = normalizeKeyword(text).split(' ').filter((token) => token !== '');
  const phrases = [];
  for (let start = 0; start + 2 <= tokens.length; start += 1) {
    for (let size = 2; size <= 4 && start + size <= tokens.length; size += 1) {
      const window = tokens.slice(start, start + size);
      if (window.some((token) => token.length < 2 || stopwords.has(token))) continue;
      const phrase = window.join(' ');
      if (!isNumericOnly(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
}

const longestFirst = (phrases) => {
  let best = null;
  for (const phrase of phrases) {
    const length = phrase.split(' ').length;
    if (best === null || length > best.length || (length === best.length && phrase.length > best.phrase.length)) {
      best = { length, phrase };
    }
  }
  return best ? best.phrase : null;
};

/**
 * Deterministically discover keyword candidates for one input group or for a
 * whole versioned seed document.
 *
 * Group form:
 *   discoverCandidates({ category, seeds, title?, description?, intent? }, { stopwords })
 * Document form (object with `inputs`): returns one result per input group.
 *
 * Result shape:
 *   { category, head_keyword, related_keywords, candidates, search_intent,
 *     content_angle, risk_flags }
 *
 * `head_keyword` prefers the first explicit seed; without seeds the longest
 * first title/description phrase wins. Related keywords are the remaining
 * candidates in first-appearance order, capped at 5. Pre-evidence risk flags
 * (`broad_keyword`, `insufficient_related_keywords`) are derived only from
 * deterministic text rules. No API or LLM call happens.
 */
export function discoverCandidates(input, options = {}) {
  if (input !== null && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.inputs)) {
    return parseSeedInput(input).inputs.map((group) => discoverCandidates(group, options));
  }
  const stopwordList = Array.isArray(options.stopwords) ? options.stopwords : [];
  const stopwords = new Set([...DEFAULT_STOPWORDS, ...stopwordList]);

  const group = normalizeGroup(input, 'input', { seedsRequired: false });
  const derived = [...derivePhrases(group.title ?? '', stopwords), ...derivePhrases(group.description ?? '', stopwords)];

  const candidates = [];
  const seen = new Set();
  for (const candidate of [...group.seeds, ...derived]) {
    const key = keywordKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) fail('input', 'must yield at least one candidate');
  const headKeyword = group.seeds.length > 0 ? candidates[0] : longestFirst(derived) ?? candidates[0];
  const headKey = keywordKey(headKeyword);

  const relatedKeywords = candidates.filter((candidate) => keywordKey(candidate) !== headKey).slice(0, 5);

  const sourceText = normalizeKeyword([...group.seeds, group.title ?? '', group.description ?? ''].join(' '));
  const searchIntent = group.intent ?? inferSearchIntent(sourceText);
  const contentAngle = group.description ?? `${headKeyword}를 WJ가 공식 근거와 실제 확인 항목 중심으로 설명`;

  const riskFlags = [];
  if (headKeyword.split(' ').length < 2) riskFlags.push('broad_keyword');
  if (relatedKeywords.length < 2) riskFlags.push('insufficient_related_keywords');

  return {
    category: group.category,
    head_keyword: headKeyword,
    related_keywords: relatedKeywords,
    candidates,
    search_intent: searchIntent,
    content_angle: contentAngle,
    risk_flags: riskFlags.sort(),
  };
}

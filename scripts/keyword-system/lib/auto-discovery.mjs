import {
  DEFAULT_STOPWORDS,
  inferSearchIntent,
  normalizeKeyword,
} from "./discovery.mjs";
import { normalizeKeywordKey } from "./contracts.mjs";

export const AUTO_CATEGORY_QUERIES = Object.freeze([
  Object.freeze({ category: "economy-business", query: "경제 비즈니스" }),
  Object.freeze({ category: "ai", query: "AI 인공지능" }),
  Object.freeze({ category: "travel", query: "여행" }),
]);

const AUTO_STOPWORDS = Object.freeze([
  "방법",
  "정리",
  "사용법",
  "추천",
  "후기",
  "소개",
  "관련",
  "정보",
  "가이드",
  "뉴스",
  "이슈",
  "이야기",
  "알아보기",
  "시작하기",
  "활용",
  "경험",
  "생각",
  "오늘",
  "이번",
  "최근",
  "좋은",
  "통해",
  "위한",
  "대해",
  "대한",
  "에서",
  "로",
  "으로",
  "를",
  "을",
  "이",
  "가",
  "은",
  "는",
  "에",
  "의",
  "와",
  "과",
  "부터",
  "까지",
  "하는",
  "하기",
  "합니다",
  "입니다",
]);

const MAX_TOPIC_WORDS = 3;
const MIN_TOPIC_WORDS = 2;
const MAX_TOPIC_LENGTH = 80;
const SAFE_TOPIC_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .+/_-]{0,79}$/u;

function fail(message) {
  const error = new Error(message);
  error.code = "AUTO_DISCOVERY";
  throw error;
}

function splitTrailingParticle(token) {
  const suffixes = [
    // Sentence-final endings first — NAVER descriptions carry copula/predicate
    // tokens ("방법입니다") whose stem ("방법") is a stopword, while the raw
    // token would survive and form fragment phrases.
    "했습니다",
    "였습니다",
    "습니다",
    "입니다",
    "합니다",
    "됩니다",
    "으로",
    "부터",
    "까지",
    "였다",
    "했다",
    "이다",
    "된다",
    "해요",
    "돼요",
    "를",
    "을",
    "은",
    "는",
    "이",
    "가",
    "에",
    "의",
    "와",
    "과",
    "도",
    "만",
    "로",
  ];
  for (const suffix of suffixes) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    const minimumStemLength = suffix === "로" ? 3 : 2;
    if (stem.length >= minimumStemLength) return stem;
  }
  return token;
}

// Phrases that can never be a usable topic or related keyword, no matter how
// often they co-occur: pure calendar expressions, URL fragments leaking from
// descriptions, and windows ending in a sentence-final ending or adverbial
// residue (the token-level particle splitter cannot see phrase-final verbs).
const DATE_TOKEN_PATTERN = /^(?:\d{4}년|\d{1,2}월|\d{1,2}일|\d{1,4}분기|\d{1,2}주차|\d+년도|\d+)$/;
const URL_TOKEN_PATTERN = /^(?:https?|www)$|\/|[a-z0-9-]+\.(?:com|net|org|io|kr|co)/i;
const FRAGMENT_ENDING_PATTERN =
  /(?:해야|해서|하고|하면|하는|해왔|걸까|건가요|어요|아요|여요|에요|였어요|세요|네요|군요|이에요|예요|봤어요|봅니다|드립니다|려주|없이|려고|인데|지만|더라|거든|잖아|랍니다|까요|시죠)$/u;

function isViablePhrase(window) {
  if (window.every((token) => DATE_TOKEN_PATTERN.test(token))) return false;
  if (window.some((token) => URL_TOKEN_PATTERN.test(token))) return false;
  if (FRAGMENT_ENDING_PATTERN.test(window[window.length - 1])) return false;
  return true;
}

function phraseWindows(text, stopwords) {
  const tokens = normalizeKeyword(text)
    .split(" ")
    .filter(Boolean)
    .map(splitTrailingParticle);
  const phrases = [];
  for (let start = 0; start + MIN_TOPIC_WORDS <= tokens.length; start += 1) {
    for (
      let size = MIN_TOPIC_WORDS;
      size <= MAX_TOPIC_WORDS && start + size <= tokens.length;
      size += 1
    ) {
      const window = tokens.slice(start, start + size);
      if (
        window.some(
          (token) => token.length < 2 || stopwords.has(token.toLowerCase()),
        )
      )
        continue;
      const phrase = window.join(" ");
      if (
        phrase.length <= MAX_TOPIC_LENGTH &&
        SAFE_TOPIC_PATTERN.test(phrase) &&
        isViablePhrase(window)
      )
        phrases.push(phrase);
    }
  }
  return phrases;
}

function normalizeItems(response) {
  if (
    !response ||
    typeof response !== "object" ||
    !Array.isArray(response.items)
  ) {
    fail("automatic discovery requires a normalized NAVER blog response");
  }
  return response.items.filter((item) => item && typeof item === "object");
}

// Description-only phrases are real topic evidence but must rank below
// title-anchored phrases — the title carries the result's topic identity.
// The offset keeps title positions strictly smaller on the first_position
// tie-break.
const DESCRIPTION_POSITION_OFFSET = 1_000_000;

/**
 * Collect per-phrase occurrence stats across the blog items. Title and
 * description are mined as separate units so phrase windows never cross the
 * title/description boundary. The same stats feed both head-topic ranking and
 * co-occurrence related-keyword extraction, so callers computing related
 * keywords should reuse the returned map instead of re-running the scan.
 */
export function collectPhraseStats(query, response) {
  if (typeof query !== "string" || query.trim() === "")
    fail("query is required");
  const queryTokens = new Set(
    normalizeKeyword(query).toLowerCase().split(" ").filter(Boolean),
  );
  const stopwords = new Set([
    ...DEFAULT_STOPWORDS,
    ...AUTO_STOPWORDS,
    ...queryTokens,
  ]);
  const stats = new Map();

  normalizeItems(response).forEach((item, itemIndex) => {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const texts = [
      { text: normalizeKeyword(title), offset: 0 },
      { text: normalizeKeyword(description), offset: DESCRIPTION_POSITION_OFFSET },
    ].filter((entry) => entry.text !== "");
    const uniquePhrases = new Set(
      texts.flatMap((entry) => phraseWindows(entry.text, stopwords)),
    );
    uniquePhrases.forEach((phrase) => {
      const position = Math.min(
        ...texts.map((entry) => {
          const index = entry.text.indexOf(phrase);
          return index < 0 ? Number.MAX_SAFE_INTEGER : index + entry.offset;
        }),
      );
      const key = normalizeKeywordKey(phrase);
      const previous = stats.get(key) ?? {
        phrase,
        occurrences: 0,
        supporting_results: 0,
        result_indexes: [],
        first_result_index: Number.MAX_SAFE_INTEGER,
        first_position: Number.MAX_SAFE_INTEGER,
      };
      stats.set(key, {
        ...previous,
        occurrences: previous.occurrences + 1,
        supporting_results: previous.supporting_results + 1,
        result_indexes: [...previous.result_indexes, itemIndex],
        first_result_index: Math.min(previous.first_result_index, itemIndex),
        first_position: Math.min(previous.first_position, position),
      });
    });
  });
  return stats;
}

function rankPhraseStats(stats) {
  return [...stats.values()]
    .map((item) => ({
      ...item,
      score: item.supporting_results * 100 + item.occurrences,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.supporting_results - left.supporting_results ||
        right.occurrences - left.occurrences ||
        left.first_result_index - right.first_result_index ||
        left.first_position - right.first_position ||
        right.phrase.split(" ").length - left.phrase.split(" ").length ||
        normalizeKeywordKey(left.phrase).localeCompare(
          normalizeKeywordKey(right.phrase),
          "ko",
        ),
    );
}

/** Turn ranked phrase stats into topic candidate objects. */
export function topicCandidatesFromStats(
  stats,
  { category, query, limit = 5 } = {},
) {
  if (typeof category !== "string" || category.trim() === "")
    fail("category is required");
  if (typeof query !== "string" || query.trim() === "")
    fail("query is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    fail("limit must be an integer from 1 to 20");
  return rankPhraseStats(stats)
    .slice(0, limit)
    .map((candidate) => ({
      category,
      query,
      topic: candidate.phrase,
      search_intent: inferSearchIntent(candidate.phrase),
      discovery_score: candidate.score,
      supporting_results: candidate.supporting_results,
      occurrences: candidate.occurrences,
      source_result_indexes: [...candidate.result_indexes],
    }));
}

/**
 * Extract deterministic topic candidates from official NAVER blog results.
 * The score is an internal candidate-ranking signal, not search volume,
 * popularity, traffic, or revenue.
 */
export function extractTopicCandidates(
  { category, query, response },
  { limit = 5 } = {},
) {
  return topicCandidatesFromStats(collectPhraseStats(query, response), {
    category,
    query,
    limit,
  });
}

/**
 * Related keywords are phrases that co-occur with the topic inside the same
 * NAVER result items — not sibling head topics, which are separate candidates.
 * Phrases that are sub- or superstrings of the topic are redundant trend lines
 * and are excluded. Ranking: shared result count, then occurrences, then
 * earliest result position, then phrase key. Deterministic.
 */
export function relatedPhrasesForTopic(
  stats,
  topic,
  { excludeKeys = new Set(), limit = 5 } = {},
) {
  const topicKey = normalizeKeywordKey(topic);
  const topicEntry = stats.get(topicKey);
  if (topicEntry === undefined) return [];
  const topicIndexes = new Set(topicEntry.result_indexes);
  return [...stats.entries()]
    .filter(
      ([key]) =>
        key !== topicKey &&
        !excludeKeys.has(key) &&
        !key.includes(topicKey) &&
        !topicKey.includes(key),
    )
    .map(([key, entry]) => ({
      key,
      entry,
      shared: entry.result_indexes.filter((index) => topicIndexes.has(index))
        .length,
    }))
    .filter((item) => item.shared > 0)
    .sort(
      (left, right) =>
        right.shared - left.shared ||
        right.entry.occurrences - left.entry.occurrences ||
        left.entry.first_result_index - right.entry.first_result_index ||
        left.key.localeCompare(right.key, "ko"),
    )
    .slice(0, limit)
    .map((item) => item.entry.phrase);
}

/**
 * Convert automatically discovered topics into the existing seed contract so
 * collection, trend comparison, records, briefs, and approval gates remain
 * compatible. The generated terms are never treated as human approval.
 *
 * When a topic carries `related_keywords` (co-occurring phrases from the same
 * NAVER results, see relatedPhrasesForTopic) they become the seeds' related
 * terms. Topics without that field fall back to sibling topics for backward
 * compatibility.
 */
export function buildAutomaticSeedDocument(
  discovered,
  { relatedLimit = 5 } = {},
) {
  if (!Array.isArray(discovered) || discovered.length === 0)
    fail("discovered topics are required");
  if (!Number.isInteger(relatedLimit) || relatedLimit < 1 || relatedLimit > 5)
    fail("relatedLimit must be an integer from 1 to 5");

  const inputs = discovered.flatMap((group) => {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.category !== "string" ||
      !Array.isArray(group.topics) ||
      group.topics.length === 0
    ) {
      fail("each automatic discovery group must contain category and topics");
    }
    const topics = group.topics
      .map((topic) => topic.topic)
      .filter((topic) => typeof topic === "string" && topic.trim() !== "");
    return group.topics.map((topic, index) => {
      const related = Array.isArray(topic.related_keywords)
        ? dedupeRelated(topic.topic, topic.related_keywords).slice(
            0,
            relatedLimit,
          )
        : topics
            .filter((value) => value !== topic.topic)
            .slice(0, relatedLimit);
      return {
        category: group.category,
        seeds: [topic.topic, ...related],
        title: topic.topic,
        description: `NAVER 블로그 검색 결과에서 자동 발견된 발행 주제 후보: ${topic.topic}`,
        intent: topic.search_intent,
        discovery_rank: index + 1,
      };
    });
  });

  return { version: 1, inputs };
}

/** Keep only clean, non-empty related terms that differ from the topic. */
function dedupeRelated(topic, related) {
  const topicKey = normalizeKeywordKey(topic);
  const seen = new Set([topicKey]);
  const result = [];
  for (const value of related) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const key = normalizeKeywordKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

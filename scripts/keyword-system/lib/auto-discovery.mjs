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
    "으로",
    "부터",
    "까지",
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
      if (phrase.length <= MAX_TOPIC_LENGTH && SAFE_TOPIC_PATTERN.test(phrase))
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

/**
 * Extract deterministic topic candidates from official NAVER blog results.
 * The score is an internal candidate-ranking signal, not search volume,
 * popularity, traffic, or revenue.
 */
export function extractTopicCandidates(
  { category, query, response },
  { limit = 5 } = {},
) {
  if (typeof category !== "string" || category.trim() === "")
    fail("category is required");
  if (typeof query !== "string" || query.trim() === "")
    fail("query is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    fail("limit must be an integer from 1 to 20");

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
    const normalizedText = normalizeKeyword(title || description);
    const uniquePhrases = new Set(phraseWindows(normalizedText, stopwords));
    uniquePhrases.forEach((phrase) => {
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
        first_position: Math.min(
          previous.first_position,
          normalizedText.indexOf(phrase),
        ),
      });
    });
  });

  const candidates = [...stats.values()]
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
    )
    .slice(0, limit);

  return candidates.map((candidate) => ({
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
 * Convert automatically discovered topics into the existing seed contract so
 * collection, trend comparison, records, briefs, and approval gates remain
 * compatible. The generated terms are never treated as human approval.
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
      const related = topics
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

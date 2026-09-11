import {
  normalizeKeywordKey,
  normalizeRawEvidenceEnvelope,
  normalizeWjKeywordRecord,
} from "./contracts.mjs";

const BLOG_SOURCE = "naver-api-hub-blog";
const TREND_SOURCE = "naver-api-hub-trend";
const RATIO_NOTE = "상대 지표이며 절대 검색량이 아님";
const OUTLINE = Object.freeze([
  "독자가 겪는 문제",
  "핵심 답변과 적용 절차",
  "실패 조건과 확인 항목",
  "출처와 기준일",
]);

export class BriefError extends Error {
  constructor(message) {
    super(message);
    this.name = "BriefError";
    this.code = "KEYWORD_BRIEF";
  }
}

const fail = (message) => {
  throw new BriefError(message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonical(value) {
  return normalizeKeywordKey(cleanText(value));
}

function isSuccessfulEnvelope(envelope, source) {
  return (
    envelope.source === source &&
    envelope.http?.ok === true &&
    isObject(envelope.response)
  );
}

function matchesKeyword(envelope, keyword) {
  const target = canonical(keyword);
  if (envelope.source === BLOG_SOURCE)
    return canonical(envelope.request?.query) === target;
  const groups = Array.isArray(envelope.request?.keywordGroups)
    ? envelope.request.keywordGroups
    : [];
  return groups.some(
    (group) =>
      canonical(group?.groupName) === target ||
      (Array.isArray(group?.keywords) &&
        group.keywords.some((item) => canonical(item) === target)),
  );
}

function safeUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//u.test(value))
    return undefined;
  return value;
}

function buildBlogEvidence(envelopes) {
  return envelopes.flatMap((envelope) => {
    const items = Array.isArray(envelope.response.items)
      ? envelope.response.items
      : [];
    return items
      .map((item) => ({
        title: cleanText(item?.title),
        description: cleanText(item?.description),
        link: safeUrl(item?.link),
        postdate: cleanText(item?.postdate),
        collected_at: envelope.collected_at,
      }))
      .filter((item) => item.title !== "");
  });
}

function buildTrendEvidence(envelopes, keyword) {
  const target = canonical(keyword);
  return envelopes.flatMap((envelope) => {
    const results = Array.isArray(envelope.response.results)
      ? envelope.response.results
      : [];
    return results
      .filter(
        (result) =>
          canonical(result?.title) === target ||
          (Array.isArray(result?.keywords) &&
            result.keywords.some((item) => canonical(item) === target)),
      )
      .map((result) => {
        const data = Array.isArray(result?.data)
          ? result.data.filter((item) => Number.isFinite(item?.ratio))
          : [];
        const latest = data.reduce(
          (current, item) =>
            !current || String(item.period) > String(current.period)
              ? item
              : current,
          undefined,
        );
        return {
          group_name: cleanText(result?.title),
          keywords: Array.isArray(result?.keywords)
            ? result.keywords.map(cleanText).filter(Boolean)
            : [],
          latest_period: cleanText(latest?.period),
          latest_ratio: latest?.ratio,
          max_ratio:
            data.length > 0
              ? Math.max(...data.map((item) => item.ratio))
              : undefined,
          ratio_note: RATIO_NOTE,
          collected_at: envelope.collected_at,
        };
      })
      .filter((item) => item.group_name !== "");
  });
}

function normalizeRecord(record) {
  try {
    return normalizeWjKeywordRecord(record);
  } catch (error) {
    fail(
      `record is invalid: ${error instanceof Error ? error.message : "invalid record"}`,
    );
  }
}

function normalizeEvidenceEntry(entry) {
  const wrapped = isObject(entry?.envelope);
  const envelopeInput = wrapped ? entry.envelope : entry;
  try {
    return {
      envelope: normalizeRawEvidenceEnvelope(envelopeInput),
      runId: wrapped ? entry.runId : undefined,
      path: wrapped ? entry.path : undefined,
    };
  } catch (error) {
    fail(
      `evidence is invalid: ${error instanceof Error ? error.message : "invalid evidence"}`,
    );
  }
}

/** Build a deterministic, evidence-linked brief. This never calls a model or writes a post. */
export function buildKeywordBrief(record, entries, { runId } = {}) {
  const normalized = normalizeRecord(record);
  if (normalized.status !== "ready-to-write")
    fail("only ready-to-write records can become briefs");
  if (!Array.isArray(entries)) fail("evidence must be an array");
  const evidence = entries.map(normalizeEvidenceEntry);
  const matching = evidence
    .filter(({ envelope, runId: evidenceRunId }) => {
      if (
        !normalized.source.includes(envelope.source) ||
        !matchesKeyword(envelope, normalized.head_keyword)
      )
        return false;
      if (envelope.collected_at !== normalized.collected_at)
        fail("evidence collected_at does not match the ready record");
      if (runId !== undefined && evidenceRunId !== runId)
        fail("evidence run_id does not match the collection run");
      return true;
    })
    .map(({ envelope }) => envelope);
  const blogEnvelopes = matching.filter((envelope) =>
    isSuccessfulEnvelope(envelope, BLOG_SOURCE),
  );
  const trendEnvelopes = matching.filter((envelope) =>
    isSuccessfulEnvelope(envelope, TREND_SOURCE),
  );
  if (blogEnvelopes.length === 0 || trendEnvelopes.length === 0)
    fail(
      "ready record requires successful blog and trend evidence for the same keyword",
    );
  const blog = buildBlogEvidence(blogEnvelopes);
  const trend = buildTrendEvidence(trendEnvelopes, normalized.head_keyword);
  if (blog.length === 0 || trend.length === 0)
    fail("ready record requires non-empty matching blog and trend evidence");
  return {
    schema_version: 1,
    category: normalized.category,
    head_keyword: normalized.head_keyword,
    related_keywords: [...normalized.related_keywords],
    search_intent: normalized.search_intent,
    content_angle: normalized.content_angle,
    collected_at: normalized.collected_at,
    freshness: normalized.freshness,
    source: [...normalized.source],
    outline: [...OUTLINE],
    review_gate: "사람 검토 필요; 자동 작성·예약·발행 금지",
    evidence: { blog, trend },
  };
}

function line(value) {
  return cleanText(value).replace(/[\r\n]/gu, " ");
}

/** Render a brief as a review note suitable for explicit handoff to a writer. */
export function renderKeywordBrief(brief) {
  if (
    !isObject(brief) ||
    typeof brief.head_keyword !== "string" ||
    !isObject(brief.evidence)
  )
    fail("brief is invalid");
  const blogLines = (brief.evidence.blog ?? []).map((item) => {
    const link = item.link ? ` [출처](${item.link})` : "";
    return `- ${line(item.title)}${link} — ${line(item.description)} (수집일: ${line(item.collected_at)})`;
  });
  const trendLines = (brief.evidence.trend ?? []).map(
    (item) =>
      `- ${line(item.group_name)}: 최신 상대 지표 ${item.latest_ratio ?? "미확인"} (${line(item.latest_period)}), 최대 상대 지표 ${item.max_ratio ?? "미확인"}; ${RATIO_NOTE}.`,
  );
  const outlineLines = (brief.outline ?? OUTLINE).map(
    (item, index) => `${index + 1}. ${line(item)}`,
  );
  return [
    `# ${line(brief.head_keyword)}`,
    "",
    `- 카테고리: ${line(brief.category)}`,
    `- 검색 의도: ${line(brief.search_intent)}`,
    `- 글 방향: ${line(brief.content_angle)}`,
    `- 근거 기준일: ${line(brief.collected_at)}`,
    `- 상태: ${line(brief.review_gate ?? "사람 검토 필요")}`,
    "",
    "## 제안 목차",
    ...outlineLines,
    "",
    "## NAVER 블로그 근거",
    ...blogLines,
    "",
    "## NAVER 트렌드 근거",
    ...trendLines,
    "",
    "## 작성 전 확인",
    "- 검색 결과의 표현을 사실 확정 문장으로 확대하지 않는다.",
    "- 상대 trend 지표를 절대 검색량·인기도·수익성으로 표현하지 않는다.",
    "- 출처와 기준일을 본문에 반영한 뒤 사람이 초안 작성을 승인한다.",
    "",
  ].join("\n");
}

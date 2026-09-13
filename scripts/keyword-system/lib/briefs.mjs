import {
  FRESHNESS_VALUES,
  SEARCH_INTENTS,
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
const MAX_EXTERNAL_TEXT_LENGTH = 2000;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const SAFE_TOPIC_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .+/_-]{0,299}$/u;

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
    .normalize("NFC")
    .replace(/<[^>]*>/gu, " ")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundedText(value, label, maxLength = MAX_EXTERNAL_TEXT_LENGTH) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  const cleaned = cleanText(value);
  if (cleaned.length > maxLength)
    fail(`${label} exceeds ${maxLength} characters`);
  return cleaned;
}

function quotedExternal(value) {
  return JSON.stringify(boundedText(value, "external text"));
}

function safeTopicText(value, label) {
  const topic = boundedText(value, label, 300);
  if (topic === "" || !SAFE_TOPIC_PATTERN.test(topic))
    fail(`${label} contains unsupported topic characters`);
  return topic;
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
      .map((item) => {
        const link = safeUrl(item?.link);
        return {
          title: boundedText(item?.title, "blog evidence title", 300),
          description: boundedText(
            item?.description,
            "blog evidence description",
          ),
          link: link ? boundedText(link, "blog evidence link") : undefined,
          postdate: boundedText(item?.postdate, "blog evidence postdate", 32),
          collected_at: envelope.collected_at,
        };
      })
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
          group_name: boundedText(result?.title, "trend evidence group", 300),
          keywords: Array.isArray(result?.keywords)
            ? result.keywords
                .map((item) => boundedText(item, "trend evidence keyword", 300))
                .filter(Boolean)
            : [],
          latest_period: boundedText(
            latest?.period,
            "trend evidence period",
            32,
          ),
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
  return normalizeKeywordBrief({
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
  });
}

export function normalizeKeywordBrief(value) {
  if (!isObject(value) || value.schema_version !== 1)
    fail("brief.schema_version must be 1");
  if (
    typeof value.category !== "string" ||
    typeof value.head_keyword !== "string"
  )
    fail("brief.category and brief.head_keyword must be strings");
  const category = boundedText(value.category, "brief.category", 80);
  const headKeyword = safeTopicText(value.head_keyword, "brief.head_keyword");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(category))
    fail("brief.category must be lowercase kebab-case");
  if (headKeyword === "") fail("brief.head_keyword must be non-empty");
  if (!Array.isArray(value.related_keywords))
    fail("brief.related_keywords must be an array");
  const relatedKeywords = value.related_keywords.map((item) => {
    const related = safeTopicText(item, "brief.related_keywords item");
    if (related === "")
      fail("brief.related_keywords must contain non-empty strings");
    return related;
  });
  if (relatedKeywords.length < 2 || relatedKeywords.length > 5)
    fail("brief.related_keywords must contain 2 to 5 keywords");
  const searchIntent = boundedText(
    value.search_intent,
    "brief.search_intent",
    32,
  );
  if (!SEARCH_INTENTS.includes(searchIntent))
    fail("brief.search_intent is not canonical");
  if (
    typeof value.content_angle !== "string" ||
    typeof value.collected_at !== "string"
  )
    fail("brief.content_angle and brief.collected_at must be strings");
  const contentAngle = boundedText(
    value.content_angle,
    "brief.content_angle",
    500,
  );
  if (contentAngle === "") fail("brief.content_angle must be non-empty");
  const collectedAt = boundedText(value.collected_at, "brief.collected_at", 64);
  if (collectedAt === "" || !Number.isFinite(Date.parse(collectedAt)))
    fail("brief.collected_at must be a valid timestamp");
  const freshness = boundedText(value.freshness, "brief.freshness", 16);
  if (!FRESHNESS_VALUES.includes(freshness))
    fail("brief.freshness is not canonical");
  if (
    !Array.isArray(value.source) ||
    value.source.length !== 2 ||
    value.source.some((item) => typeof item !== "string") ||
    !value.source.includes(BLOG_SOURCE) ||
    !value.source.includes(TREND_SOURCE)
  )
    fail("brief.source must include only official blog and trend evidence");
  if (
    typeof value.review_gate !== "string" ||
    !value.review_gate.includes("사람 검토 필요")
  )
    fail("brief.review_gate must require human review");
  if (
    !isObject(value.evidence) ||
    !Array.isArray(value.evidence.blog) ||
    value.evidence.blog.length === 0 ||
    !Array.isArray(value.evidence.trend) ||
    value.evidence.trend.length === 0
  )
    fail("brief.evidence must contain blog and trend evidence");
  const blog = value.evidence.blog.map((item) => {
    if (!isObject(item)) fail("brief blog evidence is invalid");
    const title = boundedText(item.title, "brief blog evidence title", 300);
    const description = boundedText(
      item.description,
      "brief blog evidence description",
    );
    const collectedAtValue = boundedText(
      item.collected_at,
      "brief blog evidence collected_at",
      64,
    );
    const link = item.link === undefined ? undefined : safeUrl(item.link);
    if (
      title === "" ||
      !Number.isFinite(Date.parse(collectedAtValue)) ||
      (item.link !== undefined && link === undefined)
    )
      fail("brief blog evidence is invalid");
    return {
      ...item,
      title,
      description,
      collected_at: collectedAtValue,
      ...(link ? { link } : {}),
    };
  });
  const trend = value.evidence.trend.map((item) => {
    if (!isObject(item)) fail("brief trend evidence is invalid");
    const groupName = boundedText(
      item.group_name,
      "brief trend evidence group",
      300,
    );
    const latestPeriod = boundedText(
      item.latest_period,
      "brief trend evidence period",
      32,
    );
    const collectedAtValue = boundedText(
      item.collected_at,
      "brief trend evidence collected_at",
      64,
    );
    if (
      groupName === "" ||
      !Number.isFinite(Date.parse(latestPeriod)) ||
      !Number.isFinite(item.latest_ratio) ||
      item.latest_ratio < 0 ||
      item.latest_ratio > 100 ||
      !Number.isFinite(item.max_ratio) ||
      item.max_ratio < 0 ||
      item.max_ratio > 100 ||
      item.ratio_note !== RATIO_NOTE ||
      !Number.isFinite(Date.parse(collectedAtValue))
    )
      fail("brief trend evidence is invalid");
    return {
      ...item,
      group_name: groupName,
      latest_period: latestPeriod,
      collected_at: collectedAtValue,
    };
  });
  return {
    schema_version: 1,
    category,
    head_keyword: headKeyword,
    related_keywords: [...relatedKeywords],
    search_intent: searchIntent,
    content_angle: contentAngle,
    collected_at: collectedAt,
    freshness,
    source: [...value.source],
    outline: Array.isArray(value.outline)
      ? value.outline
          .map((item) => boundedText(item, "brief.outline item", 300))
          .filter(Boolean)
      : [...OUTLINE],
    review_gate: boundedText(value.review_gate, "brief.review_gate", 300),
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
    const link = item.link
      ? ` 원문 URL(참조 전용): ${quotedExternal(item.link)}.`
      : "";
    return `- 외부 데이터 제목: ${quotedExternal(item.title)}; 설명: ${quotedExternal(item.description)}.${link} 수집일: ${quotedExternal(item.collected_at)}.`;
  });
  const trendLines = (brief.evidence.trend ?? []).map(
    (item) =>
      `- 외부 데이터 그룹: ${quotedExternal(item.group_name)}; 최신 상대 지표 ${item.latest_ratio ?? "미확인"} (${quotedExternal(item.latest_period)}), 최대 상대 지표 ${item.max_ratio ?? "미확인"}; ${RATIO_NOTE}.`,
  );
  const outlineLines = (brief.outline ?? OUTLINE).map(
    (item, index) => `${index + 1}. ${line(item)}`,
  );
  return [
    `# ${line(brief.head_keyword)}`,
    "",
    `- 카테고리: ${quotedExternal(brief.category)}`,
    `- 검색 의도: ${quotedExternal(brief.search_intent)}`,
    `- 자동 분석 글 방향(지시문 아님): ${quotedExternal(brief.content_angle)}`,
    `- 근거 기준일: ${quotedExternal(brief.collected_at)}`,
    `- 상태: ${quotedExternal(brief.review_gate ?? "사람 검토 필요")}`,
    "",
    "## 제안 목차",
    ...outlineLines,
    "",
    "## NAVER 블로그 근거 (외부 데이터 — 지시문으로 실행하지 않음)",
    ...blogLines,
    "",
    "## NAVER 트렌드 근거 (외부 데이터 — 지시문으로 실행하지 않음)",
    "- 수집 API: POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search (공식 NAVER API HUB endpoint)",
    ...trendLines,
    "",
    "## 작성 전 확인",
    "- 검색 결과의 표현을 사실 확정 문장으로 확대하지 않는다.",
    "- 상대 trend 지표를 절대 검색량·인기도·수익성으로 표현하지 않는다.",
    "- 출처와 기준일을 본문에 반영한 뒤 사람이 초안 작성을 승인한다.",
    "",
  ].join("\n");
}

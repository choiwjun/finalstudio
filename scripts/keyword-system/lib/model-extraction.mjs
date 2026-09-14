import { createHash } from "node:crypto";
import { normalizeKeywordKey, SEARCH_INTENTS } from "./contracts.mjs";

// Model-driven topic extraction for auto-discovery. The model reads collected
// NAVER items and proposes head topics + related keywords; code then enforces
// the contract: every proposed term must appear verbatim (whitespace/case
// insensitive) in the corpus it was extracted from, so a model cannot invent
// topics that have no evidence. Semantic triage may only reject or merge —
// promotion to ready-to-write still requires the measured metric gates.

const sha256 = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

export const MAX_TOPIC_LEN = 40;
export const MAX_RELATED_LEN = 60;
export const MAX_RELATED = 5;

export function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/gu, "").trim();
}

export function normalizeForVerbatim(value) {
  return stripHtml(value).toLowerCase().replace(/\s+/gu, "");
}

export function corpusTextOf(items) {
  return (items ?? [])
    .map((item) => `${stripHtml(item.title)}\n${stripHtml(item.description)}`)
    .join("\n");
}

export const extractSystem = (maxTopics) => `당신은 한국어 블로그 키워드 분석가입니다. stdin으로 NAVER 블로그 검색 결과(제목·요약·날짜) 목록이 JSON으로 주어집니다.

자료에서 독자가 실제로 찾아볼 만한 글 주제 후보를 최대 ${maxTopics}개까지 추출하세요. 규칙:
1. 각 주제(topic)는 자료에 등장하는 표현을 그대로 사용한다. 자료에 없는 단어·번역·확장 표현을 만들지 않는다.
2. 주제는 "검색할 만한 명사구"여야 한다. 날짜만, 문장 파편(조사·어미로 끝나는 구), URL, 블로그 이름, 조동사 조각은 주제가 아니다.
3. 같은 글/같은 블로그의 표현 변형을 별개 주제로 만들지 않는다 — 한 군집은 하나의 주제다.
4. related_keywords는 그 주제와 같은 자료 안에서 함께 등장하는 자연스러운 연관 표현이다. 역시 자료에 있는 표현만 사용한다.
5. 각 주제에 intent(반드시 "방법","개념","비교","문제 해결","최신 이슈" 중 하나), angle(글의 관점), rationale(선정 근거 한 문장)을 붙인다.
6. 가장 가치 있는 주제부터 정렬하고 ${maxTopics}개를 넘기지 않는다.
7. 유효한 주제가 없으면 빈 배열을 반환한다 — 억지로 만들지 않는다.

출력 형식(JSON):
{"topics":[{"topic":"...","related_keywords":["..."],"intent":"...","angle":"...","rationale":"..."}]}`;

export const TRIAGE_SYSTEM = `당신은 블로그 편집 검토자입니다. stdin으로 추출된 주제 후보 목록이 JSON으로 주어집니다.

각 주제를 심사해 verdict만 반환하세요. 규칙:
1. "keep": 독립적인 글 주제로 성립하고 검색자가 실제로 찾을 법한 표현.
2. "reject": 날짜·문장 파편·URL·블로그 이름·조동사 조각·의미 없는 일반어 등 주제로 성립하지 않는 것.
3. "merge": 다른 주제와 사실상 같은 주제 — merge_into에 상대 topic 문자열을 적는다.
4. 새 주제를 만들거나, keep으로 바꾸는 것 외의 판정을 하지 않는다. 심사는 후보를 줄이는 방향으로만 한다.

출력 형식(JSON):
{"verdicts":[{"topic":"...","verdict":"keep|reject|merge","reason":"...","merge_into":"..."}]}`;

function assertString(value, field, maxLen) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLen)
    throw Error(`model extraction: invalid ${field}`);
  return value.trim();
}

export function validateExtraction(value, { corpus, maxTopics = 5 } = {}) {
  if (!value || !Array.isArray(value.topics))
    throw Error("model extraction: response requires a topics array");
  // Overflow beyond the cap is recorded and truncated, not fatal — the cap is
  // a pipeline limit, while verbatim/schema violations below stay fatal.
  const overCap = value.topics
    .slice(maxTopics)
    .map((t) => (typeof t?.topic === "string" ? t.topic : "?"));
  value = { ...value, topics: value.topics.slice(0, maxTopics) };
  const corpusKey = normalizeForVerbatim(corpus);
  const seen = new Set();
  const topics = [];
  for (const [index, raw] of value.topics.entries()) {
    if (!raw || typeof raw !== "object")
      throw Error(`model extraction: topics[${index}] must be an object`);
    const topic = assertString(raw.topic, `topics[${index}].topic`, MAX_TOPIC_LEN);
    if (!corpusKey.includes(normalizeForVerbatim(topic)))
      throw Error(
        `model extraction: topic ${JSON.stringify(topic)} not verbatim in corpus`,
      );
    const key = normalizeKeywordKey(topic);
    if (seen.has(key)) continue;
    seen.add(key);
    const relatedRaw = Array.isArray(raw.related_keywords)
      ? raw.related_keywords
      : [];
    if (relatedRaw.length > MAX_RELATED)
      throw Error(`model extraction: topics[${index}] has too many related keywords`);
    const relatedSeen = new Set();
    const related = [];
    for (const item of relatedRaw) {
      const label = assertString(item, "related_keywords[]", MAX_RELATED_LEN);
      if (!corpusKey.includes(normalizeForVerbatim(label)))
        throw Error(
          `model extraction: related keyword ${JSON.stringify(label)} not verbatim in corpus`,
        );
      const relKey = normalizeKeywordKey(label);
      if (relatedSeen.has(relKey) || relKey === key) continue;
      relatedSeen.add(relKey);
      related.push(label);
    }
    topics.push(
      Object.freeze({
        topic,
        related_keywords: Object.freeze(related),
        intent:
          typeof raw.intent === "string" &&
          SEARCH_INTENTS.includes(raw.intent.trim())
            ? raw.intent.trim()
            : "",
        angle: typeof raw.angle === "string" ? raw.angle.slice(0, 160) : "",
        rationale:
          typeof raw.rationale === "string" ? raw.rationale.slice(0, 200) : "",
      }),
    );
  }
  return Object.freeze({
    topics: Object.freeze(topics),
    overCap: Object.freeze(overCap),
  });
}

// The model may only narrow the candidate set: reject and merge are applied,
// unknown topics or unknown verdicts are ignored, and no verdict can create a
// candidate the extractor did not propose.
export function applyTriage(topics, triageValue) {
  if (!triageValue || !Array.isArray(triageValue.verdicts))
    throw Error("model triage: response requires a verdicts array");
  const byKey = new Map(topics.map((t) => [normalizeKeywordKey(t.topic), t]));
  const verdictOf = new Map();
  for (const entry of triageValue.verdicts) {
    if (!entry || typeof entry.topic !== "string") continue;
    const key = normalizeKeywordKey(entry.topic);
    if (!byKey.has(key)) continue; // verdicts on non-candidates are ignored
    if (!["keep", "reject", "merge"].includes(entry.verdict)) continue;
    verdictOf.set(key, {
      verdict: entry.verdict,
      reason:
        typeof entry.reason === "string" ? entry.reason.slice(0, 200) : "",
      merge_into:
        typeof entry.merge_into === "string" ? entry.merge_into : undefined,
    });
  }
  const kept = [];
  const rejected = [];
  const merged = [];
  for (const topic of topics) {
    const key = normalizeKeywordKey(topic.topic);
    const verdict = verdictOf.get(key);
    if (!verdict || verdict.verdict === "keep") {
      kept.push(topic);
      continue;
    }
    if (verdict.verdict === "merge") {
      const targetKey = normalizeKeywordKey(verdict.merge_into ?? "");
      const target = byKey.get(targetKey);
      const targetVerdict = targetKey ? verdictOf.get(targetKey) : undefined;
      if (target && targetKey !== key && (!targetVerdict || targetVerdict.verdict === "keep")) {
        merged.push({
          from: topic.topic,
          into: target.topic,
          reason: verdict.reason,
        });
        continue;
      }
      // merge target missing or itself rejected/merged — keep the candidate
      kept.push(topic);
      continue;
    }
    rejected.push({ topic: topic.topic, reason: verdict.reason });
  }
  return Object.freeze({ kept: Object.freeze(kept), rejected: Object.freeze(rejected), merged: Object.freeze(merged) });
}

export function extractionInput({ category, query, items }) {
  return JSON.stringify(
    {
      category,
      query,
      items: (items ?? []).map((item) => ({
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        postdate: item.postdate ?? "",
      })),
    },
    null,
    2,
  );
}

export async function extractTopicsWithModel({
  category,
  query,
  items,
  maxTopics,
  runModel,
  cwd,
  deadline,
}) {
  if (typeof runModel !== "function")
    throw Error("model extraction requires a runModel implementation");
  const corpus = corpusTextOf(items);
  const input = extractionInput({ category, query, items });
  const call = await runModel({
    system: extractSystem(maxTopics),
    input,
    cwd,
    deadline,
  });
  const { topics, overCap } = validateExtraction(call.value, {
    corpus,
    maxTopics,
  });
  return Object.freeze({
    topics,
    overCap,
    provenance: Object.freeze({
      model: call.model,
      input_sha256: call.inputSha256 ?? sha256(input),
      raw_sha256: call.rawSha256,
    }),
  });
}

export async function triageTopicsWithModel({
  category,
  topics,
  runModel,
  cwd,
  deadline,
}) {
  if (typeof runModel !== "function")
    throw Error("model triage requires a runModel implementation");
  if (!topics.length) return { kept: [], rejected: [], merged: [] };
  const input = JSON.stringify(
    {
      category,
      topics: topics.map((t) => ({
        topic: t.topic,
        related_keywords: t.related_keywords,
        intent: t.intent,
      })),
    },
    null,
    2,
  );
  const call = await runModel({
    system: TRIAGE_SYSTEM,
    input,
    cwd,
    deadline,
  });
  const result = applyTriage(topics, call.value);
  return Object.freeze({
    ...result,
    provenance: Object.freeze({
      model: call.model,
      input_sha256: call.inputSha256 ?? sha256(input),
      raw_sha256: call.rawSha256,
    }),
  });
}

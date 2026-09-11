const CATEGORY_ORDER = Object.freeze(["economy-business", "ai", "travel"]);

const CATEGORY_ANGLES = Object.freeze({
  "economy-business": "기준일·공식 근거·판단 조건 같은 기준",
  ai: "버전·기능·확인 범위 같은 기준",
  travel: "여행 동선·비용·현장 조건 같은 기준",
});

const clean = (value) =>
  String(value ?? "")
    .replace(/[\r\n]/gu, " ")
    .trim();

function candidateKey(record) {
  return `${record?.category ?? ""}\u0000${record?.head_keyword ?? ""}`;
}

function discoveryRank(discovery) {
  const ranks = new Map();
  for (const category of discovery?.categories ?? []) {
    for (const [index, candidate] of (category?.candidates ?? []).entries()) {
      const key = `${category.category}\u0000${candidate.topic}`;
      if (!ranks.has(key)) ranks.set(key, index);
    }
  }
  return ranks;
}

export function selectPersonaBatchCandidates(
  records,
  discovery,
  { limitPerCategory = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Array.isArray(records)) return [];
  const limit =
    Number.isInteger(limitPerCategory) && limitPerCategory > 0
      ? limitPerCategory
      : Number.MAX_SAFE_INTEGER;
  const ranks = discoveryRank(discovery);
  const ready = records.filter(
    (record) =>
      record?.status === "ready-to-write" &&
      CATEGORY_ORDER.includes(record.category) &&
      clean(record.head_keyword) !== "",
  );
  return CATEGORY_ORDER.flatMap((category) =>
    ready
      .filter((record) => record.category === category)
      .toSorted((left, right) => {
        const leftRank =
          ranks.get(candidateKey(left)) ?? Number.MAX_SAFE_INTEGER;
        const rightRank =
          ranks.get(candidateKey(right)) ?? Number.MAX_SAFE_INTEGER;
        return (
          leftRank - rightRank ||
          left.head_keyword.localeCompare(right.head_keyword, "ko")
        );
      })
      .slice(0, limit),
  );
}

export function buildPersonaBatchApproval({
  brief,
  persona,
  batchApproval,
} = {}) {
  const personaName = clean(persona?.name) || "wj-editor";
  const keyword = clean(brief?.head_keyword);
  const category = clean(brief?.category);
  if (keyword === "" || !CATEGORY_ORDER.includes(category)) {
    throw new TypeError("persona batch approval requires a supported brief");
  }
  const angleFocus = CATEGORY_ANGLES[category];
  const format = clean(persona?.style?.default_article_format) || "how-to";
  const suggestion = {
    reviewer: `${personaName} persona batch`,
    reason: `${personaName} 배치가 제안한 근거 연결 상태와 WJ 편집 규칙을 확인하세요.`,
    angle: `${keyword} 검색 독자가 ${angleFocus}을 확인하고 다음 행동을 정할 수 있게 정리합니다.`,
    format,
    approval_mode: "persona-suggestion",
  };
  if (batchApproval === undefined) return Object.freeze(suggestion);
  const reviewer = clean(batchApproval.reviewer);
  const reason = clean(batchApproval.reason);
  const angle = clean(batchApproval.angle);
  if (reviewer === "" || reason === "" || angle === "") {
    throw new TypeError("batch approval requires reviewer, reason, and angle");
  }
  return Object.freeze(
    Object.assign(
      {
        reviewer,
        reason,
        angle,
        format,
        approval_mode: batchApproval.mode ?? "human-batch",
      },
      batchApproval.policyId
        ? {
            policy_id: batchApproval.policyId,
            policy_sha256: batchApproval.policySha256,
          }
        : undefined,
    ),
  );
}

export { CATEGORY_ORDER };

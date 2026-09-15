import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzePost } from "./check-writing.mjs";

const front = `---\ntitle: "테스트 글"\ndescription: "테스트용 설명입니다. 독자가 이 글을 열어야 하는 이유를 충분히 길게 적어 둡니다."\npubDate: 2026-09-15\nstatus: draft\ntopic: ai\nangle: "테스트"\nauthor: TBD\n---\n\n`;

// 서로 다른 문장으로 구성된 산문 — 반복 탐지에 걸리지 않는 베이스라인
const cleanBody = [
  "여행 상품을 고를 때 가장 먼저 볼 건 일정표입니다. 관광지 이름이 길게 나열된 것보다 실제로 그날 어디를 가는지가 중요합니다.",
  "비교할 상품이 두세 개로 좁혀지면 포함 항목을 나란히 놓으세요. 노팁·노옵션 문구는 상품마다 범위가 달라서 제목만 믿으면 안 됩니다.",
  "출발 공항과 집결 시각은 생각보다 체감 차이가 큽니다. 집에서 공항까지의 동선이 빠진 상품이 많기 때문입니다.",
  "이동일이 연속으로 붙어 있으면 체력 부담이 커집니다. 중간에 자유 시간이 끼어 있는 일정이 오히려 낫습니다.",
  "후기를 보면 같은 지역이라도 가이드 배정에 따라 만족도가 갈립니다. 판매자에게 미리 물어볼 수 있는 부분은 물어보세요.",
  "마지막으로 귀국 동선을 확인합니다. 해산 위치가 공항인지 시내인지에 따라 마지막 날 계획이 달라집니다.",
  "가격 차이가 나는 이유는 대부분 포함 범위입니다. 식사 횟수와 입장료 포함 여부를 먼저 대조해 보세요.",
  "일정표에 자유 시간이 길면 그만큼 별도 예산이 필요합니다. 선택 관광 목록을 미리 받아 두면 비교가 쉽습니다.",
].join("\n\n");

test("clean prose passes AI-tell checks", () => {
  const result = analyzePost(front + cleanBody, { format: "essay" });
  const checks = result.failures.map((f) => f.check);
  assert.ok(!checks.includes("repeated-passage"), JSON.stringify(result.failures));
  assert.ok(!checks.includes("fake-experience"));
  assert.ok(!checks.includes("list-density"));
});

test("repeated example across sections is flagged", () => {
  const repeated =
    front +
    "첫 번째 섹션입니다. 예를 들어 다낭과 호이안을 묶은 상품은 바나힐과 올드타운이 같이 들어 있는 경우가 많은데, 두 도시 사이 이동이 어느 날에 배치됐는지가 하루의 피로도를 가릅니다.\n\n" +
    "두 번째 섹션입니다. 예를 들어 다낭과 호이안을 묶은 상품은 바나힐과 올드타운이 포함됐다고 쓰여 있는데, 두 도시 사이 이동이 어느 날에 배치됐는지에 따라 마지막 날 피로도가 달라집니다.\n\n" +
    cleanBody;
  const result = analyzePost(repeated, { format: "essay" });
  assert.ok(
    result.failures.some((f) => f.check === "repeated-passage"),
    JSON.stringify(result.failures),
  );
});

test("fake first-person experience without notes evidence is flagged", () => {
  const fake =
    front +
    "제가 쓰는 순서는 이렇습니다. 먼저 기준선을 찾고 다음으로 사건 문장을 확인합니다.\n\n" +
    cleanBody;
  const result = analyzePost(fake, { format: "essay" });
  assert.ok(
    result.failures.some((f) => f.check === "fake-experience"),
    JSON.stringify(result.failures),
  );
});

test("fake experience backed by notes is only a warning", () => {
  const fake =
    front +
    "제가 쓰는 순서는 이렇습니다. 먼저 기준선을 찾고 다음으로 사건 문장을 확인합니다.\n\n" +
    cleanBody;
  const result = analyzePost(fake, {
    format: "essay",
    notes: "제가 쓰는 순서를 실제로 적용한 기록이 있습니다.",
  });
  assert.ok(!result.failures.some((f) => f.check === "fake-experience"));
  assert.ok(result.warnings.some((w) => w.check === "fake-experience"));
});

test("list-heavy audit-document structure is flagged", () => {
  const listy =
    front +
    Array.from(
      { length: 24 },
      (_, i) => `- **항목 ${i + 1}** — 확인할 내용과 조건을 나열합니다`,
    ).join("\n") +
    "\n\n" +
    Array.from({ length: 6 }, (_, i) => `| 열${i + 1} | 값 |`).join("\n") +
    "\n\n짧은 마무리 문단입니다.";
  const result = analyzePost(listy, { format: "how-to" });
  assert.ok(
    result.failures.some((f) => f.check === "list-density"),
    JSON.stringify(result.failures),
  );
});

test("monotone endings produce a warning", () => {
  const monotone =
    front +
    Array.from(
      { length: 12 },
      (_, i) => `${i + 1}번째 항목도 결국 직접 확인하세요.`,
    ).join(" ") +
    "\n\n" +
    cleanBody;
  const result = analyzePost(monotone, { format: "essay" });
  assert.ok(
    result.warnings.some((w) => w.check === "ending-monotony"),
    JSON.stringify(result.warnings),
  );
});

test("how-to over maxChars produces a warning", () => {
  const long =
    front +
    Array.from(
      { length: 60 },
      (_, i) =>
        `이 주제의 ${i + 1}번째 측면을 살펴봅니다. 조건에 따라 달라지는 부분이 있고, 독자의 상황에 맞춰 선택하면 됩니다. 실제로 적용해 보면 차이가 보입니다.`,
    ).join("\n\n") +
    "\n\n1. 단계 하나\n2. 단계 둘\n\n| 항목 | 내용 |\n|---|---|\n| a | b |\n";
  const result = analyzePost(long, { format: "how-to" });
  assert.ok(
    result.warnings.some((w) => w.check === "max-chars"),
    `chars=${result.metrics.bodyChars} ` + JSON.stringify(result.warnings),
  );
});

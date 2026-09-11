import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildPersonaBatchApproval,
  selectPersonaBatchCandidates,
} from "./lib/persona-batch.mjs";
import {
  buildPersonaBatchDraftArgs,
  main as personaBatchMain,
  parsePersonaBatchArgs,
} from "./persona-batch.mjs";
import { writeReadyToWriteExport } from "./lib/records-store.mjs";
import { makeValidRecord } from "./test-helpers.mjs";

const persona = {
  name: "wj-editor",
  style: { default_article_format: "how-to" },
};

const records = [
  { category: "ai", head_keyword: "AI 두 번째", status: "ready-to-write" },
  {
    category: "economy-business",
    head_keyword: "경제 첫 번째",
    status: "ready-to-write",
  },
  { category: "ai", head_keyword: "AI 첫 번째", status: "ready-to-write" },
  {
    category: "travel",
    head_keyword: "여행 첫 번째",
    status: "ready-to-write",
  },
  { category: "travel", head_keyword: "여행 제외", status: "candidate" },
];

const discovery = {
  categories: [
    {
      category: "ai",
      candidates: [{ topic: "AI 첫 번째" }, { topic: "AI 두 번째" }],
    },
    {
      category: "economy-business",
      candidates: [{ topic: "경제 첫 번째" }],
    },
    { category: "travel", candidates: [{ topic: "여행 첫 번째" }] },
  ],
};

test("selects the top ready candidate per fixed category from discovery order", () => {
  const selected = selectPersonaBatchCandidates(records, discovery, {
    limitPerCategory: 1,
  });

  assert.deepEqual(
    selected.map(({ category, head_keyword }) => ({ category, head_keyword })),
    [
      { category: "economy-business", head_keyword: "경제 첫 번째" },
      { category: "ai", head_keyword: "AI 첫 번째" },
      { category: "travel", head_keyword: "여행 첫 번째" },
    ],
  );
});

test("selects every ready candidate when the batch limit is unlimited", () => {
  const selected = selectPersonaBatchCandidates(records, discovery);

  assert.deepEqual(
    selected.map(({ category, head_keyword }) => `${category}/${head_keyword}`),
    [
      "economy-business/경제 첫 번째",
      "ai/AI 첫 번째",
      "ai/AI 두 번째",
      "travel/여행 첫 번째",
    ],
  );
});

test("does not select candidates outside the configured category set", () => {
  const selected = selectPersonaBatchCandidates(
    [
      ...records,
      { category: "health", head_keyword: "건강", status: "ready-to-write" },
    ],
    discovery,
  );

  assert.equal(
    selected.some((record) => record.category === "health"),
    false,
  );
});

test("parses a dry-run batch without requiring per-keyword approval fields", () => {
  const parsed = parsePersonaBatchArgs(["--dry-run", "--all"]);

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.limitPerCategory, Number.MAX_SAFE_INTEGER);

  const custom = parsePersonaBatchArgs(["--data-dir", "/tmp/keyword-data"]);
  assert.equal(custom.ready, "/tmp/keyword-data/ready-to-write.json");
  assert.equal(custom.records, "/tmp/keyword-data/records.json");
});

test("builds an approved bridge command without manual per-keyword fields", () => {
  const args = buildPersonaBatchDraftArgs(
    {
      briefPath: "/repo/out/keyword-briefs/ai-topic.json",
      reviewer: "wj-editor persona batch",
      reason: "근거 연결 상태를 확인했습니다.",
      angle: "버전과 확인 범위를 기준으로 정리합니다.",
      format: "how-to",
      briefSha256: "a".repeat(64),
    },
    {
      records: "/repo/data/keywords/records.json",
      ready: "/repo/data/keywords/ready-to-write.json",
      decisions: "/repo/data/keywords/decisions.jsonl",
    },
  );

  assert.deepEqual(args, [
    "--brief",
    "/repo/out/keyword-briefs/ai-topic.json",
    "--records",
    "/repo/data/keywords/records.json",
    "--ready",
    "/repo/data/keywords/ready-to-write.json",
    "--decisions",
    "/repo/data/keywords/decisions.jsonl",
    "--approve",
    "--reviewer",
    "wj-editor persona batch",
    "--reason",
    "근거 연결 상태를 확인했습니다.",
    "--angle",
    "버전과 확인 범위를 기준으로 정리합니다.",
    "--format",
    "how-to",
    "--brief-sha256",
    "a".repeat(64),
  ]);
});

test("builds bounded approval metadata from the configured persona", () => {
  const approval = buildPersonaBatchApproval({
    brief: {
      category: "travel",
      head_keyword: "제주 애월",
      content_angle: "여행 동선과 현장 조건을 확인합니다",
    },
    persona,
  });

  assert.deepEqual(approval, {
    reviewer: "wj-editor persona batch",
    reason:
      "wj-editor 배치가 제안한 근거 연결 상태와 WJ 편집 규칙을 확인하세요.",
    angle:
      "제주 애월 검색 독자가 여행 동선·비용·현장 조건 같은 기준을 확인하고 다음 행동을 정할 수 있게 정리합니다.",
    format: "how-to",
    approval_mode: "persona-suggestion",
  });
  assert.ok(approval.reason.length <= 300);
  assert.ok(approval.angle.length <= 300);
});

function integrationBrief() {
  return {
    schema_version: 1,
    category: "ai",
    head_keyword: "선정 키워드",
    related_keywords: ["관련 표현", "다른 표현"],
    search_intent: "방법",
    content_angle: "공식 근거와 확인 절차를 중심으로 설명합니다",
    collected_at: "2026-09-11T00:00:00.000Z",
    freshness: "fresh",
    source: ["naver-api-hub-blog", "naver-api-hub-trend"],
    outline: ["문제", "절차"],
    review_gate: "사람 검토 필요; 자동 작성·예약·발행 금지",
    evidence: {
      blog: [{ title: "근거", description: "설명", collected_at: "2026-09-11T00:00:00.000Z" }],
      trend: [{
        group_name: "선정 키워드",
        latest_period: "2026-09-11",
        latest_ratio: 10,
        max_ratio: 20,
        ratio_note: "상대 지표이며 절대 검색량이 아님",
        collected_at: "2026-09-11T00:00:00.000Z",
      }],
    },
  };
}

async function makeBatchWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "wj-persona-batch-"));
  const dataDir = join(root, "data/keywords");
  const briefDir = join(root, "out/keyword-briefs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(briefDir, { recursive: true });
  await mkdir(join(root, ".editorial"), { recursive: true });
  await writeFile(join(root, ".editorial/manifest.json"), JSON.stringify({
    defaultPersona: "wj-editor",
    modules: { personas: { "wj-editor": "persona.json" } },
  }));
  await writeFile(join(root, "persona.json"), JSON.stringify({
    name: "wj-editor",
    style: { default_article_format: "how-to" },
  }));
  const record = makeValidRecord({
    category: "ai",
    head_keyword: "선정 키워드",
    status: "ready-to-write",
  });
  const recordsPath = join(dataDir, "records.json");
  await writeFile(recordsPath, `${JSON.stringify([record])}\n`);
  await writeReadyToWriteExport([record], { path: join(dataDir, "ready-to-write.json"), recordsPath });
  await writeFile(join(dataDir, "automatic-discovery.json"), JSON.stringify({
    categories: [{ category: "ai", candidates: [{ topic: "선정 키워드" }] }],
  }));
  const briefPath = join(briefDir, "ai-선정-키워드.json");
  await writeFile(briefPath, `${JSON.stringify(integrationBrief())}\n`);
  return root;
}

test("persona batch dry-run never calls the writer and actual execution requires one batch approval", async (t) => {
  const root = await makeBatchWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;

  const dryRun = await personaBatchMain(["--dry-run"], {
    repositoryRoot: root,
    runDraft: async () => {
      calls += 1;
      return { status: "written" };
    },
  });
  assert.equal(dryRun.plan.length, 1);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(await readFile(join(root, "out/keyword-batch/latest.json"), "utf8")).mode, "dry-run");

  await assert.rejects(
    () => personaBatchMain([], { repositoryRoot: root, runDraft: async () => ({ status: "written" }) }),
    /batch approval/iu,
  );
  await personaBatchMain(
    [
      "--approve-batch",
      "--reviewer", "운영자",
      "--reason", "배치 전체 근거와 작성 방향을 확인함",
      "--angle", "근거와 확인 범위를 중심으로 정리함",
    ],
    {
      repositoryRoot: root,
      runDraft: async (args) => {
        calls += 1;
        assert.ok(args.includes("--approve"));
        return { status: "written" };
      },
    },
  );
  assert.equal(calls, 1);
});

test("persona batch rejects a manifest directory outside the repository output boundary", async (t) => {
  const root = await makeBatchWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () => personaBatchMain(["--dry-run", "--batch-dir", "/tmp/outside-batch"], { repositoryRoot: root }),
    /remain inside its root/iu,
  );
});

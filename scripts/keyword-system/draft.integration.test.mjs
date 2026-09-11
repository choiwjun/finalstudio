import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as draftMain } from "./draft.mjs";
import { makeValidRecord } from "./test-helpers.mjs";
import { writeReadyToWriteExport } from "./lib/records-store.mjs";

function makeBrief() {
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
      blog: [
        {
          title: "근거",
          description: "설명",
          collected_at: "2026-09-11T00:00:00.000Z",
        },
      ],
      trend: [
        {
          group_name: "선정 키워드",
          latest_period: "2026-09-11",
          latest_ratio: 10,
          max_ratio: 20,
          ratio_note: "상대 지표이며 절대 검색량이 아님",
          collected_at: "2026-09-11T00:00:00.000Z",
        },
      ],
    },
  };
}

test("draft bridge requires approval and records the writer handoff after draft creation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-draft-bridge-"));
  const keywordDir = join(root, "data/keywords");
  const briefDir = join(root, "out/keyword-briefs");
  const postsDir = join(root, "src/content/posts");
  await mkdir(keywordDir, { recursive: true });
  await mkdir(briefDir, { recursive: true });
  await mkdir(postsDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const record = makeValidRecord({
    category: "ai",
    head_keyword: "선정 키워드",
    collected_at: "2026-09-11T00:00:00.000Z",
    status: "ready-to-write",
  });
  const recordsPath = join(keywordDir, "records.json");
  const readyPath = join(keywordDir, "ready-to-write.json");
  const decisionsPath = join(keywordDir, "decisions.jsonl");
  await writeFile(recordsPath, `${JSON.stringify([record])}\n`);
  await writeFile(decisionsPath, "");
  await writeReadyToWriteExport([record], { path: readyPath, recordsPath });

  const briefPath = join(briefDir, "ai-selected.json");
  const briefText = `${JSON.stringify(makeBrief(), null, 2)}\n`;
  const briefSha256 = createHash("sha256").update(briefText).digest("hex");
  await writeFile(briefPath, briefText);
  await writeFile(
    join(briefDir, "ai-selected.md"),
    "# 선정 키워드\n\n사람 검토 필요\n",
  );

  await assert.rejects(
    () => draftMain(["--brief", briefPath], { repositoryRoot: root }),
    /human approval/iu,
  );

  const outsideRecords = join(root, "outside-records.json");
  await assert.rejects(
    () =>
      draftMain(
        [
          "--brief",
          briefPath,
          "--records",
          outsideRecords,
          "--brief-sha256",
          briefSha256,
          "--approve",
          "--reviewer",
          "운영자",
          "--reason",
          "검토함",
          "--angle",
          "사람이 승인한 글의 범위와 독자 문제",
        ],
        {
          repositoryRoot: root,
          runWriter: async () => ({ code: 0, stdout: "", stderr: "" }),
        },
      ),
    /--records must remain inside its root/iu,
  );

  const malformedPath = join(briefDir, "malformed.json");
  const malformedText = `${JSON.stringify({ ...makeBrief(), related_keywords: ["", ""] })}\n`;
  const malformedSha256 = createHash("sha256")
    .update(malformedText)
    .digest("hex");
  await writeFile(malformedPath, malformedText);
  await assert.rejects(
    () =>
      draftMain(
        [
          "--brief",
          malformedPath,
          "--approve",
          "--reviewer",
          "운영자",
          "--reason",
          "검토함",
          "--angle",
          "사람이 승인한 글의 범위와 독자 문제",
          "--brief-sha256",
          malformedSha256,
        ],
        { repositoryRoot: root },
      ),
    /related_keywords/iu,
  );

  const result = await draftMain(
    [
      "--brief",
      briefPath,
      "--records",
      recordsPath,
      "--ready",
      readyPath,
      "--decisions",
      decisionsPath,
      "--approve",
      "--reviewer",
      "운영자",
      "--reason",
      "근거와 글 방향을 확인함",
      "--angle",
      "사람이 승인한 글의 범위와 독자 문제",
      "--brief-sha256",
      briefSha256,
    ],
    {
      repositoryRoot: root,
      runWriter: async ({ args }) => {
        const stagingDir = args[args.indexOf("--out") + 1];
        const stagedPath = join(stagingDir, "selected.md");
        await writeFile(stagedPath, "---\nstatus: draft\n---\n");
        return {
          code: 0,
          stdout: `[convert-post] 저장 완료: ${stagedPath}\n`,
          stderr: "",
        };
      },
    },
  );

  assert.deepEqual(result, {
    category: "ai",
    head_keyword: "선정 키워드",
    draft: "src/content/posts/selected.md",
    status: "written",
  });
  assert.equal(JSON.parse(await readFile(readyPath, "utf8")).length, 0);
  assert.equal(
    JSON.parse(await readFile(recordsPath, "utf8"))[0].status,
    "written",
  );
  assert.match(await readFile(decisionsPath, "utf8"), /writer_handoff/u);

  const existingDraft = await readFile(
    join(postsDir, "selected.md"),
    "utf8",
  );
  const readyAgain = makeValidRecord({
    category: "ai",
    head_keyword: "선정 키워드",
    collected_at: "2026-09-11T00:00:00.000Z",
    status: "ready-to-write",
  });
  await writeFile(recordsPath, `${JSON.stringify([readyAgain])}\n`);
  await writeReadyToWriteExport([readyAgain], {
    path: readyPath,
    recordsPath,
  });
  await assert.rejects(
    () =>
      draftMain(
        [
          "--brief",
          briefPath,
          "--records",
          recordsPath,
          "--ready",
          readyPath,
          "--decisions",
          decisionsPath,
          "--approve",
          "--reviewer",
          "운영자",
          "--reason",
          "재생성하지 않음",
          "--angle",
          "사람이 승인한 글의 범위와 독자 문제",
          "--brief-sha256",
          briefSha256,
        ],
        {
          repositoryRoot: root,
          runWriter: async ({ args }) => {
            const stagingDir = args[args.indexOf("--out") + 1];
            const stagedPath = join(stagingDir, "selected.md");
            await writeFile(stagedPath, "---\nstatus: draft\n---\n");
            return {
              code: 0,
              stdout: `[convert-post] 저장 완료: ${stagedPath}\n`,
              stderr: "",
            };
          },
        },
      ),
    /already exists/iu,
  );
  assert.equal(await readFile(join(postsDir, "selected.md"), "utf8"), existingDraft);
});

test("automation policy can authorize the bridge without per-keyword human fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-draft-policy-"));
  const keywordDir = join(root, "data/keywords");
  const briefDir = join(root, "out/keyword-briefs");
  const postsDir = join(root, "src/content/posts");
  await mkdir(keywordDir, { recursive: true });
  await mkdir(briefDir, { recursive: true });
  await mkdir(postsDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const record = makeValidRecord({
    category: "ai",
    head_keyword: "선정 키워드",
    status: "ready-to-write",
  });
  const recordsPath = join(keywordDir, "records.json");
  const readyPath = join(keywordDir, "ready-to-write.json");
  const decisionsPath = join(keywordDir, "decisions.jsonl");
  await writeFile(recordsPath, `${JSON.stringify([record])}\n`);
  await writeFile(decisionsPath, "");
  await writeReadyToWriteExport([record], { path: readyPath, recordsPath });
  const briefText = `${JSON.stringify(makeBrief(), null, 2)}\n`;
  const briefPath = join(briefDir, "ai-selected.json");
  const briefSha256 = createHash("sha256").update(briefText).digest("hex");
  await writeFile(briefPath, briefText);
  await writeFile(
    join(briefDir, "ai-selected.md"),
    "# 선정 키워드\n\n사람 검토 필요\n",
  );
  const policyPath = join(root, "automation-policy.json");
  const policyText = JSON.stringify({
    schema_version: 1,
    kind: "keyword-automation-policy",
    id: "test-policy",
    enabled: true,
    allow_writer: true,
    allow_publish: true,
    persona: "wj-editor",
    reason: "자동화 품질 게이트를 통과한 배치입니다.",
    images: { main: 1, sub: 2 },
    publish: {
      requires_deploy_hook: true,
      requires_complete_image_bundle: true,
      requires_content_check: true,
    },
  });
  const policySha256 = createHash("sha256").update(policyText).digest("hex");
  await writeFile(policyPath, policyText);

  const result = await draftMain(
    [
      "--brief",
      briefPath,
      "--records",
      recordsPath,
      "--ready",
      readyPath,
      "--decisions",
      decisionsPath,
      "--automation-policy",
      policyPath,
      "--automation-policy-sha256",
      policySha256,
      "--angle",
      "근거와 확인 범위를 중심으로 정리합니다.",
      "--brief-sha256",
      briefSha256,
    ],
    {
      repositoryRoot: root,
      runWriter: async ({ args }) => {
        const stagingDir = args[args.indexOf("--out") + 1];
        const stagedPath = join(stagingDir, "policy.md");
        await writeFile(stagedPath, "---\nstatus: draft\n---\n");
        return {
          code: 0,
          stdout: `[convert-post] 저장 완료: ${stagedPath}\n`,
          stderr: "",
        };
      },
    },
  );

  assert.equal(result.status, "written");
  const decisionText = await readFile(decisionsPath, "utf8");
  assert.match(decisionText, /automation-policy/iu);
  assert.match(decisionText, new RegExp(`policy_sha256=${policySha256}`, "u"));
});

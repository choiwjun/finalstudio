import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildWriterEnvironment } from "./draft.mjs";
import {
  DraftBridgeError,
  buildAutoWriteArgs,
  buildWriterReference,
  normalizeDraftFormat,
  parseDraftPath,
  requireHumanApproval,
  requireHumanAuthoredAngle,
  requireReviewedBriefHash,
} from "./lib/draft-bridge.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const brief = {
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
    trend: [{ group_name: "선정 키워드", latest_period: "2026-09-11", latest_ratio: 10, max_ratio: 20, ratio_note: "상대 지표이며 절대 검색량이 아님", collected_at: "2026-09-11T00:00:00.000Z" }],
  },
};

test("review approval binds to the exact brief hash", () => {
  const hash = "a".repeat(64);
  assert.equal(requireReviewedBriefHash(hash, hash), hash);
  assert.throws(() => requireReviewedBriefHash(hash.toUpperCase(), hash), DraftBridgeError);
  assert.throws(() => requireReviewedBriefHash("b".repeat(64), hash), DraftBridgeError);
  assert.throws(() => requireReviewedBriefHash("not-a-hash", hash), DraftBridgeError);
});

test("writer subprocess environment excludes NAVER credentials", () => {
  const environment = buildWriterEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/test",
    NCP_NAVER_API_HUB_CLIENT_ID: "client-secret-value",
    NCP_NAVER_API_HUB_CLIENT_SECRET: "secret-value",
    OPENAI_API_KEY: "must-not-be-inherited",
  });

  assert.deepEqual(environment, { PATH: "/usr/bin", HOME: "/home/test" });
});

test("standalone auto-write rejects before reaching Codex", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(ROOT, "scripts/auto-publish/auto-write.mjs"),
      "직접 실행 주제",
      "--topic",
      "economy",
      "--angle",
      "사람 방향",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        NCP_NAVER_API_HUB_CLIENT_ID: "test-client-sentinel",
        NCP_NAVER_API_HUB_CLIENT_SECRET: "test-secret-sentinel",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /approved keyword draft bridge/iu);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /test-(?:client|secret)-sentinel/iu);
});

test("human approval is explicit and requires reviewer context", () => {
  assert.throws(() => requireHumanApproval({}), DraftBridgeError);
  assert.deepEqual(
    requireHumanApproval({ approved: true, reviewer: "운영자", reason: "근거와 방향을 확인함" }),
    { reviewer: "운영자", reason: "근거와 방향을 확인함" },
  );
});

test("writer args require a human-authored angle and pass reviewed notes without publish options", () => {
  assert.equal(normalizeDraftFormat("HOW-TO"), "how-to");
  assert.throws(() => requireHumanAuthoredAngle(""), DraftBridgeError);
  assert.deepEqual(
    buildAutoWriteArgs(brief, {
      notesPath: "/repo/out/keyword-briefs/ai-선정.json.md",
      humanAngle: "사람이 승인한 글의 범위와 독자 문제를 설명합니다",
      briefSha256: "a".repeat(64),
      approvalArtifact: "/repo/out/.keyword-approval.json",
    }),
    [
      "선정 키워드",
      "--topic",
      "ai",
      "--angle",
      "사람이 승인한 글의 범위와 독자 문제를 설명합니다",
      "--format",
      "how-to",
      "--notes",
      "/repo/out/keyword-briefs/ai-선정.json.md",
      "--brief-sha256",
      "a".repeat(64),
      "--approval-artifact",
      "/repo/out/.keyword-approval.json",
    ],
  );
});

test("writer output is restricted to the content post directory", () => {
  const root = "/repo";
  const posts = "/repo/src/content/posts";
  assert.equal(
    parseDraftPath("[convert-post] 저장 완료: /repo/src/content/posts/selected.md", { repositoryRoot: root, postsRoot: posts }),
    "/repo/src/content/posts/selected.md",
  );
  assert.equal(buildWriterReference(root, "/repo/src/content/posts/selected.md"), "src/content/posts/selected.md");
  assert.throws(
    () => parseDraftPath("[convert-post] 저장 완료: /repo/out/escape.md", { repositoryRoot: root, postsRoot: posts }),
    DraftBridgeError,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DraftBridgeError,
  buildAutoWriteArgs,
  buildWriterReference,
  normalizeDraftFormat,
  parseDraftPath,
  requireHumanApproval,
} from "./lib/draft-bridge.mjs";

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

test("human approval is explicit and requires reviewer context", () => {
  assert.throws(() => requireHumanApproval({}), DraftBridgeError);
  assert.deepEqual(
    requireHumanApproval({ approved: true, reviewer: "운영자", reason: "근거와 방향을 확인함" }),
    { reviewer: "운영자", reason: "근거와 방향을 확인함" },
  );
});

test("writer args pass the reviewed brief as notes without publish options", () => {
  assert.equal(normalizeDraftFormat("HOW-TO"), "how-to");
  assert.deepEqual(
    buildAutoWriteArgs(brief, { notesPath: "/repo/out/keyword-briefs/ai-선정.json.md" }),
    [
      "선정 키워드",
      "--topic",
      "ai",
      "--angle",
      "공식 근거와 확인 절차를 중심으로 설명합니다",
      "--format",
      "how-to",
      "--notes",
      "/repo/out/keyword-briefs/ai-선정.json.md",
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

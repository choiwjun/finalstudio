import assert from "node:assert/strict";
import { test } from "node:test";
import { adminKeywordRow, adminPostRow, validateAdminPost } from "./admin-data.mjs";

const validDraft = {
  slug: "new-draft",
  title: "New draft",
  description: "A draft description",
  pubDate: "2026-09-12",
  status: "draft",
  topic: "ai",
  angle: "A clear angle",
  author: "TBD",
  bodyMarkdown: "Draft body",
  metadata: { sourceIds: [] },
};

test("validates and normalizes a draft post", () => {
  const post = validateAdminPost(validDraft);

  assert.equal(post.slug, "new-draft");
  assert.equal(post.status, "draft");
  assert.equal(post.metadata.sourceIds.length, 0);
});

test("requires the publication gates for non-drafts", () => {
  assert.throws(() => validateAdminPost({ ...validDraft, status: "published" }), /testedAt and a real author/);
  assert.throws(() => validateAdminPost({ ...validDraft, status: "scheduled", publishAt: null }), /publishAt/);
});

test("rejects unsafe or malformed post input", () => {
  assert.throws(() => validateAdminPost({ ...validDraft, slug: "../secret" }), /slug/);
  assert.throws(() => validateAdminPost({ ...validDraft, pubDate: "tomorrow" }), /pubDate/);
  assert.throws(() => validateAdminPost({ ...validDraft, bodyMarkdown: "" }), /bodyMarkdown/);
});

test("maps database rows for the admin UI", () => {
  const post = adminPostRow({
    slug: "post",
    title: "Title",
    description: "Description",
    pub_date: "2026-09-12",
    publish_at: null,
    status: "draft",
    topic: "ai",
    angle: "Angle",
    author: "Author",
    body_markdown: "Body",
    payload: { sourceIds: [] },
    updated_at: "2026-09-12T00:00:00.000Z",
  });
  const keyword = adminKeywordRow({
    record_key: "key",
    category: "ai",
    head_keyword: "AI",
    status: "ready-to-write",
    collected_at: "2026-09-12T00:00:00.000Z",
    payload: { head_keyword: "AI" },
  });

  assert.equal(post.bodyMarkdown, "Body");
  assert.equal(keyword.headKeyword, "AI");
});

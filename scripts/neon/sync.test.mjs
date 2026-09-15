import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKeywordRow,
  buildPostRow,
  buildSyncQueries,
  collectSyncRows,
} from "./sync.mjs";

const draft = `---
title: "Neon sync test"
description: "A valid draft for the sync contract."
pubDate: 2026-09-11
status: draft
topic: ai
angle: "Keep the sync payload stable."
author: Tester
sourceIds: []
aiAssisted: false
---

This draft is intentionally small because draft posts are not subject to the public length gate.
`;

test("builds a stable keyword row key without losing the source payload", () => {
  const row = buildKeywordRow({
    category: "ai",
    head_keyword: "AI 키워드",
    collected_at: "2026-09-11T00:00:00.000Z",
    status: "ready-to-write",
    related_keywords: [],
  });

  assert.match(row.recordKey, /^[a-f0-9]{32}$/);
  assert.equal(JSON.parse(row.payload).head_keyword, "AI 키워드");
});

test("converts a Markdown post into a database row", () => {
  const row = buildPostRow("neon-sync-test", draft);

  assert.equal(row.slug, "neon-sync-test");
  assert.equal(row.pubDate, "2026-09-11");
  assert.equal(row.status, "draft");
  assert.equal(JSON.parse(row.payload).topic, "ai");
  assert.match(row.contentHash, /^[a-f0-9]{64}$/);
});

test("builds parameterized upsert queries for keywords and posts", () => {
  const queries = buildSyncQueries(
    [
      {
        recordKey: "key",
        category: "ai",
        headKeyword: "AI",
        status: "ready-to-write",
        collectedAt: "2026-09-11T00:00:00.000Z",
        payload: "{}",
      },
    ],
    [
      {
        slug: "post",
        title: "Title",
        description: "Description",
        pubDate: "2026-09-11",
        publishAt: null,
        status: "draft",
        topic: "ai",
        angle: "Angle",
        author: "Author",
        bodyMarkdown: "Body",
        contentHash: "hash",
        payload: "{}",
      },
    ],
    { query: (text, values) => ({ text, values }) },
  );

  assert.equal(queries.length, 3);
  assert.match(queries[0].text, /ON CONFLICT \(record_key\)/);
  assert.equal(queries[0].values[1], "ai");
  assert.match(queries[1].text, /DELETE FROM keyword_records/);
  assert.deepEqual(queries[1].values[0], ["key"]);
  assert.match(queries[2].text, /ON CONFLICT \(slug\)/);
});

test("tombstoned slugs produce post deletes only when absent from the repo", () => {
  const sql = { query: (text, values) => ({ text, values }) };
  const posts = [
    {
      slug: "kept",
      title: "Title",
      description: "Description",
      pubDate: "2026-09-11",
      publishAt: null,
      status: "draft",
      topic: "ai",
      angle: "Angle",
      author: "Author",
      bodyMarkdown: "Body",
      contentHash: "hash",
      payload: "{}",
    },
  ];

  const queries = buildSyncQueries([], posts, sql, ["gone", "kept"]);
  const deletes = queries.filter((query) =>
    query.text.includes("DELETE FROM posts"),
  );
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].values, ["gone"]);
});

test("collects the checked-in keyword records, Markdown posts, and tombstones", async () => {
  const rows = await collectSyncRows();

  assert.ok(rows.keywordRows.length > 0);
  assert.ok(rows.postRows.every((row) => row.slug.length > 0));
  assert.ok(Array.isArray(rows.tombstones));
});

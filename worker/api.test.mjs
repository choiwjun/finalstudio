import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.mjs";

function databaseStub() {
  return (strings) => {
    const text = strings.join("?");
    if (text.includes("FROM posts")) {
      if (text.includes("slug =")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        {
          slug: "published-post",
          title: "Published post",
          description: "Description",
          pub_date: "2026-09-11",
          publish_at: null,
          status: "published",
          topic: "ai",
          angle: "Angle",
          author: "Author",
          payload: { image: "/images/post.png" },
        },
      ]);
    }
    if (text.includes("FROM keyword_records")) {
      return Promise.resolve([
        {
          record_key: "record-key",
          category: "ai",
          head_keyword: "AI 키워드",
          status: "ready-to-write",
          collected_at: "2026-09-11T00:00:00.000Z",
          payload: { head_keyword: "AI 키워드" },
        },
      ]);
    }
    return Promise.resolve([{ ok: 1 }]);
  };
}

test("lists only published posts from Neon", async () => {
  const worker = createWorker({ connect: () => databaseStub() });
  const response = await worker.fetch(new Request("https://wjblog.example/api/posts?topic=ai&limit=5"), {
    DATABASE_URL: "postgresql://redacted.example/db",
    ASSETS: { fetch: async () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data[0], {
    slug: "published-post",
    title: "Published post",
    description: "Description",
    pubDate: "2026-09-11",
    publishAt: null,
    status: "published",
    topic: "ai",
    angle: "Angle",
    author: "Author",
    metadata: { image: "/images/post.png" },
  });
});

test("lists ready-to-write keywords by fixed category", async () => {
  const worker = createWorker({ connect: () => databaseStub() });
  const response = await worker.fetch(new Request("https://wjblog.example/api/keywords?category=ai"), {
    DATABASE_URL: "postgresql://redacted.example/db",
    ASSETS: { fetch: async () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].headKeyword, "AI 키워드");
});

test("rejects invalid public API filters", async () => {
  const worker = createWorker({ connect: () => databaseStub() });
  const env = { DATABASE_URL: "postgresql://redacted.example/db", ASSETS: { fetch: async () => new Response("asset") } };

  const invalidCategory = await worker.fetch(new Request("https://wjblog.example/api/keywords?category=private"), env);
  const invalidLimit = await worker.fetch(new Request("https://wjblog.example/api/posts?limit=51"), env);

  assert.equal(invalidCategory.status, 400);
  assert.equal(invalidLimit.status, 400);
});

test("does not return draft posts from the public detail route", async () => {
  const worker = createWorker({ connect: () => databaseStub() });
  const response = await worker.fetch(new Request("https://wjblog.example/api/posts/draft-post"), {
    DATABASE_URL: "postgresql://redacted.example/db",
    ASSETS: { fetch: async () => new Response("asset") },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "post_not_found" });
});

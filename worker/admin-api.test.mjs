import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.mjs";

const password = "testpass10";
const env = {
  ADMIN_PASSWORD: password,
  DATABASE_URL: "postgresql://redacted.example/db",
  ASSETS: { fetch: async () => new Response("asset") },
};

function sqlStub(strings) {
  const text = strings.join("?");
  if (text.includes("INSERT INTO posts")) {
    return Promise.resolve([
      {
        slug: "admin-post",
        title: "Admin post",
        description: "Description",
        pub_date: "2026-09-12",
        publish_at: null,
        status: "draft",
        topic: "ai",
        angle: "Angle",
        author: "TBD",
        body_markdown: "Draft body",
        payload: { testedAt: null },
        updated_at: "2026-09-12T00:00:00.000Z",
      },
    ]);
  }
  if (text.includes("DELETE FROM posts"))
    return Promise.resolve([{ slug: "admin-post" }]);
  if (text.includes("FROM posts")) return Promise.resolve([]);
  if (text.includes("FROM keyword_records")) return Promise.resolve([]);
  return Promise.resolve([]);
}

async function login(worker) {
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://wjblog.example",
      },
      body: JSON.stringify({ password }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("requires authentication before returning admin data", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/admin/posts"),
    env,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "authentication_required",
  });
});

test("logs in, lists admin data, and saves a validated draft", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const cookie = await login(worker);
  const list = await worker.fetch(
    new Request("https://wjblog.example/api/admin/posts", {
      headers: { Cookie: cookie },
    }),
    env,
  );
  const save = await worker.fetch(
    new Request("https://wjblog.example/api/admin/posts", {
      method: "PUT",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "https://wjblog.example",
      },
      body: JSON.stringify({
        slug: "admin-post",
        title: "Admin post",
        description: "Description",
        pubDate: "2026-09-12",
        status: "draft",
        topic: "ai",
        angle: "Angle",
        author: "TBD",
        bodyMarkdown: "Draft body",
        metadata: { sourceIds: [] },
      }),
    }),
    env,
  );

  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).data, []);
  assert.equal(save.status, 200);
  assert.equal((await save.json()).data.slug, "admin-post");

  const remove = await worker.fetch(
    new Request("https://wjblog.example/api/admin/posts/admin-post", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://wjblog.example" },
    }),
    env,
  );
  assert.equal(remove.status, 200);
  assert.deepEqual((await remove.json()).data, { slug: "admin-post" });
});

test("rejects cross-origin admin writes and wrong passwords", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const wrong = await worker.fetch(
    new Request("https://wjblog.example/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://wjblog.example",
      },
      body: JSON.stringify({ password: "wrong-password-123456" }),
    }),
    env,
  );
  const crossOrigin = await worker.fetch(
    new Request("https://wjblog.example/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ password }),
    }),
    env,
  );

  assert.equal(wrong.status, 401);
  assert.equal(crossOrigin.status, 403);
});

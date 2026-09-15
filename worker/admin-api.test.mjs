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

test("dispatches a validated one-click draft to GitHub Actions", async () => {
  const worker = createWorker({
    connect: () => async (strings) => {
      const text = strings.join("?");
      if (text.includes("FROM keyword_records")) return [{ record_key: "ai\u0000선택 키워드" }];
      return [];
    },
  });
  const cookie = await login(worker);
  const originalFetch = globalThis.fetch;
  let dispatch;
  globalThis.fetch = async (url, options) => {
    dispatch = { url, options };
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://wjblog.example/api/admin/auto-draft", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://wjblog.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ category: "ai", keyword: "선택 키워드" }),
      }),
      { ...env, GITHUB_TOKEN: "test-token" },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "queued");
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/i);
    assert.match(dispatch.url, /actions\/workflows\/keyword-auto-draft\.yml\/dispatches/);
    assert.deepEqual(JSON.parse(dispatch.options.body), {
      ref: "main",
      inputs: {
        category: "ai",
        keyword: "선택 키워드",
        request_id: payload.requestId,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports invalid GitHub automation configuration separately", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const cookie = await login(worker);
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/admin/auto-draft/status?request_id=123e4567-e89b-42d3-a456-426614174000", { headers: { Cookie: cookie } }),
    { ...env, GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "not-a-repository" },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "automation_configuration_invalid");
});

test("returns a safe status response for a valid request ID", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const cookie = await login(worker);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes("/actions/workflows/keyword-auto-draft.yml/runs?")) {
      return new Response(JSON.stringify({
        workflow_runs: [{
          id: 12345,
          display_title: "Keyword draft 123e4567-e89b-42d3-a456-426614174000 / ai / 선택 키워드",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/choiwjun/finalstudio/actions/runs/12345",
        }],
      }), { status: 200 });
    }
    assert.match(url, /actions\/runs\/12345\/jobs\?/);
    return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://wjblog.example/api/admin/auto-draft/status?request_id=123e4567-e89b-42d3-a456-426614174000", { headers: { Cookie: cookie } }),
      { ...env, GITHUB_TOKEN: "test-token" },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "completed");
    assert.equal(payload.conclusion, "failure");
    assert.equal(payload.requestId, "123e4567-e89b-42d3-a456-426614174000");
    assert.equal(payload.failureReason, "생성 단계 또는 품질 게이트가 실패했습니다.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects control characters and unready keywords before dispatch", async () => {
  const worker = createWorker({ connect: () => sqlStub });
  const cookie = await login(worker);
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/admin/auto-draft", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://wjblog.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ category: "ai", keyword: "not-ready\u0000" }),
    }),
    { ...env, GITHUB_TOKEN: "test-token" },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_keyword_selection");
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

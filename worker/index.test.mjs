import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.mjs";

const assets = {
  fetch: async () => new Response("asset", { status: 200 }),
};

test("returns a safe unavailable response when Neon is not configured", async () => {
  const worker = createWorker({
    connect: () => {
      throw new Error("must not connect");
    },
  });
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/health/db"),
    { ASSETS: assets },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "database_not_configured",
  });
});

test("checks Neon through the serverless driver and does not expose database details", async () => {
  let receivedUrl;
  const worker = createWorker({
    connect: (url) => {
      receivedUrl = url;
      return async () => [{ ok: 1 }];
    },
  });
  const response = await worker.fetch(
    new Request("https://wjblog.example/api/health/db"),
    {
      DATABASE_URL: "postgresql://redacted.example/db",
      ASSETS: assets,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedUrl, "postgresql://redacted.example/db");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "wjblog",
    database: "connected",
  });
});

test("forwards non-API requests to the static asset binding", async () => {
  const worker = createWorker();
  const response = await worker.fetch(new Request("https://wjblog.example/"), {
    ASSETS: assets,
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
});

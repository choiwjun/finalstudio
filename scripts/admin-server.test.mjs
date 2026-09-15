import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createAdminServer } from "./admin-server.mjs";

test("auto-publish endpoint runs one selected draft pipeline without publish", async (t) => {
  const calls = [];
  let resyncs = 0;
  const server = createAdminServer({
    runCommand: async (script, args, timeout) => {
      calls.push({ script, args, timeout });
      return { ok: true, output: `${script} ok` };
    },
    onResync: async () => {
      resyncs += 1;
    },
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/auto-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "ai", keyword: "AI 데이터센터" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      script: "brief.mjs",
      args: ["--category", "ai", "--keyword", "AI 데이터센터"],
      timeout: 120_000,
    },
    {
      script: "auto-publish.mjs",
      args: ["--category", "ai", "--keyword", "AI 데이터센터"],
      timeout: 900_000,
    },
  ]);
  assert.equal(resyncs, 1);
  assert.doesNotMatch(calls[1].args.join(" "), /--publish/u);
});

test("auto-publish endpoint rejects an invalid selection before running commands", async (t) => {
  let calls = 0;
  const server = createAdminServer({
    runCommand: async () => {
      calls += 1;
      return { ok: true, output: "unexpected" };
    },
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/auto-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "ai", keyword: "bad\u0000keyword" }),
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

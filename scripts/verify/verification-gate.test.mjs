import assert from "node:assert/strict";
import { test } from "node:test";
import { runVerification } from "./orchestrator.mjs";

test("failed preflight results in zero executor calls", async () => {
  let executorCalls = 0;
  const record = await runVerification({
    preflight: async () => ({ ok: false, reason: "RESOURCE_BLOCKED" }),
    executor: async () => {
      executorCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(executorCalls, 0);
  assert.equal(record.executorCalls, 0);
  assert.equal(record.executor, null);
});

test("throwing preflight is a veto and results in zero executor calls", async () => {
  let executorCalls = 0;
  const record = await runVerification({
    preflight: async () => {
      throw Error("preflight crashed");
    },
    executor: async () => {
      executorCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(executorCalls, 0);
  assert.equal(record.preflight.ok, false);
  assert.match(record.preflight.error, /preflight crashed/);
});

test("preflight receives no executable verify hook", async () => {
  let received = "unset";
  await runVerification({
    preflight: async (...args) => {
      received = args;
      return { ok: false };
    },
    executor: async () => ({ ok: true }),
  });
  assert.deepEqual(received, []);
});

test("accepted preflight invokes executor exactly once with the judged result as data", async () => {
  let executorCalls = 0;
  let context;
  const preflightResult = { ok: true, checks: [{ name: "memory", ok: true }] };
  const record = await runVerification({
    preflight: async () => preflightResult,
    executor: async (ctx) => {
      executorCalls += 1;
      context = ctx;
      return { ok: true, steps: [] };
    },
  });
  assert.equal(executorCalls, 1);
  assert.equal(record.executorCalls, 1);
  assert.deepEqual(context, { preflight: preflightResult });
  assert.ok(Object.isFrozen(context));
  assert.equal(record.executor.ok, true);
});

test("truthy non-ok preflight verdicts still veto the executor", async () => {
  for (const verdict of [null, undefined, { ok: 0 }, { ok: "no" }]) {
    let executorCalls = 0;
    await runVerification({
      preflight: async () => verdict,
      executor: async () => {
        executorCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(executorCalls, 0, `verdict ${JSON.stringify(verdict)}`);
  }
});

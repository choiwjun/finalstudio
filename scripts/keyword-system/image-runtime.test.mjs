import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeadlineProcess } from "./lib/image-runtime.mjs";
import { runDraftImageTopic } from "./auto-publish.mjs";
test("shared draft deadline exhaustion launches no images", async () => {
  let called = false;
  await assert.rejects(
    runDraftImageTopic({
      draftArgs: [],
      imageOptions: {},
      deadline: Date.now() + 30,
      runDraft: async () => {
        await new Promise((r) => setTimeout(r, 70));
        return { draft: "src/content/posts/article.md" };
      },
      runImages: () => {
        called = true;
      },
    }),
    /deadline/,
  );
  assert.equal(called, false);
});
test("draft and images consume same absolute deadline", async () => {
  const deadline = Date.now() + 10_000;
  let seen;
  await runDraftImageTopic({
    draftArgs: [],
    imageOptions: {},
    deadline,
    runDraft: async (_, options) => {
      seen = options.deadline;
      return { draft: "src/content/posts/article.md" };
    },
    runImages: async (options) => {
      assert.equal(options.deadline, seen);
      assert.equal(seen, deadline);
      return {};
    },
  });
});
test("actual process timeout kills descendant before delayed write, no retries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "image-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "must-not-exist");
  const script = join(root, "parent.mjs");
  await writeFile(
    script,
    `import{spawn}from'node:child_process';spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(target)},'late'),1000);`)}],{stdio:'inherit'});setInterval(()=>{},1000);`,
  );
  await assert.rejects(
    runDeadlineProcess({
      executable: process.execPath,
      args: [script],
      cwd: root,
      deadline: Date.now() + 400,
    }),
    /deadline/,
  );
  await new Promise((r) => setTimeout(r, 1100));
  await assert.rejects(readFile(target), { code: "ENOENT" });
});
test("bounded process success, missing executable, aborted input, and output limit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "image-process-paths-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    cwd: root,
    deadline: Date.now() + 10000,
    executable: process.execPath,
  };
  const result = await runDeadlineProcess({
    ...options,
    args: ["-e", 'console.log("ok");console.error("diagnostic")'],
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok\n");
  assert.ok(result.stderr.includes("diagnostic"));
  await assert.rejects(
    runDeadlineProcess({
      ...options,
      executable: join(root, "absent"),
      args: [],
    }),
    { code: "ENOENT" },
  );
  assert.throws(
    () =>
      runDeadlineProcess({ ...options, args: [], signal: AbortSignal.abort() }),
    /aborted/,
  );
  await assert.rejects(
    runDeadlineProcess({
      ...options,
      args: [
        "-e",
        'setInterval(()=>process.stdout.write("x".repeat(100000)),1)',
      ],
    }),
    /bound/,
  );
});
test("native and judge adapters use isolated sandbox, same deadline and no fallback", async () => {
  const { runImageCodex, runJudgeCodex } = await import(
    "./lib/image-runtime.mjs"
  );
  const deadline = Date.now() + 900000;
  const signal = new AbortController().signal;
  const calls = [];
  const runProcess = async (options) => {
    calls.push(options);
    return { code: 0, stdout: "result" };
  };
  await runImageCodex({
    prompt: "source data",
    path: "/tmp/private/main.png",
    signal,
    deadline,
    runProcess,
  });
  await runJudgeCodex({
    system: "judge only",
    input: "same notes + candidate",
    cwd: "/tmp/private",
    signal,
    deadline,
    runProcess,
  });
  assert.equal(calls[0].deadline, deadline);
  assert.equal(calls[1].deadline, deadline);
  assert.equal(calls[0].signal, signal);
  assert.ok(calls[0].args.includes("workspace-write"));
  assert.ok(calls[1].args.includes("read-only"));
  assert.ok(calls[0].args.at(-1).includes("Native image tool only"));
  await assert.rejects(
    runJudgeCodex({ deadline, runProcess: async () => ({ code: 1 }) }),
    /no retry/,
  );
});

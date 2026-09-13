#!/usr/bin/env node
/**
 * 한 번의 bounded 최신-바이트 검증을 실행하고 전체 로그·기록을 보존한다.
 *
 *   node scripts/verify/run.mjs [--label <name>]
 *
 * 산출물: out/verification-<UTC시각>[-label]/record.json + 단계별 stdout/stderr 로그.
 * rejected/중단된 과거 실행의 저장 계약을 재개하지 않고, 현재 바이트 기준으로 새로 검증한다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runVerification } from "./orchestrator.mjs";
import { runPreflight, preservationSnapshot } from "./preflight.mjs";
import { runExecutor } from "./executor.mjs";

const args = process.argv.slice(2);
const labelIndex = args.indexOf("--label");
const labelValue =
  labelIndex !== -1
    ? (args[labelIndex + 1] ?? "").replace(/[^a-z0-9-]/gi, "")
    : "";
const label = labelValue ? `-${labelValue}` : "";
const root = resolve(process.cwd());
const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
const outDir = join(root, "out", `verification-${stamp}${label}`);
await mkdir(outDir, { recursive: true });

const diff = (before, after) => {
  const changed = [];
  for (const [name, hash] of Object.entries(after.postsSha256))
    if (before.postsSha256[name] !== hash)
      changed.push({ path: `src/content/posts/${name}`, before: before.postsSha256[name] ?? null, after: hash });
  for (const name of Object.keys(before.postsSha256))
    if (!(name in after.postsSha256))
      changed.push({ path: `src/content/posts/${name}`, before: before.postsSha256[name], after: null });
  return {
    postsChanged: changed,
    trackedDiffChanged: before.trackedDiffSha256 !== after.trackedDiffSha256,
    untrackedChanged:
      before.untrackedManifestSha256 !== after.untrackedManifestSha256,
  };
};

let record;
let orchestrationError = null;
try {
  record = await runVerification({
    preflight: () => runPreflight({ root }),
    executor: () => runExecutor({ root, outDir }),
  });
} catch (error) {
  orchestrationError = error instanceof Error ? error.message : String(error);
  record = {
    preflight: { ok: false, error: orchestrationError },
    executorCalls: 0,
    executor: null,
  };
}

let after = null;
let preservation = null;
try {
  after = await preservationSnapshot(root);
  preservation = diff(record.preflight.snapshot ?? { postsSha256: {} }, after);
} catch (error) {
  preservation = { error: error.message };
}

const final = {
  version: 1,
  recordedAt: new Date().toISOString(),
  memoized: false,
  root,
  outDir,
  preflight: record.preflight,
  executorCalls: record.executorCalls,
  executor: record.executor,
  orchestrationError,
  preservationAfter: after,
  preservationDiff: preservation,
  ok: record.preflight?.ok === true && record.executor?.ok === true,
};
await writeFile(join(outDir, "record.json"), JSON.stringify(final, null, 2) + "\n");
process.stdout.write(
  `${final.ok ? "VERIFIED" : "NOT VERIFIED"} — record: ${outDir}/record.json\n`,
);
if (!final.ok) process.exitCode = 1;

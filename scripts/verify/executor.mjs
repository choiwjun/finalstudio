/**
 * 조건부 검증 executor — 수신·판정된 preflight 뒤에만 오케스트레이터가 호출한다.
 * 단계는 순차 실행되고 첫 실패에서 중단한다 (재시도 없음). 전체 로그는 별도 보존한다.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function keywordTestFiles(root) {
  const dir = join(root, "scripts/keyword-system");
  return (await readdir(dir))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `scripts/keyword-system/${name}`);
}

export function buildVerificationSteps(keywordTests) {
  return Object.freeze([
  {
    name: "keywords",
    command: process.execPath,
    args: ["--test", "--test-concurrency=2", ...keywordTests],
  },
  { name: "worker", command: npm, args: ["run", "test:worker"] },
  { name: "neon", command: npm, args: ["run", "test:neon"] },
  { name: "content", command: npm, args: ["run", "check:content"] },
  { name: "prompts", command: npm, args: ["run", "check:prompts"] },
  { name: "neon-sync-check", command: npm, args: ["run", "neon:sync:check"] },
  {
    name: "verification-gate",
    command: process.execPath,
    args: ["--test", "scripts/verify/verification-gate.test.mjs"],
  },
  {
    name: "image-coverage",
    command: process.execPath,
    args: [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-include=scripts/keyword-system/lib/image-*.mjs",
      "--test-coverage-include=scripts/keyword-system/lib/file-lock.mjs",
      "--test-coverage-include=scripts/lib/generated-report.mjs",
      "--test-coverage-include=scripts/lib/markdown-protected-ranges.mjs",
      "--test-coverage-include=scripts/keyword-system/image-backfill.mjs",
      "--test-coverage-lines=80",
      "--test-coverage-branches=80",
      "--test-coverage-functions=80",
      ...keywordTests,
    ],
  },
  { name: "build", command: npm, args: ["run", "build"] },
  { name: "check-build", command: npm, args: ["run", "check:build"] },
  {
    name: "diff-check",
    command: "git",
    args: ["diff", "--check"],
  },
]);
}

function runStep(step, { root, outDir, timeoutMs }) {
  return new Promise((resolveStep) => {
    const started = Date.now();
    const stdoutPath = join(outDir, `${step.name}.stdout.log`);
    const stderrPath = join(outDir, `${step.name}.stderr.log`);
    const stdout = createWriteStream(stdoutPath);
    const stderr = createWriteStream(stderrPath);
    const child = spawn(step.command, step.args, {
      cwd: root,
      shell: false,
      detached: true,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    const finish = (result) => {
      clearTimeout(timer);
      stdout.end();
      stderr.end();
      resolveStep({
        name: step.name,
        durationMs: Date.now() - started,
        stdoutPath,
        stderrPath,
        ...result,
      });
    };
    child.on("error", (error) =>
      finish({ exit: null, error: error.message }),
    );
    child.on("close", (code) => {
      if (timedOut)
        return finish({ exit: null, error: `step timed out after ${timeoutMs}ms` });
      finish({ exit: code });
    });
  });
}

const STEP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const DEFAULT_STEP_TIMEOUT_MS = 600_000;

export async function runExecutor({
  root = process.cwd(),
  outDir,
  steps,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
} = {}) {
  const resolvedRoot = resolve(root);
  if (!outDir) throw Error("executor requires a preserved log directory");
  steps ??= buildVerificationSteps(await keywordTestFiles(resolvedRoot));
  for (const step of steps)
    if (!STEP_NAME_RE.test(step.name))
      throw Error(`invalid verification step name: ${step.name}`);
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const step of steps) {
    const result = await runStep(step, {
      root: resolvedRoot,
      outDir,
      timeoutMs: step.timeoutMs ?? stepTimeoutMs,
    });
    results.push(result);
    if (result.exit !== 0) break;
  }
  return {
    ok: results.length === steps.length && results.every((r) => r.exit === 0),
    steps: results,
  };
}

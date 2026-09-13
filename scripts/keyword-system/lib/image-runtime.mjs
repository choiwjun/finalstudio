import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { buildWriterEnvironment } from "../../auto-publish/writer-env.mjs";
export const IMAGE_DEADLINE_MS = 900_000;
export function checkDeadline(deadline) {
  if (!Number.isFinite(deadline) || Date.now() >= deadline)
    throw Error("image bundle shared deadline exceeded");
}
export async function withinDeadline(task, deadline) {
  checkDeadline(deadline);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("image bundle shared deadline exceeded"));
        }, deadline - Date.now());
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function runImageCodex({
  prompt,
  path,
  signal,
  deadline,
  runProcess = runDeadlineProcess,
}) {
  return runCodex({
    prompt: `$imagegen\n${prompt}\nSave exactly one PNG to ${JSON.stringify(path)}. Do not modify other files. Native image tool only; stop on first failure.`,
    cwd: dirname(path),
    signal,
    deadline,
    runProcess,
    sandbox: "workspace-write",
  });
}
export function runJudgeCodex({
  system,
  input,
  cwd,
  signal,
  deadline,
  runProcess = runDeadlineProcess,
}) {
  return runCodex({
    prompt: `${system}\n\n${input}`,
    cwd,
    signal,
    deadline,
    runProcess,
    sandbox: "read-only",
  });
}
async function runCodex({
  prompt,
  cwd,
  signal,
  deadline,
  sandbox,
  runProcess,
}) {
  const result = await runProcess({
    executable: "codex",
    args: ["exec", "--sandbox", sandbox, "--ephemeral", "--", prompt],
    cwd,
    signal,
    deadline,
  });
  if (result.code !== 0)
    throw Error(`codex ${sandbox} failed (exit ${result.code}); no retry`);
  return result.stdout;
}
// One process group per stage; reserve up to five seconds for termination/reaping.
// Windows is fail-closed until descendant termination is independently supported.
export function runDeadlineProcess({
  executable,
  args,
  cwd,
  signal,
  deadline,
}) {
  checkDeadline(deadline);
  if (process.platform === "win32")
    throw Error(
      "bounded image/draft process requires POSIX process-group cancellation",
    );
  if (signal?.aborted) throw Error("image bundle shared deadline aborted");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...buildWriterEnvironment() },
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    const kill = () => {
      stopped = true;
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGKILL");
      }
    };
    const remaining = deadline - Date.now();
    const grace = Math.min(5000, Math.max(1, Math.floor(remaining / 10)));
    const timer = setTimeout(kill, Math.max(1, remaining - grace));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
    };
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      // A child exiting while its descendants run must not leak a writing process.
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") {
            reject(error);
            return;
          }
        }
      if (stopped || signal?.aborted)
        reject(
          Error(
            "image bundle shared deadline/output bound terminated process group",
          ),
        );
      else resolve({ code, stdout, stderr });
    });
  });
}

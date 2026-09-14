import { execFileSync, spawn } from "node:child_process";
import { buildWriterEnvironment } from "./writer-env.mjs";

// Pluggable model backends. "codex" = ChatGPT OAuth (gpt-5.6-luna etc. via the
// local codex config). "gemini" = Google OAuth via the Antigravity CLI (`agy`)
// — gemini-cli's individual OAuth path was retired by Google, so `agy` is the
// supported Google-OAuth CLI. It requires `agy` installed and one interactive
// sign-in completed; if it is missing the call fails closed with an explicit
// install message rather than silently falling back.

export const WRITER_BACKEND = process.env.WRITER_BACKEND ?? "codex";
export const IMAGE_BACKEND =
  process.env.IMAGE_BACKEND ?? process.env.IMAGE_ENGINE ?? "codex";
// e.g. gemini-3.8-flash-high — `agy models` lists the account's catalog.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash-high";

export function findBinary(name) {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    return (
      execFileSync(lookup, [name], { encoding: "utf8" })
        .split(/\r?\n/)[0]
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function runCli({ executable, args, stdinText, cwd, env }) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: env ?? buildWriterEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", rejectP);
    child.on("close", (code) => {
      if (code === 0) resolveP(out);
      else
        rejectP(
          new Error(
            `${executable} ${args.join(" ")} 실패 (exit ${code})\n${err.slice(-500)}`,
          ),
        );
    });
    child.stdin.on("error", () => {});
    if (stdinText) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

export function assertGeminiCli() {
  const bin = findBinary("agy");
  if (!bin)
    throw new Error(
      "Antigravity CLI(agy)가 없습니다. https://antigravity.google/docs/cli/install/ 로 설치 후 `agy`를 한 번 실행해 Google OAuth 로그인을 완료하세요.",
    );
  return bin;
}

// agy headless mode: -p runs one prompt and exits, --output-format text keeps
// stdout clean, --dangerously-skip-permissions auto-approves tool actions
// (needed when the model must write a file such as a PNG). agy print mode does
// NOT read piped stdin as context, so stdinText is folded into the prompt.
export function geminiCall({ prompt, stdinText, cwd, yolo = false }) {
  const bin = assertGeminiCli();
  const args = ["--output-format", "text", "--print-timeout", "10m"];
  if (GEMINI_MODEL) args.push("--model", GEMINI_MODEL);
  if (yolo) args.push("--dangerously-skip-permissions");
  const combined = stdinText ? `${prompt}\n\n${stdinText}` : prompt;
  args.push("-p", combined);
  return runCli({ executable: bin, args, cwd });
}

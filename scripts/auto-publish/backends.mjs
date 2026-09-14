import { execFileSync, spawn } from "node:child_process";
import { buildWriterEnvironment } from "./writer-env.mjs";

// Pluggable model backends. "codex" = ChatGPT OAuth (gpt-5.6-luna etc. via the
// local codex config). "gemini" = Google OAuth via gemini-cli — requires the
// CLI installed and `gemini` login completed; if it is missing the call fails
// closed with an explicit install message rather than silently falling back.

export const WRITER_BACKEND = process.env.WRITER_BACKEND ?? "codex";
export const IMAGE_BACKEND =
  process.env.IMAGE_BACKEND ?? process.env.IMAGE_ENGINE ?? "codex";
export const GEMINI_MODEL = process.env.GEMINI_MODEL; // e.g. gemini-3-flash

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
  const bin = findBinary("gemini");
  if (!bin)
    throw new Error(
      "gemini CLI가 없습니다. `npm install -g @google/gemini-cli` 후 `gemini`를 한 번 실행해 Google OAuth 로그인을 완료하세요.",
    );
  return bin;
}

// gemini-cli non-interactive mode: -p passes the instruction, piped stdin is
// appended as context, -m selects the model, -y auto-approves tool actions
// (needed when the model must write a file such as a PNG).
export function geminiCall({ prompt, stdinText, cwd, yolo = false }) {
  const bin = assertGeminiCli();
  const args = [];
  if (GEMINI_MODEL) args.push("-m", GEMINI_MODEL);
  if (yolo) args.push("-y");
  args.push("-p", prompt);
  return runCli({ executable: bin, args, stdinText, cwd });
}

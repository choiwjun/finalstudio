import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { main as briefMain } from "./brief.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const SCRIPT_DIR = join(ROOT, "scripts/keyword-system");
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures/naver-api-hub");

function runNode(script, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(SCRIPT_DIR, script), ...args], {
      cwd: ROOT,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) =>
      resolvePromise({ code, signal, stdout, stderr }),
    );
  });
}

test("brief CLI writes manual output and refuses symlink directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-brief-cli-"));
  const out = join(root, "data/keywords");
  const seed = join(root, "one-seed.json");
  await mkdir(out, { recursive: true });
  await writeFile(
    seed,
    JSON.stringify({
      version: 1,
      inputs: [{ category: "ai-it", seeds: ["엑셀 자동화"], title: "엑셀 자동화 방법" }],
    }),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(
    (await runNode("collect.mjs", ["--seed-file", seed, "--out-dir", out, "--fixture", FIXTURE_DIR])).code,
    0,
  );
  assert.equal(
    (await runNode("analyze.mjs", ["--seed-file", seed, "--records", join(out, "records.json"), "--out-dir", out])).code,
    0,
  );

  const briefDir = join(ROOT, "out", `brief-cli-${process.pid}-${Date.now()}`);
  t.after(() => rm(briefDir, { recursive: true, force: true }));
  const generated = await runNode("brief.mjs", [
    "--out-dir",
    out,
    "--brief-dir",
    briefDir,
    "--category",
    "ai-it",
    "--keyword",
    "엑셀 자동화",
  ]);
  assert.equal(generated.code, 0, generated.stderr);
  assert.match(
    await readFile(join(briefDir, "ai-it-엑셀-자동화.md"), "utf8"),
    /사람 검토 필요/u,
  );

  const symlinkDir = join(ROOT, "out", `brief-symlink-${process.pid}-${Date.now()}`);
  await symlink(root, symlinkDir, "dir");
  t.after(() => rm(symlinkDir, { force: true }));
  await assert.rejects(
    () =>
      briefMain([
        "--out-dir",
        out,
        "--brief-dir",
        symlinkDir,
        "--category",
        "ai-it",
        "--keyword",
        "엑셀 자동화",
      ]),
    /symlink|directory|changed/iu,
  );
});

/**
 * Veto 가능한 검증 preflight — 실행 가능한 verify hook 없이 판정만 수행한다.
 * 통과해야만 별도 executor가 조건부로 호출될 수 있다.
 */
import { readFile, lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const run = promisify(execFile);

export const REQUIRED_MEM_KB = 2_097_152;

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

async function git(root, args) {
  const result = await run("git", args, {
    cwd: root,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

/** 실패하지 않는 스냅샷 — before/after 비교용 근거이지 게이트가 아니다. */
export async function preservationSnapshot(root) {
  const postsDir = join(root, "src/content/posts");
  const posts = {};
  for (const name of (await readdir(postsDir)).sort()) {
    if (!name.endsWith(".md")) continue;
    posts[name] = sha256(await readFile(join(postsDir, name)));
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const trackedDiff = sha256(await git(root, ["diff", "HEAD", "--binary"]));
  const untracked = [];
  const listing = await git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  for (const path of listing.split("\n").filter(Boolean).sort()) {
    untracked.push({
      path,
      sha256: sha256(await readFile(join(root, path))),
    });
  }
  return {
    head,
    trackedDiffSha256: trackedDiff,
    postsSha256: posts,
    untracked,
    untrackedManifestSha256: sha256(JSON.stringify(untracked)),
  };
}

async function checkMemory({ requiredMemKb }) {
  const text = await readFile("/proc/meminfo", "utf8");
  const available = Number(text.match(/MemAvailable:\s*(\d+)\s*kB/)?.[1]);
  return {
    name: "memory",
    ok: Number.isInteger(available) && available >= requiredMemKb,
    memAvailableKb: available,
    requiredKb: requiredMemKb,
  };
}

async function checkPlatform() {
  let procFd = false;
  try {
    procFd = (await lstat("/proc/self/fd")).isDirectory();
  } catch {
    procFd = false;
  }
  return {
    name: "platform",
    ok: process.platform !== "win32" && procFd,
    platform: process.platform,
    procSelfFd: procFd,
  };
}

/**
 * Q1 회귀 가드: build fixture가 저장소 node_modules 루트 전체를 symlink해
 * 공유 .astro/.vite 캐시를 노출하는 형태로 되돌아가지 않았는지 정적으로 확인한다.
 */
async function checkFixtureIsolation({ root, fixtureFile }) {
  const path = join(root, fixtureFile);
  const text = await readFile(path, "utf8");
  const linksWholeRoot = /symlink\(\s*(source|join\(source\))\s*,\s*join\(destination\)\s*\)/u.test(
    text,
  );
  const skipsDotEntries = text.includes('entry.name.startsWith(".")');
  const cacheDirs = [".astro", ".vite", ".vite-temp"].map((name) =>
    join(root, "node_modules", name),
  );
  const shared = [];
  for (const dir of cacheDirs) {
    try {
      const info = await lstat(dir);
      shared.push({
        path: dir,
        symlink: info.isSymbolicLink(),
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return {
    name: "fixtureIsolation",
    ok:
      !linksWholeRoot &&
      skipsDotEntries &&
      shared.every((entry) => !entry.symlink),
    linksWholeRoot,
    skipsDotEntries,
    sharedCacheEntries: shared,
    fixtureSha256: sha256(text),
  };
}

export async function runPreflight({
  root = process.cwd(),
  requiredMemKb = REQUIRED_MEM_KB,
  fixtureFile = "scripts/keyword-system/image-build.test.mjs",
} = {}) {
  const resolvedRoot = resolve(root);
  const checks = [
    await checkMemory({ requiredMemKb }),
    await checkPlatform(),
    await checkFixtureIsolation({ root: resolvedRoot, fixtureFile }),
  ];
  const snapshot = await preservationSnapshot(resolvedRoot);
  return {
    ok: checks.every((check) => check.ok),
    checks,
    snapshot,
  };
}

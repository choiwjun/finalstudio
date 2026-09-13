#!/usr/bin/env node
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateImageBundle,
  inspectImageBundle,
} from "./lib/image-bundle.mjs";
import { imageRoles } from "./lib/image-plan.mjs";
import { containedPath, readBounded } from "./lib/image-storage.mjs";
import { IMAGE_DEADLINE_MS } from "./lib/image-runtime.mjs";

export function parseImageBackfillArgs(argv = []) {
  let result = { dryRun: false, subCount: 2 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      result = { ...result, dryRun: true };
      continue;
    }
    if (!["--approved", "--sub-count"].includes(flag))
      throw Error(`unknown image-backfill argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw Error(`${flag} requires a value`);
    result = {
      ...result,
      ...(flag === "--approved"
        ? { approved: value }
        : { subCount: Number(value) }),
    };
  }
  if (!result.approved)
    throw Error("--approved explicit post list is required");
  imageRoles(result.subCount);
  return Object.freeze(result);
}
async function readApprovedList(root, path) {
  const approved = containedPath(root, path);
  if (!relative(root, approved).startsWith("out/keyword-recovery/"))
    throw Error("approved list must be in out/keyword-recovery");
  const value = JSON.parse((await readBounded(approved)).toString("utf8"));
  if (
    !Array.isArray(value.posts) ||
    value.posts.length < 1 ||
    value.posts.length > 15
  )
    throw Error("approved list must contain 1–15 explicit posts");
  const posts = value.posts.map((entry) => {
    if (
      !entry ||
      Object.keys(entry).some(
        (key) =>
          !["path", "sha256", "notesPath", "notesSha256", "format"].includes(
            key,
          ),
      ) ||
      !/^src\/content\/posts\/[a-z0-9][a-z0-9-]{0,100}\.md$/u.test(
        entry.path ?? "",
      ) ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")
    )
      throw Error("invalid approved path/hash entry");
    if (Boolean(entry.notesPath) !== Boolean(entry.notesSha256))
      throw Error("notesPath and notesSha256 must be supplied together");
    return Object.freeze({ ...entry });
  });
  if (new Set(posts.map((entry) => entry.path)).size !== posts.length)
    throw Error("duplicate approved post");
  return Object.freeze(posts);
}
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseImageBackfillArgs(argv);
  const root = resolve(dependencies.root ?? process.cwd());
  const posts = await readApprovedList(root, args.approved);
  const results = [];
  for (const entry of posts) {
    const options = {
      root,
      postPath: resolve(root, entry.path),
      slug: basename(entry.path, ".md"),
      expectedHash: entry.sha256,
      notesPath: entry.notesPath,
      notesSha256: entry.notesSha256,
      format: entry.format,
      subCount: args.subCount,
      deadline: Date.now() + IMAGE_DEADLINE_MS,
      runImage: dependencies.runImage,
      runJudge: dependencies.runJudge,
    };
    try {
      results.push(
        await (args.dryRun ? inspectImageBundle : generateImageBundle)(options),
      );
    } catch (error) {
      throw Error(
        `image backfill stopped at ${entry.path}; ${results.length} earlier draft bundle(s) retained: ${error.message}`,
        { cause: error },
      );
    }
  }
  return { ...args, results };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main()
    .then((result) =>
      process.stdout.write(
        `${result.dryRun ? "Dry-run verified" : "Installed"} ${result.results.length} draft image bundle(s). No publication or keyword transitions.\n`,
      ),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

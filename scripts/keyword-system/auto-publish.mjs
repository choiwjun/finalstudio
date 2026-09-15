#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReadyToWriteExport } from "./lib/records-store.mjs";
import { assertContainedPath } from "./lib/draft-bridge.mjs";
import { parseFrontmatter, validatePost } from "../lib/content-contract.mjs";
import { detectContentRisks } from "../lib/content-risk.mjs";
import { imageRoles as bundleRoles } from "./lib/image-plan.mjs";
import {
  IMAGE_DEADLINE_MS,
  checkDeadline,
  withinDeadline,
  runDeadlineProcess,
} from "./lib/image-runtime.mjs";
import {
  buildPersonaBatchDraftArgs,
  buildPersonaBatchPlan,
} from "./persona-batch.mjs";
import {
  generateImageBundle,
  validateImageBundle,
} from "./lib/image-bundle.mjs";
import {
  openVerifiedDirectory,
  readFileAtDirectory,
  removeFileAtDirectory,
  writeStableTextAtDirectory,
} from "./lib/file-lock.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = resolve(ROOT, "data/keywords");
const BRIEF_DIR = resolve(ROOT, "out/keyword-briefs");
const OUTPUT_DIR = resolve(ROOT, "out/keyword-autopublish");
const DEFAULT_POLICY = resolve(
  ROOT,
  "scripts/keyword-system/automation-policy.json",
);

export class AutoPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutoPublishError";
    this.code = "KEYWORD_AUTO_PUBLISH";
  }
}

const fail = (message) => {
  throw new AutoPublishError(message);
};
const clean = (value) =>
  String(value ?? "")
    .replace(/[\r\n]/gu, " ")
    .trim();

export function parseAutoPublishArgs(argv = []) {
  const result = {
    dryRun: false,
    publish: false,
    limitPerCategory: Number.MAX_SAFE_INTEGER,
    category: undefined,
    headKeyword: undefined,
    policyPath: DEFAULT_POLICY,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (flag === "--publish") {
      result.publish = true;
      continue;
    }
    if (flag === "--all") {
      result.limitPerCategory = Number.MAX_SAFE_INTEGER;
      continue;
    }
    if (flag === "--category" || flag === "--keyword") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--"))
        fail(`${flag} requires a value`);
      if (flag === "--category" && !["ai", "travel", "economy-business"].includes(value))
        fail("--category must be ai, travel, or economy-business");
      if (flag === "--category") result.category = value;
      else result.headKeyword = value;
      index += 1;
      continue;
    }
    if (flag === "--limit-per-category" || flag === "--policy") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--")) {
        fail(`${flag} requires a value`);
      }
      if (flag === "--policy") {
        result.policyPath = resolve(value);
      } else {
        result.limitPerCategory = Number(value);
        if (
          !Number.isInteger(result.limitPerCategory) ||
          result.limitPerCategory < 1
        ) {
          fail("--limit-per-category must be a positive integer");
        }
      }
      index += 1;
      continue;
    }
    fail(`unknown argument ${JSON.stringify(flag)}`);
  }
  if (result.dryRun && result.publish)
    fail("--dry-run and --publish cannot be combined");
  if (result.headKeyword !== undefined && result.category === undefined)
    fail("--keyword requires --category");
  if (result.category !== undefined && result.headKeyword === undefined)
    fail("--category requires --keyword");
  return result;
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail(`${label} could not be read`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function loadPolicy(path) {
  const policyRoot = resolve(ROOT, "scripts/keyword-system");
  const containedPath = assertContainedPath(
    policyRoot,
    path,
    "automation policy",
  );
  const parent = await openVerifiedDirectory(dirname(containedPath), {
    create: false,
  });
  let text;
  try {
    text = await readFileAtDirectory(parent, basename(containedPath), "utf8");
  } catch (error) {
    if (error instanceof AutoPublishError) throw error;
    fail("automation policy could not be read");
  } finally {
    await parent.close().catch(() => {});
  }
  let policy;
  try {
    policy = JSON.parse(text);
  } catch {
    fail("automation policy is not valid JSON");
  }
  if (
    policy?.schema_version !== 1 ||
    policy.kind !== "keyword-automation-policy" ||
    policy.enabled !== true ||
    policy.allow_writer !== true ||
    policy.allow_publish !== true ||
    typeof policy.id !== "string" ||
    typeof policy.persona !== "string" ||
    typeof policy.reason !== "string" ||
    policy.reason.trim() === "" ||
    policy.publish?.requires_deploy_hook !== true ||
    policy.publish?.requires_complete_image_bundle !== true ||
    policy.publish?.requires_content_check !== true
  ) {
    fail("automation policy is invalid or disabled");
  }
  if (policy.images?.main !== 1 || ![2, 3].includes(policy.images?.sub)) {
    fail(
      "automation policy must require one main image and two or three sub-images",
    );
  }
  return Object.freeze({
    ...policy,
    path: containedPath,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}

async function loadPersona() {
  const manifest = await readJson(
    join(ROOT, ".editorial/manifest.json"),
    "editorial manifest",
  );
  const personaName = manifest.defaultPersona;
  const personaPath = resolve(
    ROOT,
    manifest.modules?.personas?.[personaName] ?? "",
  );
  const persona = await readJson(personaPath, "editorial persona");
  return { name: personaName, ...persona };
}

async function writeManifest(manifest) {
  const directory = await openVerifiedDirectory(OUTPUT_DIR, { create: true });
  try {
    await writeStableTextAtDirectory(
      directory,
      "latest.json",
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await directory.close().catch(() => {});
  }
}

function postPathFromResult(result) {
  const path = resolve(ROOT, result.draft);
  if (!path.startsWith(`${resolve(ROOT, "src/content/posts")}/`))
    fail("writer returned a post outside the posts directory");
  return path;
}

async function readVerifiedPost(postPath) {
  const directory = await openVerifiedDirectory(dirname(postPath), {
    create: false,
  });
  try {
    return await readFileAtDirectory(directory, basename(postPath), "utf8");
  } finally {
    await directory.close().catch(() => {});
  }
}

export async function preparePublishedPost(
  postPath,
  author,
  imageBundle,
  { root = ROOT } = {},
) {
  const text = await readVerifiedPost(postPath);
  try {
    await validateImageBundle(imageBundle, {
      root,
      postPath,
      postText: text,
    });
  } catch (error) {
    return {
      postPath,
      published: false,
      blocked: [error instanceof Error ? error.message : String(error)],
    };
  }
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) fail(`post is missing frontmatter: ${postPath}`);
  const risks = detectContentRisks(text);
  if (risks.length > 0) {
    return {
      postPath,
      published: false,
      blocked: risks.map((risk) => risk.label),
    };
  }
  const withMetadata = parseFrontmatter(frontmatter.set("author", author))?.set(
    "testedAt",
    new Date().toISOString(),
  );
  const withStatus = parseFrontmatter(withMetadata)?.set("status", "published");
  const errors = validatePost(postPath, withStatus);
  if (errors.length > 0) return { postPath, published: false, blocked: errors };
  return { postPath, published: true, text: withStatus };
}

async function writePublishedPosts(posts) {
  for (const post of posts) {
    const directory = await openVerifiedDirectory(dirname(post.postPath), {
      create: false,
    });
    try {
      await writeStableTextAtDirectory(
        directory,
        basename(post.postPath),
        post.text,
      );
    } finally {
      await directory.close().catch(() => {});
    }
  }
}

async function git(args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: ROOT,
      shell: false,
      maxBuffer: 2_000_000,
    });
    return result.stdout;
  } catch (error) {
    fail(
      `git ${args[0]} failed: ${error?.stderr?.trim() || error?.message || "unknown error"}`,
    );
  }
}

async function commitAndPush(paths, runId) {
  const stagedOutput = await git(["diff", "--cached", "--name-only"]);
  const staged = stagedOutput.trim();
  if (staged !== "")
    fail("refusing auto-publish while unrelated staged changes exist");
  const relativePaths = paths.map((path) =>
    relative(ROOT, path).replaceAll("\\", "/"),
  );
  await git(["add", "--", ...relativePaths]);
  const allowed = new Set(relativePaths);
  const stagedAfterOutput = await git(["diff", "--cached", "--name-only"]);
  const stagedAfter = stagedAfterOutput.split(/\r?\n/u).filter(Boolean);
  if (stagedAfter.some((path) => !allowed.has(path))) {
    fail("auto-publish staged a path outside the generated bundle");
  }
  const stagedIndex = await git([
    "ls-files",
    "--stage",
    "--",
    ...relativePaths,
  ]);
  if (stagedIndex.split(/\r?\n/u).some((line) => line.startsWith("120000 "))) {
    fail("auto-publish refuses symlink entries in the generated bundle");
  }
  await git(["commit", "-m", `feat: publish keyword batch ${runId}`]);
  try {
    await git(["push", "origin", "HEAD"]);
  } catch (error) {
    error.committed = true;
    throw error;
  }
}

async function assertPublishPreflight() {
  if (clean(process.env.DEPLOY_HOOK_URL) === "") {
    fail("DEPLOY_HOOK_URL is required for automatic publishing");
  }
  try {
    const result = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      {
        cwd: ROOT,
        shell: false,
        maxBuffer: 2_000_000,
      },
    );
    if (result.stdout.trim() !== "")
      fail("refusing auto-publish unless the worktree is clean");
  } catch (error) {
    if (error instanceof AutoPublishError) throw error;
    fail(
      `git preflight failed: ${error?.stderr?.trim() || error?.message || "unknown error"}`,
    );
  }
}

async function captureTextSnapshot(path) {
  try {
    return { exists: true, text: await readFile(path, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function rememberGeneratedPath(state, path) {
  if (state.generated.has(path)) return;
  const info = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  const bytes =
    info?.isFile() && info.size === 0 ? await readFile(path) : undefined;
  state.generated.set(path, {
    existed: info !== undefined,
    bytes,
  });
}

async function removeGeneratedPath(path) {
  const directory = await openVerifiedDirectory(dirname(path), {
    create: false,
  });
  try {
    await removeFileAtDirectory(directory, basename(path));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  } finally {
    await directory.close().catch(() => {});
  }
}

async function restoreTextSnapshot(path, snapshot) {
  const directory = await openVerifiedDirectory(dirname(path), {
    create: true,
  });
  try {
    if (snapshot.exists) {
      await writeStableTextAtDirectory(
        directory,
        basename(path),
        snapshot.text,
      );
    } else {
      await removeFileAtDirectory(directory, basename(path)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  } finally {
    await directory.close().catch(() => {});
  }
}

async function restoreBinarySnapshot(path, bytes) {
  const directory = await openVerifiedDirectory(dirname(path), {
    create: false,
  });
  try {
    await writeStableTextAtDirectory(directory, basename(path), bytes);
  } finally {
    await directory.close().catch(() => {});
  }
}

async function rollbackRun(state) {
  const errors = [];
  for (const [path, snapshot] of state.generated.entries()) {
    if (!snapshot.existed) {
      await removeGeneratedPath(path).catch((error) => errors.push(error));
    } else if (snapshot.bytes !== undefined) {
      await restoreBinarySnapshot(path, snapshot.bytes).catch((error) =>
        errors.push(error),
      );
    }
  }
  for (const [path, snapshot] of state.data.entries()) {
    await restoreTextSnapshot(path, snapshot).catch((error) =>
      errors.push(error),
    );
  }
  if (errors.length > 0) {
    fail(
      `automatic publish rollback failed: ${errors[0]?.message ?? "unknown error"}`,
    );
  }
}

async function assertOnlyGeneratedPaths(paths) {
  const allowed = new Set(
    paths.map((path) => relative(ROOT, path).replaceAll("\\", "/")),
  );
  const status = await git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const unexpected = status
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1))
    .filter((path) => !allowed.has(path));
  if (unexpected.length > 0) {
    const error = new AutoPublishError(
      `auto-publish changed unexpected paths: ${unexpected.join(", ")}`,
    );
    error.unexpectedPaths = unexpected;
    throw error;
  }
}

async function rollbackUnexpectedPaths(paths = []) {
  for (const relativePath of paths) {
    const path = assertContainedPath(
      ROOT,
      resolve(ROOT, relativePath),
      "unexpected path",
    );
    await git(["reset", "--", relativePath]);
    try {
      await git(["ls-files", "--error-unmatch", "--", relativePath]);
      await git(["restore", "--worktree", "--", relativePath]);
    } catch (error) {
      if (
        error instanceof AutoPublishError &&
        error.message.includes("git ls-files")
      ) {
        await removeGeneratedPath(path);
      } else {
        throw error;
      }
    }
  }
}

async function resetGeneratedIndex(paths) {
  const relativePaths = paths.map((path) =>
    relative(ROOT, path).replaceAll("\\", "/"),
  );
  await git(["reset", "--", ...relativePaths]);
}

async function triggerDeployHook() {
  const hook = clean(process.env.DEPLOY_HOOK_URL);
  if (hook === "") fail("DEPLOY_HOOK_URL is required for automatic publishing");
  const response = await fetch(hook, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`deploy hook failed with HTTP ${response.status}`);
}

async function runDraftProcess(draftArgs, { deadline, signal }) {
  const result = await runDeadlineProcess({
    executable: process.execPath,
    args: [resolve(ROOT, "scripts/keyword-system/draft.mjs"), ...draftArgs],
    cwd: ROOT,
    deadline,
    signal,
  });
  if (result.code !== 0)
    throw Error(
      `draft process failed (exit ${result.code}); no retries; stderr: ${String(result.stderr ?? "").slice(-800)}`,
    );
  const matches = [
    ...result.stdout.matchAll(
      /^created draft (src\/content\/posts\/[a-z0-9-]+\.md) for /gm,
    ),
  ];
  if (matches.length !== 1)
    throw Error("draft process did not return exactly one saved draft");
  return { draft: matches[0][1], status: "written" };
}
export async function runDraftImageTopic({
  draftArgs,
  imageOptions,
  deadline = Date.now() + IMAGE_DEADLINE_MS,
  runDraft = runDraftProcess,
  runImages = generateImageBundle,
}) {
  const draft = await withinDeadline(
    (signal) => runDraft(draftArgs, { deadline, signal }),
    deadline,
  );
  checkDeadline(deadline);
  const postPath = postPathFromResult(draft);
  const imageBundle = await runImages({
    ...imageOptions,
    root: ROOT,
    postPath,
    slug: basename(postPath, ".md"),
    deadline,
  });
  return { draft, imageBundle, postPath };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseAutoPublishArgs(argv);
  const policy = await loadPolicy(args.policyPath);
  if (args.publish) await assertPublishPreflight();
  const persona = dependencies.persona ?? (await loadPersona());
  const records = await readReadyToWriteExport({
    path: resolve(DATA_DIR, "ready-to-write.json"),
    recordsPath: resolve(DATA_DIR, "records.json"),
  });
  const discovery = await readJson(
    resolve(DATA_DIR, "automatic-discovery.json"),
    "automatic discovery",
  );
  if (args.headKeyword !== undefined && args.category === undefined)
    fail("--keyword requires --category");
  if (args.category !== undefined && args.headKeyword === undefined)
    fail("--category requires --keyword for one-click generation");
  const plan = await buildPersonaBatchPlan({
    readyRecords: records,
    discovery,
    repositoryRoot: ROOT,
    briefDir: dependencies.briefDir ?? BRIEF_DIR,
    persona,
    limitPerCategory: args.limitPerCategory,
    category: args.category,
    headKeyword: args.headKeyword,
  });
  const automationPlan = plan.map((entry) =>
    Object.freeze({
      ...entry,
      reviewer: `automation:${policy.persona}`,
      reason: policy.reason,
      approval_mode: "automation-policy",
      policy_id: policy.id,
      policy_path: relative(ROOT, policy.path).replaceAll("\\", "/"),
      policy_sha256: policy.sha256,
    }),
  );
  const runId = new Date().toISOString().replace(/[:.]/gu, "-");
  let mode = "draft-with-images";
  if (args.dryRun) mode = "dry-run";
  else if (args.publish) mode = "auto-publish";
  const manifest = {
    schema_version: 1,
    run_id: runId,
    mode,
    policy_id: policy.id,
    policy_path: relative(ROOT, policy.path).replaceAll("\\", "/"),
    policy_sha256: policy.sha256,
    candidates: automationPlan,
  };
  if (args.dryRun) {
    await writeManifest(manifest);
    process.stdout.write(
      `planned ${automationPlan.length} article bundle(s); no writer, image generator, or publisher was called\n`,
    );
    return { ...args, manifest, results: [] };
  }

  const runDraft = dependencies.runDraft ?? runDraftProcess;
  const runImages = dependencies.runImages ?? generateImageBundle;
  const dataPaths = [
    resolve(DATA_DIR, "records.json"),
    resolve(DATA_DIR, "ready-to-write.json"),
    resolve(DATA_DIR, "decisions.jsonl"),
  ];
  const state = { data: new Map(), generated: new Map() };
  for (const path of dataPaths) {
    state.data.set(path, await captureTextSnapshot(path));
  }
  const imageRoles = bundleRoles(policy.images.sub);
  const results = [];
  for (const entry of automationPlan) {
    const deadline = Date.now() + IMAGE_DEADLINE_MS;
    try {
      const { draft, imageBundle, postPath } = await runDraftImageTopic({
        deadline,
        draftArgs: buildPersonaBatchDraftArgs(entry, {
          records: resolve(DATA_DIR, "records.json"),
          ready: resolve(DATA_DIR, "ready-to-write.json"),
          decisions: resolve(DATA_DIR, "decisions.jsonl"),
          automationPolicy: args.policyPath,
          automationPolicySha256: policy.sha256,
        }),
        imageOptions: {
          imageRoles,
          notesPath: entry.briefPath,
          notesSha256: entry.briefSha256,
        },
        runDraft,
        runImages: async (options) => {
          state.generated.set(options.postPath, { existed: false });
          for (const role of imageRoles)
            await rememberGeneratedPath(
              state,
              join(ROOT, "public/images", `${options.slug}-${role}.png`),
            );
          return runImages(options);
        },
      });
      results.push({ ...entry, draft, imageBundle, postPath });
    } catch (error) {
      results.push({
        ...entry,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    if (args.publish) await rollbackRun(state);
    await writeManifest({
      ...manifest,
      results,
      rolled_back: args.publish,
      text_drafts_retained: !args.publish,
    });
    fail(
      `article generation failed for ${failures.length} candidate(s); nothing was published`,
    );
  }

  if (!args.publish) {
    await writeManifest({ ...manifest, results });
    process.stdout.write(
      `created ${results.length} article bundle(s) with images; publication was not requested\n`,
    );
    return { ...args, manifest, results };
  }

  const prepared = [];
  for (const result of results) {
    const candidate = await preparePublishedPost(
      result.postPath,
      "WJ Blog",
      result.imageBundle,
      { root: ROOT },
    );
    if (!candidate.published) {
      await rollbackRun(state);
      await writeManifest({
        ...manifest,
        results,
        blocked: candidate,
        rolled_back: true,
      });
      fail(
        `publication blocked for ${result.head_keyword}: ${candidate.blocked.join(", ")}`,
      );
    }
    prepared.push(candidate);
  }
  try {
    await writePublishedPosts(prepared);
  } catch (error) {
    await rollbackRun(state);
    throw error;
  }
  const generatedPaths = [
    ...prepared.map((post) => post.postPath),
    ...results.flatMap((result) =>
      result.imageBundle.images.map((image) => image.path),
    ),
    resolve(DATA_DIR, "records.json"),
    resolve(DATA_DIR, "ready-to-write.json"),
    resolve(DATA_DIR, "decisions.jsonl"),
  ];
  try {
    await assertOnlyGeneratedPaths(generatedPaths);
  } catch (error) {
    await rollbackRun(state);
    await rollbackUnexpectedPaths(error.unexpectedPaths);
    await writeManifest({
      ...manifest,
      results,
      rolled_back: true,
      error: error.message,
    });
    throw error;
  }
  try {
    await commitAndPush(generatedPaths, runId);
  } catch (error) {
    if (!error.committed) {
      await resetGeneratedIndex(generatedPaths);
      await rollbackRun(state);
    }
    await writeManifest({
      ...manifest,
      results,
      published: prepared.map((post) => post.postPath),
      publication_status: error.committed
        ? "commit-created-push-failed"
        : "rolled-back",
      error: error.message,
    });
    throw error;
  }
  const committedManifest = {
    ...manifest,
    results,
    published: prepared.map((post) => post.postPath),
    publication_status: "committed",
  };
  await writeManifest(committedManifest);
  try {
    await triggerDeployHook();
  } catch (error) {
    await writeManifest({
      ...committedManifest,
      publication_status: "deploy-hook-failed",
      error: error.message,
    });
    throw error;
  }
  await writeManifest({ ...committedManifest, publication_status: "deployed" });
  process.stdout.write(
    `published ${prepared.length} article bundle(s) with images\n`,
  );
  return { ...args, manifest, results, published: prepared };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `keyword auto-publish failed (${error?.code ?? "KEYWORD_AUTO_PUBLISH"}): ${error?.message ?? "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}

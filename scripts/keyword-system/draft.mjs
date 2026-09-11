#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  readReadyToWriteExport,
  upsertRecords,
  writeReadyToWriteExport,
} from "./lib/records-store.mjs";
import { transitionStatus } from "./lib/analysis.mjs";
import {
  openVerifiedDirectory,
  openVerifiedFileAtDirectory,
  readFileAtDirectory,
  writeStableTextAtDirectory,
} from "./lib/file-lock.mjs";
import {
  assertContainedPath,
  buildAutoWriteArgs,
  buildWriterReference,
  parseDraftPath,
  requireHumanApproval,
  requireHumanAuthoredAngle,
  requireReviewedBriefHash,
} from "./lib/draft-bridge.mjs";
import { normalizeKeywordBrief, renderKeywordBrief } from "./lib/briefs.mjs";
import { buildWriterEnvironment } from "../auto-publish/writer-env.mjs";

export { buildWriterEnvironment } from "../auto-publish/writer-env.mjs";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export class DraftCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "DraftCliError";
    this.code = "KEYWORD_DRAFT_CLI";
  }
}

const fail = (message) => {
  throw new DraftCliError(message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function valueFor(argv, index, name) {
  const value = argv[index + 1];
  if (typeof value !== "string" || value === "" || value.startsWith("--"))
    fail(`${name} requires a value`);
  return value;
}

export function parseDraftArgs(
  argv = process.argv.slice(2),
  root = REPOSITORY_ROOT,
) {
  const keywordDir = resolve(root, "data/keywords");
  const result = {
    brief: undefined,
    outDir: keywordDir,
    records: resolve(keywordDir, "records.json"),
    ready: resolve(keywordDir, "ready-to-write.json"),
    decisions: resolve(keywordDir, "decisions.jsonl"),
    format: "how-to",
    approved: false,
    reviewer: undefined,
    reason: undefined,
    angle: undefined,
    briefSha256: undefined,
  };
  const valueOptions = new Map([
    ["--brief", "brief"],
    ["--out-dir", "outDir"],
    ["--records", "records"],
    ["--ready", "ready"],
    ["--decisions", "decisions"],
    ["--format", "format"],
    ["--reviewer", "reviewer"],
    ["--reason", "reason"],
    ["--angle", "angle"],
    ["--brief-sha256", "briefSha256"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--approve") {
      result.approved = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) fail(`unknown argument ${JSON.stringify(argument)}`);
    const value = valueFor(argv, index, argument);
    if (["format", "reviewer", "reason", "briefSha256"].includes(key)) {
      result[key] = value;
    } else {
      result[key] = isAbsolute(value) ? resolve(value) : resolve(root, value);
    }
    index += 1;
  }
  if (result.brief === undefined)
    fail("--brief <generated brief JSON> is required");
  if (result.brief.endsWith(".md"))
    fail("--brief must point to the generated .json brief, not Markdown");
  if (result.outDir !== keywordDir) {
    if (!argv.includes("--records"))
      result.records = join(result.outDir, "records.json");
    if (!argv.includes("--ready"))
      result.ready = join(result.outDir, "ready-to-write.json");
    if (!argv.includes("--decisions"))
      result.decisions = join(result.outDir, "decisions.jsonl");
  }
  return result;
}

async function readTextAt(root, target, label) {
  const filePath = assertContainedPath(root, target, label);
  const parent = await openVerifiedDirectory(dirname(filePath), {
    create: false,
  });
  try {
    return await readFileAtDirectory(parent, basename(filePath), "utf8");
  } catch {
    fail(`${label} is not readable`);
  } finally {
    await parent.close().catch(() => {});
  }
}

export function runAutoWriter({ cwd, scriptPath, args }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: buildWriterEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      resolvePromise({ code: 1, stdout, stderr: error.message }),
    );
    child.on("close", (code, signal) =>
      resolvePromise({ code: code ?? 1, signal, stdout, stderr }),
    );
  });
}

async function readDraftFile(draftPath) {
  const parent = await openVerifiedDirectory(dirname(draftPath), {
    create: false,
  });
  try {
    const text = await readFileAtDirectory(parent, basename(draftPath), "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
    if (!/^status:\s*draft\s*$/mu.test(frontmatter))
      fail("writer output is not a status: draft article");
    return text;
  } catch (error) {
    if (error instanceof DraftCliError) throw error;
    fail("writer did not create a readable draft file");
  } finally {
    await parent.close().catch(() => {});
  }
}

async function assertDraftTargetAvailable(directoryHandle, fileName) {
  try {
    const existing = await openVerifiedFileAtDirectory(
      directoryHandle,
      fileName,
    );
    await existing.handle.close().catch(() => {});
    fail(`draft target already exists: ${fileName}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const root = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
  const args = parseDraftArgs(argv, root);
  const approval = requireHumanApproval(args);
  const humanAngle = requireHumanAuthoredAngle(args.angle);
  const keywordRoot = resolve(root, "data/keywords");
  const outDir = assertContainedPath(keywordRoot, args.outDir, "--out-dir");
  const dataHandle = await openVerifiedDirectory(outDir, { create: false });
  await dataHandle.close().catch(() => {});
  const recordsPath = assertContainedPath(outDir, args.records, "--records");
  const readyPath = assertContainedPath(outDir, args.ready, "--ready");
  const decisionsPath = assertContainedPath(outDir, args.decisions, "--decisions");
  const briefRoot = resolve(root, "out/keyword-briefs");
  const briefPath = assertContainedPath(briefRoot, args.brief, "brief");
  const briefText = await readTextAt(briefRoot, briefPath, "brief JSON");
  let briefValue;
  try {
    briefValue = JSON.parse(briefText);
  } catch {
    fail("brief JSON is not valid JSON");
  }
  const briefHash = createHash("sha256").update(briefText).digest("hex");
  requireReviewedBriefHash(args.briefSha256, briefHash);
  const brief = normalizeKeywordBrief(briefValue);
  const markdownPath = `${briefPath.slice(0, -5)}.md`;
  await readTextAt(briefRoot, markdownPath, "brief Markdown");
  const ready = await readReadyToWriteExport({
    path: readyPath,
    recordsPath,
  });
  const record = ready.find(
    (item) =>
      item.category === brief.category &&
      item.head_keyword === brief.head_keyword,
  );
  if (!record) fail("brief does not match a ready-to-write record");
  const stagingRoot = resolve(root, "out");
  const stagingParent = await openVerifiedDirectory(stagingRoot, { create: true });
  await stagingParent.close().catch(() => {});
  const stagingDir = await mkdtemp(join(stagingRoot, ".keyword-draft-"));
  const reviewedNotes = renderKeywordBrief(brief);
  const reviewedNotesPath = join(stagingDir, ".reviewed-brief.md");
  const approvalArtifactPath = join(stagingDir, ".keyword-approval.json");
  const reviewedNotesSha256 = createHash("sha256").update(reviewedNotes).digest("hex");
  const approvalArtifact = {
    schema_version: 1,
    kind: "keyword-draft-bridge-approval",
    approved: true,
    brief_sha256: briefHash,
    notes_sha256: reviewedNotesSha256,
    reviewer: approval.reviewer,
    reason: approval.reason,
    human_angle: humanAngle,
    nonce: randomBytes(32).toString("hex"),
  };
  const stagingHandle = await openVerifiedDirectory(stagingDir, { create: false });
  try {
    await writeStableTextAtDirectory(stagingHandle, ".reviewed-brief.md", reviewedNotes);
    await writeStableTextAtDirectory(stagingHandle, ".keyword-approval.json", `${JSON.stringify(approvalArtifact)}\n`);
  } finally {
    await stagingHandle.close().catch(() => {});
  }
  const writerArgs = buildAutoWriteArgs(brief, {
    notesPath: reviewedNotesPath,
    outputDir: stagingDir,
    format: args.format,
    humanAngle,
    briefSha256: briefHash,
    approvalArtifact: approvalArtifactPath,
  });
  const writer = dependencies.runWriter ?? runAutoWriter;
  try {
    const writerResult = await writer({
      cwd: root,
      scriptPath: resolve(root, "scripts/auto-publish/auto-write.mjs"),
      args: writerArgs,
    });
    if (!isObject(writerResult) || writerResult.code !== 0)
      fail(
        `writer failed before draft handoff (${writerResult?.stderr?.slice(-500) ?? "unknown error"})`,
      );
    const stagedPath = parseDraftPath(writerResult.stdout, {
      repositoryRoot: root,
      postsRoot: stagingDir,
    });
    const draftText = await readDraftFile(stagedPath);
    const fileName = basename(stagedPath);
    const postsRoot = resolve(root, "src/content/posts");
    const postsHandle = await openVerifiedDirectory(postsRoot, { create: false });
    try {
      await assertDraftTargetAvailable(postsHandle, fileName);
      await writeStableTextAtDirectory(postsHandle, fileName, draftText);
    } finally {
      await postsHandle.close().catch(() => {});
    }
    const draftPath = resolve(postsRoot, fileName);
    const reference = buildWriterReference(root, draftPath);
    const event = {
      type: "writer_handoff",
      reference,
      reason: `brief approved by ${approval.reviewer}: ${approval.reason}; angle=${humanAngle}; brief_sha256=${briefHash}; brief=${relative(root, briefPath).replaceAll("\\", "/")}`,
    };
    const writtenRecord = transitionStatus(record, event);
    const records = await upsertRecords([writtenRecord], {
      path: recordsPath,
      decisionsPath,
      event,
    });
    await writeReadyToWriteExport(records, {
      path: readyPath,
      recordsPath,
    });
    const result = {
      category: brief.category,
      head_keyword: brief.head_keyword,
      draft: reference,
      status: writtenRecord.status,
    };
    process.stdout.write(
      `created draft ${reference} for ${brief.head_keyword}; publication remains human-approved\n`,
    );
    return result;
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `keyword draft generation failed (${error?.code ?? "KEYWORD_DRAFT_CLI"})\n`,
    );
    process.exitCode = 1;
  });
}

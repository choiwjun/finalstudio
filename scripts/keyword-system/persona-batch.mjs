#!/usr/bin/env node
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReadyToWriteExport } from "./lib/records-store.mjs";
import { slugifySafeKey } from "./lib/evidence-store.mjs";
import { normalizeKeywordBrief } from "./lib/briefs.mjs";
import {
  buildPersonaBatchApproval,
  selectPersonaBatchCandidates,
} from "./lib/persona-batch.mjs";
import { main as draftMain } from "./draft.mjs";
import { assertContainedPath } from "./lib/draft-bridge.mjs";
import {
  openVerifiedDirectory,
  readFileAtDirectory,
  writeStableTextAtDirectory,
} from "./lib/file-lock.mjs";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export class PersonaBatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "PersonaBatchError";
    this.code = "KEYWORD_PERSONA_BATCH";
  }
}

const fail = (message) => {
  throw new PersonaBatchError(message);
};
const clean = (value) =>
  String(value ?? "")
    .replace(/[\r\n]/gu, " ")
    .trim();
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    fail(`${label} must be a positive integer`);
  return parsed;
}

export function parsePersonaBatchArgs(
  argv = [],
  repositoryRoot = REPOSITORY_ROOT,
) {
  const root = resolve(repositoryRoot);
  const dataDir = resolve(root, "data/keywords");
  const result = {
    repositoryRoot: root,
    dataDir,
    ready: join(dataDir, "ready-to-write.json"),
    records: join(dataDir, "records.json"),
    decisions: join(dataDir, "decisions.jsonl"),
    discovery: join(dataDir, "automatic-discovery.json"),
    briefDir: resolve(root, "out/keyword-briefs"),
    batchDir: resolve(root, "out/keyword-batch"),
    limitPerCategory: Number.MAX_SAFE_INTEGER,
    dryRun: false,
    batchApproved: false,
    reviewer: undefined,
    reason: undefined,
    angle: undefined,
  };
  const supplied = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (flag === "--all") {
      result.limitPerCategory = Number.MAX_SAFE_INTEGER;
      continue;
    }
    if (flag === "--approve-batch") {
      result.batchApproved = true;
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) {
      fail(`${flag} requires a value`);
    }
    const textFlags = new Map([
      ["--reviewer", "reviewer"],
      ["--reason", "reason"],
      ["--angle", "angle"],
    ]);
    if (textFlags.has(flag)) {
      result[textFlags.get(flag)] = value;
      index += 1;
      continue;
    }
    const pathFlags = new Map([
      ["--data-dir", "dataDir"],
      ["--ready", "ready"],
      ["--records", "records"],
      ["--decisions", "decisions"],
      ["--discovery", "discovery"],
      ["--brief-dir", "briefDir"],
      ["--batch-dir", "batchDir"],
    ]);
    if (pathFlags.has(flag)) {
      const key = pathFlags.get(flag);
      result[key] = resolve(value);
      supplied.add(key);
    } else if (flag === "--limit-per-category") {
      result.limitPerCategory = parsePositiveInteger(value, flag);
    } else {
      fail(`unknown argument ${JSON.stringify(flag)}`);
    }
    index += 1;
  }
  if (
    result.batchApproved &&
    [result.reviewer, result.reason, result.angle].some(
      (value) => clean(value) === "",
    )
  ) {
    fail("--approve-batch requires --reviewer, --reason, and --angle");
  }
  if (supplied.has("dataDir")) {
    if (!supplied.has("ready"))
      result.ready = join(result.dataDir, "ready-to-write.json");
    if (!supplied.has("records"))
      result.records = join(result.dataDir, "records.json");
    if (!supplied.has("decisions"))
      result.decisions = join(result.dataDir, "decisions.jsonl");
    if (!supplied.has("discovery"))
      result.discovery = join(result.dataDir, "automatic-discovery.json");
  }
  return result;
}

async function readContainedText(root, path, label, optional = false) {
  const containedPath = assertContainedPath(root, path, label);
  const parent = await openVerifiedDirectory(dirname(containedPath), {
    create: false,
  });
  try {
    return await readFileAtDirectory(parent, basename(containedPath), "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return undefined;
    fail(`${label} could not be read`);
  } finally {
    await parent.close().catch(() => {});
  }
}

async function readJson(root, path, label) {
  const text = await readContainedText(root, path, label);
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function readOptionalJson(root, path, label) {
  const text = await readContainedText(root, path, label, true);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function loadPersona(repositoryRoot) {
  const manifest = await readJson(
    repositoryRoot,
    join(repositoryRoot, ".editorial/manifest.json"),
    "editorial manifest",
  );
  if (!isObject(manifest) || typeof manifest.defaultPersona !== "string") {
    fail("editorial manifest persona configuration is invalid");
  }
  const personaPath = resolve(
    repositoryRoot,
    manifest.modules?.personas?.[manifest.defaultPersona] ?? "",
  );
  const persona = await readJson(
    repositoryRoot,
    personaPath,
    "editorial persona",
  );
  return { name: manifest.defaultPersona, ...persona };
}

function briefPathFor(briefDir, record) {
  return join(
    briefDir,
    `${record.category}-${slugifySafeKey(record.head_keyword)}.json`,
  );
}

function draftSlugFor(record) {
  const key = `${record.category}\u0000${record.head_keyword}`;
  const suffix = createHash("sha256").update(key).digest("hex").slice(0, 10);
  return `${record.category}-${suffix}`;
}

export async function buildPersonaBatchPlan({
  readyRecords,
  discovery,
  repositoryRoot,
  briefDir,
  persona,
  batchApproval,
  limitPerCategory = Number.MAX_SAFE_INTEGER,
}) {
  const selected = selectPersonaBatchCandidates(readyRecords, discovery, {
    limitPerCategory,
  });
  const plan = [];
  for (const record of selected) {
    const path = briefPathFor(briefDir, record);
    let text;
    try {
      text = await readContainedText(
        repositoryRoot,
        path,
        `brief for ${record.category}/${record.head_keyword}`,
      );
    } catch {
      fail(`brief is missing for ${record.category}/${record.head_keyword}`);
    }
    let brief;
    try {
      brief = normalizeKeywordBrief(JSON.parse(text));
    } catch {
      fail(`brief is invalid for ${record.category}/${record.head_keyword}`);
    }
    if (
      brief.category !== record.category ||
      brief.head_keyword !== record.head_keyword
    ) {
      fail(`brief does not match ${record.category}/${record.head_keyword}`);
    }
    const approval = buildPersonaBatchApproval({
      brief,
      persona,
      batchApproval,
    });
    plan.push(
      Object.freeze({
        category: record.category,
        head_keyword: record.head_keyword,
        slug: draftSlugFor(record),
        briefPath: path,
        briefSha256: createHash("sha256").update(text).digest("hex"),
        ...approval,
      }),
    );
  }
  if (plan.length === 0)
    fail("no ready-to-write candidate is available for the persona batch");
  return Object.freeze(plan);
}

function buildApprovalArgs(entry, args) {
  if (!args.automationPolicy) {
    return [
      "--approve",
      "--reviewer",
      entry.reviewer,
      "--reason",
      entry.reason,
    ];
  }
  if (!args.automationPolicySha256) {
    return ["--automation-policy", args.automationPolicy];
  }
  return [
    "--automation-policy",
    args.automationPolicy,
    "--automation-policy-sha256",
    args.automationPolicySha256,
  ];
}

export function buildPersonaBatchDraftArgs(entry, args) {
  const approvalArgs = buildApprovalArgs(entry, args);
  return [
    "--brief",
    entry.briefPath,
    "--records",
    args.records,
    "--ready",
    args.ready,
    "--decisions",
    args.decisions,
    ...approvalArgs,
    "--angle",
    entry.angle,
    "--slug",
    entry.slug,
    "--format",
    entry.format,
    "--brief-sha256",
    entry.briefSha256,
  ];
}

async function writeBatchManifest(repositoryRoot, path, manifest) {
  const containedPath = assertContainedPath(
    repositoryRoot,
    path,
    "batch manifest",
  );
  const parent = await openVerifiedDirectory(dirname(containedPath), {
    create: true,
  });
  try {
    await writeStableTextAtDirectory(
      parent,
      basename(containedPath),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await parent.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parsePersonaBatchArgs(
    argv,
    dependencies.repositoryRoot ?? REPOSITORY_ROOT,
  );
  const dataRoot = resolve(args.repositoryRoot, "data/keywords");
  const readyPath = assertContainedPath(dataRoot, args.ready, "ready export");
  const recordsPath = assertContainedPath(dataRoot, args.records, "records");
  const decisionsPath = assertContainedPath(
    dataRoot,
    args.decisions,
    "decisions",
  );
  const discoveryPath = assertContainedPath(
    args.repositoryRoot,
    args.discovery,
    "automatic discovery",
  );
  const briefDir = assertContainedPath(
    resolve(args.repositoryRoot, "out"),
    args.briefDir,
    "brief directory",
  );
  const batchDir = assertContainedPath(
    resolve(args.repositoryRoot, "out"),
    args.batchDir,
    "batch directory",
  );
  const readyRecords = await readReadyToWriteExport({
    path: readyPath,
    recordsPath,
  });
  const discovery = await readOptionalJson(
    args.repositoryRoot,
    discoveryPath,
    "automatic discovery",
  );
  const persona =
    dependencies.persona ?? (await loadPersona(args.repositoryRoot));
  const plan = await buildPersonaBatchPlan({
    readyRecords,
    discovery,
    repositoryRoot: args.repositoryRoot,
    briefDir,
    persona,
    batchApproval: args.batchApproved
      ? {
          reviewer: args.reviewer,
          reason: args.reason,
          angle: args.angle,
        }
      : undefined,
    limitPerCategory: args.limitPerCategory,
  });
  const manifestPath = join(batchDir, "latest.json");
  const manifest = {
    schema_version: 1,
    persona: persona.name,
    mode: args.dryRun ? "dry-run" : "draft-only",
    created_at: new Date().toISOString(),
    candidates: plan,
  };
  if (!args.dryRun && !args.batchApproved) {
    fail(
      "writer requires batch approval; run --dry-run first, then pass --approve-batch with one reviewer, reason, and angle",
    );
  }
  if (args.dryRun) {
    await writeBatchManifest(args.repositoryRoot, manifestPath, manifest);
    process.stdout.write(
      `persona batch planned ${plan.length} draft(s); no writer was called\n`,
    );
    return { ...args, manifestPath, plan, results: [] };
  }

  const runDraft =
    dependencies.runDraft ??
    ((draftArgs) =>
      draftMain(draftArgs, { repositoryRoot: args.repositoryRoot }));
  const results = [];
  for (const entry of plan) {
    try {
      const result = await runDraft(
        buildPersonaBatchDraftArgs(entry, {
          ...args,
          ready: readyPath,
          records: recordsPath,
          decisions: decisionsPath,
        }),
      );
      results.push({ ...entry, result });
    } catch (error) {
      results.push({
        ...entry,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const completedManifest = { ...manifest, results };
  await writeBatchManifest(
    args.repositoryRoot,
    manifestPath,
    completedManifest,
  );
  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    fail(`persona batch completed with ${failures.length} failed draft(s)`);
  }
  process.stdout.write(
    `persona batch created ${results.length} draft(s); publication remains human-approved\n`,
  );
  return { ...args, manifestPath, plan, results };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `persona batch failed (${error?.code ?? "KEYWORD_PERSONA_BATCH"})\n`,
    );
    process.exitCode = 1;
  });
}

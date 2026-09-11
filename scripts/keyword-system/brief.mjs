import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { readReadyToWriteExport } from "./lib/records-store.mjs";
import { isCanonicalRunId, slugifySafeKey } from "./lib/evidence-store.mjs";
import {
  openVerifiedDirectory,
  readFileAtDirectory,
  writeStableTextAtDirectory,
} from "./lib/file-lock.mjs";
import { buildKeywordBrief, renderKeywordBrief } from "./lib/briefs.mjs";
import { assertSafeOutputDir } from "./lib/output-boundary.mjs";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_OUT_DIR = resolve(REPOSITORY_ROOT, "data/keywords");
const DEFAULT_BRIEF_DIR = resolve(REPOSITORY_ROOT, "out/keyword-briefs");

export class BriefCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "BriefCliError";
    this.code = "BRIEF_CLI";
  }
}

const fail = (message) => {
  throw new BriefCliError(message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseBriefArgs(argv = []) {
  const result = {
    outDir: DEFAULT_OUT_DIR,
    raw: resolve(DEFAULT_OUT_DIR, "raw"),
    records: resolve(DEFAULT_OUT_DIR, "records.json"),
    ready: resolve(DEFAULT_OUT_DIR, "ready-to-write.json"),
    collection: resolve(DEFAULT_OUT_DIR, "collection.json"),
    briefDir: DEFAULT_BRIEF_DIR,
    category: undefined,
    keyword: undefined,
  };
  const supplied = new Set();
  const aliases = new Map([
    ["--out-dir", "outDir"],
    ["--raw", "raw"],
    ["--records", "records"],
    ["--ready", "ready"],
    ["--collection", "collection"],
    ["--brief-dir", "briefDir"],
    ["--category", "category"],
    ["--keyword", "keyword"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = aliases.get(argv[index]);
    if (!key) fail(`unknown argument ${JSON.stringify(argv[index])}`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--"))
      fail(`${argv[index]} requires a value`);
    result[key] = ["category", "keyword"].includes(key)
      ? value
      : resolve(value);
    supplied.add(key);
    index += 1;
  }
  if (supplied.has("outDir")) {
    if (!supplied.has("raw")) result.raw = join(result.outDir, "raw");
    if (!supplied.has("records"))
      result.records = join(result.outDir, "records.json");
    if (!supplied.has("ready"))
      result.ready = join(result.outDir, "ready-to-write.json");
    if (!supplied.has("collection"))
      result.collection = join(result.outDir, "collection.json");
  }
  return result;
}

function ensureContained(root, target, label) {
  const suffix = relative(resolve(root), resolve(target));
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
    fail(`${label} must remain inside its root`);
  return resolve(target);
}

async function readJsonAt(root, target, label) {
  const filePath = ensureContained(root, target, label);
  const parent = await openVerifiedDirectory(dirname(filePath), {
    create: false,
  });
  try {
    let parsed;
    try {
      parsed = JSON.parse(
        await readFileAtDirectory(parent, basename(filePath), "utf8"),
      );
    } catch {
      fail(`${label} is not valid JSON or could not be read`);
    }
    return parsed;
  } finally {
    await parent.close().catch(() => {});
  }
}

export function normalizeManifestEvidencePath(value) {
  if (typeof value !== "string" || value === "")
    fail("evidence path must be a string");
  return value.replaceAll("\\", "/");
}

async function loadEvidence(manifest, rawRoot, record) {
  if (
    !isObject(manifest) ||
    !isCanonicalRunId(manifest.run_id) ||
    typeof manifest.collected_at !== "string"
  )
    fail("collection manifest metadata is invalid");
  const mapping = manifest.candidates?.find(
    (entry) =>
      entry?.candidate?.category === record.category &&
      entry?.candidate?.head_keyword === record.head_keyword,
  );
  if (!mapping || !Array.isArray(mapping.evidence))
    fail(
      `collection manifest has no evidence mapping for ${record.category}/${record.head_keyword}`,
    );
  const envelopes = [];
  for (const evidence of mapping.evidence) {
    if (evidence.outcome !== "success" || typeof evidence.path !== "string")
      continue;
    if (
      evidence.run_id !== manifest.run_id ||
      evidence.collected_at !== manifest.collected_at
    )
      fail("evidence metadata does not match the collection manifest");
    const normalizedPath = normalizeManifestEvidencePath(evidence.path);
    const marker = "data/keywords/";
    if (!normalizedPath.startsWith(marker))
      fail("evidence path must use the data/keywords mapping");
    const path = ensureContained(
      rawRoot,
      resolve(dirname(rawRoot), normalizedPath.slice(marker.length)),
      "evidence path",
    );
    envelopes.push({
      envelope: await readJsonAt(rawRoot, path, "raw evidence"),
      runId: evidence.run_id,
      path,
    });
  }
  return envelopes;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseBriefArgs(argv);
  await assertSafeOutputDir(args.outDir);
  const ready = await readReadyToWriteExport({
    path: args.ready,
    recordsPath: args.records,
  });
  const selected = ready.filter(
    (record) =>
      (!args.category || record.category === args.category) &&
      (!args.keyword || record.head_keyword === args.keyword),
  );
  if (selected.length === 0) fail("no matching ready-to-write record");
  const manifest = await readJsonAt(
    args.outDir,
    args.collection,
    "collection manifest",
  );
  const briefDir = ensureContained(
    resolve(REPOSITORY_ROOT, "out"),
    args.briefDir,
    "brief directory",
  );
  const outputHandle = await openVerifiedDirectory(briefDir, { create: true });
  const written = [];
  try {
    for (const record of selected) {
      const brief = buildKeywordBrief(
        record,
        await loadEvidence(manifest, args.raw, record),
        { runId: manifest.run_id },
      );
      const name = `${record.category}-${slugifySafeKey(record.head_keyword)}`;
      const fileName = `${name}.md`;
      await writeStableTextAtDirectory(
        outputHandle,
        fileName,
        renderKeywordBrief(brief),
      );
      written.push({
        category: record.category,
        head_keyword: record.head_keyword,
        path: relative(REPOSITORY_ROOT, resolve(briefDir, fileName)).replaceAll(
          "\\",
          "/",
        ),
      });
    }
    await writeStableTextAtDirectory(
      outputHandle,
      "index.json",
      `${JSON.stringify(written, null, 2)}\n`,
    );
  } finally {
    await outputHandle.close().catch(() => {});
  }
  console.log(
    `created ${written.length} manual keyword brief(s) under ${relative(REPOSITORY_ROOT, briefDir).replaceAll("\\", "/")}`,
  );
  return { ...args, written };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    const code = error?.code ?? "BRIEF_CLI";
    console.error(`keyword brief generation failed (${code})`);
    process.exitCode = 1;
  });
}

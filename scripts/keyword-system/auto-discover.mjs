import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  main as collectMain,
  createFixtureFetch,
  writeBoundedJson,
} from "./collect.mjs";
import { createNaverApiHubProvider } from "./lib/naver-api-hub-provider.mjs";
import {
  AUTO_CATEGORY_QUERIES,
  buildAutomaticSeedDocument,
  extractTopicCandidates,
} from "./lib/auto-discovery.mjs";
import {
  assertContainedPath,
  assertSafeOutputDir,
} from "./lib/output-boundary.mjs";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_OUT_DIR = resolve(REPOSITORY_ROOT, "data/keywords");
const DEFAULT_MAX_CANDIDATES = 5;

export class AutoDiscoverCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutoDiscoverCliError";
    this.code = "AUTO_DISCOVER_CLI";
  }
}

function fail(message) {
  throw new AutoDiscoverCliError(message);
}

function parsePositiveInteger(value, flag, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
    fail(`${flag} must be an integer from 1 to ${maximum}`);
  return parsed;
}

/** Parse automatic topic discovery flags without accepting arbitrary input queries. */
export function parseArgs(argv = []) {
  const result = {
    outDir: DEFAULT_OUT_DIR,
    fixture: undefined,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    dryRun: false,
  };
  const takesValue = new Set(["--out-dir", "--fixture", "--max-candidates"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (!takesValue.has(flag)) fail(`unknown argument ${JSON.stringify(flag)}`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--"))
      fail(`${flag} requires a value`);
    index += 1;
    if (flag === "--out-dir") result.outDir = resolve(value);
    if (flag === "--fixture") result.fixture = resolve(value);
    if (flag === "--max-candidates")
      result.maxCandidates = parsePositiveInteger(value, flag, 20);
  }
  return result;
}

function hashDiscoveryResponse(response) {
  return createHash("sha256")
    .update(JSON.stringify(response))
    .digest("hex");
}

function providerFor(args) {
  const providerEnv = args.fixture
    ? {
        NCP_NAVER_API_HUB_CLIENT_ID: "fixture-client",
        NCP_NAVER_API_HUB_CLIENT_SECRET: "fixture-secret",
      }
    : process.env;
  return args.fixture
    ? createNaverApiHubProvider({
        fetchImpl: createFixtureFetch(args.fixture),
        env: providerEnv,
      })
    : createNaverApiHubProvider({ env: providerEnv });
}

async function discoverFromNaver(args) {
  const provider = providerFor(args);
  const groups = [];
  const manifestGroups = [];
  for (const categoryQuery of AUTO_CATEGORY_QUERIES) {
    const response = await provider.searchBlogs({
      query: categoryQuery.query,
      display: 100,
      start: 1,
      sort: "date",
      format: "json",
    });
    if (response && typeof response.kind === "string") {
      fail(
        `NAVER topic discovery failed for ${categoryQuery.category}: ${response.message ?? response.kind}`,
      );
    }
    const discoveryResponseSha256 = hashDiscoveryResponse(response);
    const topics = extractTopicCandidates(
      { ...categoryQuery, response },
      { limit: args.maxCandidates },
    ).map((topic) => ({ ...topic, discovery_response_sha256: discoveryResponseSha256 }));
    if (topics.length === 0)
      fail(
        `NAVER returned no usable topic candidates for ${categoryQuery.category}`,
      );
    groups.push({ category: categoryQuery.category, topics });
    manifestGroups.push({
      category: categoryQuery.category,
      query: categoryQuery.query,
      result_count: Number.isInteger(response.total)
        ? response.total
        : response.items.length,
      candidates: topics,
      discovery_response_sha256: discoveryResponseSha256,
      response,
      source: {
        provider: "naver-api-hub",
        endpoint: "/search/v1/blog",
        method: "GET",
      },
      result_sample: response.items.slice(0, 10).map((item) => ({
        title: item.title,
        postdate: item.postdate,
      })),
    });
  }
  return { groups, manifestGroups };
}

/** Discover topics from official NAVER blog evidence, then collect canonical evidence for each candidate. */
export async function main(
  argv = process.argv.slice(2),
  { clock = () => new Date() } = {},
) {
  const args = parseArgs(argv);
  await assertSafeOutputDir(args.outDir);
  if (args.dryRun) {
    const categories = AUTO_CATEGORY_QUERIES.map((item) => ({ ...item }));
    console.log(
      `planned automatic topic discovery for ${categories.length} NAVER category query(ies); no network call or file write`,
    );
    return { ...args, categories, candidates: [], collection: null };
  }

  const discovered = await discoverFromNaver(args);
  const seedDocument = buildAutomaticSeedDocument(discovered.groups);
  const seedPath = await assertContainedPath(
    resolve(args.outDir, "automatic-seeds.json"),
    args.outDir,
  );
  const manifestPath = await assertContainedPath(
    resolve(args.outDir, "automatic-discovery.json"),
    args.outDir,
  );
  const generatedAt = clock().toISOString();
  await writeBoundedJson(seedPath, seedDocument);
  await writeBoundedJson(manifestPath, {
    schema_version: 1,
    generated_at: generatedAt,
    selection: "automatic-from-naver-blog-results",
    ranking_note:
      "discovery_score is an internal extraction rank, not search volume, popularity, traffic, or revenue",
    categories: discovered.manifestGroups,
  });

  const collectArgs = ["--seed-file", seedPath, "--out-dir", args.outDir];
  if (args.fixture) collectArgs.push("--fixture", args.fixture);
  const collection = await collectMain(collectArgs);
  const candidateCount = seedDocument.inputs.length;
  console.log(
    `automatically discovered ${candidateCount} topic candidate(s); canonical evidence collection completed`,
  );
  return { ...args, seedPath, manifestPath, seedDocument, collection };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(
      `automatic topic discovery failed (${error?.code ?? "AUTO_DISCOVER_CLI"})`,
    );
    process.exitCode = 1;
  });
}

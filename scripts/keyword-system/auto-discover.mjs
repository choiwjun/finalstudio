import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  main as collectMain,
  createFixtureFetch,
  writeBoundedJson,
} from "./collect.mjs";
import { main as analyzeMain } from "./analyze.mjs";
import { createNaverApiHubProvider } from "./lib/naver-api-hub-provider.mjs";
import { normalizeKeywordKey } from "./lib/contracts.mjs";
import {
  AUTO_CATEGORY_QUERIES,
  buildAutomaticSeedDocument,
  collectPhraseStats,
  relatedPhrasesForTopic,
  topicCandidatesFromStats,
} from "./lib/auto-discovery.mjs";
import {
  extractTopicsWithModel,
  triageTopicsWithModel,
} from "./lib/model-extraction.mjs";
import {
  MODEL_REVIEW_DEADLINE_MS,
  runModelJsonCodex,
} from "./lib/model-review.mjs";
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
    extractor: undefined,
  };
  const takesValue = new Set([
    "--out-dir",
    "--fixture",
    "--max-candidates",
    "--extractor",
  ]);
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
    if (flag === "--extractor") {
      if (!["model", "ngram"].includes(value))
        fail("--extractor must be model or ngram");
      result.extractor = value;
    }
  }
  // Fixture runs must stay hermetic — no model calls. Real runs default to the
  // model extractor; ngram remains available as an explicit fallback.
  result.extractor = result.extractor ?? (result.fixture ? "ngram" : "model");
  return result;
}

function hashDiscoveryResponse(response) {
  return createHash("sha256").update(JSON.stringify(response)).digest("hex");
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

async function discoverFromNaver(args, { runModel = runModelJsonCodex } = {}) {
  const provider = providerFor(args);
  const deadline = Date.now() + MODEL_REVIEW_DEADLINE_MS;
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
    let relatedTopics;
    let extraction;
    if (args.extractor === "model") {
      // The model proposes topics and may only narrow them in triage; code
      // enforces verbatim-in-corpus on every term and keeps the final metric
      // gates as the sole promotion path.
      const extracted = await extractTopicsWithModel({
        category: categoryQuery.category,
        query: categoryQuery.query,
        items: response.items,
        maxTopics: args.maxCandidates,
        runModel,
        cwd: REPOSITORY_ROOT,
        deadline,
      });
      const triaged = await triageTopicsWithModel({
        category: categoryQuery.category,
        topics: extracted.topics,
        runModel,
        cwd: REPOSITORY_ROOT,
        deadline,
      });
      relatedTopics = triaged.kept.map((topic) => ({
        topic: topic.topic,
        search_intent: topic.intent || undefined,
        content_angle: topic.angle,
        related_keywords: topic.related_keywords,
        extraction_rationale: topic.rationale,
        discovery_response_sha256: discoveryResponseSha256,
      }));
      extraction = {
        extractor: "model",
        model: extracted.provenance.model,
        extraction_input_sha256: extracted.provenance.input_sha256,
        extraction_raw_sha256: extracted.provenance.raw_sha256,
        over_cap_dropped: extracted.overCap,
        triage_rejected: triaged.rejected,
        triage_merged: triaged.merged,
      };
    } else {
      // One phrase-stat scan feeds both topic ranking and per-topic related
      // keywords: related terms are phrases that co-occur with the topic inside
      // the same NAVER results, not sibling head topics.
      const stats = collectPhraseStats(categoryQuery.query, response);
      const topics = topicCandidatesFromStats(stats, {
        ...categoryQuery,
        limit: args.maxCandidates,
      });
      const headKeys = new Set(
        topics.map((topic) => normalizeKeywordKey(topic.topic)),
      );
      relatedTopics = topics.map((topic) => ({
        ...topic,
        related_keywords: relatedPhrasesForTopic(stats, topic.topic, {
          excludeKeys: headKeys,
          limit: 5,
        }),
        discovery_response_sha256: discoveryResponseSha256,
      }));
      extraction = { extractor: "ngram" };
      if (topics.length === 0)
        fail(
          `NAVER returned no usable topic candidates for ${categoryQuery.category}`,
        );
    }
    groups.push({ category: categoryQuery.category, topics: relatedTopics });
    manifestGroups.push({
      category: categoryQuery.category,
      query: categoryQuery.query,
      result_count: Number.isInteger(response.total)
        ? response.total
        : response.items.length,
      candidates: relatedTopics,
      discovery_response_sha256: discoveryResponseSha256,
      extraction,
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
  // A model extractor may legitimately find no valid topics in a category;
  // empty groups are kept in the manifest for review but cannot seed evidence
  // collection.
  const seedGroups = discovered.groups.filter(
    (group) => group.topics.length > 0,
  );
  if (seedGroups.length === 0)
    fail("no usable topic candidates from any category");
  const seedDocument = buildAutomaticSeedDocument(seedGroups);
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
    extractor: args.extractor,
    ranking_note:
      "discovery_score is an internal extraction rank, not search volume, popularity, traffic, or revenue",
    categories: discovered.manifestGroups,
  });

  const collectArgs = ["--seed-file", seedPath, "--out-dir", args.outDir];
  if (args.fixture) collectArgs.push("--fixture", args.fixture);
  const collection = await collectMain(collectArgs);

  // Collection alone only marks candidates "researching" — the automatic run
  // must also analyze the fresh evidence so ready-to-write.json is repopulated
  // and the write queue is actually fed. Analysis failures propagate (the run
  // is fail-closed, matching collect's own contract).
  const analysis = await analyzeMain(["--out-dir", args.outDir]);

  const candidateCount = seedDocument.inputs.length;
  const readyCount = analysis.analysed.filter(
    (record) => record.status === "ready-to-write",
  ).length;
  console.log(
    `automatically discovered ${candidateCount} topic candidate(s); canonical evidence collected and analyzed, ${readyCount} ready-to-write`,
  );
  return {
    ...args,
    seedPath,
    manifestPath,
    seedDocument,
    collection,
    analysis,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(
      `automatic topic discovery failed (${error?.code ?? "AUTO_DISCOVER_CLI"}): ${error?.message ?? error}`,
    );
    process.exitCode = 1;
  });
}

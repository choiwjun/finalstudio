import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeRawEvidenceEnvelope } from "./contracts.mjs";
import {
  directoryFdPath,
  openVerifiedDirectory,
  openVerifiedNestedDirectory,
} from "./file-lock.mjs";

export const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DEFAULT_SAFE_KEY = "keyword";
const MAX_SAFE_KEY_LENGTH = 120;

// Representative HTTP status used when a failure has no transport-level status.
const KIND_STATUS = Object.freeze({
  network_error: 0,
  auth_missing: 401,
  forbidden: 403,
  rate_limited: 429,
  validation_error: 400,
  trend_error: 400,
  search_error: 400,
  gateway_error: 502,
  server_error: 500,
  malformed_json: 502,
  malformed_response: 502,
  api_error: 502,
});

export class EvidenceStoreError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "EvidenceStoreError";
    this.code = "EVIDENCE_STORE";
  }
}

const fail = (message) => {
  throw new EvidenceStoreError(message);
};

export function isCanonicalRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) return false;
  const timestamp = `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(9, 11)}:${runId.slice(11, 13)}:${runId.slice(13, 15)}Z`;
  return isRealUtcDateTime(timestamp);
}

function assertRunId(runId) {
  if (!isCanonicalRunId(runId)) {
    fail(
      `runId must match a canonical UTC timestamp and lowercase hex suffix; received ${JSON.stringify(runId)}`,
    );
  }
  return runId;
}

/** Resolve the raw evidence root; defaults to <cwd>/data/keywords/raw. */
export function resolveRawRoot(rootDir) {
  return rootDir === undefined || rootDir === null
    ? resolve(process.cwd(), "data", "keywords", "raw")
    : resolve(rootDir);
}

/**
 * Path sanitizer: keeps a segment safe for any single path component by
 * removing path separators, NUL, and control characters, and never allows
 * the empty, '.', or '..' segment to reach the filesystem.
 */
export function sanitizePathSegment(value) {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "");
  return cleaned === "" || cleaned === "." || cleaned === ".."
    ? "segment"
    : cleaned;
}

/**
 * UTF-8 slug for a raw evidence filename. Letters and numbers (including
 * Hangul) survive NFC-normalized; every other character becomes a single '-',
 * runs collapse, and an empty result falls back to 'keyword'. The result is
 * truncated so the total filename component stays within filesystem limits.
 */
export function slugifySafeKey(keyword) {
  const text = String(keyword ?? "").normalize("NFC");
  let slug = "";
  for (const character of text) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      slug += character;
    } else if (!slug.endsWith("-")) {
      slug += "-";
    }
  }
  const trimmed = slug.replace(/^-+|-+$/gu, "");
  const bounded = [...(trimmed || DEFAULT_SAFE_KEY)]
    .slice(0, MAX_SAFE_KEY_LENGTH)
    .join("");
  return bounded || DEFAULT_SAFE_KEY;
}

/**
 * The keyword a piece of evidence belongs to, read deterministically from the
 * normalized request: the blog query, or the first trend keyword group name.
 */
export function deriveSafeKey(source, request) {
  if (source === "naver-api-hub-blog") {
    return typeof request?.query === "string" && request.query.trim() !== ""
      ? request.query
      : DEFAULT_SAFE_KEY;
  }
  if (source === "naver-api-hub-trend") {
    const firstGroup = Array.isArray(request?.keywordGroups)
      ? request.keywordGroups[0]
      : undefined;
    const groupName =
      firstGroup && typeof firstGroup.groupName === "string"
        ? firstGroup.groupName.trim()
        : "";
    if (groupName !== "") return groupName;
    const firstKeyword =
      firstGroup && Array.isArray(firstGroup.keywords)
        ? firstGroup.keywords[0]
        : undefined;
    return typeof firstKeyword === "string" && firstKeyword.trim() !== ""
      ? firstKeyword
      : DEFAULT_SAFE_KEY;
  }
  return DEFAULT_SAFE_KEY;
}

/** UTC run-id: YYYYMMDDTHHMMSSZ-<8-char-random> with injectable clock/random. */
export function makeRunId({
  clock = () => new Date(),
  random = () => randomBytes(4).toString("hex"),
} = {}) {
  const stamp = new Date(clock().getTime())
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}/u, "");
  const runId = `${stamp}-${random()}`;
  assertRunId(runId);
  return runId;
}

/**
 * Stable JSON text: two-space pretty print with a trailing newline. This store
 * only ever serializes envelopes produced by normalizeRawEvidenceEnvelope,
 * whose field order is fixed by the Task 1 contract, so byte output is stable
 * across reruns and independent of caller key order.
 */
export function stableSerialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Atomic JSON writer: creates parent directories, writes a same-directory
 * temporary file, then renames it over the target. On any failure the partial
 * temporary file is removed before the error is rethrown.
 */
export async function writeStableJson(filePath, value, options = {}) {
  const file = resolve(filePath);
  const installFile =
    typeof options.installPath === "string" ? options.installPath : file;
  const text = stableSerialize(value);
  await mkdir(dirname(installFile), { recursive: true });
  const temporary = join(
    dirname(installFile),
    `.${basename(installFile)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, text, "utf8");
    if (options.exclusive === true) {
      // A hard-link install is atomic and, unlike rename, never replaces an
      // existing target. Both files are in the same directory/filesystem.
      await link(temporary, installFile);
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, installFile);
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Canonical raw evidence path relative to the raw root: YYYY/MM/DD/run-id/<source>-<safe-key>.json */
function isRealUtcDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const canonical = date.toISOString();
  const expected = value.includes(".")
    ? canonical
    : canonical.replace(".000Z", "Z");
  return expected === value;
}

export function evidenceRelativePath({ collectedAt, runId, source, safeKey }) {
  assertRunId(runId);
  if (
    typeof collectedAt !== "string" ||
    !ISO_UTC_PATTERN.test(collectedAt) ||
    !isRealUtcDateTime(collectedAt)
  ) {
    fail(
      `collectedAt must be a real ISO UTC date-time; received ${JSON.stringify(collectedAt)}`,
    );
  }
  const year = collectedAt.slice(0, 4);
  const month = collectedAt.slice(5, 7);
  const day = collectedAt.slice(8, 10);
  const sourceSegment = sanitizePathSegment(source);
  const keySegment = slugifySafeKey(safeKey);
  return `${year}/${month}/${day}/${runId}/${sourceSegment}-${keySegment}.json`;
}

/**
 * Redacted error envelope for a failed call, without any IO. The Task 1
 * contract normalizer rejects credential-bearing keys, redacts credential
 * values, and enforces the failure variant (ok:false, error, no response).
 */
export function buildFailureEnvelope({
  source,
  endpoint,
  method,
  request,
  http,
  error,
  collectedAt,
  redactValues,
}) {
  const requestedStatus = Number.isInteger(http?.status)
    ? http.status
    : (KIND_STATUS[error?.kind] ?? 0);
  return normalizeRawEvidenceEnvelope(
    {
      schema_version: 1,
      provider: "naver-api-hub",
      source,
      endpoint,
      method,
      request,
      collected_at: collectedAt,
      http: { status: requestedStatus, ok: false },
      error,
    },
    { redactValues },
  );
}

/** Evidence index entry linking a persisted envelope to its traceable path. */
export function makeEvidenceIndexEntry({ envelope, path, runId }) {
  const failed = envelope.http.ok === false;
  const entry = {
    schema_version: 1,
    run_id: runId,
    source: envelope.source,
    endpoint: envelope.endpoint,
    method: envelope.method,
    collected_at: envelope.collected_at,
    http: { status: envelope.http.status, ok: envelope.http.ok },
    outcome: failed ? "failure" : "success",
  };
  if (failed) entry.error_kind = envelope.error.kind;
  entry.path = String(path);
  return entry;
}

async function persist({
  source,
  endpoint,
  method,
  request,
  response,
  error,
  http,
  collectedAt,
  runId,
  rootDir,
  redactValues,
  safeKey: safeKeyOverride,
}) {
  assertRunId(runId);
  const envelopeInput = {
    schema_version: 1,
    provider: "naver-api-hub",
    source,
    endpoint,
    method,
    request,
    collected_at: collectedAt,
    http: { status: http?.status ?? 0, ok: http?.ok === true },
  };
  if (envelopeInput.http.ok) {
    envelopeInput.response = response;
  } else {
    envelopeInput.error = error;
  }
  // Normalizing first means invalid, empty, malformed, or secret-bearing
  // evidence throws before any directory or file is created.
  const envelope = normalizeRawEvidenceEnvelope(envelopeInput, {
    redactValues,
  });
  const root = resolveRawRoot(rootDir);
  const safeKey =
    typeof safeKeyOverride === "string" && safeKeyOverride.trim() !== ""
      ? safeKeyOverride
      : deriveSafeKey(envelope.source, envelope.request);
  const relativePath = evidenceRelativePath({
    collectedAt: envelope.collected_at,
    runId,
    source: envelope.source,
    safeKey,
  });
  const filePath = resolve(root, relativePath);
  const rootHandle = await openVerifiedDirectory(root);
  let nested;
  try {
    nested = await openVerifiedNestedDirectory(
      rootHandle,
      dirname(relativePath),
    );
    await writeStableJson(filePath, envelope, {
      exclusive: true,
      installPath: join(directoryFdPath(nested.handle), basename(relativePath)),
    });
  } finally {
    for (const handle of nested?.owned ?? [])
      await handle.close().catch(() => {});
    await rootHandle.close().catch(() => {});
  }
  const indexEntry = makeEvidenceIndexEntry({
    envelope,
    path: filePath,
    runId,
  });
  return { path: filePath, envelope, indexEntry };
}

/**
 * Persist one redacted raw evidence envelope under
 * <rootDir>/YYYY/MM/DD/<run-id>/<source>-<safe-key>.json. Success (http.ok)
 * requires a non-empty, shape-valid response; http.ok false routes through the
 * failure envelope path and requires an error.
 */
export async function writeEvidence(input) {
  if (input === null || typeof input !== "object")
    fail("evidence input must be an object");
  return persist(input);
}

/** Persist a failed call envelope; http.ok is forced false when omitted. */
export async function writeFailureEvidence({ http, redactValues, ...rest }) {
  const status = http?.status;
  const errorKind = rest?.error?.kind;
  const resolvedStatus =
    status === undefined ? (KIND_STATUS[errorKind] ?? 0) : status;
  return persist({
    ...rest,
    http: { status: resolvedStatus, ok: false },
    redactValues,
  });
}

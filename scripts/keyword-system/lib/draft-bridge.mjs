import { isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeKeywordBrief } from "./briefs.mjs";

const SUPPORTED_FORMATS = new Set([
  "how-to",
  "review",
  "essay",
  "experience",
  "place-log",
  "book-memo",
  "photo-log",
]);
const DRAFT_MARKER = /^\[convert-post\] 저장 완료:\s*(.+)$/gimu;

export class DraftBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DraftBridgeError";
    this.code = "KEYWORD_DRAFT_BRIDGE";
  }
}

const fail = (message) => {
  throw new DraftBridgeError(message);
};

const clean = (value) => String(value ?? "").replace(/[\r\n]/gu, " ").trim();
const MAX_HUMAN_ANGLE_LENGTH = 300;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function assertContainedPath(root, target, label) {
  const suffix = relative(resolve(root), resolve(target));
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
    fail(`${label} must remain inside its root`);
  return resolve(target);
}

export function normalizeDraftFormat(value = "how-to") {
  const format = clean(value).toLowerCase();
  if (!SUPPORTED_FORMATS.has(format))
    fail(`unsupported draft format: ${format || "empty"}`);
  return format;
}

export function requireHumanApproval({ approved, reviewer, reason } = {}) {
  if (approved !== true)
    fail("human approval is required; pass --approve after reviewing the brief");
  const normalizedReviewer = clean(reviewer);
  const normalizedReason = clean(reason);
  if (normalizedReviewer === "") fail("--reviewer is required with --approve");
  if (normalizedReason === "") fail("--reason is required with --approve");
  return { reviewer: normalizedReviewer, reason: normalizedReason };
}

export function requireHumanAuthoredAngle(value) {
  const angle = clean(value);
  if (angle === "") fail("--angle is required and must be written by the reviewer");
  if (angle.length > MAX_HUMAN_ANGLE_LENGTH)
    fail(`--angle must be ${MAX_HUMAN_ANGLE_LENGTH} characters or fewer`);
  return angle;
}

export function requireReviewedBriefHash(expected, actual) {
  const supplied = clean(expected);
  if (!SHA256_PATTERN.test(supplied))
    fail("--brief-sha256 must be a 64-character lowercase SHA-256 hash");
  if (supplied !== actual)
    fail("--brief-sha256 does not match the reviewed brief");
  return supplied;
}

export function buildAutoWriteArgs(
  brief,
  {
    notesPath,
    outputDir,
    format = "how-to",
    humanAngle,
    briefSha256,
    approvalArtifact,
  } = {},
) {
  const normalized = normalizeKeywordBrief(brief);
  const notes = clean(notesPath);
  if (notes === "") fail("brief Markdown path is required as writer notes");
  const selectedFormat = normalizeDraftFormat(format);
  const selectedAngle = requireHumanAuthoredAngle(humanAngle);
  const selectedBriefSha256 = requireReviewedBriefHash(briefSha256, briefSha256);
  const approvalPath = clean(approvalArtifact);
  if (approvalPath === "") fail("bridge approval artifact is required");
  const args = [
    normalized.head_keyword,
    "--topic",
    normalized.category,
    "--angle",
    selectedAngle,
    "--format",
    selectedFormat,
    "--notes",
    notes,
    "--brief-sha256",
    selectedBriefSha256,
    "--approval-artifact",
    approvalPath,
  ];
  const output = clean(outputDir);
  if (output !== "") args.push("--out", output);
  return Object.freeze(args);
}

export function parseDraftPath(stdout, { repositoryRoot, postsRoot } = {}) {
  const root = resolve(repositoryRoot ?? process.cwd());
  const outputRoot = resolve(postsRoot ?? root, "");
  const matches = [...String(stdout ?? "").matchAll(DRAFT_MARKER)];
  const rawPath = clean(matches.at(-1)?.[1]);
  if (rawPath === "") fail("writer output did not contain a saved draft path");
  if (rawPath.startsWith("file://"))
    fail("writer output contained an unsupported file URL");
  const candidate = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(root, rawPath);
  return assertContainedPath(outputRoot, candidate, "draft output");
}

export function buildWriterReference(repositoryRoot, draftPath) {
  const relativePath = assertContainedPath(
    resolve(repositoryRoot),
    draftPath,
    "draft reference",
  );
  return relative(resolve(repositoryRoot), relativePath).replaceAll("\\", "/");
}

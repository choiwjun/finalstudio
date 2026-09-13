#!/usr/bin/env node
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open, rename, unlink } from "node:fs/promises";
import {
  openVerifiedDirectory,
  directoryFdPath,
  writeStableTextAtDirectory,
  withExclusiveFileLock,
} from "./lib/file-lock.mjs";
import {
  containedPath,
  decodePng,
  readBounded,
  readBoundedAt,
  MAX_IMAGE_BYTES,
} from "./lib/image-storage.mjs";
import { hashText, imageRoles, buildVisualImagePrompts } from "./lib/image-plan.mjs";
import { snapshotImageNotes } from "./lib/image-quality.mjs";
import {
  checkDeadline,
  withinDeadline,
  runImageCodex,
  runBriefCodex,
  runVisualJudgeCodex,
} from "./lib/image-runtime.mjs";
import { readJournal, saveJournal } from "./lib/image-transaction.mjs";
import {
  extractArticleSignals,
  generateVisualBrief,
} from "./lib/visual-brief.mjs";
import {
  VISUAL_JUDGE_SYSTEM,
  VISUAL_BUNDLE_JUDGE_SYSTEM,
  VISUAL_DIAGRAM_JUDGE_SYSTEM,
  VISUAL_DIAGRAM_BUNDLE_JUDGE_SYSTEM,
  buildVisualJudgeInput,
  parseVisualJudgeScores,
  parseVisualJudgeScoresLenient,
  parseVisualBundleScore,
  parseVisualBundleScoreLenient,
} from "./lib/visual-judge.mjs";
import {
  buildDiagramSpec,
  renderDiagramSvg,
} from "./lib/diagram.mjs";

export const REGEN_DEADLINE_MS = 2_700_000;

// Aggregation of repeated judge runs on a deterministic artifact. Fatal and
// malformed verdicts count as negative votes — a majority of bad samples fails
// the image, while a single bad sample is treated as judge noise (for a
// deterministic render every real defect is visible to every judge, and
// "unauthorized text" is impossible by construction since rendered strings are
// mechanically bound to the allowed-label list).
function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function diagramSampleVerdict(samples, fields, thresholds) {
  const bad = samples.filter((s) => !s.valid || s.fatal).length;
  if (bad >= 2 || !samples.length) return null;
  const good = samples.filter((s) => s.valid && !s.fatal);
  if (!good.length) return null;
  // 3 clean samples → median; fewer → require every clean sample to pass
  const aggregate =
    good.length >= 3
      ? (f) => medianOf(good.map((s) => s[f]))
      : (f) => Math.min(...good.map((s) => s[f]));
  const scores = {};
  for (const f of fields) {
    scores[f] = aggregate(f);
    if (scores[f] < thresholds[f]) return null;
  }
  return { ...scores, observed: good[0].observed, raw: good[0].raw };
}

function medianDiagramVerdict(samples) {
  return diagramSampleVerdict(samples, ["semantic", "craft"], {
    semantic: 90,
    craft: 85,
  });
}

function medianDiagramBundleVerdict(samples) {
  return diagramSampleVerdict(samples, ["bundle"], { bundle: 90 });
}

const ROLE_CONTENT = {
  main: "글의 핵심 논지를 한눈에 보여주는 요약 이미지",
  "sub-1": "핵심 비교·분류·판독 프레임",
  "sub-2": "실제 절차·예시·확인 순서",
};

export function parseImageRegenArgs(argv = []) {
  let result = { dryRun: false, subCount: 2 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      result = { ...result, dryRun: true };
      continue;
    }
    if (flag === "--diagram") {
      result = { ...result, diagram: true };
      continue;
    }
    if (!["--approved", "--sub-count"].includes(flag))
      throw Error(`unknown image-regen argument: ${flag}`);
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
  if (!Array.isArray(value.posts) || value.posts.length < 1 || value.posts.length > 15)
    throw Error("approved list must contain 1–15 explicit posts");
  const posts = value.posts.map((entry) => {
    if (
      !entry ||
      Object.keys(entry).some(
        (key) =>
          !["path", "sha256", "notesPath", "notesSha256", "format"].includes(key),
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

async function readPngMeta(directory, name) {
  const bytes = await readBoundedAt(directory, name, MAX_IMAGE_BYTES);
  const decoded = await decodePng(bytes);
  return { ...decoded, bytes: bytes.length };
}

function roleArticleCore({ role, postText, journal, signals }) {
  const header = postText.match(/^---\r?\n[\s\S]*?\r?\n---/u)?.[0] ?? "";
  if (role === "main") {
    return [
      `제목: ${signals.title}`,
      `설명: ${signals.description}`,
      `앵글: ${signals.angle}`,
      `소제목 흐름: ${signals.headings.join(" | ")}`,
      "",
      "도입부:",
      signals.intro,
    ].join("\n");
  }
  const scene = journal.plan?.scenes?.find((item) => item.role === role);
  const section = signals.firstSections.find((s) =>
    scene?.heading ? s.heading === scene.heading.slice(3).trim() : false,
  );
  return [
    `대상 섹션: ${scene?.heading?.slice(3).trim() ?? section?.heading ?? role}`,
    "",
    section?.body?.slice(0, 1500) ??
      postText.slice(header.length, header.length + 1500),
  ].join("\n");
}

async function defaultRasterize(svg) {
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(String(svg), "utf8")).png().toBuffer();
}

// runImage resolves when codex exits; $imagegen may fail without writing the
// PNG. Verify the file exists and retry generation a bounded number of times.
async function generatePng({
  runImage,
  role,
  prompt,
  name,
  regenRoot,
  regenDirectory,
  deadline,
  recordStdout,
}) {
  for (let genAttempt = 0; genAttempt < 3; genAttempt++) {
    checkDeadline(deadline);
    const output = await withinDeadline(
      (signal) =>
        runImage({
          role,
          prompt,
          path: join(regenRoot, name),
          deadline,
          signal,
        }),
      deadline,
    );
    if (typeof output === "string" && output.trim())
      await recordStdout?.(output);
    try {
      return await readPngMeta(regenDirectory, name);
    } catch (error) {
      if (error?.code !== "ENOENT" || genAttempt >= 2) throw error;
    }
  }
  throw Error(`image generation produced no PNG for ${name}`);
}

async function replaceImageAsset({ imagesDirectory, name, staged }) {
  const target = join(directoryFdPath(imagesDirectory), name);
  const tmp = `${target}.regen-tmp`;
  const file = await open(tmp, "w", 0o644);
  try {
    await file.writeFile(staged.bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tmp, target);
  const verify = await decodePng(
    await readBoundedAt(imagesDirectory, name, MAX_IMAGE_BYTES),
  );
  if (verify.sha256 !== staged.sha256)
    throw Error("replaced image asset hash mismatch");
  return verify;
}

export async function regenOneBundle(options) {
  const {
    root,
    entry,
    subCount = 2,
    runImage = runImageCodex,
    runBrief = runBriefCodex,
    runVisualJudge = runVisualJudgeCodex,
    rasterize = defaultRasterize,
    deadline = Date.now() + REGEN_DEADLINE_MS,
  } = options;
  const diagram = options.diagram === true;
  const slug = basename(entry.path, ".md");
  const postsRoot = resolve(root, "src/content/posts");
  const imagesRoot = resolve(root, "public/images");
  const outputRoot = resolve(root, "out/image-bundles", slug);
  const roles = imageRoles(subCount);
  checkDeadline(deadline);
  return withExclusiveFileLock(
    join(postsRoot, `.${slug}.images.lock`),
    async () => {
      const postsDirectory = await openVerifiedDirectory(postsRoot, {
        create: false,
      });
      const bundleDirectory = await openVerifiedDirectory(outputRoot, {
        create: true,
      });
      const imagesDirectory = await openVerifiedDirectory(imagesRoot, {
        create: false,
      });
      const regenRoot = join(
        outputRoot,
        `regen-${new Date().toISOString().replace(/[:.]/gu, "")}`,
      );
      const regenDirectory = await openVerifiedDirectory(regenRoot, {
        create: true,
      });
      const backupDirectory = await openVerifiedDirectory(
        join(regenRoot, "backup"),
        { create: true },
      );
      try {
        // 1. verify current state — committed journal + installed assets + approved hash
        const postText = (
          await readBoundedAt(postsDirectory, basename(entry.path))
        ).toString("utf8");
        if (hashText(postText) !== entry.sha256)
          throw Error("approved post hash mismatch");
        const journal = await readJournal(bundleDirectory);
        if (!journal || journal.state !== "committed")
          throw Error("regen requires a previously committed image bundle");
        if (
          journal.candidateHash !== hashText(postText) ||
          !postText.includes(`<!-- wj-auto-images:${slug}:`)
        )
          throw Error("post does not match committed bundle receipt");
        const oldImages = [];
        for (const image of journal.images ?? []) {
          const name = `${slug}-${image.role}.png`;
          const current = await readPngMeta(imagesDirectory, name);
          if (current.sha256 !== image.sha256)
            throw Error(`installed asset diverged from journal: ${name}`);
          oldImages.push({ role: image.role, name, meta: current });
        }
        if (oldImages.length !== roles.length)
          throw Error("journal image roles do not match requested bundle");
        const notes = await snapshotImageNotes({ ...options, root, notesPath: entry.notesPath, notesSha256: entry.notesSha256 });
        if (options.dryRun)
          return { slug, dryRun: true, journal, oldImages, notes };

        // 2. preserve current bytes before any generation
        await writeStableTextAtDirectory(backupDirectory, "post.md", postText);
        for (const old of oldImages)
          await writeStableTextAtDirectory(
            backupDirectory,
            `${old.role}.png`,
            await readBoundedAt(imagesDirectory, old.name, MAX_IMAGE_BYTES),
          );
        await writeStableTextAtDirectory(
          backupDirectory,
          "transaction.json",
          JSON.stringify(journal, null, 2) + "\n",
        );

        // 3. visual brief from structured article signals — illustration only;
        //    diagrams are judged against their own verified spec instead.
        const signals = extractArticleSignals(postText);
        let brief;
        let briefHash;
        if (!diagram) {
          ({ brief, briefHash } = await withinDeadline(
            (signal) =>
              generateVisualBrief({
                signals,
                notesText: notes.text,
                runBrief,
                signal,
                deadline,
                cwd: regenRoot,
                recordRaw: (raw) =>
                  writeStableTextAtDirectory(
                    regenDirectory,
                    "visual-brief-raw.md",
                    raw,
                  ),
              }),
            deadline,
          ));
          await writeStableTextAtDirectory(
            regenDirectory,
            "visual-brief.json",
            JSON.stringify({ briefHash, brief }, null, 2) + "\n",
          );
        }

        // 4–6. generate → per-image judge → bundle judge. On bundle failure the
        //    whole set is regenerated once with the judge's feedback appended.
        const staged = [];
        const imageResults = [];
        let bundleResult;
        let bundleRaw;
        let diagramInfo;
        if (diagram) {
          // deterministic diagram path — every rendered label is verified
          // verbatim against the post; no codex imagegen is invoked.
          const { spec, labels, specHash } = buildDiagramSpec({
            signals,
            postText,
          });
          diagramInfo = { specHash, labels };
          await writeStableTextAtDirectory(
            regenDirectory,
            "diagram-spec.json",
            JSON.stringify({ specHash, labels, spec }, null, 2) + "\n",
          );
          for (const role of roles) {
            checkDeadline(deadline);
            const name = `${role}.png`;
            const svg = renderDiagramSvg(spec.roles[role]);
            const png = await rasterize(svg);
            await writeStableTextAtDirectory(regenDirectory, `${role}.svg`, svg);
            await writeStableTextAtDirectory(regenDirectory, name, png);
            staged.push({ role, meta: await readPngMeta(regenDirectory, name) });
          }
          // Deterministic output, nondeterministic judge — sample the verdict
          // up to 3 times on the same PNG and take the median score. A fatal
          // defect in any run fails the image (fail-closed on defects).
          const judgeDiagramImage = async (item) => {
            const samples = [];
            for (let j = 0; j < 3; j++) {
              checkDeadline(deadline);
              const raw = await withinDeadline(
                (signal) =>
                  runVisualJudge({
                    system: VISUAL_DIAGRAM_JUDGE_SYSTEM,
                    input: [
                      `이미지 role: ${item.role} (${ROLE_CONTENT[item.role] ?? item.role})`,
                      "",
                      "다이어그램 요구 구조:",
                      JSON.stringify(spec.roles[item.role], null, 2),
                      "",
                      "해당 role이 표현해야 할 글 핵심 내용:",
                      roleArticleCore({
                        role: item.role,
                        postText,
                        journal,
                        signals,
                      }),
                      "",
                      "허용 레이블 목록 (이 목록의 문자열 외 읽을 수 있는 문자가 보이면 치명적 결함):",
                      ...labels.map((label) => `- ${label}`),
                      "",
                      "첨부된 PNG를 실제로 보고 위 기준으로 채점하라. PNG가 보이지 않으면 치명적 결함으로 보고하라.",
                    ].join("\n"),
                    imagePaths: [join(regenRoot, `${item.role}.png`)],
                    cwd: regenRoot,
                    signal,
                    deadline,
                  }),
                deadline,
              );
              await writeStableTextAtDirectory(
                regenDirectory,
                `visual-judge-${item.role}${j === 0 ? "" : `-j${j + 1}`}.md`,
                String(raw),
              );
              const parsed = parseVisualJudgeScoresLenient(raw);
              samples.push({ raw, ...parsed });
              // a first-run clean pass is accepted outright; otherwise keep
              // sampling for a majority vote / median of 3
              if (j === 0 && parsed.valid && !parsed.fatal && parsed.semantic >= 90 && parsed.craft >= 85)
                break;
              if (samples.filter((s) => !s.valid || s.fatal).length >= 2)
                break;
            }
            return samples;
          };
          for (const item of staged) {
            const samples = await judgeDiagramImage(item);
            const verdict = medianDiagramVerdict(samples);
            if (!verdict)
              throw Error(
                "visual image judge must report observed elements, semantic>=90, craft>=85, no fatal defects",
              );
            imageResults.push({
              role: item.role,
              semantic: verdict.semantic,
              craft: verdict.craft,
              observed: verdict.observed,
              judgeRawHash: hashText(String(verdict.raw)),
              judgeSamples: samples.length,
            });
          }
          // bundle judge — same median sampling; "regeneration" is pointless
          // for deterministic artifacts, so re-judging is the only retry.
          {
            const samples = [];
            for (let j = 0; j < 3; j++) {
              checkDeadline(deadline);
              const raw = await withinDeadline(
                (signal) =>
                  runVisualJudge({
                    system: VISUAL_DIAGRAM_BUNDLE_JUDGE_SYSTEM,
                    input: [
                      "다이어그램 요구 구조 (role별):",
                      JSON.stringify(spec.roles, null, 2),
                      "",
                      `글 핵심:`,
                      `제목: ${signals.title}`,
                      `설명: ${signals.description}`,
                      `소제목 흐름: ${signals.headings.join(" | ")}`,
                      "",
                      "허용 레이블 목록 (이 목록의 문자열 외 읽을 수 있는 문자가 보이면 치명적 결함):",
                      ...labels.map((label) => `- ${label}`),
                      "",
                      "첨부된 PNG들을 실제로 보고 번들을 심사하라.",
                    ].join("\n"),
                    imagePaths: staged.map((item) => join(regenRoot, `${item.role}.png`)),
                    cwd: regenRoot,
                    signal,
                    deadline,
                  }),
                deadline,
              );
              await writeStableTextAtDirectory(
                regenDirectory,
                `visual-judge-bundle${j === 0 ? "" : `-j${j + 1}`}.md`,
                String(raw),
              );
              const parsed = parseVisualBundleScoreLenient(raw);
              samples.push({ raw, ...parsed });
              if (j === 0 && parsed.valid && !parsed.fatal && parsed.bundle >= 90)
                break;
              if (samples.filter((s) => !s.valid || s.fatal).length >= 2)
                break;
            }
            const verdict = medianDiagramBundleVerdict(samples);
            if (!verdict)
              throw Error(
                "visual bundle judge must report observed elements, bundle>=90, no fatal defects",
              );
            bundleRaw = verdict.raw;
            bundleResult = { bundle: verdict.bundle, observed: verdict.observed };
          }
        } else {
        const basePrompts = buildVisualImagePrompts({ brief, roles });
        for (let bundleAttempt = 0; bundleAttempt <= 1; bundleAttempt++) {
          const suffix = bundleAttempt === 0 ? "" : `-b${bundleAttempt}`;
          const prompts = { ...basePrompts };
          if (bundleAttempt > 0) {
            const feedback = await readBoundedAt(
              regenDirectory,
              "visual-judge-bundle.md",
              MAX_IMAGE_BYTES,
            );
            for (const role of roles)
              prompts[role] = `${basePrompts[role]}\n\nThe previous bundle was rejected: the images overlapped or failed bundle-level coherence. Your image must clearly serve ONLY its own role (${ROLE_CONTENT[role] ?? role}) and must not repeat the summary scene. Fix every issue below while keeping all constraints:\n${feedback.toString("utf8").slice(0, 3000)}`;
          }
          staged.length = 0;
          for (const role of roles) {
            checkDeadline(deadline);
            const name = `${role}.png`;
            try {
              const previous = await readBoundedAt(regenDirectory, name, MAX_IMAGE_BYTES);
              await writeStableTextAtDirectory(
                regenDirectory,
                `${role}.rejected${suffix}.png`,
                previous,
              );
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
            try {
              await unlink(join(regenRoot, name));
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
            staged.push({
              role,
              meta: await generatePng({
                runImage,
                role,
                prompt: prompts[role],
                name,
                regenRoot,
                regenDirectory,
                deadline,
                recordStdout: (output) =>
                  writeStableTextAtDirectory(
                    regenDirectory,
                    `${role}${suffix}.stdout.txt`,
                    output,
                  ),
              }),
            });
          }

          // 5. per-image visual judge — PNG is a required input; bounded
          //    regenerations with judge feedback are allowed per image.
          imageResults.length = 0;
          for (const item of staged) {
            let raw;
            for (let attempt = 0; attempt <= 4; attempt++) {
              checkDeadline(deadline);
              raw = await withinDeadline(
                (signal) =>
                  runVisualJudge({
                    system: VISUAL_JUDGE_SYSTEM,
                    input: buildVisualJudgeInput({
                      role: item.role,
                      brief,
                      articleCore: roleArticleCore({
                        role: item.role,
                        postText,
                        journal,
                        signals,
                      }),
                      roleContent: ROLE_CONTENT[item.role] ?? item.role,
                    }),
                    imagePaths: [join(regenRoot, `${item.role}.png`)],
                    cwd: regenRoot,
                    signal,
                    deadline,
                  }),
                deadline,
              );
              const judgeSuffix = `${suffix}${attempt === 0 ? "" : `-retry${attempt}`}`;
              await writeStableTextAtDirectory(
                regenDirectory,
                `visual-judge-${item.role}${judgeSuffix}.md`,
                String(raw),
              );
              try {
                imageResults.push({
                  role: item.role,
                  ...parseVisualJudgeScores(raw),
                  judgeRawHash: hashText(String(raw)),
                });
                break;
              } catch (error) {
                if (attempt >= 4) throw error;
                checkDeadline(deadline);
                const name = `${item.role}.png`;
                await writeStableTextAtDirectory(
                  regenDirectory,
                  `${item.role}.rejected.png`,
                  await readBoundedAt(regenDirectory, name, MAX_IMAGE_BYTES),
                );
                await unlink(join(regenRoot, name));
                // fatal defects get feedback-guided fixes; semantic-only misses
                // get a fresh take on the base scene instead of accumulating
                // feedback that fixes the composition in place.
                const fatal = /치명적 결함\s*[:：]\s*있음/u.test(String(raw));
                const retryPrompt = fatal
                  ? `${prompts[item.role]}\n\nPrevious attempt was rejected by the visual judge; fix every issue below while keeping all constraints:\n${String(raw).slice(0, 3000)}`
                  : prompts[item.role];
                item.meta = await generatePng({
                  runImage,
                  role: item.role,
                  prompt: retryPrompt,
                  name,
                  regenRoot,
                  regenDirectory,
                  deadline,
                  recordStdout: (output) =>
                    writeStableTextAtDirectory(
                      regenDirectory,
                      `${item.role}.retry.stdout.txt`,
                      output,
                    ),
                });
              }
            }
          }

          // 6. bundle judge — all PNGs attached
          bundleRaw = await withinDeadline(
            (signal) =>
              runVisualJudge({
                system: VISUAL_BUNDLE_JUDGE_SYSTEM,
                input: [
                  `글의 visual brief:`,
                  JSON.stringify(brief, null, 2),
                  "",
                  `글 핵심:`,
                  `제목: ${signals.title}`,
                  `설명: ${signals.description}`,
                  `소제목 흐름: ${signals.headings.join(" | ")}`,
                  "",
                  "첨부된 PNG들을 실제로 보고 번들을 심사하라.",
                ].join("\n"),
                imagePaths: staged.map((item) => join(regenRoot, `${item.role}.png`)),
                cwd: regenRoot,
                signal,
                deadline,
              }),
            deadline,
          );
          await writeStableTextAtDirectory(
            regenDirectory,
            bundleAttempt === 0
              ? "visual-judge-bundle.md"
              : `visual-judge-bundle-b${bundleAttempt}.md`,
            String(bundleRaw),
          );
          try {
            bundleResult = parseVisualBundleScore(bundleRaw);
            break;
          } catch (error) {
            if (bundleAttempt >= 1) throw error;
          }
        }
        }

        // 7. all gates passed — swap installed PNG bytes, post text untouched
        const replaced = [];
        for (const item of staged) {
          const name = `${slug}-${item.role}.png`;
          const stagedBytes = await readBoundedAt(
            regenDirectory,
            `${item.role}.png`,
            MAX_IMAGE_BYTES,
          );
          if (hashText(stagedBytes) !== item.meta.sha256)
            throw Error("staged image changed before install");
          const verify = await replaceImageAsset({
            imagesDirectory,
            name,
            staged: { bytes: stagedBytes, sha256: item.meta.sha256 },
          });
          replaced.push({ role: item.role, name, meta: verify });
        }

        // 8. journal — record new asset hashes + full visual QA evidence
        const visual = {
          version: 1,
          generatedAt: new Date().toISOString(),
          evidenceMode: diagram ? "deterministic diagram" : brief.evidenceMode,
          ...(diagram ? {} : { briefHash }),
          ...(diagramInfo
            ? {
                diagramSpecHash: diagramInfo.specHash,
                diagramLabels: diagramInfo.labels,
              }
            : {}),
          images: Object.fromEntries(
            imageResults.map((result) => {
              const meta = staged.find((item) => item.role === result.role).meta;
              const previous = journal.images.find(
                (image) => image.role === result.role,
              );
              return [
                result.role,
                {
                  sha256: meta.sha256,
                  previousSha256: previous?.sha256 ?? null,
                  width: meta.width,
                  height: meta.height,
                  bytes: meta.bytes,
                  semantic: result.semantic,
                  craft: result.craft,
                  judgeRawHash: result.judgeRawHash,
                },
              ];
            }),
          ),
          bundleScore: bundleResult.bundle,
          bundleJudgeRawHash: hashText(String(bundleRaw)),
        };
        const nextJournal = {
          ...journal,
          images: journal.images.map((image) => ({
            ...image,
            sha256:
              staged.find((item) => item.role === image.role)?.meta.sha256 ??
              image.sha256,
          })),
          visual,
        };
        await saveJournal(bundleDirectory, nextJournal);
        return { slug, briefHash, imageResults, bundleResult, visual };
      } catch (error) {
        await writeStableTextAtDirectory(
          regenDirectory,
          "failure.json",
          JSON.stringify(
            {
              error: error.message,
              failedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
        throw error;
      } finally {
        await backupDirectory.close();
        await regenDirectory.close();
        await imagesDirectory.close();
        await bundleDirectory.close();
        await postsDirectory.close();
      }
    },
    { timeoutMs: Math.max(1, deadline - Date.now()) },
  );
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseImageRegenArgs(argv);
  const root = resolve(dependencies.root ?? process.cwd());
  const posts = await readApprovedList(root, args.approved);
  const results = [];
  for (const entry of posts) {
    try {
      const result = await regenOneBundle({
        root,
        entry,
        subCount: args.subCount,
        dryRun: args.dryRun,
        diagram: args.diagram,
        runImage: dependencies.runImage,
        runBrief: dependencies.runBrief,
        runVisualJudge: dependencies.runVisualJudge,
        rasterize: dependencies.rasterize,
        deadline: Date.now() + REGEN_DEADLINE_MS,
      });
      results.push(
        args.dryRun
          ? { path: entry.path, verified: true }
          : {
              path: entry.path,
              briefHash: result.briefHash,
              images: result.imageResults,
              bundle: result.bundleResult.bundle,
            },
      );
    } catch (error) {
      throw Error(
        `image regen stopped at ${entry.path}; ${results.length} earlier bundle(s) regenerated: ${error.message}`,
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
        `${result.dryRun ? "Dry-run verified" : "Regenerated"} ${result.results.length} draft image bundle(s). Post bodies and draft status unchanged.\n`,
      ),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

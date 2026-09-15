import { basename, join, resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { parseFrontmatter } from "../../lib/content-contract.mjs";
import {
  assertRegularFileAtDirectory,
  directoryFdPath,
  openVerifiedDirectory,
  withExclusiveFileLock,
  writeStableTextAtDirectory,
} from "./file-lock.mjs";
import {
  attachSubImages,
  buildImagePrompts,
  planArticleImages,
  hashText,
  imageRoles,
  assertImageSlug,
} from "./image-plan.mjs";
import {
  containedPath,
  decodePng,
  readBoundedAt,
  MAX_IMAGE_BYTES,
} from "./image-storage.mjs";
import {
  parseImageJudgeScore,
  snapshotImageNotes,
  mechanicalImageCheck,
  judgeImageCandidate,
} from "./image-quality.mjs";
import {
  IMAGE_DEADLINE_MS,
  checkDeadline,
  withinDeadline,
  runImageDefault,
  runJudgeCodex,
} from "./image-runtime.mjs";
import {
  archivePreviousImageAttempt,
  assertAssetAbsent,
  installImageTransaction,
  readJournal,
  recoverImageTransaction,
  saveJournal,
  verifyDirectoryPath,
} from "./image-transaction.mjs";
export { attachSubImages, buildImagePrompts };
export const IMAGE_ROLES = imageRoles(2);
export class ImageBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageBundleError";
    this.code = "KEYWORD_IMAGE_BUNDLE";
  }
}
function pathsFor({ root, postPath, slug }) {
  assertImageSlug(slug);
  const postsRoot = resolve(root, "src/content/posts");
  const safePost = containedPath(postsRoot, postPath);
  if (safePost !== join(postsRoot, `${slug}.md`))
    throw Error("post path does not match image slug");
  return {
    postsRoot,
    postPath: safePost,
    imagesRoot: resolve(root, "public/images"),
    outputRoot: resolve(root, "out/image-bundles", slug),
  };
}
async function existingScreenshotPaths(text, imagesRoot) {
  const targets = [
    ...text.matchAll(/!\[[^\]\n]*\]\((\/images\/[^)\n]+)\)/gu),
  ].map((match) => match[1]);
  if (!targets.length) return [];
  let directory;
  try {
    directory = await openVerifiedDirectory(imagesRoot, { create: false });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const found = [];
    for (const target of targets) {
      if (!/^\/images\/[a-zA-Z0-9._-]+\.png$/u.test(target))
        throw Error("unsupported existing image path; review required");
      try {
        await decodePng(
          await readBoundedAt(directory, basename(target), MAX_IMAGE_BYTES),
        );
        found.push(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return found;
  } finally {
    await directory.close();
  }
}
export async function prepareImageBundle(options) {
  const {
    root = process.cwd(),
    slug,
    subCount = options.imageRoles ? options.imageRoles.length - 1 : 2,
    deadline = Date.now() + IMAGE_DEADLINE_MS,
  } = options;
  checkDeadline(deadline);
  const paths = pathsFor({ ...options, root });
  const postsDirectory = await openVerifiedDirectory(paths.postsRoot, {
    create: false,
  });
  try {
    const sourceText = (
      await readBoundedAt(postsDirectory, basename(paths.postPath))
    ).toString("utf8");
    const notes = await snapshotImageNotes({ ...options, root });
    const existingImages = await existingScreenshotPaths(
      sourceText,
      paths.imagesRoot,
    );
    const plan = planArticleImages(sourceText, {
      slug,
      subCount,
      existingImages,
    });
    if (options.expectedHash && options.expectedHash !== plan.sourceHash)
      throw Error("approved post hash mismatch");
    const images = plan.scenes.map((scene) =>
      Object.freeze({
        role: scene.role,
        path: join(paths.imagesRoot, `${slug}-${scene.role}.png`),
        publicPath: `/images/${slug}-${scene.role}.png`,
      }),
    );
    const candidate = attachSubImages(sourceText, { slug, images, plan });
    mechanicalImageCheck(candidate, {
      sourceText,
      format: options.format,
      notes,
    });
    checkDeadline(deadline);
    return { paths, plan, images, candidate, notes, deadline };
  } finally {
    await postsDirectory.close();
  }
}
async function verifyReceipt(journal, options, sourceText) {
  const {
    root,
    postPath,
    subCount,
    expectedHash,
    notesPath,
    notesSha256,
    format = "how-to",
  } = options;
  if (
    journal.version !== 1 ||
    journal.plan?.slug !== basename(postPath, ".md") ||
    journal.plan?.subCount !== subCount ||
    journal.quality?.format !== format ||
    (expectedHash && expectedHash !== journal.sourceHash)
  )
    throw Error("existing bundle contract conflict");
  if (
    journal.quality?.candidateHash !== hashText(sourceText) ||
    journal.candidateHash !== hashText(sourceText) ||
    journal.quality.score < 90 ||
    journal.quality.mechanical?.pass !== true
  )
    throw Error("existing bundle quality/hash conflict");
  const notes = await snapshotImageNotes({ root, notesPath, notesSha256 });
  if (
    journal.quality.notesHash !== notes.sha256 ||
    journal.quality.renderedNotesHash !== hashText(notes.text)
  )
    throw Error("existing bundle notes conflict");
  if (parseImageJudgeScore(journal.quality.raw) !== journal.quality.score)
    throw Error("existing bundle receipt score conflict");
  mechanicalImageCheck(sourceText, {
    sourceText: journal.plan.sourceText,
    format,
    notes,
  });
  const rebuilt = planArticleImages(journal.plan.sourceText, {
    slug: journal.plan.slug,
    subCount,
    existingImages: await existingScreenshotPaths(
      journal.plan.sourceText,
      resolve(root, "public/images"),
    ),
  });
  if (
    JSON.stringify(rebuilt) !== JSON.stringify(journal.plan) ||
    attachSubImages(journal.plan.sourceText, {
      slug: journal.plan.slug,
      plan: rebuilt,
      images: journal.images,
    }) !== sourceText
  )
    throw Error("existing bundle provenance conflict");
  await validateImageBundle(
    { ...journal, postPath },
    { root, postPath, postText: sourceText },
  );
  return { ...journal, postPath, idempotent: true };
}
export async function inspectImageBundle(options) {
  const root = resolve(options.root ?? process.cwd());
  const subCount = options.subCount ?? 2;
  const paths = pathsFor({ ...options, root });
  const postsDirectory = await openVerifiedDirectory(paths.postsRoot, {
    create: false,
  });
  let directory;
  try {
    const text = (
      await readBoundedAt(postsDirectory, basename(paths.postPath))
    ).toString("utf8");
    try {
      directory = await openVerifiedDirectory(paths.outputRoot, {
        create: false,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const journal = directory ? await readJournal(directory) : null;
    if (
      journal &&
      ["committed", "prepared"].includes(journal.state) &&
      hashText(text) === journal.candidateHash
    ) {
      return verifyReceipt(
        journal,
        { ...options, root, postPath: paths.postPath, subCount },
        text,
      );
    }
    if (journal && journal.state !== "rolled-back")
      throw Error("pending image transaction requires recovery before dry-run");
    const prepared = await prepareImageBundle({ ...options, root, subCount });
    let imagesDirectory;
    try {
      imagesDirectory = await openVerifiedDirectory(paths.imagesRoot, {
        create: false,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (imagesDirectory)
      try {
        for (const image of prepared.images)
          await assertAssetAbsent(imagesDirectory, basename(image.path));
      } finally {
        await imagesDirectory.close();
      }
    return prepared;
  } finally {
    await postsDirectory.close();
    if (directory) await directory.close();
  }
}
export async function generateImageBundle(options) {
  const root = resolve(options.root ?? process.cwd());
  const subCount =
    options.subCount ??
    (options.imageRoles ? options.imageRoles.length - 1 : 2);
  const roles = imageRoles(subCount);
  if (
    options.imageRoles &&
    JSON.stringify(options.imageRoles) !== JSON.stringify(roles)
  )
    throw Error("image role contract mismatch");
  const deadline = options.deadline ?? Date.now() + IMAGE_DEADLINE_MS;
  checkDeadline(deadline);
  const paths = pathsFor({ ...options, root });
  return withExclusiveFileLock(
    join(paths.postsRoot, `.${options.slug}.images.lock`),
    async () => {
      const opened = [];
      let directory, imagesDirectory, postsDirectory;
      try {
        directory = await openVerifiedDirectory(paths.outputRoot, {
          create: true,
        });
        opened.push(directory);
        imagesDirectory = await openVerifiedDirectory(paths.imagesRoot, {
          create: true,
        });
        opened.push(imagesDirectory);
        postsDirectory = await openVerifiedDirectory(paths.postsRoot, {
          create: false,
        });
        opened.push(postsDirectory);
      } catch (error) {
        for (const handle of opened) await handle.close().catch(() => {});
        throw error;
      }
      try {
        const sourceText = (
          await readBoundedAt(postsDirectory, basename(paths.postPath))
        ).toString("utf8");
        const postIdentity = await assertRegularFileAtDirectory(
          postsDirectory,
          basename(paths.postPath),
        );
        const journal = await recoverImageTransaction({
          journal: await readJournal(directory),
          directory,
          imagesDirectory,
          postText: sourceText,
          expectedSlug: options.slug,
        });
        if (
          journal &&
          ["committed", "commit-pending"].includes(journal.state)
        ) {
          const result = await verifyReceipt(
            journal,
            { ...options, root, postPath: paths.postPath, subCount },
            sourceText,
          );
          if (journal.state === "commit-pending")
            await saveJournal(directory, { ...journal, state: "committed" });
          return result;
        }
        const prepared = await prepareImageBundle({
          ...options,
          root,
          subCount,
          deadline,
        });
        if (prepared.plan.sourceText !== sourceText)
          throw Error("post changed while planning");
        for (const image of prepared.images)
          await assertAssetAbsent(imagesDirectory, basename(image.path));
        await archivePreviousImageAttempt(directory, paths.outputRoot);
        await writeStableTextAtDirectory(directory, "source.md", sourceText);
        await writeStableTextAtDirectory(
          directory,
          "plan.json",
          JSON.stringify(prepared.plan, null, 2) + "\n",
        );
        await writeStableTextAtDirectory(
          directory,
          "candidate.md",
          prepared.candidate,
        );
        const images = [];
        for (const image of prepared.images) {
          const name = `${image.role}.png`;
          // Stale private outputs are never accepted as a successful generation.
          try {
            await assertRegularFileAtDirectory(directory, name);
            await unlink(join(directoryFdPath(directory), name));
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await verifyDirectoryPath(paths.outputRoot, directory);
          const output = await withinDeadline(
            (signal) =>
              (options.runImage ?? runImageDefault)({
                role: image.role,
                prompt: buildImagePrompts({ plan: prepared.plan })[image.role],
                path: join(paths.outputRoot, name),
                deadline,
                signal,
              }),
            deadline,
          );
          if (typeof output === "string")
            await writeStableTextAtDirectory(
              directory,
              `${image.role}.stdout.txt`,
              output,
            );
          await verifyDirectoryPath(paths.outputRoot, directory);
          const decoded = await decodePng(
            await readBoundedAt(directory, name, MAX_IMAGE_BYTES),
          );
          images.push(Object.freeze({ ...image, ...decoded }));
        }
        const quality = await judgeImageCandidate(prepared.candidate, {
          sourceText,
          format: options.format,
          notes: prepared.notes,
          runJudge: options.runJudge ?? runJudgeCodex,
          deadline,
          cwd: paths.outputRoot,
          // The draft subprocess only writes a post after the independent
          // judge scores it >=90; the post's existence is the approval
          // signal. Passing the proven threshold lets the quality check
          // reuse it instead of re-rolling the judge on identical prose.
          approvedScore: options.approvedScore,
          recordRaw: (raw) =>
            writeStableTextAtDirectory(directory, "judge.md", raw),
        });
        await writeStableTextAtDirectory(
          directory,
          "quality.json",
          JSON.stringify(quality, null, 2) + "\n",
        );
        const result = await installImageTransaction({
          directory,
          imagesDirectory,
          postsDirectory,
          ...paths,
          postIdentity,
          plan: prepared.plan,
          candidate: prepared.candidate,
          images,
          quality,
          deadline,
          installHook: options.installHook,
        });
        return { ...result, postPath: paths.postPath };
      } catch (error) {
        await writeStableTextAtDirectory(
          directory,
          "failure.json",
          JSON.stringify(
            {
              error: error.message,
              deadline,
              failedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
        throw error;
      } finally {
        await postsDirectory.close();
        await imagesDirectory.close();
        await directory.close();
      }
    },
    { timeoutMs: Math.max(1, deadline - Date.now()) },
  );
}
export async function validateImageBundle(
  bundle,
  { root = process.cwd(), postPath, postText } = {},
) {
  if (
    !postPath ||
    typeof postText !== "string" ||
    resolve(bundle?.postPath ?? "") !== resolve(postPath)
  )
    throw Error("image bundle must be bound to the published post");
  const slug = basename(postPath, ".md");
  assertImageSlug(slug);
  const roles = imageRoles((bundle.images?.length ?? 0) - 1);
  if (
    JSON.stringify(bundle.images.map((image) => image.role)) !==
    JSON.stringify(roles)
  )
    throw Error("image bundle role mismatch");
  const imagesRoot = resolve(root, "public/images");
  const directory = await openVerifiedDirectory(imagesRoot, { create: false });
  try {
    for (const image of bundle.images) {
      const name = `${slug}-${image.role}.png`;
      if (
        image.path !== join(imagesRoot, name) ||
        image.publicPath !== `/images/${name}`
      )
        throw Error("image bundle path is not bound to post");
      const decoded = await decodePng(
        await readBoundedAt(directory, name, MAX_IMAGE_BYTES),
      );
      if (image.sha256 && decoded.sha256 !== image.sha256)
        throw Error("image bundle asset hash conflict");
      if (image.role !== "main" && !postText.includes(`](${image.publicPath})`))
        throw Error("post does not reference every sub-image");
    }
    if (
      parseFrontmatter(postText)?.get("image") !== bundle.images[0].publicPath
    )
      throw Error("post frontmatter does not reference main image");
  } finally {
    await directory.close();
  }
  return true;
}

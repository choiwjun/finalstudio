import { randomUUID } from "node:crypto";
import { open, lstat, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import {
  directoryFdPath,
  openVerifiedDirectory,
  writeStableTextAtDirectory,
  assertExpectedFileIdentity,
} from "./file-lock.mjs";
import { readBoundedAt, MAX_IMAGE_BYTES } from "./image-storage.mjs";
import { hashText, imageRoles } from "./image-plan.mjs";
import { checkDeadline } from "./image-runtime.mjs";

export const saveJournal = (directory, journal) =>
  writeStableTextAtDirectory(
    directory,
    "transaction.json",
    JSON.stringify(journal, null, 2) + "\n",
  );
export async function readJournal(directory) {
  try {
    return JSON.parse(
      (await readBoundedAt(directory, "transaction.json", 10_000_000)).toString(
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function verifyDirectoryPath(path, handle) {
  const fresh = await openVerifiedDirectory(path, { create: false });
  try {
    const a = await fresh.stat();
    const b = await handle.stat();
    if (a.ino !== b.ino || a.dev !== b.dev)
      throw Error("directory path identity changed");
  } finally {
    await fresh.close();
  }
}
async function removeOwned(imagesDirectory, owned) {
  for (const item of [...owned].reverse()) {
    if (basename(item.name) !== item.name)
      throw Error("invalid recovery asset path");
    try {
      await assertExpectedFileIdentity(
        imagesDirectory,
        item.name,
        item.identity,
      );
      const bytes = await readBoundedAt(
        imagesDirectory,
        item.name,
        MAX_IMAGE_BYTES,
      );
      if (bytes.length !== 0 && hashText(bytes) !== item.sha256)
        throw Error("recovery asset hash conflict");
      await unlink(join(directoryFdPath(imagesDirectory), item.name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
// A crash before post replacement is reversible. A completed post is accepted only
// via its final-byte quality receipt; divergent edits/assets always require review.
export async function recoverImageTransaction({
  journal,
  directory,
  imagesDirectory,
  postText,
  expectedSlug,
}) {
  if (!journal || ["committed", "rolled-back"].includes(journal.state))
    return journal;
  const roles = imageRoles(journal.plan?.subCount);
  if (
    journal.plan?.slug !== expectedSlug ||
    journal.sourceHash !== hashText(journal.plan.sourceText) ||
    !Array.isArray(journal.owned) ||
    journal.owned.some((item) => {
      const image = journal.images?.find(
        (image) =>
          `${expectedSlug}-${image.role}.png` === item.name &&
          roles.includes(image.role),
      );
      return (
        !image ||
        item.sha256 !== image.sha256 ||
        !Number.isFinite(item.identity?.dev) ||
        !Number.isFinite(item.identity?.ino)
      );
    })
  )
    throw Error("recovery asset ownership conflict");
  if (
    hashText(postText) === journal.candidateHash &&
    journal.quality?.candidateHash === journal.candidateHash
  ) {
    return { ...journal, state: "commit-pending" };
  }
  if (hashText(postText) !== journal.sourceHash)
    throw Error("recovery post conflict; preserve journal for manual review");
  await removeOwned(imagesDirectory, journal.owned ?? []);
  const next = { ...journal, state: "rolled-back" };
  await saveJournal(directory, next);
  return next;
}
export async function installImageTransaction({
  directory,
  imagesDirectory,
  postsDirectory,
  imagesRoot,
  postsRoot,
  postPath,
  postIdentity,
  plan,
  candidate,
  images,
  quality,
  deadline,
  installHook,
}) {
  let journal = {
    version: 1,
    state: "prepared",
    sourceHash: plan.sourceHash,
    candidateHash: hashText(candidate),
    plan,
    images,
    quality,
    owned: [],
  };
  await saveJournal(directory, journal);
  let postInstalled = false;
  try {
    for (const [index, image] of images.entries()) {
      checkDeadline(deadline);
      await verifyDirectoryPath(imagesRoot, imagesDirectory);
      const name = basename(image.path);
      const bytes = await readBoundedAt(
        directory,
        `${image.role}.png`,
        MAX_IMAGE_BYTES,
      );
      if (hashText(bytes) !== image.sha256) throw Error("staged image changed");
      const file = await open(
        join(directoryFdPath(imagesDirectory), name),
        "wx",
        0o644,
      );
      try {
        const stat = await file.stat();
        journal = {
          ...journal,
          owned: [
            ...journal.owned,
            {
              name,
              sha256: image.sha256,
              identity: { dev: stat.dev, ino: stat.ino },
            },
          ],
        };
        await saveJournal(directory, journal);
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await installHook?.({ index, image });
    }
    checkDeadline(deadline);
    await verifyDirectoryPath(postsRoot, postsDirectory);
    await verifyDirectoryPath(imagesRoot, imagesDirectory);
    for (const image of images)
      if (
        hashText(
          await readBoundedAt(
            imagesDirectory,
            basename(image.path),
            MAX_IMAGE_BYTES,
          ),
        ) !== image.sha256
      )
        throw Error("installed asset changed");
    await assertExpectedFileIdentity(
      postsDirectory,
      basename(postPath),
      postIdentity,
    );
    if (
      hashText(await readBoundedAt(postsDirectory, basename(postPath))) !==
      plan.sourceHash
    )
      throw Error("post changed before installation");
    await writeStableTextAtDirectory(
      postsDirectory,
      basename(postPath),
      candidate,
    );
    postInstalled = true;
    journal = { ...journal, state: "committed" };
    await saveJournal(directory, journal);
    return journal;
  } catch (error) {
    if (postInstalled) {
      // Do not undo a completed post without its assets if receipt persistence fails.
      throw Error(`commit recovery required: ${error.message}`, {
        cause: error,
      });
    }
    try {
      await removeOwned(imagesDirectory, journal.owned);
      await saveJournal(directory, {
        ...journal,
        state: "rolled-back",
        error: error.message,
      });
    } catch (recoveryError) {
      throw Error(
        `${error.message}; rollback requires review: ${recoveryError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}
export async function assertAssetAbsent(directory, name) {
  try {
    await lstat(join(directoryFdPath(directory), name));
    throw Error(`image asset conflict: ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function archivePreviousImageAttempt(directory, outputRoot) {
  const names = [
    "source.md",
    "plan.json",
    "candidate.md",
    "quality.json",
    "judge.md",
    "failure.json",
    "transaction.json",
    ...["main", "sub-1", "sub-2", "sub-3"].flatMap((role) => [
      `${role}.png`,
      `${role}.stdout.txt`,
    ]),
  ];
  const artifacts = [];
  for (const name of names) {
    try {
      artifacts.push({
        name,
        bytes: await readBoundedAt(directory, name, MAX_IMAGE_BYTES),
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!artifacts.length) return;
  await verifyDirectoryPath(outputRoot, directory);
  const archive = await openVerifiedDirectory(
    join(outputRoot, "history", randomUUID()),
    { create: true },
  );
  try {
    for (const item of artifacts)
      await writeStableTextAtDirectory(archive, item.name, item.bytes);
  } finally {
    await archive.close();
  }
}

import { basename, dirname, resolve, relative, isAbsolute } from "node:path";
import sharp from "sharp";
import {
  openVerifiedDirectory,
  openReadOnlyFileAtDirectory,
  assertFileHandleIdentity,
  assertFilePathIdentity,
} from "./file-lock.mjs";
import { hashText } from "./image-plan.mjs";
export const MAX_TEXT_BYTES = 2_000_000;
export const MAX_IMAGE_BYTES = 20_000_000;
export function containedPath(root, path) {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw Error("path must remain inside approved root");
  return target;
}
export async function readBoundedAt(
  directory,
  name,
  maxBytes = MAX_TEXT_BYTES,
) {
  const file = await openReadOnlyFileAtDirectory(directory, name);
  try {
    if (file.identity.size > maxBytes || file.identity.nlink !== 1)
      throw Error("file size/link bounds exceeded");
    await assertFileHandleIdentity(file);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw Error("file size bounds exceeded");
    const bytes = buffer.subarray(0, length);
    const after = await file.handle.stat();
    if (
      after.size !== file.identity.size ||
      after.mtimeMs !== file.identity.mtimeMs ||
      after.ctimeMs !== file.identity.ctimeMs ||
      after.nlink !== 1
    )
      throw Error("file changed during snapshot");
    await assertFileHandleIdentity(file);
    await assertFilePathIdentity(directory, name, file.identity);
    return bytes;
  } finally {
    await file.handle.close();
  }
}
export async function readBounded(path, maxBytes = MAX_TEXT_BYTES) {
  const directory = await openVerifiedDirectory(dirname(path), {
    create: false,
  });
  try {
    return await readBoundedAt(directory, basename(path), maxBytes);
  } finally {
    await directory.close();
  }
}
export async function decodePng(bytes) {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw Error("image byte bounds exceeded");
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "png" ||
      metadata.pages > 1 ||
      metadata.width < 16 ||
      metadata.height < 16 ||
      metadata.width > 8192 ||
      metadata.height > 8192
    )
      throw Error("PNG format/dimension bounds");
    await image.raw().toBuffer();
    return Object.freeze({
      sha256: hashText(bytes),
      bytes: bytes.length,
      format: "png",
      width: metadata.width,
      height: metadata.height,
    });
  } catch (error) {
    throw Error(`invalid PNG image: ${error.message}`);
  }
}

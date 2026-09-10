import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class OutputBoundaryError extends Error {
  constructor(message) { super(message); this.name = 'OutputBoundaryError'; this.code = 'OUTPUT_BOUNDARY'; }
}
const fail = (message) => { throw new OutputBoundaryError(message); };
const verifiedDirectories = new Map();

function parts(path) { return resolve(path).split(sep).filter(Boolean); }
function hasDataKeywordsSuffix(path) {
  const values = parts(path);
  return values.length >= 2 && values.at(-2) === 'data' && values.at(-1) === 'keywords';
}

/** Return the identity captured by the latest output-boundary preflight. */
export function expectedDirectoryIdentity(value) {
  const path = resolve(value);
  let best;
  for (const [root, identity] of verifiedDirectories) {
    const suffix = relative(root, path);
    if (suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix)) && (!best || root.length > best.root.length)) best = { root, identity };
  }
  return best;
}

/**
 * Validate the bounded data mapping before any output IO. Production and test
 * workspaces both use a path ending in `data/keywords`; arbitrary directories
 * are not accepted as an output root.
 */
export async function assertSafeOutputDir(value) {
  if (typeof value !== 'string' || value.trim() === '') fail('output directory is required');
  const output = resolve(value);
  if (!hasDataKeywordsSuffix(output)) fail('output directory must end in data/keywords');
  await assertNoSymlink(output, true);
  let info;
  try { info = await lstat(output); } catch (error) {
    if (error?.code === 'ENOENT') return output;
    throw error;
  }
  if (!info.isDirectory()) fail('output directory is not a directory');
  verifiedDirectories.set(output, { dev: info.dev, ino: info.ino });
  return output;
}

/** Ensure a path is lexically and physically inside a validated output root. */
export async function assertContainedPath(value, rootDir) {
  if (typeof value !== 'string' || value.trim() === '') fail('contained path is required');
  const root = await assertSafeOutputDir(rootDir);
  const target = resolve(value);
  const suffix = relative(root, target);
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) fail('path must remain contained by output directory');
  await assertNoSymlink(target, false);
  try {
    const info = await lstat(target);
    if (info.isDirectory() && !info.isSymbolicLink()) verifiedDirectories.set(target, { dev: info.dev, ino: info.ino });
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return target;
}

/** Reject symlink components, including a symlink output root or target file. */
async function assertNoSymlink(target, includeTarget) {
  const absolute = resolve(target);
  const root = parseRoot(absolute);
  let current = root;
  const remaining = parts(absolute).slice(root === sep ? 0 : 1);
  for (const segment of remaining) {
    current = current === sep ? joinRoot(root, segment) : resolve(current, segment);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) fail('output path cannot contain a symlink');
    if (!info.isDirectory() && current !== absolute) fail('output path parent is not a directory');
  }
  if (!includeTarget) {
    // The loop above checks the target when it exists. Missing leaf files are
    // allowed because callers create them atomically after this validation.
  }
}

function parseRoot(path) {
  return path.startsWith(sep) ? sep : '';
}
function joinRoot(root, segment) { return root === sep ? `${root}${segment}` : segment; }

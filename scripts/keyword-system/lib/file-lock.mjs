import { constants, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expectedDirectoryIdentity } from './output-boundary.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 10;
const STALE_MS = 60_000;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class FileLockError extends Error {
  constructor(message) { super(message); this.name = 'FileLockError'; this.code = 'FILE_LOCK'; }
}

function fail(message) { throw new FileLockError(message); }

/** Open one directory child without following any intermediate symlink. */
async function openDirectoryChild(parentHandle, segment, { create = true } = {}) {
  if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) fail('invalid directory component');
  const childPath = join(directoryFdPath(parentHandle), segment);
  let info;
  try { info = await lstat(childPath); }
  catch (error) {
    if (error?.code !== 'ENOENT' || !create) throw error;
    try { await mkdir(childPath); } catch (mkdirError) { if (mkdirError?.code !== 'EEXIST') throw mkdirError; }
    info = await lstat(childPath);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) fail('store directory must be a real directory');
  let child;
  try { child = await open(childPath, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); }
  catch { fail('store directory could not be opened without following symlinks'); }
  const after = await child.stat();
  if (after.dev !== info.dev || after.ino !== info.ino) { await child.close().catch(() => {}); fail('store directory changed during validation'); }
  return child;
}

/** Open a real directory and bind every path component to stable directory FDs. */
export async function openVerifiedDirectory(directory, { create = true } = {}) {
  const path = resolve(directory);
  const expected = expectedDirectoryIdentity(path);
  const assertExpectedRoot = async () => {
    if (!expected) return;
    let root;
    try { root = await lstat(expected.root); } catch { fail('validated output root disappeared or changed'); }
    if (root.dev !== expected.identity.dev || root.ino !== expected.identity.ino || root.isSymbolicLink()) fail('validated output root changed during write');
  };
  await assertExpectedRoot();
  const segments = path.split(/[\/]+/u).filter(Boolean);
  let current;
  try {
    current = await open('/', constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    for (const segment of segments) {
      const child = await openDirectoryChild(current, segment, { create });
      await current.close().catch(() => {});
      current = child;
    }
    await assertExpectedRoot();
    return current;
  } catch (error) {
    await current?.close().catch(() => {});
    throw error;
  }
}

export function directoryFdPath(handle) {
  if (!handle || !Number.isInteger(handle.fd)) fail('a verified directory handle is required');
  return `/proc/self/fd/${handle.fd}`;
}

export async function readFileAtDirectory(directoryHandle, name, encoding = 'utf8') {
  return readFile(join(directoryFdPath(directoryHandle), basename(name)), encoding);
}

/** Open each relative directory component through the previous directory FD. */
export async function openVerifiedNestedDirectory(rootHandle, relativeDirectory) {
  const parts = String(relativeDirectory ?? '').split(/[/\\]+/u).filter((part) => part && part !== '.');
  let current = rootHandle;
  const owned = [];
  try {
    for (const part of parts) {
      if (part === '..') fail('nested directory escapes its verified root');
      const child = await openDirectoryChild(current, part, { create: true });
      owned.push(child);
      current = child;
    }
    return { handle: current, owned };
  } catch (error) {
    await Promise.all(owned.map((handle) => handle.close().catch(() => {})));
    throw error;
  }
}

export async function appendFileAtDirectory(directoryHandle, name, text) {
  const target = join(directoryFdPath(directoryHandle), basename(name));
  let handle;
  try {
    handle = await open(target, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | O_NOFOLLOW, 0o600);
    await handle.writeFile(text, 'utf8');
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function removeFileAtDirectory(directoryHandle, name) {
  await rm(join(directoryFdPath(directoryHandle), basename(name)), { force: true, recursive: true });
}

export async function writeStableTextAtDirectory(directoryHandle, name, text) {
  const target = join(directoryFdPath(directoryHandle), basename(name));
  const temporary = join(directoryFdPath(directoryHandle), `.${basename(name)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); }
    finally { await handle.close().catch(() => {}); }
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}
function parseOwner(text) {
  try {
    const owner = JSON.parse(text);
    if (typeof owner?.token === 'string' && Number.isInteger(owner.pid)) return owner;
  } catch { /* invalid lock metadata is not trusted as live */ }
  return undefined;
}
async function readLockOwner(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return undefined;
    return parseOwner(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    return undefined;
  }
}

/** Serialize all lock-path inspection/removal/installation operations. */
async function acquireGuard(parentHandle, lockInstallPath, timeoutMs, staleMs) {
  const guardPath = `${lockInstallPath}.guard`;
  const token = randomBytes(16).toString('hex');
  const started = Date.now();
  while (true) {
    let handle;
    try {
      handle = await open(guardPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n', 'utf8');
      return { handle, token, path: guardPath };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await lstat(guardPath);
        const owner = await readLockOwner(guardPath);
        if (owner?.state === 'released' || owner !== undefined && !processAlive(owner.pid) && Date.now() - info.mtimeMs > staleMs) await rm(guardPath, { force: true });
      } catch (inspectError) { if (inspectError?.code !== 'ENOENT') throw inspectError; }
      if (Date.now() - started >= timeoutMs) throw new FileLockError('timed out waiting for exclusive lock guard');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, RETRY_MS));
    }
  }
}

async function markReleased(handle, token) {
  try {
    const text = Buffer.from(JSON.stringify({ token, pid: process.pid, state: 'released' }) + '\n', 'utf8');
    await handle.truncate(0);
    await handle.write(text, 0, text.length, 0);
  } catch { /* a crashed/failed owner leaves active metadata for stale recovery */ }
}

async function releaseGuard(guard) {
  if (!guard) return;
  const identity = await guard.handle.stat().catch(() => undefined);
  await markReleased(guard.handle, guard.token);
  const current = await lstat(guard.path).catch(() => undefined);
  const owner = await readLockOwner(guard.path);
  if (identity && current && owner?.token === guard.token && current.dev === identity.dev && current.ino === identity.ino) await rm(guard.path, { force: true }).catch(() => {});
  await guard.handle.close().catch(() => {});
}

/**
 * Acquire an exclusive lock. Inspection and removal of the canonical lock are
 * serialized by a guard in the same verified parent directory. This closes the
 * read-then-unlink window where an old owner could remove a replacement owner.
 */
export async function withExclusiveFileLock(filePath, task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withExclusiveFileLock requires a task function');
  const lockPath = resolve(filePath);
  const parentHandle = await openVerifiedDirectory(dirname(lockPath));
  const lockInstallPath = join(directoryFdPath(parentHandle), basename(lockPath));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) { await parentHandle.close(); throw new TypeError('lock timeout must be positive'); }
  const token = randomBytes(16).toString('hex');
  const started = Date.now();
  let handle;
  try {
    while (handle === undefined) {
      const remaining = Math.max(1, timeoutMs - (Date.now() - started));
      const guard = await acquireGuard(parentHandle, lockInstallPath, remaining, staleMs);
      try {
        let created = false;
        try {
          handle = await open(lockInstallPath, 'wx', 0o600);
          created = true;
          await handle.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n', 'utf8');
        } catch (error) {
          await handle?.close().catch(() => {}); handle = undefined;
          if (created) await rm(lockInstallPath, { force: true }).catch(() => {});
          if (error?.code !== 'EEXIST') throw error;
          const info = await lstat(lockInstallPath).catch((inspectError) => { if (inspectError?.code === 'ENOENT') return undefined; throw inspectError; });
          if (info?.isSymbolicLink() || info && !info.isFile()) throw new FileLockError('lock path must not be a symlink or directory');
          const owner = info ? await readLockOwner(lockInstallPath) : undefined;
          if (owner?.state === 'released' || owner !== undefined && !processAlive(owner.pid) && Date.now() - info.mtimeMs > staleMs) await rm(lockInstallPath, { force: true });
        }
      } finally { await releaseGuard(guard); }
      if (handle === undefined) {
        if (Date.now() - started >= timeoutMs) throw new FileLockError('timed out waiting for exclusive store lock');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, RETRY_MS));
      }
    }
    return await task({ directoryHandle: parentHandle, ownerToken: token });
  } finally {
    if (handle !== undefined) {
      // Mark the original inode through its FD, then remove the pathname only
      // while a guard confirms that the same token/inode is still installed.
      // A replacement owner is therefore never unlinked by this owner.
      const identity = await handle.stat().catch(() => undefined);
      await markReleased(handle, token);
      const guard = await acquireGuard(parentHandle, lockInstallPath, timeoutMs, staleMs).catch(() => undefined);
      try {
        const current = await lstat(lockInstallPath).catch(() => undefined);
        const owner = await readLockOwner(lockInstallPath);
        if (guard && identity && current && owner?.token === token && owner.state === 'released' && current.dev === identity.dev && current.ino === identity.ino) await rm(lockInstallPath, { force: true });
      } finally { await releaseGuard(guard); }
      await handle.close().catch(() => {});
    }
    await parentHandle.close().catch(() => {});
  }
}

export async function removeVerifiedFile(filePath) {
  const parentHandle = await openVerifiedDirectory(dirname(resolve(filePath)), { create: false });
  try { await removeFileAtDirectory(parentHandle, basename(filePath)); }
  finally { await parentHandle.close().catch(() => {}); }
}

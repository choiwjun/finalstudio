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

/** Open a real directory and bind subsequent work to its inode. */
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
  if (create) await mkdir(path, { recursive: true });
  await assertExpectedRoot();
  let before;
  try { before = await lstat(path); } catch (error) { throw error; }
  if (!before.isDirectory() || before.isSymbolicLink()) fail('store directory must be a real directory');
  await assertExpectedRoot();
  let handle;
  try { handle = await open(path, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); } catch { fail('store directory could not be opened without following symlinks'); }
  try {
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino) fail('store directory changed during validation');
    await assertExpectedRoot();
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
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
      const childPath = join(directoryFdPath(current), part);
      await mkdir(childPath, { recursive: true });
      const child = await openVerifiedDirectory(childPath, { create: false });
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
  } catch { /* invalid/stale lock is handled by mtime and is not trusted as live */ }
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

/**
 * Acquire an exclusive lock. The lock path is opened through a verified parent
 * directory handle, so replacing the lexical parent with a symlink cannot
 * redirect the critical section. Stale recovery only removes locks whose PID
 * is demonstrably dead; release removes a lock only when its owner token still
 * matches, so an old owner cannot unlink a replacement owner's lock.
 */
export async function withExclusiveFileLock(filePath, task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withExclusiveFileLock requires a task function');
  const lockPath = resolve(filePath);
  const parentPath = dirname(lockPath);
  const parentHandle = await openVerifiedDirectory(parentPath);
  const lockInstallPath = join(directoryFdPath(parentHandle), basename(lockPath));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) { await parentHandle.close(); throw new TypeError('lock timeout must be positive'); }
  const token = randomBytes(16).toString('hex');
  const started = Date.now();
  let handle;
  try {
    while (handle === undefined) {
      let created = false;
      try {
        handle = await open(lockInstallPath, 'wx', 0o600);
        created = true;
        await handle.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n', 'utf8');
      } catch (error) {
        if (handle !== undefined) await handle.close().catch(() => {});
        handle = undefined;
        if (created) await rm(lockInstallPath, { force: true }).catch(() => {});
        if (error?.code !== 'EEXIST') throw error;
        let owner;
        try {
          const info = await lstat(lockInstallPath);
          if (info.isSymbolicLink() || !info.isFile()) throw new FileLockError('lock path must not be a symlink or directory');
          owner = await readLockOwner(lockInstallPath);
          if (owner === undefined && Date.now() - info.mtimeMs > staleMs) await rm(lockInstallPath, { force: true });
          else if (owner !== undefined && !processAlive(owner.pid) && Date.now() - info.mtimeMs > staleMs) {
            // A dead owner cannot release later. The PID check is the safety
            // gate; a live owner is never reclaimed merely because it is old.
            await rm(lockInstallPath, { force: true });
          }
        } catch (statError) {
          if (statError?.code !== 'ENOENT') throw statError;
        }
        if (Date.now() - started >= timeoutMs) throw new FileLockError('timed out waiting for exclusive store lock');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, RETRY_MS));
      }
    }
    return await task({ directoryHandle: parentHandle, ownerToken: token });
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
      const owner = await readLockOwner(lockInstallPath);
      if (owner?.token === token && owner.pid === process.pid) await rm(lockInstallPath, { force: true }).catch(() => {});
    }
    await parentHandle.close().catch(() => {});
  }
}

export async function removeVerifiedFile(filePath) {
  const parentHandle = await openVerifiedDirectory(dirname(resolve(filePath)), { create: false });
  try { await removeFileAtDirectory(parentHandle, basename(filePath)); }
  finally { await parentHandle.close().catch(() => {}); }
}

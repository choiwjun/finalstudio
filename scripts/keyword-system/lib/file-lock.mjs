import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 10;
const STALE_MS = 60_000;

export class FileLockError extends Error {
  constructor(message) { super(message); this.name = 'FileLockError'; this.code = 'FILE_LOCK'; }
}

/** Acquire a filesystem-exclusive lock, run a critical section, and clean up. */
export async function withExclusiveFileLock(filePath, task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withExclusiveFileLock requires a task function');
  const lockPath = resolve(filePath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('lock timeout must be positive');
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  let handle;
  while (handle === undefined) {
    let created = false;
    try {
      handle = await open(lockPath, 'wx');
      created = true;
      await handle.writeFile(`${process.pid}\n`, 'utf8');
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => {});
      if (created) await rm(lockPath, { force: true }).catch(() => {});
      handle = undefined;
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) await rm(lockPath, { force: true });
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
      }
      if (Date.now() - started >= timeoutMs) throw new FileLockError('timed out waiting for exclusive store lock');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, RETRY_MS));
    }
  }
  try {
    return await task();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

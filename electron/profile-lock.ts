import { open, readFile, unlink, mkdir, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** A lock being written right now may briefly be empty; older unreadable locks are crash leftovers. */
const WRITING_GRACE_MS = 5000;
/** Tolerance between the boot clock and file timestamps. */
const BOOT_MARGIN_MS = 60_000;

/**
 * Whether an existing owner.lock still belongs to a live Dayweave process.
 * A PID check alone is not enough: after a reboot the recorded PID can belong to an unrelated
 * system process, so a lock written before this boot is stale whatever its PID now names.
 */
async function ownerState(target: string): Promise<'live' | 'stale' | 'writing'> {
  const [content, info] = await Promise.all([readFile(target, 'utf8'), stat(target)]);
  const bootedAt = Date.now() - os.uptime() * 1000;
  if (info.mtimeMs < bootedAt - BOOT_MARGIN_MS) return 'stale';
  let pid: unknown;
  try {
    pid = JSON.parse(content).pid;
  } catch {
    return Date.now() - info.mtimeMs < WRITING_GRACE_MS ? 'writing' : 'stale';
  }
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return 'stale';
  try {
    process.kill(pid as number, 0);
  } catch (error) {
    // EPERM means the process exists under another account: still an owner.
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'stale';
  }
  return 'live';
}

export async function lockProfile(directory: string) {
  await mkdir(directory, { recursive: true });
  // Windows named pipes are kernel-owned and vanish even after an abrupt process exit.
  // Serialize stale owner.lock recovery as well as normal startup; retain owner.lock
  // for compatibility with installed desktop versions that only know that file.
  const guard =
    process.platform === 'win32' ? createServer((socket) => socket.destroy()) : undefined;
  if (guard) {
    const identity = createHash('sha256')
      .update((await realpath(directory)).toLowerCase())
      .digest('hex');
    await new Promise<void>((resolve, reject) => {
      guard.once('error', reject);
      guard.listen(`\\\\.\\pipe\\dayweave-profile-${identity}`, () => {
        guard.off('error', reject);
        resolve();
      });
    });
  }
  const releaseGuard = async () => {
    if (guard?.listening) await new Promise<void>((resolve) => guard.close(() => resolve()));
  };
  const target = path.join(directory, 'owner.lock');
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try {
    // Enough attempts to outlast the writing grace period and then replace the leftover.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const file = await open(target, 'wx', 0o600);
        try {
          await file.writeFile(identity);
          await file.sync();
        } finally {
          await file.close();
        }
        return async () => {
          try {
            if ((await readFile(target, 'utf8')) === identity) await unlink(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          } finally {
            await releaseGuard();
          }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let state: Awaited<ReturnType<typeof ownerState>>;
        try {
          state = await ownerState(target);
        } catch (failure) {
          // The other owner released it between our attempts.
          if ((failure as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw failure;
        }
        if (state === 'writing') {
          await delay(WRITING_GRACE_MS / 4);
          continue;
        }
        if (state === 'stale') {
          // Keep the evidence instead of deleting it.
          await rename(target, `${target}.stale-${Date.now()}`);
          continue;
        }
        throw new Error(
          '此数据目录已由运行中的 Dayweave 使用。请关闭另一个实例或选择独立 DAYWEAVE_DATA_DIR。',
        );
      }
    }
    throw new Error('无法锁定数据目录');
  } catch (error) {
    await releaseGuard();
    throw error;
  }
}

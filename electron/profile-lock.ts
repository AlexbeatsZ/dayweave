import { open, readFile, unlink, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
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
  const identity = JSON.stringify({ pid: process.pid, nonce: crypto.randomUUID() });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(target, 'wx', 0o600);
        try {
          await file.writeFile(identity);
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
        const old = JSON.parse(await readFile(target, 'utf8'));
        if (!Number.isSafeInteger(old.pid) || old.pid <= 0)
          throw new Error('Invalid profile owner.lock; preserve it and inspect before recovery');
        try {
          process.kill(old.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            await unlink(target);
            continue;
          }
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

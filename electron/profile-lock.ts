import { open, readFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
export async function lockProfile(directory: string) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, 'owner.lock');
  const identity = JSON.stringify({ pid: process.pid, nonce: crypto.randomUUID() });
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
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const old = JSON.parse(await readFile(target, 'utf8'));
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
}

import fs, { open, readFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import type { JsonFiles } from '../src/persistence.js';

/** Write through a synced temporary file and rename, so readers see the old or new bytes only. */
export async function writeAtomic(file: string, content: string, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const handle = await open(temporary, 'w', mode);
  try {
    // A temporary left by a crash keeps its old mode; credentials must stay private.
    await handle.chmod(mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rename(temporary, file);
      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EACCES', 'EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') ||
        attempt === 9
      )
        throw error;
      // A reader or scanner can briefly deny replacement on Windows.
      await delay(100);
    }
  }
}

/** Keep the first copy of a migration source; later calls leave it untouched. */
export async function preserveOnce(file: string, content: string) {
  try {
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function readOptional(file: string) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The repository's file interface over one profile directory. */
export function directoryFiles(directory: string): JsonFiles {
  return {
    read: (name) => readOptional(path.join(directory, name)),
    write: (name, content) => writeAtomic(path.join(directory, name), content),
    preserve: (name, content) => preserveOnce(path.join(directory, name), content),
  };
}

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUDAN_CAPTURE_RESULT_FUNCTION } from '../src/fudan-capture.ts';

const output =
  process.argv[2] ??
  fileURLToPath(new URL('../android/app/src/main/assets/fudan-capture.js', import.meta.url));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, FUDAN_CAPTURE_RESULT_FUNCTION, 'utf8');

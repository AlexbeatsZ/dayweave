import { mkdir, writeFile } from 'node:fs/promises';
import { FUDAN_CAPTURE_SCRIPT } from '../src/fudan-capture.ts';

await mkdir('android/app/src/main/assets', { recursive: true });
await writeFile('android/app/src/main/assets/fudan-capture.js', FUDAN_CAPTURE_SCRIPT, 'utf8');

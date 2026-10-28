import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import electron from 'electron';
import { existsSync } from 'node:fs';
if (!existsSync('native-bin/work-review-agent.exe'))
  throw new Error('Run npm run build:collector before packaging.');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows x64 packaging must run on Windows x64.');
}

// Reuse the project runtime, avoiding a second download/extract/rename path.
const require = createRequire(import.meta.url);
const targets = process.argv.slice(2);
const child = spawn(
  process.execPath,
  [
    require.resolve('electron-builder/cli.js'),
    '--win',
    ...targets,
    '--x64',
    '--publish',
    'never',
    `--config.electronDist=${path.dirname(electron)}`,
  ],
  { stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

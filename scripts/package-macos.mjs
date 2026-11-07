import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
if (process.platform !== 'darwin') throw new Error('Build macOS packages on a Mac.');
if (process.arch !== 'arm64' || (process.argv[2] && process.argv[2] !== 'arm64'))
  throw new Error('Build macOS packages on an Apple Silicon Mac (arm64 only).');
if (!existsSync('native-bin/work-review-agent'))
  throw new Error('Run npm run build:collector for the selected architecture before packaging.');
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve('electron-builder/cli.js'),
    '--mac',
    '--arm64',
    '--publish',
    'never',
    `--config.electronDist=${path.join(path.dirname(require.resolve('electron/package.json')), 'dist')}`,
  ],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

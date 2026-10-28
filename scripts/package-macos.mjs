import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import electron from 'electron';
import { existsSync } from 'node:fs';
if (!existsSync('native-bin/work-review-agent'))
  throw new Error('Run npm run build:collector for the selected architecture before packaging.');
if (process.platform !== 'darwin') throw new Error('Build macOS packages on a Mac.');
const arch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Choose arm64 or x64.');
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve('electron-builder/cli.js'),
    '--mac',
    '--' + arch,
    '--publish',
    'never',
    ...(arch === process.arch
      ? [
          `--config.electronDist=${path.join(path.dirname(require.resolve('electron/package.json')), 'dist')}`,
        ]
      : []),
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

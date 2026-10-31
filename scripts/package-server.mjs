import { build } from 'rolldown';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const app = JSON.parse(await readFile('package.json', 'utf8'));
const server = JSON.parse(await readFile('server/package.json', 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = path.join(root, 'release', 'Dayweave-Server');
await mkdir(output, { recursive: true });
await build({
  input: 'electron/headless-runtime.ts',
  platform: 'node',
  output: { file: path.join(output, 'runtime.mjs'), format: 'esm', codeSplitting: false },
  external: [/^node:/],
});
const files = {
  'server/run.mjs': 'server.mjs',
  'server/admin.mjs': 'admin.mjs',
  'server/config.mjs': 'config.mjs',
  'server/server.example.json': 'server.example.json',
  'server/start.ps1': 'start.ps1',
  'server/stage-update.mjs': 'stage-update.mjs',
  'server/README.md': 'README.md',
  'scripts/api.mjs': 'api.mjs',
  LICENSE: 'LICENSE',
  'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_LICENSES.txt': 'THIRD_PARTY_LICENSES.txt',
};
for (const [source, target] of Object.entries(files))
  await copyFile(source, path.join(output, target));
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify(
    {
      ...server,
      appVersion: app.version,
      sourceCommit,
    },
    null,
    2,
  ) + '\n',
);
const expected = new Set(['runtime.mjs', 'package.json', ...Object.values(files)]);
for (const file of await readdir(output))
  if (!expected.has(file))
    throw new Error(`Unexpected package file ${file}; inspect before publishing`);
if (process.argv.includes('--zip')) {
  if (process.platform !== 'win32') throw new Error('--zip requires Windows Compress-Archive');
  const archive = path.join(root, 'release', `Dayweave-Server-${server.version}.zip`);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(root, 'scripts', 'archive-server.ps1'),
      '-Source',
      output,
      '-Target',
      archive,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  console.log(archive);
}
console.log(
  `Bundled Dayweave Server ${server.version} (app ${app.version}, ${sourceCommit}); no runtime npm dependencies.`,
);

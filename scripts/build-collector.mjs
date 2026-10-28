import { spawn, execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (!['win32', 'darwin'].includes(process.platform))
  throw new Error('Build the collector on Windows or macOS.');
const target = process.argv[2];
const child = spawn(
  'cargo',
  [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    'native/collector/Cargo.toml',
    '-p',
    'work-review-agent',
    ...(target ? ['--target', target] : []),
  ],
  { stdio: 'inherit', windowsHide: true },
);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
if (code !== 0) process.exit(code ?? 1);
const name = process.platform === 'win32' ? 'work-review-agent.exe' : 'work-review-agent';
await mkdir('native-bin', { recursive: true });
await copyFile(
  path.join('native/collector/target', target ?? '', 'release', name),
  path.join('native-bin', name),
);
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      'native/collector/Cargo.toml',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  ),
);
const notices = [await readFile('THIRD_PARTY_NOTICES.md', 'utf8')];
for (const dependency of metadata.packages
  .filter((entry) => entry.source)
  .sort((left, right) => left.name.localeCompare(right.name))) {
  const root = path.dirname(dependency.manifest_path);
  const files = (await readdir(root)).filter((file) =>
    /^(licen[cs]e|copying)(?:[._-]|$)/i.test(file),
  );
  if (dependency.license_file && !files.includes(dependency.license_file))
    files.push(dependency.license_file);
  notices.push(
    `\n## ${dependency.name} ${dependency.version}\nLicense: ${dependency.license ?? 'See supplied license file'}\nSource: ${dependency.repository ?? dependency.source}\n`,
  );
  for (const file of files) {
    try {
      notices.push(await readFile(path.join(root, file), 'utf8'));
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
    }
  }
}
await writeFile('native-bin/COLLECTOR_LICENSES.txt', notices.join('\n'), 'utf8');

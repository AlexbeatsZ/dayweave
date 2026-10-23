import { build } from 'rolldown';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release/Dayweave-AI-tools', { recursive: true });
await build({
  input: 'electron/headless.ts',
  platform: 'node',
  output: { file: 'release/Dayweave-AI-tools/headless.mjs', format: 'esm', codeSplitting: false },
  external: [/^node:/],
});
await copyFile('scripts/api.mjs', 'release/Dayweave-AI-tools/api.mjs');
await copyFile('docs/api/openapi.json', 'release/Dayweave-AI-tools/openapi.json');
await copyFile('docs/api/README.md', 'release/Dayweave-AI-tools/README.md');
await copyFile('LICENSE', 'release/Dayweave-AI-tools/LICENSE');
await copyFile('THIRD_PARTY_NOTICES.md', 'release/Dayweave-AI-tools/THIRD_PARTY_NOTICES.md');
await copyFile('THIRD_PARTY_LICENSES.txt', 'release/Dayweave-AI-tools/THIRD_PARTY_LICENSES.txt');
await writeFile(
  'release/Dayweave-AI-tools/package.json',
  JSON.stringify(
    {
      name: 'dayweave-ai-tools',
      version,
      private: true,
      type: 'module',
      license: 'MIT',
      engines: { node: '>=24' },
      scripts: { start: 'node headless.mjs' },
    },
    null,
    2,
  ),
);
console.log('Bundled standalone API and CLI; no runtime npm dependencies.');

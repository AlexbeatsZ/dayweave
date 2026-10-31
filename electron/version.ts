import { readFileSync } from 'node:fs';

// Source, tsc output, and standalone bundles keep their own package metadata.
let version: string | undefined;
export function appVersion() {
  if (version) return version;
  for (const relative of ['./package.json', '../package.json', '../../package.json'])
    try {
      const info = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
      if (['dayweave', 'dayweave-ai-tools', 'dayweave-server'].includes(info.name)) {
        version = String(info.appVersion ?? info.version);
        return version;
      }
    } catch {}
  throw new Error('Dayweave package version metadata is missing');
}

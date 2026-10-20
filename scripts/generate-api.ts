import { mkdir, writeFile } from 'node:fs/promises';
import { openapi } from '../src/api-contract';
import { format } from 'prettier';
await mkdir('docs/api', { recursive: true });
await writeFile('docs/api/openapi.json', await format(JSON.stringify(openapi), { parser: 'json' }));

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value) throw new Error(`Missing ${name}`);
  args.splice(at, 2);
  return value;
};
const profile =
  option('--profile') ??
  process.env.DAYWEAVE_DATA_DIR ??
  (process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'Dayweave')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Application Support/Dayweave')
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Dayweave'));
const bodyFile = option('--body-file');
const match = option('--if-match');
const [method = 'GET', endpoint = '/health'] = args;
try {
  const credentials = JSON.parse(await readFile(path.join(profile, 'api.json'), 'utf8'));
  const base = new URL(credentials.url);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname))
    throw new Error('Refusing to send the local token to a remote address');
  if (!endpoint.startsWith('/') || endpoint.includes('..') || endpoint.includes('://'))
    throw new Error('Use an API path such as /tasks');
  const response = await fetch(`${base.href.replace(/\/$/, '')}${endpoint}`, {
    method: method.toUpperCase(),
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      ...(bodyFile ? { 'Content-Type': 'application/json' } : {}),
      ...(match ? { 'If-Match': match } : {}),
    },
    ...(bodyFile ? { body: await readFile(bodyFile, 'utf8') } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  console.log(JSON.stringify(value, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Dayweave API: ${error.message}`);
  process.exitCode = 1;
}

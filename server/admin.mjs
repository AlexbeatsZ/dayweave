import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkNode, loadConfig } from './config.mjs';

try {
  checkNode();
  const args = process.argv.slice(2);
  if (args[0] !== '--config' || !args[1])
    throw new Error(
      'Usage: node admin.mjs --config <server.json> status|usage|invite|sync|revoke <id>|stop',
    );
  const config = await loadConfig(args[1]);
  const credentials = JSON.parse(await readFile(path.join(config.profile, 'api.json'), 'utf8'));
  const base = new URL(credentials.url);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(base.hostname) ||
    base.pathname !== '/api/v1' ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error('Refusing a non-loopback API credential URL');
  const request = async (method, route) => {
    const response = await fetch(base.href + route, {
      method,
      headers: { Authorization: `Bearer ${credentials.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? `HTTP ${response.status}`);
    return result;
  };
  const health = (await request('GET', '/health')).data;
  if (health.mode !== 'server')
    throw new Error(
      'The profile is served by a desktop/headless client; server administration refused',
    );
  const command = args[2] ?? 'status';
  const operations = {
    status: ['GET', '/server/status'],
    usage: ['GET', '/usage/status'],
    invite: ['POST', '/sync/invite'],
    sync: ['POST', '/sync/now'],
    stop: ['POST', '/server/shutdown'],
  };
  if (command === 'revoke') {
    if (!/^[\w-]{1,100}$/.test(args[3] ?? '') || args.length !== 4)
      throw new Error('revoke requires one exact device ID');
    operations.revoke = ['DELETE', `/sync/peers/${encodeURIComponent(args[3])}`];
  } else if (args.length > 3) throw new Error('Unexpected arguments');
  if (!operations[command]) throw new Error('Unknown administration command');
  const result = await request(...operations[command]);
  if (command === 'stop') {
    // The authenticated request acknowledges intent; wait for profile release too.
    const started = Date.now();
    for (;;) {
      let owner;
      try {
        owner = JSON.parse(await readFile(path.join(config.profile, 'owner.lock'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
      if (owner.pid !== credentials.pid)
        throw new Error('Profile owner changed while stopping; inspect status');
      if (Date.now() - started > 45000)
        throw new Error(
          'Shutdown has not released the profile; inspect logs, do not force termination',
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Dayweave Server administration:', error.message);
  process.exitCode = 1;
}

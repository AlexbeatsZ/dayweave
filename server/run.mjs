import { readFile } from 'node:fs/promises';
import { startHeadless } from './runtime.mjs';
import { checkNode, loadConfig, requireExistingProfile } from './config.mjs';

let runtime;
const finish = (error) => {
  if (error) console.error('Dayweave Server shutdown failed:', error);
  process.exit(error ? 1 : 0);
};
try {
  checkNode();
  if (process.argv.length !== 4 || process.argv[2] !== '--config')
    throw new Error('Usage: node server.mjs --config <absolute server.json>');
  const config = await loadConfig(process.argv[3]);
  await requireExistingProfile(config);
  const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  runtime = await startHeadless({
    directory: config.profile,
    apiPort: config.apiPort,
    discovery: config.discovery,
    enableHub: config.hub === 'enable',
    initialHubPort: config.initialHubPort,
    server: {
      version: manifest.version,
      appVersion: manifest.appVersion,
      sourceCommit: manifest.sourceCommit,
    },
    onShutdown: finish,
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void runtime.close().then(() => finish(), finish);
    });
  console.log(
    JSON.stringify({
      event: 'ready',
      product: 'Dayweave Server',
      version: manifest.version,
      appVersion: manifest.appVersion,
      pid: process.pid,
      profile: config.profile,
      api: runtime.api.info.url,
      hubPort: runtime.sync.client.config.hub?.port,
      localCapture: false,
    }),
  );
} catch (error) {
  console.error('Dayweave Server:', error.message);
  if (runtime) await runtime.close().catch((failure) => console.error(failure));
  process.exit(1);
}

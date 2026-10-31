import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHeadless, defaultProfile } from './headless-runtime.js';
const directory = path.resolve(process.env.DAYWEAVE_DATA_DIR ?? defaultProfile());
const runtime = await startHeadless({
  directory,
  apiPort: Number(process.env.DAYWEAVE_API_PORT ?? 49731),
  binary:
    fileURLToPath(
      new URL(
        import.meta.url.endsWith('.mjs')
          ? './native-bin/'
          : import.meta.url.endsWith('.ts')
            ? '../native-bin/'
            : '../../native-bin/',
        import.meta.url,
      ),
    ) + (process.platform === 'win32' ? 'work-review-agent.exe' : 'work-review-agent'),
  enableHub: process.env.DAYWEAVE_SYNC_HUB === '1',
});
const { sync, api } = runtime;
if (process.argv.includes('--invite')) {
  await sync.enableHub();
  console.log(`Dayweave pairing invitation (expires in 5 minutes):\n${await sync.invite()}`);
}
console.log(`Dayweave API ${api.info.url}; local credentials: ${path.join(directory, 'api.json')}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void runtime.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  });

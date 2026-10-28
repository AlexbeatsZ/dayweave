import path from 'node:path';
import os from 'node:os';
import { FileStore } from './storage.js';
import { StateService } from './state-service.js';
import { startApi } from './api.js';
import { lockProfile } from './profile-lock.js';
import { DesktopSync } from './sync.js';
import { UsageStore } from './usage-store.js';
import { DesktopUsage } from './usage.js';
const directory =
  process.env.DAYWEAVE_DATA_DIR ??
  path.join(
    process.platform === 'win32'
      ? process.env.APPDATA!
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')),
    'Dayweave',
  );
const unlock = await lockProfile(directory);
const service = new StateService(new FileStore(directory));
const sync = await new DesktopSync(service, directory).initialize();
const usage = await new DesktopUsage(
  new UsageStore(path.join(directory, 'usage.db')),
  sync,
  directory,
  path.resolve(
    'native-bin',
    process.platform === 'win32' ? 'work-review-agent.exe' : 'work-review-agent',
  ),
).initialize();
const api = await startApi(service, Number(process.env.DAYWEAVE_API_PORT ?? 49731), () => sync);
if (process.env.DAYWEAVE_SYNC_HUB === '1') await sync.enableHub();
if (process.argv.includes('--invite')) {
  await sync.enableHub();
  console.log(`Dayweave pairing invitation (expires in 5 minutes):\n${await sync.invite()}`);
}
console.log(`Dayweave API ${api.info.url}; local credentials: ${path.join(directory, 'api.json')}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void api
      .close()
      .then(() => sync.close())
      .then(() => usage.close())
      .then(() => service.flush())
      .then(unlock)
      .then(() => process.exit(0));
  });

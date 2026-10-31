import path from 'node:path';
import os from 'node:os';
import { FileStore } from './storage.js';
import { StateService } from './state-service.js';
import { startApi } from './api.js';
import { lockProfile } from './profile-lock.js';
import { DesktopSync } from './sync.js';
import { UsageStore } from './usage-store.js';
import { DesktopUsage } from './usage.js';

export { lockProfile };
export function defaultProfile() {
  const root =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  if (!root) throw new Error('APPDATA is unavailable; specify an absolute profile path');
  return path.join(root, 'Dayweave');
}

export type HeadlessOptions = {
  directory: string;
  apiPort?: number;
  discovery?: boolean;
  binary?: string;
  enableHub?: boolean;
  initialHubPort?: number;
  server?: { version: string; appVersion: string; sourceCommit: string };
  onShutdown?: (error?: unknown) => void;
};

export async function startHeadless(options: HeadlessOptions) {
  const directory = path.resolve(options.directory);
  const unlock = await lockProfile(directory);
  const service = new StateService(new FileStore(directory));
  const sync = new DesktopSync(service, directory, options.discovery ?? true);
  let usage: DesktopUsage | undefined;
  let api: Awaited<ReturnType<typeof startApi>> | undefined;
  let closing = false;
  let shutdown: Promise<void> | undefined;
  const close = () => {
    closing = true;
    shutdown ??= (async () => {
      // Do not release the profile if draining/closing fails: the caller exits nonzero,
      // and stale-lock recovery can then check that this process really ended.
      await api?.close();
      await sync.close();
      await usage?.close();
      service.dispose();
      await service.flush();
      await unlock();
    })();
    return shutdown;
  };
  try {
    await service.snapshot();
    await sync.initialize();
    usage = new DesktopUsage(
      new UsageStore(path.join(directory, 'usage.db')),
      sync,
      directory,
      options.binary ?? '',
      !options.server,
    );
    await usage.initialize();
    if (options.enableHub) await sync.enableHub(options.initialHubPort);
    api = await startApi(service, options.apiPort, () => sync, {
      ...(options.server
        ? {
            health: {
              ...options.server,
              mode: 'server',
              product: 'Dayweave Server',
              hubPort: sync.client.config.hub?.port,
            },
            strictPort: true,
            management: {
              usage,
              closing: () => closing,
              shutdown: () => {
                void close().then(
                  () => options.onShutdown?.(),
                  (error) => options.onShutdown?.(error),
                );
              },
            },
          }
        : {}),
    });
    return { service, sync, usage, api, close };
  } catch (error) {
    await close().catch((failure) => {
      console.error('Dayweave startup cleanup failed:', failure);
    });
    throw error;
  }
}

import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { JsonRepository } from './persistence';
import { stateSchema } from './model';
import { SyncClient } from './sync/client';
import { SyncScheduler } from './sync/scheduler';
import { store } from './store';
import { invitationText, pendingPairingKey } from './sync/invitation';
let syncClient: SyncClient | undefined;
let appActive = true;
const syncScheduler = new SyncScheduler(async () => {
  const now = Date.now();
  if (now - lastUsageSync > 15000) {
    lastUsageSync = now;
    void nativeUsageSync().catch(() => {});
  }
  await syncClient?.now();
});
let lastUsageSync = 0;
let usageSyncRunning: Promise<void> | undefined;
async function nativeUsageSync() {
  usageSyncRunning ??= files.usage({ action: 'sync' }).finally(() => {
    usageSyncRunning = undefined;
    window.dispatchEvent(new Event('dayweave:usage'));
  });
  return usageSyncRunning;
}
let syncStarted = false;

import { nativeFiles as files } from './native-files';
export const isMobileApp = Capacitor.isNativePlatform();

export async function initializeMobile() {
  if (!isMobileApp) return;
  document.documentElement.classList.add('native-mobile');
  const repository = new JsonRepository({
    read: async (name) => (await files.read({ name })).content,
    write: (name, content) => files.write({ name, content }),
  });
  window.clearlist = {
    usage: {
      query: (query) => files.usage({ action: 'query', value: query }),
      status: () => files.usage({ action: 'status' }),
      configure: (settings) => files.usage({ action: 'configure', value: settings }),
      import: async (events) => (await files.usage({ action: 'import', value: { events } })).count,
      sync: () => files.usage({ action: 'sync' }),
      permission: (kind) => files.usagePermission({ kind }),
      applications: async () => (await files.usage({ action: 'applications' })).applications,
    },
    platform: 'android',
    load: async () => ({ ...(await repository.load()), path: '此设备 · 应用私有存储' }),
    save: (state) => repository.save(state),
    exportData: async (state) =>
      (
        await files.exportBackup({
          content: JSON.stringify(stateSchema.parse(state), null, 2),
          name: `Dayweave-${Date.now()}.json`,
        })
      ).saved,
    importData: async () => {
      const { content } = await files.pickBackup();
      return content === null ? null : JSON.parse(content);
    },
    restoreData: async () => {
      const { content } = await files.pickBackup();
      return content === null
        ? null
        : { ...(await repository.restore(JSON.parse(content))), path: '此设备 · 应用私有存储' };
    },
    setTheme: (theme) =>
      files.appearance({
        dark:
          theme === 'dark' ||
          (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
      }),
    notify: async () => {},
    onBeforeClose: () => {},
    readyToClose: () => {},
  };
  const deviceName = (await files.deviceInfo()).name;
  syncClient = new SyncClient(
    {
      read: async () => (await files.read({ name: 'sync.json' })).content,
      write: (content) => files.write({ name: 'sync.json', content }),
    },
    {
      snapshot: async () => {
        const snapshot = await store.flush();
        if (!snapshot.loaded || snapshot.error) throw new Error(snapshot.error || '数据尚未载入');
        return { state: snapshot.data };
      },
      mutate: (transform) => store.transact(transform),
    },
    async (endpoint, path, body) => (await files.postSync({ endpoint, path, body })).body,
    deviceName,
  );
  try {
    await syncClient.load();
    if (['小米手机', '小米平板'].includes(syncClient.config.name)) {
      syncClient.config.name = deviceName;
      await syncClient.save();
    }
    const client = syncClient;
    window.clearlist.sync = {
      status: () => client.readStatus(),
      discover: async () => (await files.discoverSync()).peers,
      pair: async (invitation, endpoint) => {
        await client.pair(invitation, endpoint);
        return client.now();
      },
      now: async () => {
        const [status] = await Promise.all([client.now(), nativeUsageSync()]);
        return status;
      },
      disconnect: () => client.disconnect(),
      setEndpoint: async (endpoint) => {
        await client.setEndpoint(endpoint);
        return client.now();
      },
      resolve: (index, keepLocal) => client.resolve(index, keepLocal),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = async () => {
      throw new Error(message);
    };
    syncClient = undefined;
    window.clearlist.sync = {
      status: async () => ({
        mode: 'off',
        name: '此设备',
        connected: false,
        error: message,
        conflicts: [],
      }),
      discover: unavailable,
      pair: unavailable,
      now: unavailable,
      disconnect: unavailable,
      resolve: unavailable,
    };
  }
  await NativeApp.addListener('appStateChange', ({ isActive }) => {
    appActive = isActive;
    if (isActive) {
      lastUsageSync = 0;
      window.dispatchEvent(new Event('dayweave:usage'));
    }
    if (syncStarted && isActive) syncScheduler.start();
    else syncScheduler.stop();
  });
  const openUrl = (url: string) => {
    if (url === 'dayweave://timetable') location.hash = 'timetable';
    if (url.startsWith('dayweave://pair?'))
      try {
        invitationText(url);
        sessionStorage.setItem(pendingPairingKey, url);
        document.dispatchEvent(new Event('dayweave:pairing'));
        document.dispatchEvent(new Event('clearlist:settings'));
      } catch {
        /* Invalid links do not change pairing or data. */
      }
  };
  const launch = await NativeApp.getLaunchUrl();
  if (launch?.url) openUrl(launch.url);
  await NativeApp.addListener('appUrlOpen', (event) => openUrl(event.url));
  await NativeApp.addListener('backButton', () => {
    const event = new CustomEvent('clearlist:back', { cancelable: true });
    if (document.dispatchEvent(event)) void NativeApp.minimizeApp();
  });
}
export function startMobileSync() {
  if (!isMobileApp || syncStarted) return;
  syncStarted = true;
  let previous = store.get();
  store.subscribe(() => {
    const current = store.get();
    if (previous === current) return;
    previous = current;
    syncScheduler.request();
  });
  if (appActive) syncScheduler.start();
  window.addEventListener('online', () => syncScheduler.request());
}

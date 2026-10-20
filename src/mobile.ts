import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { JsonRepository } from './persistence';
import { stateSchema } from './model';

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
  const openUrl = (url: string) => {
    if (url === 'dayweave://timetable') location.hash = 'timetable';
  };
  const launch = await NativeApp.getLaunchUrl();
  if (launch?.url) openUrl(launch.url);
  await NativeApp.addListener('appUrlOpen', (event) => openUrl(event.url));
  await NativeApp.addListener('backButton', () => {
    const event = new CustomEvent('clearlist:back', { cancelable: true });
    if (document.dispatchEvent(event)) void NativeApp.minimizeApp();
  });
}

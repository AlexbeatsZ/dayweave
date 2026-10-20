import { isMobileApp, pickText, exportText } from '../files';
export const isAndroid = isMobileApp;
export const nativeFiles = {
  open: async () => ({ name: 'backup.json', data: (await pickText()) ?? '' }),
  save: async ({ name, data, mime }: { name: string; data: string; mime: string }) =>
    exportText(name, data, mime),
};

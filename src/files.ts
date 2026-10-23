import { Capacitor } from '@capacitor/core';
import { nativeFiles as native } from './native-files';
export const isMobileApp = Capacitor.isNativePlatform();

export async function pickText(accept = '.json,.csv,.ics'): Promise<string | null> {
  if (isMobileApp) return (await native.pickBackup()).content;
  if (window.clearlist?.pickText) return window.clearlist.pickText();
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > 10 * 1024 * 1024) return reject(new Error('文件不能超过 10 MB'));
      void file.text().then(resolve, reject);
    };
    input.click();
  });
}
export async function exportText(
  name: string,
  data: string,
  mime = 'application/json',
): Promise<void> {
  if (isMobileApp) {
    if (!(await native.exportBackup({ name, content: data, mime })).saved)
      throw new Error('已取消导出');
    return;
  }
  if (window.clearlist?.exportText) {
    if (!(await window.clearlist.exportText(name, data))) throw new Error('已取消导出');
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function requestWidget() {
  return native.pinWidget();
}

export async function importFudan(): Promise<string | null> {
  if (isMobileApp) return (await native.importFudan()).content;
  if (window.clearlist?.importFudan) return window.clearlist.importFudan();
  throw new Error('网站导入需要使用 Windows、macOS 或 Android 安装版；浏览器版请使用文件导入。');
}

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Tray,
  nativeImage,
  shell,
} from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateSchema } from '../src/model.js';
import { importFudan } from './fudan-import.js';
import { Runtime } from './headless-runtime.js';

app.setName('Dayweave');
app.setPath(
  'userData',
  process.env.DAYWEAVE_DATA_DIR
    ? path.resolve(process.env.DAYWEAVE_DATA_DIR)
    : path.join(app.getPath('appData'), 'Dayweave'),
);
const directory = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = path.join(
  directory,
  process.platform === 'darwin' ? '../../dist/tray-macos.png' : '../../dist/tray.png',
);
let window: BrowserWindow | null = null;
let allowClose = false,
  closing = false,
  quitting = false;
/** Shared with the server and AI tools: lock, state queue, sync, records, goals and API. */
let runtime: Runtime | undefined;
/** A second launch before the first window exists is answered once startup finishes. */
let started = false,
  showWhenStarted = false;
const trayMode = process.argv.includes('--tray');
let tray: Tray | undefined;
let shutdown: Promise<void> | undefined;
let shutdownComplete = false;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('无效请求来源');
  };
  async function readBackup() {
    const result = await dialog.showOpenDialog(window!, {
      title: '选择时织 JSON 备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > 50 * 1024 * 1024)
      throw new Error('文件超过 50 MB 限制');
    return JSON.parse(await readFile(result.filePaths[0], 'utf8'));
  }
  function createWindow(visible = true) {
    allowClose = false;
    closing = false;
    window = new BrowserWindow({
      width: 1400,
      height: 920,
      minWidth: 900,
      minHeight: 640,
      title: '时织 · Dayweave',
      icon: appIconPath,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#f2f2f2',
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'default' as const, trafficLightPosition: { x: 16, y: 17 } }
        : {}),
      webPreferences: {
        preload: path.join(directory, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    if (visible) window.once('ready-to-show', () => window?.show());
    window.on('close', (event) => {
      if (allowClose || window?.webContents.isLoadingMainFrame() || window?.webContents.isCrashed())
        return;
      event.preventDefault();
      if (!closing) {
        closing = true;
        window?.webContents.send('window:before-close');
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    if (process.env.DAYWEAVE_DEV_URL === 'http://127.0.0.1:5178')
      void window.loadURL(process.env.DAYWEAVE_DEV_URL);
    else void window.loadFile(path.join(directory, '../../dist/index.html'));
    window.on('closed', () => {
      window = null;
      if (quitting) app.quit();
    });
  }
  const showWindow = () => {
    if (!window) createWindow();
    window?.restore();
    window?.show();
    window?.focus();
  };
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--tray')) return;
    if (started) showWindow();
    else showWhenStarted = true;
  });
  app.on('before-quit', (event) => {
    quitting = true;
    if ((!window || allowClose) && !shutdownComplete && runtime) {
      event.preventDefault();
      shutdown ??= runtime
        .close()
        .catch((error) => {
          console.error('Dayweave shutdown failed:', error);
        })
        .then(() => {
          shutdownComplete = true;
          app.quit();
        });
    }
  });
  app.whenReady().then(async () => {
    try {
      runtime = await Runtime.open({
        directory: app.getPath('userData'),
        apiPort: Number(process.env.DAYWEAVE_API_PORT ?? 49731),
        api: process.env.DAYWEAVE_API_DISABLE !== '1',
        binary: path.join(
          app.isPackaged ? process.resourcesPath : app.getAppPath(),
          'native-bin',
          process.platform === 'win32' ? 'work-review-agent.exe' : 'work-review-agent',
        ),
      });
    } catch (error) {
      // Without the profile lock no window may open; say why instead of idling invisibly.
      dialog.showErrorBox('时织无法启动', (error as Error).message);
      app.exit(1);
      return;
    }
    const service = runtime.service;
    const usage = () => runtime?.usage;
    try {
      const snapshot = await service.snapshot();
      nativeTheme.themeSource = snapshot.state.settings.theme;
    } catch {
      /* Keep the recovery screen available. */
    }
    if (process.platform === 'darwin')
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Dayweave',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: '设置…',
                accelerator: 'Cmd+,',
                click: () => window?.webContents.send('app:open-settings'),
              },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
    else Menu.setApplicationMenu(null);
    ipcMain.handle('fudan:import', (event) => {
      trusted(event);
      return importFudan(window!);
    });
    for (const method of [
      'query',
      'status',
      'configure',
      'import',
      'sync',
      'applications',
    ] as const) {
      ipcMain.handle(`usage:${method}`, (event, ...args) => {
        trusted(event);
        const target = usage();
        if (!target) throw new Error(runtime?.errors.usage || '自动记录存储尚未启动');
        return (target[method] as (...args: unknown[]) => unknown).apply(target, args);
      });
    }
    ipcMain.handle('usage:permission', (event, kind: unknown) => {
      trusted(event);
      if (process.platform !== 'darwin' || kind !== 'usage')
        throw new Error('此权限不适用于当前设备');
      return shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
    });
    ipcMain.handle('text:pick', async (event) => {
      trusted(event);
      const result = await dialog.showOpenDialog(window!, {
        title: '选择课程表或备份',
        properties: ['openFile'],
        filters: [
          { name: '课程表 / 备份 / 目标脚本', extensions: ['csv', 'ics', 'json', 'js', 'mjs'] },
        ],
      });
      if (result.canceled) return null;
      if ((await stat(result.filePaths[0])).size > 10 * 1024 * 1024)
        throw new Error('文件不能超过 10 MB');
      return readFile(result.filePaths[0], 'utf8');
    });
    ipcMain.handle('text:export', async (event, name: unknown, data: unknown) => {
      trusted(event);
      if (
        typeof name !== 'string' ||
        !/^[-a-zA-Z0-9_.]+$/.test(name) ||
        typeof data !== 'string' ||
        Buffer.byteLength(data) > 50 * 1024 * 1024
      )
        throw new Error('Invalid export');
      const result = await dialog.showSaveDialog(window!, { defaultPath: name });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, data, 'utf8');
      return true;
    });
    ipcMain.handle('store:load', (event) => {
      trusted(event);
      return service.snapshot();
    });
    ipcMain.handle('store:patch', (event, delta) => {
      trusted(event);
      return service.patch(delta);
    });
    ipcMain.handle('theme:set', (event, theme: unknown) => {
      trusted(event);
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        nativeTheme.themeSource = theme;
        window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#181818' : '#f2f2f2');
      }
    });
    ipcMain.handle('api:info', (event) => {
      trusted(event);
      return (
        runtime?.api?.info ?? {
          enabled: false,
          url: '',
          token: '',
          error: runtime?.errors.api ?? '',
        }
      );
    });
    for (const method of [
      'status',
      'discover',
      'pair',
      'now',
      'disconnect',
      'ensureTasks',
      'setEndpoint',
      'enableHub',
      'invite',
      'revoke',
      'resolve',
    ] as const) {
      ipcMain.handle(`sync:${method}`, (event, ...args) => {
        trusted(event);
        const sync = runtime?.sync;
        if (!sync) throw new Error(runtime?.errors.sync || runtime?.errors.state || '同步尚未启动');
        const fn = sync[method] as (...args: unknown[]) => unknown;
        return fn.apply(sync, args);
      });
    }
    ipcMain.handle('data:export', async (event, value: unknown) => {
      trusted(event);
      const data = stateSchema.parse(value);
      const result = await dialog.showSaveDialog(window!, {
        title: '导出时织备份',
        defaultPath: `Dayweave-${Date.now()}.json`,
        filters: [{ name: 'JSON 备份', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      return true;
    });
    ipcMain.handle('data:import', (event) => {
      trusted(event);
      return readBackup();
    });
    ipcMain.handle('data:restore', async (event) => {
      trusted(event);
      const data = await readBackup();
      if (!data) return null;
      const result = await service.restore(data);
      // Sync, records, goal scripts and the API could not start on unreadable data; start them now.
      await runtime!.start(false);
      return result;
    });
    ipcMain.on('window:ready-close', async (event, success: unknown) => {
      trusted(event);
      if (!closing) return;
      await service.flush();
      if (success !== true) {
        const result = await dialog.showMessageBox(window!, {
          type: 'warning',
          buttons: ['继续处理', '仍然关闭'],
          defaultId: 0,
          cancelId: 0,
          message: '有数据尚未保存',
          detail: '建议返回窗口导出备份，或重试保存。',
        });
        if (result.response === 0) {
          closing = false;
          quitting = false;
          return;
        }
      }
      if ((trayMode || usage()?.store.settings().enabled) && !quitting) {
        closing = false;
        window?.hide();
      } else {
        allowClose = true;
        window?.close();
      }
    });
    service.subscribe((snapshot) => {
      nativeTheme.themeSource = snapshot.state.settings.theme;
      window?.webContents.send('store:changed', snapshot);
    });
    // Each part records its own failure; the window opens even when data needs recovery.
    await runtime.start(false);
    createWindow(!trayMode);
    {
      const icon = nativeImage.createFromPath(appIconPath).resize({ width: 20, height: 20 });
      tray = new Tray(icon);
      tray.setToolTip('时织 · Dayweave');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '打开时织', click: showWindow },
          {
            label: '设置与配对',
            click: () => {
              showWindow();
              window?.webContents.send('app:open-settings');
            },
          },
          {
            label: '立即同步',
            click: () => {
              void runtime?.sync?.now();
            },
          },
          { type: 'separator' },
          { label: '退出时织', click: () => app.quit() },
        ]),
      );
      tray.on('click', showWindow);
    }
    app.on('activate', () => {
      if (!window) createWindow();
      else window.show();
    });
    started = true;
    if (showWhenStarted) showWindow();
  });
  app.on('window-all-closed', () => {
    if (
      process.platform !== 'darwin' &&
      ((!trayMode && !runtime?.usage?.store.settings().enabled) || quitting)
    )
      app.quit();
  });
  app.on('will-quit', () => {
    tray?.destroy();
  });
}

import { BrowserWindow, WebContentsView, session } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  FUDAN_CAPTURE_RESULT_SCRIPT,
  FUDAN_LOGIN_URL,
  fudanCaptureError,
  isFudanCourseTable,
  isFudanNavigation,
} from '../src/fudan-capture.js';

let pending: Promise<string | null> | undefined;

export function importFudan(parent: BrowserWindow): Promise<string | null> {
  if (pending) return pending;
  pending = openImport(parent).finally(() => {
    pending = undefined;
  });
  return pending;
}

function openImport(parent: BrowserWindow): Promise<string | null> {
  return new Promise((resolve) => {
    const isolated = session.fromPartition(`dayweave-fudan-${randomUUID()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', (event) => event.preventDefault());
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        safeDialogs: true,
      },
    });
    const popup = new BrowserWindow({
      parent,
      width: 1100,
      height: 820,
      minWidth: 700,
      minHeight: 500,
      title: '复旦课表导入 · 时织',
      backgroundColor: '#181818',
      show: false,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    popup.setMenu(null);
    popup.contentView.addChildView(view);
    const layout = () => {
      const [width, height] = popup.getContentSize();
      view.setBounds({ x: 0, y: 72, width, height: Math.max(0, height - 72) });
    };
    layout();
    popup.on('resize', layout);
    let busy = false,
      completed = false,
      captureGeneration = 0;
    const status = (message: string) => {
      if (!popup.isDestroyed())
        void popup.webContents
          .executeJavaScript(
            `document.getElementById('status').textContent=${JSON.stringify(message)};document.getElementById('read').disabled=${busy}`,
          )
          .catch(() => {});
    };
    const finish = (content: string | null) => {
      if (completed) return;
      completed = true;
      captureGeneration++;
      if (!popup.isDestroyed()) popup.destroy();
      resolve(content);
    };
    const read = async () => {
      if (busy || completed) return;
      if (!isFudanCourseTable(view.webContents.getURL())) {
        status('请自行登录并打开课程表，选择学期后点击读取。');
        return;
      }
      busy = true;
      const generation = ++captureGeneration;
      const captureUrl = view.webContents.getURL();
      const current = () =>
        !completed &&
        generation === captureGeneration &&
        !view.webContents.isDestroyed() &&
        view.webContents.getURL() === captureUrl;
      status('正在读取所选学期的课表…');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const result: unknown = await Promise.race([
          view.webContents.executeJavaScript(FUDAN_CAPTURE_RESULT_SCRIPT, true),
          new Promise((_, reject) => {
            deadline = setTimeout(() => {
              timedOut = true;
              reject(new Error('Capture deadline'));
            }, 20000);
          }),
        ]);
        if (!current()) return;
        if (!result || typeof result !== 'object') throw new Error('Invalid result');
        if ('error' in result) {
          busy = false;
          status(fudanCaptureError(result.error));
          return;
        }
        const content = 'content' in result ? result.content : undefined;
        if (typeof content !== 'string' || !content || content.length > 262144)
          throw new Error('课表数据格式无效。');
        finish(content);
      } catch {
        if (!current()) return;
        busy = false;
        status(
          timedOut
            ? '课表读取超时，请稍后重试。 [FUDAN_TIMEOUT]'
            : '课表读取程序执行失败，请返回课程表重试。 [FUDAN_SCRIPT]',
        );
      } finally {
        clearTimeout(deadline);
      }
    };
    // Chromium forbids renderer-initiated data: hash navigation. Intercept local
    // toolbar window requests instead; deny creation before any URL is loaded.
    popup.webContents.setWindowOpenHandler(({ url }) => {
      setImmediate(() => {
        if (url === 'https://dayweave.invalid/fudan/read') void read();
        else if (url === 'https://dayweave.invalid/fudan/cancel') finish(null);
      });
      return { action: 'deny' };
    });
    popup.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    view.webContents.on('did-start-navigation', (_event, _url, _inPlace, main) => {
      if (main && busy) {
        captureGeneration++;
        busy = false;
        status('页面已切换，请返回课程表重新读取。 [FUDAN_PAGE]');
      }
    });
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event, url) => {
      if (!isFudanNavigation(url)) event.preventDefault();
    });
    view.webContents.on('will-redirect', (event, url) => {
      if (!isFudanNavigation(url)) event.preventDefault();
    });
    view.webContents.on('will-frame-navigate', (event) => {
      if (!isFudanNavigation(event.url)) event.preventDefault();
    });
    view.webContents.on('did-fail-load', (_event, _code, _description, _url, main) => {
      if (main) status('页面加载失败，可检查网络后关闭并重试。');
    });
    popup.on('closed', () => {
      if (!view.webContents.isDestroyed()) view.webContents.close();
      void isolated.clearStorageData().catch(() => {});
      finish(null);
    });
    popup.once('ready-to-show', () => popup.show());
    const toolbar =
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'"><style>body{margin:0;background:#181818;color:#f4f4f5;font:14px system-ui}header{height:72px;display:flex;align-items:center;gap:16px;padding:0 16px;box-sizing:border-box}button{padding:10px 18px;border:0;border-radius:9px;background:#303030;color:#f4f4f5;font:inherit}#read{background:#76b9ed;color:#112431}button:disabled{opacity:.5}span{flex:1}</style><header><button onclick="window.open(\'https://dayweave.invalid/fudan/cancel\')">取消</button><span id="status">请自行登录，选择学期，再读取课表。登录信息不会传回时织。</span><button id="read" onclick="window.open(\'https://dayweave.invalid/fudan/read\')">读取课表</button></header></html>';
    void popup
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbar)}`)
      .catch(() => finish(null));
    void view.webContents
      .loadURL(FUDAN_LOGIN_URL)
      .catch(() => status('页面加载失败，可检查网络后关闭并重试。'));
  });
}

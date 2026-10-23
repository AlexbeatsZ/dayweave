import { BrowserWindow, WebContentsView, session } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  FUDAN_CAPTURE_SCRIPT,
  FUDAN_LOGIN_URL,
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
      completed = false;
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
      status('正在读取所选学期的课表…');
      try {
        const content: unknown = await view.webContents.executeJavaScript(
          FUDAN_CAPTURE_SCRIPT,
          true,
        );
        if (typeof content !== 'string' || content.length > 2 * 1024 * 1024)
          throw new Error('课表数据格式无效。');
        finish(content);
      } catch {
        busy = false;
        status('读取失败，请确认已登录并选择学期，然后重试。');
      }
    };
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (url === 'dayweave-import:read') void read();
      else if (url === 'dayweave-import:cancel') finish(null);
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
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'"><style>body{margin:0;background:#181818;color:#f4f4f5;font:14px system-ui}header{height:72px;display:flex;align-items:center;gap:16px;padding:0 16px;box-sizing:border-box}button{padding:10px 18px;border:0;border-radius:9px;background:#303030;color:#f4f4f5;font:inherit}#read{background:#76b9ed;color:#112431}button:disabled{opacity:.5}span{flex:1}</style><header><button onclick="location.href=\'dayweave-import:cancel\'">取消</button><span id="status">请自行登录，选择学期，再读取课表。登录信息不会传回时织。</span><button id="read" onclick="location.href=\'dayweave-import:read\'">读取课表</button></header></html>';
    void popup
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbar)}`)
      .catch(() => finish(null));
    void view.webContents
      .loadURL(FUDAN_LOGIN_URL)
      .catch(() => status('页面加载失败，可检查网络后关闭并重试。'));
  });
}

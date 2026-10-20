const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clearlist', {
  platform: process.platform,
  sync: Object.fromEntries(
    [
      'status',
      'discover',
      'pair',
      'now',
      'disconnect',
      'enableHub',
      'invite',
      'revoke',
      'resolve',
    ].map((method) => [method, (...args) => ipcRenderer.invoke(`sync:${method}`, ...args)]),
  ),
  pickText: () => ipcRenderer.invoke('text:pick'),
  exportText: (name, data) => ipcRenderer.invoke('text:export', name, data),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  patch: (delta) => ipcRenderer.invoke('store:patch', delta),
  onState: (callback) => ipcRenderer.on('store:changed', (_event, snapshot) => callback(snapshot)),
  apiInfo: () => ipcRenderer.invoke('api:info'),
  load: () => ipcRenderer.invoke('store:load'),
  save: (state) => ipcRenderer.invoke('store:save', state),
  exportData: (state) => ipcRenderer.invoke('data:export', state),
  importData: () => ipcRenderer.invoke('data:import'),
  restoreData: () => ipcRenderer.invoke('data:restore'),
  notify: (title, body) => ipcRenderer.invoke('notice', title, body),
  onBeforeClose: (callback) => ipcRenderer.on('window:before-close', () => callback()),
  readyToClose: (success) => ipcRenderer.send('window:ready-close', success),
});
ipcRenderer.on('app:open-settings', () => window.dispatchEvent(new Event('clearlist:settings')));

'use strict';
// Secure bridge between the (isolated) renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  onMetrics: (cb) => { ipcRenderer.on('metrics', (_e, data) => cb(data)); },
  onUiState: (cb) => { ipcRenderer.on('ui-state', (_e, data) => cb(data)); },
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  setPin: (v) => ipcRenderer.send('set-pin', v),
  setMode: (m) => ipcRenderer.send('set-mode', m),
  refresh: () => ipcRenderer.send('refresh'),
  hide: () => ipcRenderer.send('hide-widget'),
  ready: () => ipcRenderer.send('renderer-ready'),
  // auto-update
  onUpdateStatus: (cb) => { ipcRenderer.on('update-status', (_e, data) => cb(data)); },
  checkUpdate: () => ipcRenderer.send('check-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
});

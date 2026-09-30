const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('lumen', {
  getState: () => ipcRenderer.invoke('library:state'),
  openFolder: path => ipcRenderer.invoke('library:open', path),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  cancel: () => ipcRenderer.invoke('library:cancel'),
  metadata: id => ipcRenderer.invoke('image:metadata', id),
  reveal: id => ipcRenderer.invoke('image:reveal', id),
  copyPath: id => ipcRenderer.invoke('image:copy', id),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  droppedPath: file => webUtils.getPathForFile(file),
  onIndex: callback => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('library:event', handler);
    return () => ipcRenderer.removeListener('library:event', handler);
  },
});

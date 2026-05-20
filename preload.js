const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  toggleTop: () => ipcRenderer.invoke('window-toggle-top'),
  hide: () => ipcRenderer.invoke('window-hide'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  quit: () => ipcRenderer.invoke('app-quit'),
  openExternal: (url) => ipcRenderer.invoke('shell-open', url),
  fetchTitle: (url) => ipcRenderer.invoke('fetch-title', url),
  fetchKmTitle: (contentId) => ipcRenderer.invoke('fetch-km-title', contentId),
  resizeHeight: (h) => ipcRenderer.invoke('resize-height', h),
  getBounds: () => ipcRenderer.invoke('get-bounds'),
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.invoke('set-ignore-mouse-events', ignore, opts),
  log: (...args) => ipcRenderer.invoke('renderer-log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
  // 图片相关
  saveImage: (base64) => ipcRenderer.invoke('save-image', base64),
  getImagePath: (filename) => ipcRenderer.invoke('get-image-path', filename),
  deleteImage: (filename) => ipcRenderer.invoke('delete-image', filename),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  // 提醒
  toggleReminder: (todoId) => ipcRenderer.invoke('toggle-reminder', todoId),
  // 监听主进程数据更新通知
  onTodosUpdated: (callback) => ipcRenderer.on('todos-updated', callback),
});

const { contextBridge, ipcRenderer } = require('electron');
let dataBaseline, dataGeneration = 0;

contextBridge.exposeInMainWorld('api', {
  loadData: async () => {
    const data = await ipcRenderer.invoke('load-data'); dataBaseline = structuredClone(data.todos); dataGeneration = data._generation; return data;
  },
  saveData: async data => {
    const submitted = structuredClone(data.todos);
    const result = await ipcRenderer.invoke('save-data', { ...data, _baseTodos: dataBaseline, _generation: dataGeneration });
    dataBaseline = submitted; return result;
  },
  toggleTop: () => ipcRenderer.invoke('window-toggle-top'),
  hide: () => ipcRenderer.invoke('window-hide'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  quit: () => ipcRenderer.invoke('app-quit'),
  openExternal: (url) => ipcRenderer.invoke('shell-open', url),
  fetchTitle: (url) => ipcRenderer.invoke('fetch-title', url),
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
  confirmDeleteTodos: ids => ipcRenderer.invoke('confirm-delete-todos', ids),
  syncCall: async (action, input) => {
    const channels = { status: 'apple-sync-status', authorize: 'apple-sync-authorize', lists: 'apple-sync-lists',
      preview: 'apple-sync-preview', connect: 'apple-sync-connect', now: 'apple-sync-now', disconnect: 'apple-sync-disconnect',
      cats: 'apple-sync-cats', resolve: 'apple-sync-resolve', resolveCreate: 'apple-sync-resolve-create', privacy: 'apple-sync-privacy' };
    if (!channels[action]) throw new Error('不支持的同步操作。');
    const response = await ipcRenderer.invoke(channels[action], input);
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  },
  onOpenSettingsMenu: callback => ipcRenderer.on('open-settings-menu', callback),
  showSyncSettings: section => ipcRenderer.invoke('show-sync-settings', section),
  settingsCall: async (action, input) => {
    if (!['get', 'save', 'avatarList', 'avatarDelete', 'avatarDefaults', 'avatarPick', 'avatarCommit', 'testReminder', 'export', 'importPreview', 'restore', 'notifications', 'update', 'releasePage', 'feedback'].includes(action)) throw new Error('不支持的设置操作。');
    const response = await ipcRenderer.invoke('settings-call', action, input); if (!response.ok) throw new Error(response.error); return response.result;
  },
  onPreferencesUpdated: callback => ipcRenderer.on('preferences-updated', (_, value) => callback(value)),
  onSettingsSection: callback => ipcRenderer.on('settings-section', (_, section) => callback(section)),
  onSyncUpdated: callback => ipcRenderer.on('apple-sync-updated', callback),
});
window.addEventListener('unload', () => ipcRenderer.send('renderer-ready-forget'));

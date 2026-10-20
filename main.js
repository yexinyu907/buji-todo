const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, powerMonitor, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { AppleRemindersBridge } = require('./apple-reminders-bridge');
const { AppleSyncService } = require('./apple-sync-service');
const { mergeRendererTodos } = require('./apple-sync-engine');
const { PreferencesStore } = require('./preferences-store');
const { BackupStore } = require('./backup-store');
const { checkUpdate } = require('./update-check');
const { ReminderGallery } = require('./reminder-gallery');

// 解决 macOS sandbox 权限问题
app.commandLine.appendSwitch('no-sandbox');

// 数据存储路径
const dataPath = path.join(app.getPath('userData'), 'buji-data.json');

let mainWindow;
let tray;
let settingsWindow;
let syncService;
let dataGeneration = 0, shortcutError = '', trayTopItem;
const preferences = new PreferencesStore(app.getPath('userData'));
const reminderGallery = new ReminderGallery(app.getPath('userData'), bytes => nativeImage.createFromBuffer(bytes), path.join(__dirname,'assets','cats'), () => preferences.get().customReminderAvatar);
const backups = new BackupStore({ directory: app.getPath('userData'), version: app.getVersion(), readData: loadData, readSync: () => syncService?.state || {} });
let dataOperation = Promise.resolve();
function serialized(operation) { const next = dataOperation.then(operation, operation); dataOperation = next.catch(() => {}); return next; }
function toggleVisibility() { if (!mainWindow || mainWindow.isDestroyed()) return; if (mainWindow.isVisible()) mainWindow.hide(); else { mainWindow.show(); mainWindow.focus(); } }
function notifyPreferences() {
  const value = preferences.get();
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('preferences-updated', value);
  if (trayTopItem) trayTopItem.checked = value.pinned;
}
function savePreferences(patch) {
  const previous = preferences.get(), next = preferences.next(patch); let registered = false, loginChanged = false, previousLogin;
  try {
    if (next.shortcut !== previous.shortcut && next.shortcut) {
      if (!globalShortcut.register(next.shortcut, toggleVisibility)) throw new Error('这个快捷键已被占用，请换一个组合。'); registered = true;
    }
    if (Object.hasOwn(patch, 'openAtLogin')) {
      if (!['darwin', 'win32'].includes(process.platform)) throw new Error('当前平台不支持开机启动设置。');
      previousLogin = app.getLoginItemSettings().openAtLogin;
      app.setLoginItemSettings({ openAtLogin: next.openAtLogin }); loginChanged = true;
    }
    const saved = preferences.save(patch);
    if (next.shortcut !== previous.shortcut && previous.shortcut) globalShortcut.unregister(previous.shortcut);
    if (next.shortcut !== previous.shortcut) shortcutError = '';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(saved.pinned);
    notifyPreferences(); return saved;
  } catch (error) {
    if (registered) globalShortcut.unregister(next.shortcut);
    if (loginChanged) { try { app.setLoginItemSettings({ openAtLogin: previousLogin }); } catch {} }
    throw error;
  }
}


const rendererBaselines = new Map();

function publishData() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todos-updated');
}
function showSettings(section = 'data') {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); settingsWindow.webContents.send('settings-section', section); return; }
  const area = screen.getPrimaryDisplay().workArea;
  settingsWindow = new BrowserWindow({ width: 520, height: Math.min(700, area.height), minWidth: 380,
    title: '设置 · 不记Todo', backgroundColor: '#faf9f6', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  settingsWindow.loadFile('sync-settings.html', { query: { section } });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}
function showSettingsMenu() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('open-settings-menu'); }
}
function createApplicationMenu() {
  const settings = { label: '设置…', accelerator: 'CommandOrControl+,', click: showSettingsMenu };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: process.platform === 'darwin' ? app.name : '文件', submenu: [{ role: 'about' }, settings, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'windowMenu' }
  ]));
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  const savedData = loadData();
  let winBounds = savedData.windowBounds || {
    width: 280,
    height: 420,
    x: screenW - 310,
    y: 60
  };

  const valid = winBounds && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(winBounds[k]));
  const display = valid && screen.getAllDisplays().find(d => winBounds.x < d.workArea.x + d.workArea.width && winBounds.x + winBounds.width > d.workArea.x && winBounds.y < d.workArea.y + d.workArea.height && winBounds.y + winBounds.height > d.workArea.y);
  const area = (display || screen.getPrimaryDisplay()).workArea;
  winBounds = { width: Math.max(220, Math.min(valid ? winBounds.width : 280, area.width)), height: Math.max(44, Math.min(valid ? winBounds.height : 420, area.height)), x: valid ? winBounds.x : area.x + area.width - 310, y: valid ? winBounds.y : area.y + 60 };
  winBounds.x = Math.max(area.x, Math.min(winBounds.x, area.x + area.width - winBounds.width));
  winBounds.y = Math.max(area.y, Math.min(winBounds.y, area.y + area.height - winBounds.height));
  mainWindow = new BrowserWindow({
    ...winBounds,
    minWidth: 220,
    minHeight: 44,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: preferences.get().pinned,
    resizable: true,
    skipTaskbar: false, // Dock（Mac）和任务栏（Windows）都显示图标
    hasShadow: false,       // 我们用 CSS 自带阴影，更柔和
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 }, // 隐藏红绿灯
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('index.html');

  // 让窗口不获取焦点时也能显示（真正的"贴纸"感）
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 保存窗口位置
  mainWindow.on('moved', saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);

  // 关闭 → 隐藏
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      if (preferences.get().closeBehavior === 'quit') { app.isQuiting = true; app.quit(); }
      else { e.preventDefault(); mainWindow.hide(); }
    }
  });
}

function createTray() {
  // 用应用图标放在菜单栏/系统托盘
  let icon;
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // fallback: 内嵌小图标
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaklEQVQ4T2NkoBAwUqifgWoGMP7//38DEBsQ4wImIN0AxP+JMQSoeTMQXyDGEBCdi8QGGYKsB0UfuiGbQRqxGYJiAC5DQIYg64czBN0QrIagG0KUIcimEjSAmABD1ousB10fLkOwphMAAN3dMBFfHQxqAAAAAElFTkSuQmCC'
    );
  }

  // macOS 菜单栏需要小图标（16-22px），Windows 托盘需要稍大的
  const size = process.platform === 'darwin' ? 18 : 24;
  tray = new Tray(icon.resize({ width: size, height: size }));
  tray.setToolTip('不记Todo');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      }
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: preferences.get().pinned,
      click: (item) => {
        savePreferences({ pinned: item.checked });
      }
    },
    { type: 'separator' },
    { label: '设置…', click: showSettingsMenu },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  trayTopItem = contextMenu.items.find(item => item.label === '置顶');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}

function saveWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const data = loadData();
  data.windowBounds = bounds;
  saveData(data);
}

function loadData() {
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    if (!Array.isArray(data.todos)) throw new Error('待办数据格式异常，已停止写入，请从备份恢复。');
    return data;
  }
  return { todos: [], windowBounds: null };
}

function saveData(data) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(dataPath + '.tmp', dataPath);
}

// IPC - 渲染进程日志桥接
ipcMain.handle('renderer-log', (_, msg) => {
  console.log('[renderer]', msg);
});

ipcMain.handle('load-data', event => {
  const data = loadData(); rendererBaselines.set(event.sender.id, structuredClone(data.todos)); return { ...data, _generation: dataGeneration };
});
ipcMain.handle('save-data', (event, data) => {
  if (data._generation !== dataGeneration) throw new Error('数据刚刚恢复，旧窗口的保存已停止，请等待刷新后重试。');
  const current = loadData();
  if (!Array.isArray(data.todos)) throw new Error('待办内容无效。');
  let todos = mergeRendererTodos(current.todos, data.todos, data._baseTodos || rendererBaselines.get(event.sender.id));
  if (syncService) todos = syncService.prepareSave(current.todos, todos);
  const merged = { ...current, todos, tagGroupOrder: data.tagGroupOrder || current.tagGroupOrder || [], windowBounds: current.windowBounds };
  saveData(merged);
  // 如果 todo 的 DDL 被重新设置到未来，清除已提醒缓存，允许再次提醒
  const now = Date.now();
  for (const todo of (merged.todos || [])) {
    if (todo.ddl && todo.ddl > now && remindedSet.has(todo.id)) {
      remindedSet.delete(todo.id);
    }
  }
  rendererBaselines.set(event.sender.id, structuredClone(todos));
  syncService?.schedule();
  return true;
});

ipcMain.on('renderer-ready-forget', event => rendererBaselines.delete(event.sender.id));
ipcMain.handle('confirm-delete-todos', async (_, ids) => {
  if (!Array.isArray(ids)) return false;
  const linked = ids.filter(id => syncService?.state.links[id]);
  if (!linked.length) return true;
  const { response } = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '删除同步任务',
    message: `将同时从苹果提醒事项删除 ${linked.length} 条任务`, detail: '手机上的对应任务也会删除。删除前的桌面内容会保存在本机恢复记录中。',
    buttons: ['取消', '从两边删除'], defaultId: 0, cancelId: 0 });
  if (response !== 1) return false;
  for (const id of linked) syncService.confirmedDeletes.add(id);
  return true;
});

for (const [channel, handler] of Object.entries({
  'apple-sync-status': () => syncService.status(),
  'apple-sync-authorize': () => syncService.bridge.call('authorize'),
  'apple-sync-lists': () => syncService.lists(),
  'apple-sync-preview': (_, id) => syncService.preview(id),
  'apple-sync-connect': (_, { token, choices }) => syncService.connect(token, choices),
  'apple-sync-now': () => syncService.sync(),
  'apple-sync-disconnect': () => syncService.disconnect(),
  'apple-sync-cats': (_, enabled) => syncService.setCatReminders(enabled),
  'apple-sync-resolve': (_, { id, choice }) => syncService.resolve(id, choice),
  'apple-sync-resolve-create': (_, id) => syncService.resolveCreate(id),
  'apple-sync-privacy': () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders'),
  'show-sync-settings': (_, section) => showSettings(section || 'data'),
})) ipcMain.handle(channel, async (...args) => {
  try {
    const mutating = ['apple-sync-connect', 'apple-sync-now', 'apple-sync-disconnect', 'apple-sync-resolve', 'apple-sync-resolve-create'].includes(channel);
    return { ok: true, result: await (mutating ? serialized(() => handler(...args)) : handler(...args)) };
  }
  catch (error) { return { ok: false, error: { code: error.code || 'SYNC_ERROR', message: error.message } }; }
});

function settingsInfo() {
  const value = preferences.get();
  if (['darwin', 'win32'].includes(process.platform)) { try { value.openAtLogin = app.getLoginItemSettings().openAtLogin; } catch {} }
  const gallery = reminderGallery.summary();
  return { preferences: value, avatar: gallery.avatar, avatarCount: gallery.count, platform: process.platform, version: app.getVersion(), error: preferences.error || shortcutError || '', loginSupported: ['darwin', 'win32'].includes(process.platform),
    notes: ['同步状态精简为连接状态与上次成功同步时间。', '提醒图库支持多张上传、查看和删减，默认包含六只小猫，每次随机展示。', '提醒示例展示完整操作按钮，示例操作不会修改待办。'] };
}
ipcMain.handle('settings-call', async (_, action, input) => {
  try {
    let result;
    if (action === 'get') result = settingsInfo();
    else if (action === 'save') { savePreferences(input); result = settingsInfo(); }
    else if (action === 'avatarList') result = reminderGallery.list();
    else if (action === 'avatarDelete') { result = reminderGallery.remove(input); notifyPreferences(); }
    else if (action === 'avatarDefaults') { result = reminderGallery.addDefaults(); notifyPreferences(); }
    else if (action === 'avatarPick') {
      const selected = await dialog.showOpenDialog(settingsWindow || mainWindow, { title: '选择提醒形象', properties: ['openFile','multiSelections'], filters: [{ name: '图片', extensions: ['png','webp','jpg','jpeg'] }] });
      if (selected.canceled) result = { canceled: true };
      else {
        reminderGallery.canAdd(selected.filePaths.length);let total=0;
        const files = selected.filePaths.map(file => {
          const size=fs.statSync(file).size;total+=size;
          if (!/\.(png|webp|jpe?g)$/i.test(file)||size>8*1024*1024||total>64*1024*1024) throw new Error('每张图片最大8MB，一次上传合计不超过64MB。');
          const mime=/\.webp$/i.test(file)?'webp':/\.jpe?g$/i.test(file)?'jpeg':'png';
          return {name:path.basename(file),src:'data:image/'+mime+';base64,'+fs.readFileSync(file).toString('base64')};
        });result={files};
      }
    }
    else if (action === 'avatarCommit') {
      if (!Array.isArray(input)||!input.length||input.length>50) throw new Error('图片列表无效。');
      let total=0;const files=input.map(item=>{
        if (!item||typeof item.png!=='string'||item.png.length>12*1024*1024||!(/^[A-Za-z0-9+/]*={0,2}$/).test(item.png)||(total+=item.png.length)>90*1024*1024) throw new Error('图片内容无效。');
        return {name:item.name,bytes:Buffer.from(item.png,'base64')};
      });result=reminderGallery.add(files);notifyPreferences();
    }
    else if (action === 'testReminder') { showCatReminder('这是一条不记Todo提醒', null, false); result = {}; }
    else if (action === 'export') {
      const day = new Date().toLocaleDateString('sv-SE');
      const selected = await dialog.showSaveDialog(settingsWindow || mainWindow, { title: '导出不记Todo备份', defaultPath: '不记Todo备份-' + day + '.zip', filters: [{ name: '不记Todo备份', extensions: ['zip'] }] });
      if (selected.canceled || !selected.filePath) result = { canceled: true };
      else { const dest = selected.filePath.toLowerCase().endsWith('.zip') ? selected.filePath : selected.filePath + '.zip'; backups.write(dest, backups.capture()); result = { canceled: false, filename: path.basename(dest) }; }
    } else if (action === 'importPreview') {
      const selected = await dialog.showOpenDialog(settingsWindow || mainWindow, { title: '选择不记Todo备份', properties: ['openFile'], filters: [{ name: '不记Todo备份', extensions: ['zip'] }] });
      result = selected.canceled ? { canceled: true } : backups.previewFile(selected.filePaths[0]);
    } else if (action === 'restore') result = await serialized(async () => {
      backups.checkPreview(input); const wasEnabled = syncService.state.enabled;
      await syncService.disconnect();
      const pausedState = structuredClone(syncService.state); let prepared, stateChanged = false, committed = false;
      try {
        backups.checkPreview(input); prepared = backups.prepareRestore(input);
        syncService.state.links = {}; syncService.state.pendingDeletes = {}; syncService.state.pendingCreate = null; syncService.state.conflicts = []; syncService.state.archives = {};
        syncService.state.calendar ||= prepared.calendar; syncService.state.restoredAt = Date.now(); syncService.state.lastSyncAt = null; syncService.pendingPreview = null;
        stateChanged = true; syncService.persist();
        const current = loadData(); saveData({ ...current, todos: prepared.data.todos, tagGroupOrder: prepared.data.tagGroupOrder || [] }); committed = true;
        dataGeneration++; rendererBaselines.clear(); remindedSet.clear();
        for (const win of [...reminderWindows]) if (!win.isDestroyed()) win.close();
        prepared.commit(); syncService.notify(); mainWindow?.webContents.reload();
        return { restored: prepared.data.todos.length };
      } catch (error) {
        if (!committed) {
          prepared?.rollback();
          if (stateChanged) syncService.state = pausedState;
          syncService.state.enabled = wasEnabled; syncService.persist(); syncService.schedule();
        }
        throw error;
      }
    });
    else if (action === 'notifications') {
      if (process.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
      else if (process.platform === 'win32') await shell.openExternal('ms-settings:notifications');
      else throw new Error('请在系统设置中打开通知设置。');
    } else if (action === 'update') result = await checkUpdate(app.getVersion());
    else if (action === 'releasePage') await shell.openExternal('https://github.com/yexinyu907/buji-todo/releases/latest');
    else if (action === 'feedback') await shell.openExternal('https://github.com/yexinyu907/buji-todo/issues');
    else throw new Error('不支持的设置操作。');
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('window-toggle-top', () => {
  if (!mainWindow) return false;
  const isTop = mainWindow.isAlwaysOnTop();
  savePreferences({ pinned: !isTop });
  return !isTop;
});

ipcMain.handle('window-hide', () => {
  if (preferences.get().closeBehavior === 'quit') { app.isQuiting = true; app.quit(); }
  else if (mainWindow) mainWindow.hide();
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('app-quit', () => {
  app.isQuiting = true;
  app.quit();
});

ipcMain.handle('shell-open', (_, url) => {
  shell.openExternal(url);
});

// 动态调整窗口高度（Done展开/收起、内容变化时）
ipcMain.handle('resize-height', (_, height) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  if (!Number.isFinite(height)) return;
  const area = screen.getDisplayMatching(bounds).workArea;
  // 下方空间不足时向上挪动，仍不足则由面板内部滚动。
  const newH = Math.min(Math.max(Math.ceil(height), 44), area.height);
  const newY = Math.max(area.y, Math.min(bounds.y, area.y + area.height - newH));
  mainWindow.setBounds({ ...bounds, y: newY, height: newH });
});

ipcMain.handle('get-bounds', () => {
  if (!mainWindow) return null;
  return mainWindow.getBounds();
});

ipcMain.handle('set-ignore-mouse-events', (_, ignore, opts) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(ignore, opts || {});
});

// 抓取网页标题（通用）
ipcMain.handle('fetch-title', (_, url) => {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(null);
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 10240) res.destroy();
      });
      res.on('end', () => {
        const match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        resolve(match ? match[1].trim() : null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
});

// 图片存储目录
const imgDir = path.join(app.getPath('userData'), 'images');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

// 保存图片（base64 data）
ipcMain.handle('save-image', (_, base64Data) => {
  try {
    const ext = base64Data.startsWith('/9j') ? 'jpg' : 'png';
    const id = crypto.randomBytes(8).toString('hex');
    const filename = `${id}.${ext}`;
    const filePath = path.join(imgDir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return filename;
  } catch (e) {
    console.error('[save-image] error:', e.message);
    return null;
  }
});

// 获取图片完整路径
ipcMain.handle('get-image-path', (_, filename) => {
  return path.join(imgDir, filename);
});

// 删除图片
ipcMain.handle('delete-image', (_, filename) => {
  try {
    const filePath = path.join(imgDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
});

// 选择图片文件
ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1) || 'png';
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.${ext}`;
  const destPath = path.join(imgDir, filename);
  fs.writeFileSync(destPath, buffer);
  return filename;
});

// ===================== Cat Reminder Window =====================
let reminderWindows = []; // 支持多个猫咪提醒同时显示
let reminderTimer = null;
const remindedSet = new Set(); // 已提醒过的 todo ID（防止重复提醒）

// 每个窗口的待发送数据，以 webContents id 为 key
const pendingReminderMap = new Map();

function showCatReminder(todoText, todoId, isOverdue) {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 320;
  const winH = 190;

  // 计算位置：屏幕上方居中，多个窗口纵向错开
  const baseY = 40;
  const offsetY = reminderWindows.length * (winH + 10);

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round((screenW - winW) / 2),
    y: baseY + offsetY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // 存储待发送数据
  pendingReminderMap.set(win.webContents.id, { text: todoText, todoId, isOverdue, demo: !todoId, avatar: reminderGallery.pick() });

  // 保存 todoId 到窗口对象，供 reminder-action 使用
  win._reminderTodoId = todoId;

  reminderWindows.push(win);

  win.loadFile('cat-reminder.html');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const wcId = win.webContents.id; // 提前保存，closed 时 webContents 已销毁
  win.on('closed', () => {
    reminderWindows = reminderWindows.filter(w => w !== win);
    pendingReminderMap.delete(wcId);
  });
}

// 渲染进程准备好后，通过 event.sender 找到对应窗口并发送数据
ipcMain.on('reminder-ready', (event) => {
  const wcId = event.sender.id;
  const data = pendingReminderMap.get(wcId);
  if (data) {
    event.sender.send('show-reminder', data);
    pendingReminderMap.delete(wcId);
  }
});

// 提醒被点击 → 显示主窗口，猫咪继续留着不关闭
ipcMain.on('reminder-clicked', (event) => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('close-reminder', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

// 提醒弹窗操作按钮：done / later / delay30
ipcMain.on('reminder-action', (event, { action, minutes }) => {
  const wcId = event.sender.id;
  // 找到该窗口对应的 todoId
  // pendingReminderMap 可能已经清空，所以我们遍历 reminderWindows
  let todoId = null;
  for (const win of reminderWindows) {
    if (!win.isDestroyed() && win.webContents.id === wcId) {
      // 从 show-reminder 时保存的数据找 todoId
      break;
    }
  }
  // 我们需要在 showCatReminder 时保存 todoId 到窗口上
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) todoId = win._reminderTodoId;

  if (!todoId) return;

  const data = loadData();
  const todo = (data.todos || []).find(t => t.id === todoId);
  if (!todo) return;

  if (action === 'done') {
    // 标记完成
    if (todo.repeat && !todo.appleReminderId) {
      // 循环待办：标记今天完成
      if (!todo.completedDates) todo.completedDates = [];
      const today = new Date();
      const dk = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
      if (!todo.completedDates.includes(dk)) todo.completedDates.push(dk);
    } else {
      todo.done = true;
    }
    saveData(data);
    syncService?.schedule();
    // 通知主窗口刷新
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('todos-updated');
    }
  } else if (action === 'delay') {
    // 延后N分钟：把 DDL 推迟指定时间
    const delayMin = minutes || 30;
    if (todo.ddl) {
      todo.ddl = Date.now() + delayMin * 60 * 1000;
      todo.ddlHasTime = true;
    } else {
      // 没有 DDL 的待办，设一个新的 DDL
      todo.ddl = Date.now() + delayMin * 60 * 1000;
      todo.ddlHasTime = true;
    }
    remindedSet.delete(todoId); // 允许之后重新提醒
    saveData(data);
    syncService?.schedule();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('todos-updated');
    }
  }
});

// 拖动支持：渲染进程发来鼠标偏移，主进程移动窗口
ipcMain.on('reminder-drag', (event, { dx, dy }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

// 定时器：每30秒检查一次是否有到期的待办
function startReminderScheduler() {
  // 立即检查一次
  checkReminders();
  // 每30秒检查
  reminderTimer = setInterval(checkReminders, 30000);
}

function checkReminders() {
  const data = loadData();
  const todos = data.todos || [];
  const now = Date.now();

  for (const todo of todos) {
    if (todo.done) continue;
    if (!todo.ddl) continue;
    if (!todo.ddlHasTime) continue; // 只有设置了具体时分的才触发提醒
    if (todo.noReminder) continue; // 用户关闭了提醒
    if (todo.appleReminderId && !todo.appleDetached && syncService?.state.catReminders === false) continue;
    if (remindedSet.has(todo.id)) continue; // 已提醒过

    const diff = todo.ddl - now;
    // 到期时间已到（diff <= 0）且不超过5分钟前
    if (diff <= 0 && diff > -300000) {
      remindedSet.add(todo.id);
      showCatReminder(todo.text, todo.id, true);
    }
  }
}

// IPC：切换提醒开关
ipcMain.handle('toggle-reminder', (_, todoId) => {
  const data = loadData();
  const todo = (data.todos || []).find(t => t.id === todoId);
  if (todo) {
    todo.noReminder = !todo.noReminder;
    saveData(data);
    // 如果重新开启提醒，移出已提醒集合
    if (!todo.noReminder) remindedSet.delete(todoId);
    return !todo.noReminder; // 返回当前是否开启提醒
  }
  return true;
});

// 单实例锁：防止重复打开，第二次点击时激活已有窗口
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    syncService = new AppleSyncService({ directory: app.getPath('userData'), readData: loadData,
      writeData: data => { saveData(data); publishData(); },
      bridge: new AppleRemindersBridge(() => syncService?.schedule()),
      notify: () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('apple-sync-updated'); }
    });
    createWindow();
    const shortcut = preferences.get().shortcut;
    if (shortcut && !globalShortcut.register(shortcut, toggleVisibility)) shortcutError = '保存的快捷键被占用，请在通用设置中重新选择。';
    createTray();
    createApplicationMenu();
    startReminderScheduler();
    syncService.start();
    powerMonitor.on('resume', () => syncService.schedule());
  }).catch(error => dialog.showErrorBox('不记Todo无法读取数据', error.message));
}

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (reminderTimer) clearInterval(reminderTimer);
  syncService?.stop(); globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// 解决 macOS sandbox 权限问题
app.commandLine.appendSwitch('no-sandbox');

// 数据存储路径
const dataPath = path.join(app.getPath('userData'), 'buji-data.json');

let mainWindow;
let tray;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  const savedData = loadData();
  const winBounds = savedData.windowBounds || {
    width: 280,
    height: 420,
    x: screenW - 310,
    y: 60
  };

  mainWindow = new BrowserWindow({
    ...winBounds,
    minWidth: 220,
    minHeight: 44,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
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
      e.preventDefault();
      mainWindow.hide();
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
      checked: true,
      click: (item) => {
        mainWindow.setAlwaysOnTop(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

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
  try {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
  } catch {}
  return { todos: [], windowBounds: null };
}

function saveData(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Save failed:', err);
  }
}

// IPC - 渲染进程日志桥接
ipcMain.handle('renderer-log', (_, msg) => {
  console.log('[renderer]', msg);
});

ipcMain.handle('load-data', () => loadData());
ipcMain.handle('save-data', (_, data) => {
  const current = loadData();
  const merged = { ...current, ...data, windowBounds: current.windowBounds };
  saveData(merged);
  // 如果 todo 的 DDL 被重新设置到未来，清除已提醒缓存，允许再次提醒
  const now = Date.now();
  for (const todo of (merged.todos || [])) {
    if (todo.ddl && todo.ddl > now && remindedSet.has(todo.id)) {
      remindedSet.delete(todo.id);
    }
  }
  return true;
});

ipcMain.handle('window-toggle-top', () => {
  if (!mainWindow) return false;
  const isTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!isTop);
  return !isTop;
});

ipcMain.handle('window-hide', () => {
  if (mainWindow) mainWindow.hide();
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
  const maxH = screen.getPrimaryDisplay().workAreaSize.height - bounds.y;
  // 允许最小44px（折叠模式），由调用方决定合理高度
  const newH = Math.min(Math.max(height, 44), maxH);
  mainWindow.setBounds({ ...bounds, height: newH });
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

// 抓取学城文档标题（通过 citadel CLI）
const { execFile } = require('child_process');
const homedir = require('os').homedir();
// 构建一个包含常见路径的 PATH（确保 nvm/homebrew/catpaw 路径都包含）
const extendedPath = [
  path.join(homedir, '.nvm/versions/node/v24.14.0/bin'),
  path.join(homedir, '.catpaw', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  process.env.PATH || ''
].join(':');
// 查找 oa-skills 的全路径
function findOaSkills() {
  const candidates = [
    path.join(homedir, '.nvm/versions/node/v24.14.0/bin/oa-skills'),
    path.join(homedir, '.catpaw/bin/oa-skills'),
    '/usr/local/bin/oa-skills',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'oa-skills'; // fallback to PATH
}

// 自动发现最新的 MTSSO agent config
function findLatestMtssoConfig() {
  const agentsDir = path.join(homedir, '.mtsso', 'agents');
  try {
    const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return null;
    // 按修改时间降序
    files.sort((a, b) => {
      const sa = fs.statSync(path.join(agentsDir, a)).mtimeMs;
      const sb = fs.statSync(path.join(agentsDir, b)).mtimeMs;
      return sb - sa;
    });
    return path.join(agentsDir, files[0]);
  } catch { return null; }
}

ipcMain.handle('fetch-km-title', (_, contentId) => {
  return new Promise((resolve) => {
    const cmd = findOaSkills();
    const fullCmd = `"${cmd}" citadel getDocumentMetaInfo --contentId ${String(contentId)} --raw --no-version-check`;
    const { exec } = require('child_process');
    // 构建 exec 环境：传入认证所需的环境变量
    const execEnv = { ...process.env, PATH: extendedPath, HOME: homedir, NO_CHECK_VERSION: 'true' };
    // 自动发现 MTSSO agent config（如果 process.env 中没有）
    if (!execEnv.MTSSO_AGENT_CONFIG_PATH) {
      const latestConfig = findLatestMtssoConfig();
      if (latestConfig) execEnv.MTSSO_AGENT_CONFIG_PATH = latestConfig;
    }
    exec(fullCmd, {
      timeout: 15000,
      env: execEnv,
      shell: '/bin/zsh'
    }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      if (err && !output) {
        console.error('[fetch-km-title] exec error for contentId', contentId, ':', err.message);
        resolve(null);
        return;
      }
      if (err) {
        console.warn('[fetch-km-title] cmd exited with error for contentId', contentId, ', output:', output.slice(0, 200));
      }
      try {
        // --raw 模式输出纯 JSON
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const meta = JSON.parse(jsonMatch[0]);
          const title = meta.title || meta.name || null;
          if (title) { resolve(title); return; }
        }
        // fallback: 匹配 "标题: xxx" 格式
        const titleMatch = output.match(/(?:标题|title)[：:]\s*(.+)/i);
        const title = titleMatch ? titleMatch[1].trim() : null;
        if (!title) {
          console.warn('[fetch-km-title] no title found for contentId', contentId, ', output:', output.slice(0, 200));
        }
        resolve(title);
      } catch (e) {
        console.error('[fetch-km-title] parse error for contentId', contentId, ':', e.message, 'output:', output.slice(0, 200));
        resolve(null);
      }
    });
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
  pendingReminderMap.set(win.webContents.id, { text: todoText, todoId, isOverdue });

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
    if (todo.repeat) {
      // 循环待办：标记今天完成
      if (!todo.completedDates) todo.completedDates = [];
      const today = new Date();
      const dk = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
      if (!todo.completedDates.includes(dk)) todo.completedDates.push(dk);
    } else {
      todo.done = true;
    }
    saveData(data);
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
    createWindow();
    createTray();
    startReminderScheduler();
  });
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

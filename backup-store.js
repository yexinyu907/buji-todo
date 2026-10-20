const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pack, unpack, safeName, MAX_TOTAL } = require('./zip-format');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const dataHash = data => hash(Buffer.from(JSON.stringify({ todos: data.todos, tagGroupOrder: data.tagGroupOrder || [] })));
function validateData(data) {
  if (!data || !Array.isArray(data.todos) || data.todos.length > 20000) throw new Error('备份中的待办列表无效。');
  const ids = new Set();
  for (const t of data.todos) {
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 256 || ids.has(t.id) || typeof t.text !== 'string' || t.text.length > 1000000) throw new Error('备份中的任务格式无效。');
    ids.add(t.id);
    for (const key of ['done', 'ddlHasTime', 'reminderEnabled', 'appleDetached', 'restoredFromBackup']) if (t[key] != null && typeof t[key] !== 'boolean') throw new Error('任务开关状态无效。');
    if (t.ddl != null && (!Number.isFinite(t.ddl) || Math.abs(t.ddl) > 8640000000000000)) throw new Error('截止日期无效。');
    if (t.priority != null && !['urgent', 'important', 'normal'].includes(t.priority)) throw new Error('优先级无效。');
    if (t.repeat != null && !['daily', 'weekly', 'custom', ''].includes(t.repeat)) throw new Error('循环规则无效。');
    for (const key of ['note', 'tag']) if (t[key] != null && typeof t[key] !== 'string') throw new Error('任务内容无效。');
    for (const key of ['images', 'noteImages']) if (t[key] != null && (!Array.isArray(t[key]) || t[key].some(n => !safeName('images/' + n)))) throw new Error('图片文件名无效。');
    if (t.links != null && (!Array.isArray(t.links) || t.links.some(l => !l || typeof l.url !== 'string' || !/^https?:\/\//i.test(l.url)))) throw new Error('链接内容无效。');
    if (t.completedDates != null && (!Array.isArray(t.completedDates) || t.completedDates.some(v => typeof v !== 'string'))) throw new Error('循环完成记录无效。');
  }
  if (data.tagGroupOrder != null && (!Array.isArray(data.tagGroupOrder) || data.tagGroupOrder.some(v => typeof v !== 'string'))) throw new Error('标签顺序无效。');
  return data;
}
function parseJSON(bytes) {
  return JSON.parse(bytes.toString('utf8'), (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('备份中包含无效字段。'); return value;
  });
}
class BackupStore {
  constructor({ directory, version, readData, readSync = () => ({}) }) {
    Object.assign(this, { directory, version, readData, readSync });
  }
  capture() {
    const current = this.readData(), data = validateData(clone({ todos: current.todos || [], tagGroupOrder: current.tagGroupOrder || [] }));
    const files = new Map([['data.json', Buffer.from(JSON.stringify(data))]]), state = this.readSync();
    files.set('sync.json', Buffer.from(JSON.stringify({ calendar: state.calendar || null, links: state.links || {} })));
    for (const t of data.todos) for (const name of [...(t.images || []), ...(t.noteImages || [])]) {
      const filename = 'images/' + name; if (files.has(filename)) continue;
      const full = path.join(this.directory, filename), st = fs.lstatSync(full);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 32 * 1024 * 1024) throw new Error('图片不可读取，备份未生成：' + name);
      files.set(filename, fs.readFileSync(full));
    }
    const manifest = { format: 'buji-todo-backup', schemaVersion: 1, appVersion: this.version, createdAt: Date.now(), total: data.todos.length,
      completed: data.todos.filter(t => t.done).length, images: [...files.keys()].filter(n => n.startsWith('images/')).length,
      files: Object.fromEntries([...files].map(([n, b]) => [n, { bytes: b.length, sha256: hash(b) }])) };
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest))); return pack(files);
  }
  read(bytes) {
    const files = unpack(bytes), manifest = parseJSON(files.get('manifest.json') || Buffer.from('{}'));
    if (manifest.format !== 'buji-todo-backup' || manifest.schemaVersion !== 1 || !Number.isFinite(manifest.createdAt) || !manifest.files || !files.has('data.json') || !files.has('sync.json')) throw new Error('这不是支持的不记Todo备份文件。');
    const names = Object.keys(manifest.files);
    if (names.length !== files.size - 1 || names.includes('manifest.json')) throw new Error('备份文件清单不完整。');
    for (const name of names) {
      const bytes = files.get(name), spec = manifest.files[name];
      if (!bytes || bytes.length !== spec.bytes || hash(bytes) !== spec.sha256) throw new Error('备份校验失败；当前数据未改动。');
    }
    const data = validateData(parseJSON(files.get('data.json'))), sync = parseJSON(files.get('sync.json'));
    if (!sync || typeof sync !== 'object' || Array.isArray(sync) || !sync.links || typeof sync.links !== 'object' || Array.isArray(sync.links) || (sync.calendar != null && (typeof sync.calendar !== 'object' || typeof sync.calendar.id !== 'string'))) throw new Error('备份中的关联记录无效。');
    for (const link of Object.values(sync.links)) if (!link || typeof link.remoteId !== 'string') throw new Error('备份中的任务关联无效。');
    for (const t of data.todos) for (const n of [...(t.images || []), ...(t.noteImages || [])]) if (!files.has('images/' + n)) throw new Error('备份缺少任务引用的图片。');
    if (manifest.total !== data.todos.length || manifest.completed !== data.todos.filter(t => t.done).length || manifest.images !== [...files.keys()].filter(n => n.startsWith('images/')).length) throw new Error('备份统计与内容不一致。');
    return { files, manifest, data, sync };
  }
  write(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, bytes, { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  preview(bytes) {
    const decoded = this.read(bytes), token = crypto.randomUUID();
    this.pending = { token, decoded, at: Date.now(), currentHash: dataHash(this.readData()) };
    return { token, ...decoded.manifest, incomplete: decoded.manifest.total - decoded.manifest.completed, tasks: decoded.data.todos.slice(0, 12).map(t => ({ text: t.text, done: !!t.done })) };
  }
  previewFile(file) {
    if (fs.statSync(file).size > MAX_TOTAL + 1024 * 1024) throw new Error('备份文件超过 250MB 的支持范围。');
    return this.preview(fs.readFileSync(file));
  }
  checkPreview(token) {
    const p = this.pending;
    if (!p || p.token !== token || Date.now() - p.at > 10 * 60000) throw new Error('导入确认已过期，请重新选择文件。');
    if (p.currentHash !== dataHash(this.readData())) throw new Error('当前待办有变化，请重新选择文件后导入。');
    return p;
  }
  prepareRestore(token) {
    const p = this.checkPreview(token);
    const data = clone(p.decoded.data), paths = [], renamed = new Map();
    try {
      fs.mkdirSync(path.join(this.directory, 'images'), { recursive: true });
      for (const t of data.todos) {
        const old = p.decoded.sync.links?.[t.id];
        const reference = t.restoreAppleLink || (t.appleReminderId && !t.appleDetached ? { remoteId: t.appleReminderId, externalId: old?.externalId, calendarId: t.appleCalendarId || p.decoded.sync.calendar?.id } : old ? { ...old, calendarId: p.decoded.sync.calendar?.id } : null);
        if (reference && typeof reference.remoteId === 'string') t.restoreAppleLink = { remoteId: reference.remoteId, externalId: typeof reference.externalId === 'string' ? reference.externalId : undefined, calendarId: typeof reference.calendarId === 'string' ? reference.calendarId : undefined };
        delete t.appleReminderId; delete t.appleCalendarId; delete t.appleDetached; t.restoredFromBackup = true;
        for (const key of ['images', 'noteImages']) if (t[key]) t[key] = t[key].map(n => {
          if (!renamed.has(n)) {
            const name = crypto.randomBytes(16).toString('hex') + path.extname(n), dest = path.join(this.directory, 'images', name);
            fs.writeFileSync(dest, p.decoded.files.get('images/' + n), { flag: 'wx', mode: 0o600 }); paths.push(dest); renamed.set(n, name);
          }
          return renamed.get(n);
        });
      }
      return { data, calendar: p.decoded.sync.calendar, rollback: () => { for (const f of paths) if (fs.existsSync(f)) fs.unlinkSync(f); }, commit: () => { this.pending = null; } };
    } catch (e) { for (const f of paths) if (fs.existsSync(f)) fs.unlinkSync(f); throw e; }
  }
}
module.exports = { BackupStore, validateData };

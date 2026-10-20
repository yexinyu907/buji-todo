const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fields, remoteFields, mergeFields, applyFields, createLocal, fingerprint, equal } = require('./apple-sync-engine');
const fail = (code, message) => Object.assign(new Error(message), { code });

class AppleSyncService {
  constructor({ bridge, directory, readData, writeData, notify = () => {} }) {
    Object.assign(this, { bridge, directory, readData, writeData, notify });
    this.statePath = path.join(directory, 'apple-sync.json');
    this.state = { enabled: false, catReminders: true, links: {}, pendingDeletes: {}, recovery: [], conflicts: [], archives: {}, audit: [] };
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(this.statePath, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') this.corrupt = true; }
    this.confirmedDeletes = new Set();
  }
  persist() {
    if (this.corrupt) throw fail('STATE_CORRUPT', '同步记录无法读取，已停止同步；请保留文件并联系开发者恢复。');
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.statePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.statePath);
  }
  view() {
    return { supported: process.platform === 'darwin', enabled: this.state.enabled,
      calendar: this.state.calendar || null, catReminders: this.state.catReminders !== false,
      lastSyncAt: this.state.lastSyncAt || null, lastAttemptAt: this.state.lastAttemptAt || null, errorCode: this.state.errorCode || null, error: this.corrupt ? '同步记录损坏，已停止同步。' : this.state.error || null,
      busy: !!this.running, conflicts: this.state.conflicts || [], uncertain: this.state.pendingCreate || null,
      linkedCount: Object.keys(this.state.links).length, restorePaused: !!this.state.restoredAt };
  }
  async status() {
    let authorization = 'unavailable';
    try { ({ authorization } = await this.bridge.call('status')); } catch (e) { if (process.platform === 'darwin') return { ...this.view(), error: e.message, authorization }; }
    return { ...this.view(), authorization };
  }
  async lists() { return this.bridge.call('lists'); }
  async snapshot(calendarId = this.state.calendar?.id) {
    const restored = (this.readData().todos || []).filter(t => !t.done && t.restoreAppleLink?.remoteId).map(t => t.restoreAppleLink.remoteId);
    return this.bridge.call('snapshot', { calendarId, ids: [...new Set([...Object.values(this.state.links).map(link => link.remoteId), ...restored])] });
  }
  async preview(calendarId) {
    if (this.state.enabled && this.state.calendar.id !== calendarId) throw fail('DISCONNECT_FIRST', '请先断开当前清单，再选择其他清单。');
    const calendar = (await this.lists()).find(c => c.id === calendarId && c.iCloud);
    if (!calendar) throw fail('NOT_ICLOUD', '请选择 iCloud 中允许修改的提醒事项清单。');
    const { reminders } = await this.snapshot(calendarId);
    const linked = this.state.calendar?.id === calendarId ? this.state.links : this.state.archives[calendarId]?.links || {};
    const remoteIds = new Set(Object.values(linked).map(x => x.remoteId));
    const local = (this.readData().todos || []).filter(t => !fields(t).done && !linked[t.id] && !t.appleReminderId);
    const available = reminders.filter(r => !remoteIds.has(r.id) && (!r.done || local.some(t => t.restoreAppleLink?.remoteId === r.id || (t.restoreAppleLink?.externalId && t.restoreAppleLink.externalId === r.externalId))));
    const duplicates = local.map(t => ({ localId: t.id, text: t.text,
      fromBackup: !!t.restoredFromBackup,
      candidates: available.filter(r => r.text.trim() === t.text.trim() || t.restoreAppleLink?.remoteId === r.id || (t.restoreAppleLink?.externalId && t.restoreAppleLink.externalId === r.externalId)).map(r => ({ id: r.id, ...remoteFields(r) })) }))
      .filter(row => row.candidates.length);
    const token = crypto.randomUUID();
    this.pendingPreview = { token, calendar, local, reminders, duplicates,
      hash: fingerprint(this.readData().todos || [], reminders) };
    return { token, calendar, exportCount: local.length, importCount: available.length, duplicates,
      localTasks: local.map(t => ({ id: t.id, text: t.text })), remoteTasks: available.map(r => ({ id: r.id, text: r.text })),
      resume: Object.keys(linked).length > 0, restoring: !!this.state.restoredAt };
  }
  async connect(token, choices = {}) {
    const preview = this.pendingPreview;
    if (!preview || preview.token !== token) throw fail('PREVIEW_EXPIRED', '预览已失效，请重新预览。');
    const fresh = await this.snapshot(preview.calendar.id);
    if (fingerprint(this.readData().todos || [], fresh.reminders) !== preview.hash) throw fail('PREVIEW_CHANGED', '预览后有任务发生变化，请重新预览再合并。');
    const used = new Set();
    for (const row of preview.duplicates) {
      const raw = choices[row.localId], choice = typeof raw === 'object' && raw ? raw.remoteId : raw;
      if (typeof raw === 'object' && (!raw || !row.fromBackup || !['local', 'remote'].includes(raw.side))) throw fail('INVALID_CHOICE', '恢复任务的处理方式无效。');
      if (choice !== 'separate' && !row.candidates.some(r => r.id === choice)) throw fail('CHOOSE_DUPLICATE', '请处理每一组疑似重复任务。');
      if (choice !== 'separate' && used.has(choice)) throw fail('DUPLICATE_LINK', '一条手机任务不能同时对应两条桌面任务。');
      if (choice !== 'separate') used.add(choice);
    }
    // Back up before the first write to either side.
    const backup = path.join(this.directory, 'sync-backups'); fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, `before-connect-${Date.now()}.json`), JSON.stringify(this.readData(), null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(backup, `merge-plan-${Date.now()}.json`), JSON.stringify({
      at: Date.now(), calendar: preview.calendar, remoteBefore: fresh.reminders,
      localBefore: preview.local, choices
    }, null, 2), { mode: 0o600 });
    if (this.state.calendar?.id !== preview.calendar.id) {
      if (this.state.calendar) this.state.archives[this.state.calendar.id] = { links: this.state.links };
      this.state.links = this.state.archives[preview.calendar.id]?.links || {};
      this.state.pendingDeletes = {}; this.state.conflicts = []; this.state.pendingCreate = null;
    }
    this.state.calendar = preview.calendar;
    for (const row of preview.duplicates) {
      if (choices[row.localId] === 'separate') continue;
      const raw = choices[row.localId], remoteId = typeof raw === 'object' ? raw.remoteId : raw;
      const remote = fresh.reminders.find(r => r.id === remoteId);
      this.state.links[row.localId] = { remoteId: remote.id, externalId: remote.externalId, base: remoteFields(remote) };
      // Explicit matching keeps phone values; the preview states this before confirmation.
      if (typeof raw === 'object' && raw.side === 'local') this.updateLocal(row.localId, t => { t.appleReminderId = remote.id; delete t.restoreAppleLink; });
      else this.updateLocal(row.localId, t => applyFields(t, remoteFields(remote), remote));
    }
    this.state.enabled = true; this.state.restoredAt = null; this.state.error = null; this.persist(); this.pendingPreview = null;
    await this.sync(); return this.view();
  }
  updateLocal(id, update) {
    const data = this.readData(); const task = (data.todos || []).find(t => t.id === id);
    if (task) { const before = JSON.stringify(task); update(task); task.appleCalendarId = this.state.calendar?.id;
      if (JSON.stringify(task) !== before) this.writeData(data); }
  }
  prepareSave(current, incoming) {
    if (this.corrupt) return incoming;
    const ids = new Set(incoming.map(t => t.id));
    for (const old of current) {
      if (!this.state.links[old.id] || ids.has(old.id)) continue;
      if (this.confirmedDeletes.delete(old.id)) { this.archive(old, '桌面删除'); this.state.pendingDeletes[old.id] = true; }
      else incoming.push(old);
    }
    this.persist(); return incoming;
  }
  async disconnect() {
    this.state.enabled = false; clearTimeout(this.debounce); this.again = false; this.persist();
    if (this.running) await this.running.catch(() => {});
    this.state.enabled = false; this.state.error = null; this.persist(); this.notify(); return this.view();
  }
  setCatReminders(enabled) { this.state.catReminders = !!enabled; this.persist(); this.notify(); return this.view(); }
  schedule() {
    clearTimeout(this.debounce);
    if (this.state.enabled) this.debounce = setTimeout(() => this.sync().catch(() => {}), 700);
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (this.state.enabled) this.sync().catch(() => {}); }, 30000);
    this.schedule();
  }
  stop() { clearTimeout(this.debounce); clearInterval(this.timer); }
  sync() {
    if (this.running) { this.again = true; return this.running; }
    if (!this.state.enabled || this.corrupt) return Promise.resolve(this.view());
    this.state.lastAttemptAt = Date.now();
    this.running = this.run().then(() => this.view()).catch(error => {
      this.state.error = error.message; this.state.errorCode = error.code; this.persist();
      throw error;
    }).finally(() => {
      this.running = null; this.notify();
      if (this.again) { this.again = false; this.schedule(); }
    });
    this.notify(); return this.running;
  }
  archive(todo, reason) {
    this.state.recovery.unshift({ at: Date.now(), reason, todo: structuredClone(todo) });
    this.state.recovery = this.state.recovery.slice(0, 100);
  }
  record(operation, localId, remoteId) {
    this.state.audit.push({ at: Date.now(), operation, localId, remoteId, calendarId: this.state.calendar.id });
    this.state.audit = this.state.audit.slice(-1000);
  }
  conflict(id, type, local, remote, keys = []) {
    return { id, type, text: local?.text || remote?.text || '待办', local: local ? fields(local) : null,
      remote: remote ? remoteFields(remote) : null, remoteId: remote?.id || null, stamp: remote?.stamp, keys };
  }
  async run() {
    this.persist();
    const snapshot = await this.snapshot();
    const remoteMap = new Map(snapshot.reminders.map(r => [r.id, r]));
    const removedRemoteIds = new Set();
    const conflicts = [];
    for (const task of this.readData().todos || []) {
      if (task.appleCalendarId === this.state.calendar.id && task.appleReminderId && !task.appleDetached && !this.state.links[task.id]) {
        this.state.links[task.id] = { remoteId: task.appleReminderId, base: null };
      }
    }
    for (const [id, link] of Object.entries(this.state.links)) {
      let remote = remoteMap.get(link.remoteId);
      const local = (this.readData().todos || []).find(t => t.id === id);
      if (!remote && link.externalId) {
        const matches = snapshot.reminders.filter(r => r.externalId === link.externalId);
        if (matches.length === 1) { remote = matches[0]; link.remoteId = remote.id; }
        else if (matches.length > 1) { conflicts.push(this.conflict(id, 'identifier', local, null)); continue; }
      }
      if (snapshot.outsideIds.includes(link.remoteId)) { conflicts.push(this.conflict(id, 'moved', local, null)); continue; }
      if (this.state.pendingDeletes[id]) {
        if (remote && !equal(link.base, remoteFields(remote))) { conflicts.push(this.conflict(id, 'delete', local || { text: link.base.text }, remote)); continue; }
        if (remote) {
          await this.bridge.call('delete', { calendarId: this.state.calendar.id, id: remote.id, stamp: remote.stamp });
          this.record('delete', id, remote.id);
        }
        if (remote) removedRemoteIds.add(remote.id);
        const data = this.readData();
        if ((data.todos || []).some(t => t.id === id)) { data.todos = data.todos.filter(t => t.id !== id); this.writeData(data); }
        delete this.state.links[id]; delete this.state.pendingDeletes[id];
        this.persist(); continue;
      }
      if (!local) { conflicts.push(this.conflict(id, 'missingLocal', null, remote)); continue; }
      if (!link.base) { conflicts.push(this.conflict(id, 'orphan', local, remote)); continue; }
      if (!remote) {
        if (!equal(fields(local), link.base)) { conflicts.push(this.conflict(id, 'deletedRemote', local, null)); continue; }
        const data = this.readData(); this.archive(local, '手机端删除'); data.todos = data.todos.filter(t => t.id !== id);
        this.writeData(data); delete this.state.links[id]; this.persist(); continue;
      }
      const plan = mergeFields(link.base, fields(local), remoteFields(remote));
      if (plan.conflicts.length) { conflicts.push(this.conflict(id, 'fields', local, remote, plan.conflicts)); continue; }
      const captured = fields(local);
      if (Object.keys(plan.patch).length) {
        remote = await this.bridge.call('update', { calendarId: this.state.calendar.id, id: remote.id, stamp: remote.stamp, patch: plan.patch });
        this.record('update', id, remote.id);
      }
      const next = remoteFields(remote);
      this.updateLocal(id, t => {
        const current = fields(t), safe = { ...next };
        for (const key of Object.keys(current)) if (!equal(current[key], captured[key])) safe[key] = current[key];
        applyFields(t, safe, remote);
      });
      link.base = next; link.remoteId = remote.id; link.externalId = remote.externalId;
      this.persist();
    }
    this.state.conflicts = conflicts;
    // An interrupted create has an unknown outcome. Never automatically repeat it.
    if (this.state.pendingCreate) {
      const pending = this.state.pendingCreate;
      pending.candidates = snapshot.reminders.filter(r => !Object.values(this.state.links).some(l => l.remoteId === r.id) && r.text === pending.fields.text)
        .map(r => ({ id: r.id, text: r.text, date: r.date }));
      this.persist(); this.notify(); return;
    }
    const linkedIds = new Set(Object.values(this.state.links).map(l => l.remoteId));
    const data = this.readData(); let imported = false;
    for (const remote of snapshot.reminders) {
      if (remote.done || linkedIds.has(remote.id) || removedRemoteIds.has(remote.id)) continue;
      const todo = createLocal(remote); todo.appleCalendarId = this.state.calendar.id; data.todos.unshift(todo);
      this.state.links[todo.id] = { remoteId: remote.id, externalId: remote.externalId, base: remoteFields(remote) };
      imported = true;
    }
    if (imported) { this.writeData(data); this.persist(); }
    for (const todo of this.readData().todos || []) {
      if (this.state.links[todo.id] || todo.appleReminderId || fields(todo).done) continue;
      const capture = fields(todo);
      if (capture.repeat === 'custom') throw fail('CUSTOM_REPEAT', '恢复的自定义循环需要关联原苹果任务，或先改成每天、每周或不循环，再同步。');
      this.state.pendingCreate = { todoId: todo.id, fields: capture, at: Date.now(), candidates: [] }; this.persist();
      const remote = await this.bridge.call('create', { calendarId: this.state.calendar.id, patch: capture });
      this.record('create', todo.id, remote.id);
      this.state.links[todo.id] = { remoteId: remote.id, externalId: remote.externalId, base: remoteFields(remote) };
      this.updateLocal(todo.id, t => { t.appleReminderId = remote.id; delete t.restoreAppleLink; });
      this.state.pendingCreate = null; this.persist();
      if (!equal(fields((this.readData().todos || []).find(t => t.id === todo.id) || todo), capture)) this.again = true;
    }
    this.state.lastSyncAt = Date.now(); this.state.error = null; this.state.errorCode = null; this.persist(); this.notify();
  }
  async resolve(id, choice) {
    if (this.running) await this.running;
    const conflict = this.state.conflicts.find(c => c.id === id);
    if (!conflict) throw fail('CONFLICT_EXPIRED', '任务状态已变化，请重新同步。');
    const snapshot = await this.snapshot();
    const remote = snapshot.reminders.find(r => r.id === conflict.remoteId);
    if (remote && remote.stamp !== conflict.stamp) throw fail('CONFLICT_CHANGED', '手机内容已变化，请重新同步后再选择。');
    const link = this.state.links[id];
    if (!link) throw fail('CONFLICT_EXPIRED', '关联记录已变化，请重新同步。');
    if (conflict.type === 'fields' || (conflict.type === 'orphan' && remote)) {
      const local = (this.readData().todos || []).find(t => t.id === id);
      if (!local || !remote || !equal(fields(local), conflict.local)) throw fail('CONFLICT_CHANGED', '任务内容已变化，请重新同步。');
      // Change the baseline, not data: next three-way merge applies the chosen side safely.
      link.base = choice === 'local' ? remoteFields(remote) : fields(local);
    } else if (choice === 'remote') {
      const data = this.readData(), local = (data.todos || []).find(t => t.id === id);
      if (local) { this.archive(local, '冲突处理中移除'); data.todos = data.todos.filter(t => t.id !== id); this.writeData(data); }
      delete this.state.links[id]; delete this.state.pendingDeletes[id];
      // A remote task that still exists is imported again with its current values.
    } else if (conflict.type === 'delete' && remote) {
      link.base = remoteFields(remote);
    } else {
      // Missing/moved/ambiguous remote: keeping desktop detaches it; never writes another list.
      this.updateLocal(id, t => { t.appleReminderId = t.appleReminderId || link.remoteId; t.appleDetached = true; });
      delete this.state.links[id]; delete this.state.pendingDeletes[id];
    }
    this.state.conflicts = this.state.conflicts.filter(c => c.id !== id); this.persist();
    await this.sync(); return this.view();
  }
  async resolveCreate(remoteId) {
    if (this.running) await this.running;
    const pending = this.state.pendingCreate;
    if (!pending) return this.view();
    if (!remoteId) throw fail('CHOOSE_RESULT', '请先在提醒事项确认结果，再选择对应任务，或保留为本地任务。');
    if (remoteId === 'retry-confirmed') {
      // Explicit user confirmation is required by the settings UI before retrying.
    } else if (remoteId === 'local-only') {
      this.updateLocal(pending.todoId, t => { t.appleReminderId = 'detached:' + t.id; t.appleDetached = true; });
    } else {
      const snapshot = await this.snapshot(); const remote = snapshot.reminders.find(r => r.id === remoteId);
      if (!remote || Object.values(this.state.links).some(l => l.remoteId === remoteId)) throw fail('INVALID_MATCH', '选择的任务已不可关联，请重新同步。');
      this.state.links[pending.todoId] = { remoteId, externalId: remote.externalId, base: remoteFields(remote) };
      this.updateLocal(pending.todoId, t => applyFields(t, remoteFields(remote), remote));
    }
    this.state.pendingCreate = null; this.persist(); await this.sync(); return this.view();
  }
}
module.exports = { AppleSyncService };

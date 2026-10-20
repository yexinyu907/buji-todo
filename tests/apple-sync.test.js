const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppleSyncService } = require('../apple-sync-service');
const { fields, mergeFields, mergeRendererTodos } = require('../apple-sync-engine');
const copy = value => structuredClone(value);
const todo = (id = 'local', patch = {}) => ({ id, text: id, note: null, ddl: null, ddlHasTime: false, priority: 'normal', repeat: null, done: false, createdAt: 1, ...patch });
const remote = (id = 'remote', patch = {}) => ({ id, externalId: 'external-' + id, stamp: 1, ...fields(todo(id)), url: '', ...patch });
function setup(t, local = [], reminders = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buji-sync-'));
  let data = { todos: copy(local) }, next = 1;
  const map = new Map(reminders.map(r => [r.id, copy(r)])), calls = [];
  const bridge = { failRead: false, loseCreateReply: false, async call(action, input = {}) {
    calls.push({ action, input: copy(input) });
    if (action === 'status') return { authorization: 'authorized' };
    if (action === 'lists') return [{ id: 'list', title: '提醒', source: 'iCloud', iCloud: true }];
    if (input.calendarId !== 'list') throw new Error('wrong list');
    if (action === 'snapshot') {
      if (this.failRead) throw Object.assign(new Error('permission revoked'), { code: 'NOT_AUTHORIZED' });
      return { reminders: [...map.values()].filter(r => !r.done || input.ids?.includes(r.id)).map(copy), outsideIds: this.outsideIds || [] };
    }
    if (action === 'create') {
      const r = remote('created-' + next++, input.patch); map.set(r.id, r);
      if (this.loseCreateReply) throw new Error('reply lost');
      return copy(r);
    }
    const r = map.get(input.id); if (!r) throw new Error('missing');
    if (input.stamp !== r.stamp) throw Object.assign(new Error('changed'), { code: 'ITEM_CHANGED' });
    if (action === 'delete') { map.delete(r.id); return { deleted: true }; }
    if (action === 'update') { Object.assign(r, input.patch); r.stamp++; return copy(r); }
    throw new Error('unknown action');
  } };
  const service = new AppleSyncService({ directory, bridge, readData: () => copy(data), writeData: value => { data = copy(value); } });
  t.after(() => { service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, bridge, map, calls, data: () => data, change: fn => fn(data), async connect(choices) { const p = await service.preview('list'); await service.connect(p.token, choices); } };
}

test('首次合并只导入导出未完成任务；反复同步无重复', async t => {
  const f = setup(t, [todo('local'), todo('local-done', { done: true })], [remote(), remote('old', { done: true })]);
  const p = await f.service.preview('list'); assert.equal(p.exportCount, 1); assert.equal(p.importCount, 1);
  assert.equal(f.calls.filter(c => c.action === 'create').length, 0);
  await f.service.connect(p.token); await f.service.sync(); await f.service.sync();
  assert.equal(f.data().todos.length, 3); assert.equal(f.map.size, 3);
  assert.equal(f.calls.filter(c => c.action === 'create').length, 1);
});
test('首次预览后数据变化会拒绝合并', async t => {
  const f = setup(t, [todo()]); const p = await f.service.preview('list');
  f.change(d => d.todos[0].text = 'edited');
  await assert.rejects(f.service.connect(p.token), { code: 'PREVIEW_CHANGED' }); assert.equal(f.map.size, 0);
});
test('同名任务必须由用户选择，选择保留两条不自动合并', async t => {
  const f = setup(t, [todo('a', { text: '同名' })], [remote('b', { text: '同名' })]);
  const p = await f.service.preview('list'); assert.equal(p.duplicates.length, 1);
  await assert.rejects(f.service.connect(p.token), { code: 'CHOOSE_DUPLICATE' });
  await f.service.connect(p.token, { a: 'separate' }); assert.equal(f.map.size, 2); assert.equal(f.data().todos.length, 2);
});
test('明确关联同名任务采用预览说明的手机内容，不再次导出', async t => {
  const f = setup(t, [todo('a', { text: '同名', note: '桌面备注' })], [remote('b', { text: '同名', note: '手机备注' })]);
  await f.connect({ a: 'b' }); assert.equal(f.map.size, 1); assert.equal(f.data().todos[0].note, '手机备注');
});
test('两端修改不同字段可合并，原有图片和标签仍保留', async t => {
  const f = setup(t, [], [remote()]); await f.connect();
  f.change(d => Object.assign(d.todos[0], { note: '桌面备注', images: ['a.png'], tag: '工作' }));
  Object.assign(f.map.get('remote'), { text: '手机正文', stamp: 2 }); await f.service.sync();
  assert.equal(f.data().todos[0].text, '手机正文'); assert.equal(f.map.get('remote').note, '桌面备注');
  assert.deepEqual(f.data().todos[0].images, ['a.png']); assert.equal(f.data().todos[0].tag, '工作');
  const write = f.calls.find(c => c.action === 'update'); assert.deepEqual(Object.keys(write.input.patch), ['note']);
});
test('同字段冲突保留两端，选择桌面后再写入苹果', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.change(d => d.todos[0].text = '桌面');
  Object.assign(f.map.get('remote'), { text: '手机', stamp: 2 }); await f.service.sync();
  assert.equal(f.service.state.conflicts.length, 1); assert.equal(f.map.get('remote').text, '手机');
  await f.service.resolve(f.data().todos[0].id, 'local'); assert.equal(f.map.get('remote').text, '桌面');
});
test('冲突选择手机不会回写旧桌面内容', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.change(d => d.todos[0].text = '桌面');
  Object.assign(f.map.get('remote'), { text: '手机', stamp: 2 }); await f.service.sync();
  await f.service.resolve(f.data().todos[0].id, 'remote'); assert.equal(f.data().todos[0].text, '手机');
});
test('预览中的一个手机任务不能匹配多个桌面任务', async t => {
  const f = setup(t, [todo('a', { text: 'same' }), todo('b', { text: 'same' })], [remote('r', { text: 'same' })]);
  const p = await f.service.preview('list'); await assert.rejects(f.service.connect(p.token, { a: 'r', b: 'r' }), { code: 'DUPLICATE_LINK' });
});
test('权限撤回或读取失败不会被当作远端清空', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.bridge.failRead = true;
  await assert.rejects(f.service.sync()); assert.equal(f.data().todos.length, 1); assert.equal(f.map.size, 1);
});
test('手机删除未修改任务后桌面移除并保存恢复快照', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.map.delete('remote'); await f.service.sync();
  assert.equal(f.data().todos.length, 0); assert.equal(f.service.state.recovery.length, 1);
});
test('手机删除与桌面修改相遇时不会丢失桌面内容', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.change(d => d.todos[0].note = '离线修改'); f.map.delete('remote');
  await f.service.sync(); assert.equal(f.service.state.conflicts[0].type, 'deletedRemote');
  assert.equal(f.data().todos[0].note, '离线修改');
});
test('未经确认的桌面删除会被拦住', async t => {
  const f = setup(t, [], [remote()]); await f.connect();
  const incoming = f.service.prepareSave(f.data().todos, []); assert.equal(incoming.length, 1);
});
test('确认删除后两边删除，不会从旧快照重新导入', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); const id = f.data().todos[0].id;
  f.service.confirmedDeletes.add(id); const incoming = f.service.prepareSave(f.data().todos, []); f.change(d => d.todos = incoming);
  await f.service.sync(); await f.service.sync(); assert.equal(f.data().todos.length, 0); assert.equal(f.map.size, 0);
  assert.equal(f.service.state.recovery[0].todo.text, 'remote');
});
test('删除确认后手机又编辑时，先展示冲突', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); const id = f.data().todos[0].id;
  f.service.confirmedDeletes.add(id); const incoming = f.service.prepareSave(f.data().todos, []); f.change(d => d.todos = incoming);
  Object.assign(f.map.get('remote'), { note: '手机新备注', stamp: 2 }); await f.service.sync();
  assert.equal(f.service.state.conflicts[0].type, 'delete'); assert.equal(f.map.size, 1);
  await f.service.resolve(id, 'remote'); assert.equal(f.data().todos[0].note, '手机新备注');
});
test('新增写入成功但回包丢失时不自动重试新增', async t => {
  const f = setup(t, [todo()]); const p = await f.service.preview('list'); f.bridge.loseCreateReply = true;
  await assert.rejects(f.service.connect(p.token)); assert.equal(f.map.size, 1);
  await f.service.sync(); await f.service.sync(); assert.equal(f.map.size, 1);
  assert.equal(f.service.state.pendingCreate.candidates.length, 1);
  f.bridge.loseCreateReply = false; await f.service.resolveCreate([...f.map.keys()][0]);
  assert.equal(f.data().todos.length, 1); assert.equal(f.service.state.pendingCreate, null);
});
test('本地导入成功但关联记录丢失时要求确认，不重复导入', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); f.service.state.links = {}; await f.service.sync();
  assert.equal(f.data().todos.length, 1); assert.equal(f.service.state.conflicts[0].type, 'orphan');
  await f.service.resolve(f.data().todos[0].id, 'remote'); assert.equal(f.data().todos.length, 1);
});
test('断开不删除数据，再连接同一清单不重复', async t => {
  const f = setup(t, [todo()], [remote()]); await f.connect(); await f.service.disconnect();
  const count = f.calls.length; await f.service.sync(); assert.equal(f.calls.length, count);
  assert.equal(f.data().todos.length, 2); await f.connect(); assert.equal(f.map.size, 2); assert.equal(f.data().todos.length, 2);
});
test('远端完成和撤销完成双向处理', async t => {
  const f = setup(t, [], [remote()]); await f.connect(); Object.assign(f.map.get('remote'), { done: true, stamp: 2 });
  await f.service.sync(); assert.equal(f.data().todos[0].done, true);
  f.change(d => d.todos[0].done = false); await f.service.sync(); assert.equal(f.map.get('remote').done, false);
});
test('自定义循环规则不因修改备注而被简化', async t => {
  const f = setup(t, [], [remote('remote', { repeat: 'custom' })]); await f.connect(); f.change(d => d.todos[0].note = 'new');
  await f.service.sync(); assert.equal(f.map.get('remote').repeat, 'custom');
  assert.equal(f.calls.find(c => c.action === 'update').input.patch.repeat, undefined);
});
test('旧渲染器保存只提交已修改字段，不覆盖同步导入和手机修改', () => {
  const base = [todo('a')], current = [todo('a', { text: '手机新正文' }), todo('imported')];
  const submitted = [todo('a', { note: '桌面新备注' })];
  const merged = mergeRendererTodos(current, submitted, base);
  assert.equal(merged[0].text, '手机新正文'); assert.equal(merged[0].note, '桌面新备注'); assert.equal(merged.length, 2);
});
test('合并器仅对真正冲突的字段提问', () => {
  const base = fields(todo()); const local = { ...base, note: 'desktop' }, phone = { ...base, text: 'phone' };
  assert.equal(mergeFields(base, local, phone).conflicts.length, 0);
  assert.deepEqual(mergeFields(base, { ...base, text: 'desktop' }, phone).conflicts, ['text']);
});
test('手机任务移出清单时提示确认，不当作删除也不修改其他清单', async t => {
  const f = setup(t, [], [remote()]); await f.connect();
  f.map.delete('remote'); f.bridge.outsideIds = ['remote']; await f.service.sync();
  assert.equal(f.data().todos.length, 1); assert.equal(f.service.state.conflicts[0].type, 'moved');
  await f.service.resolve(f.data().todos[0].id, 'local');
  assert.equal(f.data().todos[0].appleDetached, true);
  assert.equal(f.calls.filter(c => ['create', 'update', 'delete'].includes(c.action)).length, 0);
});
test('苹果内部标识改变但外部标识唯一时恢复关联', async t => {
  const f = setup(t, [], [remote()]); await f.connect();
  const r = f.map.get('remote'); f.map.delete('remote'); f.map.set('new-id', { ...r, id: 'new-id', stamp: 2 });
  await f.service.sync(); assert.equal(f.data().todos.length, 1);
  assert.equal(f.data().todos[0].appleReminderId, 'new-id'); assert.equal(f.service.state.conflicts.length, 0);
});
test('重启后仍使用原关联，不重复导入导出', async t => {
  const f = setup(t, [todo()], [remote()]); await f.connect();
  const restarted = new AppleSyncService({ directory: f.service.directory, bridge: f.bridge,
    readData: () => copy(f.data()), writeData: value => f.change(d => Object.assign(d, value)) });
  await restarted.sync(); assert.equal(f.data().todos.length, 2); assert.equal(f.map.size, 2);
  assert.equal(f.calls.filter(c => c.action === 'create').length, 1);
});
test('写入与合并计划记录苹果标识，供后续核对', async t => {
  const f = setup(t, [todo()]); await f.connect();
  assert.equal(f.service.state.audit[0].operation, 'create');
  assert.equal(f.service.state.audit[0].remoteId, [...f.map.keys()][0]);
  const backup = path.join(f.service.directory, 'sync-backups');
  const manifest = fs.readdirSync(backup).find(name => name.startsWith('merge-plan-'));
  const plan = JSON.parse(fs.readFileSync(path.join(backup, manifest), 'utf8'));
  assert.equal(plan.remoteBefore.length, 0); assert.equal(plan.localBefore.length, 1);
});
test('旧窗口未编辑的任务不使已经删除的任务复活', () => {
  const before = [todo('gone'), todo('kept')];
  assert.deepEqual(mergeRendererTodos([todo('kept')], copy(before), before).map(t => t.id), ['kept']);
  const edited = copy(before); edited[0].note = '尚未保存的修改';
  assert.equal(mergeRendererTodos([todo('kept')], edited, before)[0].note, '尚未保存的修改');
});
test('循环完成后苹果生成的下一条只导入一次', async t => {
  const f = setup(t, [], [remote('repeat', { repeat: 'daily' })]); await f.connect();
  Object.assign(f.map.get('repeat'), { done: true, stamp: 2 });
  f.map.set('next-repeat', remote('next-repeat', { repeat: 'daily' }));
  await f.service.sync(); await f.service.sync();
  assert.equal(f.data().todos.filter(t => !t.done).length, 1);
  assert.equal(f.calls.filter(c => c.action === 'create').length, 0);
});
test('首次连接后变更触发自动双向同步，不再要求确认合并', async t => {
  const f = setup(t, [todo('desktop')], [remote('phone')]); await f.connect();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  f.map.set('new-phone', remote('new-phone'));
  f.change(d => d.todos.push(todo('new-desktop')));
  f.service.schedule(); t.mock.timers.tick(700);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.data().todos.some(t => t.appleReminderId === 'new-phone'));
  assert.ok([...f.map.values()].some(r => r.text === 'new-desktop'));
  assert.equal(f.service.state.conflicts.length, 0); assert.equal(f.service.state.enabled, true);
});
test('重启后自动续接，轮询自动读取手机后续变更', async t => {
  const f = setup(t, [], [remote('phone')]); await f.connect();
  const restarted = new AppleSyncService({ directory: f.service.directory, bridge: f.bridge,
    readData: () => copy(f.data()), writeData: value => f.change(d => Object.assign(d, value)) });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => restarted.stop());
  f.map.set('while-closed', remote('while-closed')); restarted.start();
  t.mock.timers.tick(700); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.data().todos.some(t => t.appleReminderId === 'while-closed'));
  f.map.set('later', remote('later')); t.mock.timers.tick(30000);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.data().todos.some(t => t.appleReminderId === 'later'));
  assert.equal(f.calls.filter(c => c.action === 'create').length, 0);
});

test('恢复后的关联按原标识找回，即使手机标题已改；默认采用手机当前内容', async t => {
  const f = setup(t, [todo('a',{text:'旧标题',restoredFromBackup:true,restoreAppleLink:{remoteId:'r'}})], [remote('r',{text:'手机新标题',note:'手机备注'})]);
  f.service.state.restoredAt=1;const p=await f.service.preview('list');assert.equal(p.restoring,true);assert.equal(p.duplicates[0].fromBackup,true);
  await f.service.connect(p.token,{a:{remoteId:'r',side:'remote'}});assert.equal(f.data().todos[0].text,'手机新标题');assert.equal(f.calls.filter(c=>['create','update'].includes(c.action)).length,0);assert.equal(f.map.size,1);
});
test('恢复内容只有明确选采用桌面后才回写手机，且不重复新增',async t=>{
  const f=setup(t,[todo('a',{text:'恢复标题',note:'恢复备注',restoredFromBackup:true,restoreAppleLink:{remoteId:'r'}})],[remote('r',{text:'手机标题',note:'手机备注'})]);
  const p=await f.service.preview('list');assert.equal(f.map.get('r').text,'手机标题');await f.service.connect(p.token,{a:{remoteId:'r',side:'local'}});
  assert.equal(f.map.get('r').text,'恢复标题');assert.equal(f.map.get('r').note,'恢复备注');assert.equal(f.map.size,1);await f.service.sync();assert.equal(f.calls.filter(c=>c.action==='update').length,1);assert.equal(f.calls.filter(c=>c.action==='create').length,0);
});
test('恢复未完成但手机已经完成时默认保留手机完成状态',async t=>{
  const f=setup(t,[todo('a',{text:'旧任务',restoredFromBackup:true,restoreAppleLink:{remoteId:'r'}})],[remote('r',{done:true})]);
  const p=await f.service.preview('list');assert.equal(p.duplicates[0].candidates[0].done,true);await f.service.connect(p.token,{a:{remoteId:'r',side:'remote'}});assert.equal(f.data().todos[0].done,true);assert.equal(f.map.get('r').done,true);
});
test('恢复自定义循环找不到原任务时不降级新建',async t=>{
  const f=setup(t,[todo('a',{text:'旧任务',repeat:'custom',restoredFromBackup:true,restoreAppleLink:{remoteId:'gone'}})],[]);
  const p=await f.service.preview('list');await assert.rejects(f.service.connect(p.token),{code:'CUSTOM_REPEAT'});assert.equal(f.calls.filter(c=>c.action==='create').length,0);assert.equal(f.map.size,0);assert.ok(f.service.state.error);
});

test('恢复选择无效时拒绝写入手机',async t=>{ const f=setup(t,[todo('a',{text:'same',restoredFromBackup:true,restoreAppleLink:{remoteId:'r'}})],[remote('r',{text:'same'})]); const p=await f.service.preview('list');await assert.rejects(f.service.connect(p.token,{a:null}),{code:'INVALID_CHOICE'});assert.equal(f.calls.filter(c=>['create','update'].includes(c.action)).length,0); });

test('立即同步无内容变化也更新成功时间，失败保留上次成功并记录尝试时间',async t=>{
  const f=setup(t,[],[remote()]);await f.connect();f.service.state.lastSyncAt=1;f.bridge.failRead=true;
  await assert.rejects(f.service.sync());let status=f.service.view();assert.equal(status.lastSyncAt,1);assert.ok(status.lastAttemptAt>1);assert.equal(status.errorCode,'NOT_AUTHORIZED');
  f.bridge.failRead=false;await f.service.sync();status=f.service.view();assert.ok(status.lastSyncAt>1);assert.equal(status.error,null);assert.equal(status.errorCode,null);
  f.service.state.lastSyncAt=1;const result=await f.service.sync();assert.equal(result.enabled,true);assert.ok(result.lastSyncAt>1);assert.ok(f.service.view().lastSyncAt>1);assert.equal(f.calls.filter(c=>c.action==='update').length,0);
});

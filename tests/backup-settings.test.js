const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BackupStore } = require('../backup-store');
const { pack, unpack, safeName } = require('../zip-format');
const { PreferencesStore, validatePatch } = require('../preferences-store');
const { compareVersions } = require('../update-check');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buji-backup-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  let data = {todos:[{id:'a',text:'未完成',done:false,priority:'normal',note:'备注',tag:'工作',images:['a.PNG'],noteImages:['a.PNG'],appleReminderId:'remote',appleCalendarId:'list'}, {id:'b',text:'已完成',done:true,completedDates:['2026-10-19']}],tagGroupOrder:['工作'],bounds:{height:600},secretPreference:'excluded'};
  fs.mkdirSync(path.join(directory,'images')); fs.writeFileSync(path.join(directory,'images/a.PNG'),Buffer.from([137,80,78,71]));
  const store = new BackupStore({directory,version:'0.8.0',readData:()=>structuredClone(data),readSync:()=>({enabled:true,calendar:{id:'list'},links:{a:{remoteId:'remote',externalId:'external'}},catReminders:false})});
  return {directory,store,data:()=>data,change:fn=>fn(data)};
}
test('ZIP 支持标准读取、无损图片；拒绝路径穿越与重复文件', () => {
  const files = new Map([['data.json',Buffer.from('{"a":1}')],['images/a.PNG',Buffer.from([0,1,2,3])]]);
  assert.deepEqual(unpack(pack(files)),files);
  for (const name of ['../data.json','images/../../a.png','/a.png','images/a/b.png','images/a.svg']) assert.equal(safeName(name),false);
  assert.throws(()=>pack(new Map([['../data.json',Buffer.from('x')]])));
  const bytes=pack(new Map([['data.json',Buffer.from('a')],['sync.json',Buffer.from('b')]]));
  // Two names of the same byte length; replace both local and directory names.
  const duplicate=Buffer.from(bytes.toString('latin1').replaceAll('sync.json','data.json'),'latin1');
  assert.throws(()=>unpack(duplicate));
});
test('ZIP 校验拒绝坏图片、损坏目录和过大声明', () => {
  const bytes=pack(new Map([['images/a.png',Buffer.from('unique-image-bytes')]]));
  const broken=Buffer.from(bytes);broken[broken.indexOf('unique-image-bytes')]^=1;assert.throws(()=>unpack(broken));
  assert.throws(()=>unpack(bytes.subarray(0,bytes.length-1)));
  const large=Buffer.from(bytes),c=large.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));large.writeUInt32LE(40*1024*1024,c+24);assert.throws(()=>unpack(large));
});
test('备份包含已完成未完成、图片、任务属性和关联，不包含全局设置',t=>{
  const f=fixture(t), decoded=f.store.read(f.store.capture());
  assert.deepEqual(decoded.data.todos,f.data().todos);assert.deepEqual(decoded.data.tagGroupOrder,['工作']);
  assert.equal(decoded.manifest.total,2);assert.equal(decoded.manifest.completed,1);assert.equal(decoded.manifest.images,1);
  assert.equal(decoded.data.secretPreference,undefined);assert.equal(decoded.data.bounds,undefined);assert.equal(decoded.sync.enabled,undefined);assert.equal(decoded.sync.catReminders,undefined);
  assert.deepEqual(decoded.files.get('images/a.PNG'),Buffer.from([137,80,78,71]));
});
test('修改内容即使重新打包也过不了清单哈希；失败不改数据',t=>{
  const f=fixture(t), before=structuredClone(f.data()), files=unpack(f.store.capture());files.set('data.json',Buffer.from('{"todos":[]}'));
  assert.throws(()=>f.store.preview(pack(files)),/校验/);assert.deepEqual(f.data(),before);assert.equal(f.store.pending,undefined);
});
test('恢复先预览，不写数据；图片换名、关联待核对，并可撤销准备',t=>{
  const f=fixture(t),bytes=f.store.capture(),p=f.store.preview(bytes);assert.equal(p.incomplete,1);assert.equal(p.completed,1);
  assert.deepEqual(fs.readdirSync(path.join(f.directory,'images')),['a.PNG']);
  const prepared=f.store.prepareRestore(p.token),a=prepared.data.todos[0];
  assert.equal(a.appleReminderId,undefined);assert.equal(a.restoreAppleLink.remoteId,'remote');assert.equal(a.restoreAppleLink.externalId,'external');assert.equal(a.restoredFromBackup,true);
  assert.notEqual(a.images[0],'a.PNG');assert.equal(a.images[0],a.noteImages[0]);assert.equal(fs.readdirSync(path.join(f.directory,'images')).length,2);
  assert.equal(f.data().todos[0].appleReminderId,'remote');prepared.rollback();assert.equal(fs.readdirSync(path.join(f.directory,'images')).length,1);
});
test('导入确认忽略窗口位置变化，但拒绝任务变化和过期令牌',t=>{
  const f=fixture(t),p=f.store.preview(f.store.capture());f.change(d=>d.bounds.height=700);assert.doesNotThrow(()=>f.store.checkPreview(p.token));
  f.change(d=>d.todos[0].text='改了');assert.throws(()=>f.store.checkPreview(p.token),/有变化/);
  const next=f.store.preview(f.store.capture());f.store.pending.at-=11*60000;assert.throws(()=>f.store.checkPreview(next.token),/过期/);
});
test('只在指定位置导出，预览与导入准备不会创建自动备份目录', t => {
  const f=fixture(t), file=path.join(f.directory,'manual-export.zip');f.store.write(file,f.store.capture());
  const p=f.store.previewFile(file),prepared=f.store.prepareRestore(p.token);assert.equal(prepared.data.todos.length,2);prepared.rollback();
  assert.equal(fs.existsSync(path.join(f.directory,'backups')),false);assert.equal(typeof f.store.ensureDaily,'undefined');assert.equal(typeof f.store.beforeRestore,'undefined');
});
test('缺图片拒绝生成不完整备份；原有数据保持',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.directory,'images/a.PNG'));assert.throws(()=>f.store.capture());assert.equal(f.data().todos.length,2);
});
test('偏好默认值、持久保存、非法输入及损坏文件保护',t=>{
  const f=fixture(t), p=new PreferencesStore(f.directory);assert.equal(p.get().catEnabled,true);
  p.save({fontSize:'large',density:'compact',opacity:80,shortcut:'Command+Shift+B',sortMode:'ddl-asc',viewMode:'calendar',pinned:false});
  assert.deepEqual(new PreferencesStore(f.directory).get(),p.get());
  for(const v of [{opacity:69},{fontSize:'huge'},{pinned:'false'},{shortcut:'Shift+B'},{shortcut:'Command+;'},{unknown:true}])assert.throws(()=>validatePatch(v));
  fs.writeFileSync(p.file,'broken');const corrupted=new PreferencesStore(f.directory);assert.ok(corrupted.error);assert.throws(()=>corrupted.save({density:'compact'}));assert.equal(fs.readFileSync(p.file,'utf8'),'broken');
});
test('公开版本比较不按字符串排序',()=>{assert.equal(compareVersions('0.10.0','0.9.9'),1);assert.equal(compareVersions('v0.8.0','0.8.0'),0);assert.equal(compareVersions('0.7.6','0.8.0'),-1);});

test('旧版外观迁移为连续数值，保持字号和紧凑偏好', t => {
  const f=fixture(t);fs.writeFileSync(path.join(f.directory,'settings.json'),JSON.stringify({fontSize:'large',density:'compact',opacity:85}));
  const p=new PreferencesStore(f.directory);assert.equal(p.get().fontScale,114);assert.equal(p.get().cardSpacing,10);assert.equal(p.get().opacity,85);assert.equal(p.get().backgroundColor,'#faf9f6');
  p.save({fontScale:153,cardSpacing:87,backgroundColor:'#edf5ee'});const next=new PreferencesStore(f.directory).get();assert.equal(next.fontScale,153);assert.equal(next.cardSpacing,87);assert.equal(next.backgroundColor,'#edf5ee');
});
test('连续外观仅接受范围内整数和有效的自定义色值', () => {
  for(const value of [{fontScale:79},{fontScale:161},{fontScale:'120'},{fontScale:110.5},{cardSpacing:-1},{cardSpacing:101},{backgroundColor:'#xxff00'},{backgroundColor:'url(test)'}]) assert.throws(()=>validatePatch(value));
  assert.doesNotThrow(()=>validatePatch({fontScale:80,cardSpacing:0,backgroundColor:'#faedf0',opacity:70}));
  assert.doesNotThrow(()=>validatePatch({fontScale:160,cardSpacing:100}));
});

test('自定义颜色支持缩写、大小写及不带井号，并规范化持久保存', t => {
  const f=fixture(t),p=new PreferencesStore(f.directory);p.save({backgroundColor:'#AbC'});assert.equal(p.get().backgroundColor,'#aabbcc');
  p.save({backgroundColor:'123456'});assert.equal(new PreferencesStore(f.directory).get().backgroundColor,'#123456');
  assert.doesNotThrow(()=>p.save({backgroundColor:'#000000'}));
});

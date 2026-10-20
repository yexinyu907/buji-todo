const fs = require('node:fs');
const path = require('node:path');
const { normalizeHex } = require('./color-utils');
const DEFAULTS = Object.freeze({ openAtLogin: false, closeBehavior: 'hide', shortcut: '', fontSize: 'standard', density: 'comfortable', fontScale: 100, cardSpacing: 30, backgroundColor: '#faf9f6', opacity: 100, sortMode: 'default', viewMode: 'list', collapsed: false, pinned: true, catEnabled: true, customReminderAvatar: false });
const choices = { closeBehavior: ['hide', 'quit'], fontSize: ['small', 'standard', 'large'], density: ['compact', 'comfortable'], sortMode: ['default', 'pri-asc', 'pri-desc', 'ddl-asc', 'ddl-desc', 'tag'], viewMode: ['list', 'calendar'] };
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置内容无效。');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error('不支持的设置项。');
    if (choices[key] && !choices[key].includes(value)) throw new Error('设置选项无效。');
    if (typeof DEFAULTS[key] === 'boolean' && typeof value !== 'boolean') throw new Error('设置开关无效。');
    if (key === 'opacity' && (!Number.isInteger(value) || value < 70 || value > 100)) throw new Error('背景不透明度需要在 70% 到 100% 之间。');
    if (key === 'fontScale' && (!Number.isInteger(value) || value < 80 || value > 160)) throw new Error('字号需要在 80% 到 160% 之间。');
    if (key === 'cardSpacing' && (!Number.isInteger(value) || value < 0 || value > 100)) throw new Error('卡片间距需要在 0 到 100 之间。');
    if (key === 'backgroundColor' && !normalizeHex(value)) throw new Error('请输入有效的十六进制颜色，例如 #FAF9F6。');
    if (key === 'shortcut' && (typeof value !== 'string' || (value !== '' && (!value.split('+').some(k => ['CommandOrControl', 'Command', 'Control', 'Alt'].includes(k)) || !/^(?:(?:CommandOrControl|Command|Control|Alt|Shift)\+)+(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-2]))$/.test(value))))) throw new Error('快捷键需要包含修饰键和字母、数字或功能键。');
  }
  return patch;
}
class PreferencesStore {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json'); this.value = { ...DEFAULTS };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); validatePatch(saved); Object.assign(this.value, saved);
      // Keep the previous appearance when upgrading from the original presets.
      if (!Object.hasOwn(saved, 'fontScale')) this.value.fontScale = { small: 90, standard: 100, large: 114 }[saved.fontSize] || 100;
      if (!Object.hasOwn(saved, 'cardSpacing')) this.value.cardSpacing = saved.density === 'compact' ? 10 : 30;
    }
    catch (error) { if (error.code !== 'ENOENT') this.error = '设置文件无法读取，已保留原文件。'; }
  }
  get() { return { ...this.value, backgroundColor: normalizeHex(this.value.backgroundColor) }; }
  next(patch) { if (this.error) throw new Error(this.error); validatePatch(patch); return { ...this.value, ...patch, backgroundColor: normalizeHex(patch.backgroundColor || this.value.backgroundColor) }; }
  save(patch) {
    const next = this.next(patch); fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file);
    this.value = next; return this.get();
  }
}
module.exports = { PreferencesStore, DEFAULTS, validatePatch };

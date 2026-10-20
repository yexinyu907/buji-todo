const path = require('node:path');
class AppleRemindersBridge {
  constructor(onChange = () => {}) { this.onChange = onChange; }
  load() {
    if (process.platform !== 'darwin') throw Object.assign(new Error('苹果提醒事项同步目前仅支持 Mac。'), { code: 'UNSUPPORTED' });
    if (!this.native) {
      try { this.native = require(path.join(__dirname, 'native/build/reminders.node')); }
      catch { throw Object.assign(new Error('苹果连接模块不可用，请重新安装完整的 Mac 应用。'), { code: 'BRIDGE_MISSING' }); }
      this.native.onChange(() => this.onChange());
    }
    return this.native;
  }
  async call(action, input = {}) {
    const response = JSON.parse(await this.load().request(JSON.stringify({ ...input, action })));
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.result;
  }
}
module.exports = { AppleRemindersBridge };

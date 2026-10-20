const https = require('node:https');
function compareVersions(a, b) {
  const parse = s => { const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(s); if (!m) throw new Error('版本格式无法识别。'); return m.slice(1).map(Number); };
  const aa = parse(a), bb = parse(b); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1; return 0;
}
function checkUpdate(current) {
  return new Promise((resolve, reject) => {
    const request = https.get('https://api.github.com/repos/yexinyu907/buji-todo/releases/latest', { headers: { 'User-Agent': 'buji-todo/' + current, Accept: 'application/vnd.github+json' }, timeout: 10000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(response.statusCode === 404 ? '暂未发布公开版本。' : '暂时无法检查更新，请稍后重试。')); return; }
      let bytes = 0, chunks = []; response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) request.destroy(new Error('更新信息过大。')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => {
        try { const release = JSON.parse(Buffer.concat(chunks)); const delta = compareVersions(release.tag_name, current); resolve({ latest: release.tag_name, newer: delta > 0, ahead: delta < 0 }); }
        catch { reject(new Error('更新信息格式无效。')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('网络超时，请稍后重试。'))); request.on('error', () => reject(new Error('无法连接 GitHub，请检查网络。')));
  });
}
module.exports = { checkUpdate, compareVersions };

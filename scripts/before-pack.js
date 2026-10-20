const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async context => {
  if (context.electronPlatformName === 'darwin') {
    execFileSync(process.execPath, [path.join(__dirname, 'build-native.js')], { stdio: 'inherit' });
  }
};

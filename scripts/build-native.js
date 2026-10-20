const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') process.exit(0);
const root = path.join(__dirname, '..');
const headers = process.env.BUJI_NODE_API_HEADERS || path.join(path.dirname(require.resolve('node-api-headers/package.json')), 'include');
fs.mkdirSync(path.join(root, 'native/build'), { recursive: true });
execFileSync('/usr/bin/xcrun', ['clang', '-bundle', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-fblocks',
  '-mmacosx-version-min=12.0', '-arch', 'arm64', '-arch', 'x86_64', '-DNAPI_VERSION=8', '-I', headers,
  '-framework', 'Foundation', '-framework', 'EventKit', path.join(root, 'native/reminders.m'),
  '-o', path.join(root, 'native/build/reminders.node')], { stdio: 'inherit' });
console.log('Apple Reminders bridge built (arm64 + x86_64).');

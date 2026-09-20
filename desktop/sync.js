// Copies the shared web app into ./app so Electron packages it.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'web'), dst = path.join(__dirname, 'app');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (f) => !path.basename(f).startsWith('._') });
console.log('synced web ->', dst);

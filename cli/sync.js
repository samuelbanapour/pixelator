// Copies the shared engine (palettes + looks) from ../web so the CLI works when installed on its own.
const fs = require('fs'), path = require('path');
fs.mkdirSync(path.join(__dirname, 'lib'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'web', 'pixelate.js'), path.join(__dirname, 'lib', 'pixelate.js'));
console.log('synced web/pixelate.js -> cli/lib/pixelate.js');

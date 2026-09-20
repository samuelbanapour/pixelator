// electron-builder afterSign hook: ad-hoc code-sign the macOS app (no Apple certificate needed).
// Ad-hoc signing gives the app a valid, sealed signature so it runs on Apple Silicon; it is
// still not notarized, so Gatekeeper asks the user to right-click > Open the first time.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • ad-hoc signed', app);
};

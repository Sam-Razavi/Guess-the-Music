// Headless Chromium for the browser tests. Uses the build Playwright expects if
// it is installed, otherwise the newest headless shell that is (so a Playwright
// upgrade doesn't force a new ~150 MB browser download just to run the tests).
// Install one with: npx playwright install chromium-headless-shell
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function executablePath() {
  try {
    const own = chromium.executablePath();
    if (own && fs.existsSync(own)) return undefined; // Playwright finds it itself
  } catch { /* fall through */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
      : process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
        : path.join(process.env.HOME || '', '.cache', 'ms-playwright'));
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter(d => /^chromium_headless_shell-\d+$/.test(d)); } catch { /* none */ }
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-headless-shell-win64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-linux']) {
      for (const exe of ['chrome-headless-shell.exe', 'chrome-headless-shell', 'headless_shell']) {
        const p = path.join(root, d, sub, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('No headless Chromium found. Run: npx playwright install chromium-headless-shell');
}

module.exports.launch = (opts = {}) => chromium.launch({ ...opts, executablePath: executablePath() });

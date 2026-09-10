'use strict';
/**
 * Open the vault in a browser window.
 *
 * Where a Chromium-based browser exists we ask for "app mode", which gives a
 * clean window with no address bar or tabs — so double-clicking the icon feels
 * like opening an application rather than visiting a website. Everything falls
 * back to the ordinary default browser.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Chromium-family browsers that support --app=, in order of preference. */
function candidates() {
  if (process.platform === 'win32') {
    const programFiles = [
      process.env['ProgramFiles(x86)'],
      process.env.ProgramFiles,
      process.env.LOCALAPPDATA,
    ].filter(Boolean);

    const relative = [
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Google\\Chrome\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ];

    const found = [];
    for (const base of programFiles) {
      for (const rel of relative) {
        const full = path.join(base, rel);
        if (fs.existsSync(full)) found.push(full);
      }
    }
    return found;
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ].filter((p) => fs.existsSync(p));
  }

  return ['google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge'];
}

function detached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

/** Last resort: hand the URL to whatever the system considers the browser. */
function openWithDefault(url) {
  if (process.platform === 'win32') {
    // The empty string is the window title cmd's `start` expects first.
    detached('cmd', ['/c', 'start', '', url]);
  } else if (process.platform === 'darwin') {
    detached('open', [url]);
  } else {
    detached('xdg-open', [url]);
  }
}

function openBrowser(url, { appMode = true } = {}) {
  if (!appMode) return openWithDefault(url);

  for (const browser of candidates()) {
    try {
      const child = detached(browser, [`--app=${url}`, '--new-window']);
      let failed = false;
      child.on('error', () => { failed = true; });
      // spawn reports ENOENT asynchronously, so give it a moment before
      // deciding this browser worked.
      if (!failed) return child;
    } catch {
      // try the next candidate
    }
  }

  return openWithDefault(url);
}

module.exports = { openBrowser };

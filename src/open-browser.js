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

    // Edge is last on purpose. On Windows it signs itself in to the machine's
    // Microsoft account the first time a profile is made — a sync notice
    // appears over the vault window, which is both alarming and the opposite
    // of what this thing is for. Chrome and Brave do not do that.
    const relative = [
      'Google\\Chrome\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
    ];

    const found = [];
    for (const rel of relative) {
      for (const base of programFiles) {
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

function openBrowser(url, { appMode = true, profileDir = null } = {}) {
  if (!appMode) return openWithDefault(url);

  // The vault window gets a profile of its own, kept inside the vault folder:
  // nothing it reads ends up in the person's everyday browser history, no
  // extensions or sync accounts reach in, and the window comes up clean.
  // A browser left to itself talks to the internet on every launch: component
  // updates, variations, safe-browsing lists, sign-in and sync. None of that
  // belongs in an offline vault, so it is all switched off. Flags a given
  // browser does not know are ignored, which is why the sign-in ones can be
  // listed together — Edge's are best-effort, Chrome and Brave do not need them.
  const base = [
    `--app=${url}`, '--new-window', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--disable-background-networking', '--disable-component-update',
    '--disable-domain-reliability', '--no-pings', '--no-service-autorun', '--disable-breakpad',
    '--disable-features=OptimizationHints,Translate,MediaRouter,InterestFeedContentSuggestions,'
      + 'msImplicitSignin,msEdgeImplicitSignIn,msIdentityWebSignIn,SyncPromo,SigninInterceptBubble',
  ];
  for (const browser of candidates()) {
    const args = [...base];
    if (profileDir) {
      // One profile per browser family: a profile written by Chrome is not a
      // profile Edge can open, and the vault should never touch the person's
      // own browsing data either way.
      const family = path.basename(browser).replace(/\.exe$/i, '').toLowerCase();
      const dir = `${profileDir}-${family}`;
      try { fs.mkdirSync(dir, { recursive: true }); args.push(`--user-data-dir=${dir}`); } catch { /* fall back to the default profile */ }
    }
    try {
      const child = detached(browser, args);
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

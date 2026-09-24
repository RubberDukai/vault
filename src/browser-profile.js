'use strict';
/**
 * The vault window's browser profile, and wiping it.
 *
 * The window gets a profile of its own inside the vault folder, so nothing
 * read here lands in the person's everyday browser. That profile still keeps
 * a history, a cache and a session on disk, which is the wrong thing to leave
 * behind on a machine that may be shared, lost or searched.
 *
 * So it is wiped — on shutdown, and again on startup in case the last run
 * ended in a power cut. One folder is kept: Local Storage, which is where the
 * browser puts the app's own settings (the theme, the phosphor colour, which
 * person is selected, where the map was left). Wiping those would mean
 * choosing your colours again every single launch, which is not privacy, it
 * is just annoyance.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Kept through a wipe: the app's own settings, not browsing history. */
const KEEP = [path.join('Default', 'Local Storage')];

function wipeProfile(profileDir, { keepSettings = true } = {}) {
  let removed = 0;
  let failed = 0;

  const keep = keepSettings ? KEEP.map((p) => path.join(profileDir, p)) : [];
  // A kept path needs its parents kept too, or there is nowhere to put it.
  const keepParents = new Set();
  for (const full of keep) {
    let dir = path.dirname(full);
    while (dir.length >= profileDir.length) {
      keepParents.add(dir);
      if (dir === profileDir) break;
      dir = path.dirname(dir);
    }
  }

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (keep.includes(full)) continue;
      if (entry.isDirectory() && keepParents.has(full)) { walk(full); continue; }
      try {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
      } catch {
        // A file the browser still has open — Windows will not let it go.
        // The wipe on the next startup will get it.
        failed++;
      }
    }
  };

  if (!fs.existsSync(profileDir)) return { removed: 0, failed: 0, existed: false };
  walk(profileDir);
  return { removed, failed, existed: true };
}

module.exports = { wipeProfile, KEEP };

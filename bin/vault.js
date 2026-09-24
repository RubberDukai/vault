#!/usr/bin/env node
'use strict';
/**
 * Vault command line. Works the same on Windows, Linux and macOS.
 *
 *   vault serve [--port 8080] [--host 127.0.0.1 | 0.0.0.0]   (no --host: this machine only, or as set in Setup)
 *   vault library                 list every pack and when it was cloned
 *   vault check                   ask the catalogue what is newer
 *   vault info <file.zim>         inspect a pack without the server
 *   vault search <query>          search everything from the terminal
 */

const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=');
      if (inline !== undefined) args[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function ageDescription(dateStr) {
  if (!dateStr) return 'date unknown';
  const days = Math.floor((Date.now() - Date.parse(dateStr)) / 86400000);
  if (Number.isNaN(days)) return 'date unknown';
  if (days < 1) return 'today';
  if (days < 60) return `${days} days old`;
  if (days < 730) return `${Math.round(days / 30)} months old`;
  return `${(days / 365).toFixed(1)} years old`;
}

async function cmdServe(args) {
  const { ArkServer } = require('../src/server');
  const server = new ArkServer({
    port: Number(args.port || process.env.ARK_PORT || 8080),
    host: args.host || process.env.ARK_HOST || null,
    libraryDir: args.library || process.env.ARK_LIBRARY || path.join(ROOT, 'library'),
    // Useful for a portable copy that keeps its settings somewhere else, and
    // for running a second vault without touching the first one's state.
    dataDir: args.data || process.env.ARK_DATA || undefined,
  });

  process.stdout.write('Loading vault…\n');
  await server.init();
  const addresses = await server.start();

  const packs = server.library.list();
  const stats = server.content.stats();

  console.log('');
  console.log('  VAULT — offline knowledge vault');
  console.log('  ' + '─'.repeat(48));
  console.log(`  Packs      ${packs.length} (${packs.filter((p) => p.ok).length} readable)`);
  for (const pack of packs) {
    console.log(`             · ${pack.title} — ${pack.sizeHuman || '?'}, ${ageDescription(pack.date)}`);
  }
  console.log(`  Handbook   ${stats.chapters} chapters across ${stats.modules} modules`);
  console.log(`  Languages  ${stats.languages} (${stats.cards} cards)`);
  console.log(`  School     ${stats.lessons} lessons across ${stats.subjects} subjects`);
  console.log('');
  console.log('  Open on this machine:');
  console.log(`    ${addresses[0]}`);
  if (addresses.length > 1) {
    console.log('  Or from any phone or tablet on the same wifi:');
    for (const addr of addresses.slice(1)) console.log(`    ${addr}`);
  } else if (!server.sharing()) {
    console.log('  Sharing with other devices is off — Setup → Share on this network to turn it on.');
  }
  if (server.locked) {
    console.log('');
    console.log('  This vault is locked. Open the page above and enter the PIN.');
  }
  console.log('');

  // The vault window's own profile is wiped at both ends: now, in case the
  // last run ended in a power cut, and again on the way out. Only the app's
  // own settings survive it — see src/browser-profile.js.
  const { wipeProfile } = require('../src/browser-profile');
  const profileDir = path.join(server.dataDir, 'browser-profile');
  const wipeAll = () => {
    for (const family of ['chrome', 'brave', 'msedge']) wipeProfile(`${profileDir}-${family}`);
    wipeProfile(profileDir); // a profile left by an older version
  };
  if (server.wipeBrowserProfile()) wipeAll();

  if (args.open) {
    const { openBrowser } = require('../src/open-browser');
    console.log('  Opening the vault…');
    console.log('');
    openBrowser(`http://localhost:${server.port}`, { appMode: !args.browser, profileDir });
  }

  console.log('  Leave this window open. Closing it stops the vault.');
  console.log('');

  // Wiping on the way out is best-effort and cannot be otherwise: a power cut,
  // a hard kill or a crash never gets to run anything. So it is attempted at
  // every exit that can be caught — and the wipe at startup above is the one
  // that actually guarantees nothing survives to be read by the next person.
  process.on('exit', () => {
    if (server.wipeBrowserProfile()) wipeAll();
  });

  const shutdown = async () => {
    console.log('\nClosing the vault.');
    await server.stop();
    if (server.wipeBrowserProfile()) {
      // Close our own window first: Windows will not delete a file the
      // browser still has open, and anything missed is caught next startup.
      try { require('../src/open-browser').closeBrowser(); } catch { /* nothing to close */ }
      await new Promise((r) => setTimeout(r, 600));
      wipeAll();
      console.log('Browsing history from the vault window has been wiped.');
    }
    process.exit(0);
  };
  // One bad request or one corrupt file must never take the whole library
  // down. Log it and carry on; the request that caused it has already failed.
  process.on('uncaughtException', (err) => console.error('[vault] recovered from:', err && err.stack || err));
  process.on('unhandledRejection', (err) => console.error('[vault] recovered from:', err && err.stack || err));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Closing the console window — how most people will stop the vault on
  // Windows — arrives as SIGHUP, and Windows allows only a few seconds
  // before killing the process, so this path has to be quick.
  process.on('SIGHUP', shutdown);
}

async function cmdLibrary(args) {
  const { LibraryManager } = require('../src/library/manager');
  const library = new LibraryManager(args.library || path.join(ROOT, 'library'));
  const packs = await library.scan();

  if (packs.length === 0) {
    console.log('\nThe library is empty.');
    console.log(`Put .zim files in: ${library.libraryDir}`);
    console.log('Get them from https://library.kiwix.org, or run the server and use the Get packs tab.\n');
    return;
  }

  console.log('');
  for (const pack of packs) {
    if (!pack.ok) {
      console.log(`  ✗ ${pack.title}\n      unreadable: ${pack.error}\n`);
      continue;
    }
    console.log(`  ${pack.title}`);
    console.log(`      cloned ${pack.date || 'unknown'} (${ageDescription(pack.date)})`);
    console.log(`      ${pack.sizeHuman} · ${pack.entryCount.toLocaleString()} entries · ZIM ${pack.zimVersion} · ${pack.language || '?'}`);
    console.log(`      id: ${pack.id}`);
    console.log('');
  }
  await library.close();
}

async function cmdCheck(args) {
  const { LibraryManager } = require('../src/library/manager');
  const catalog = require('../src/library/catalog');

  const library = new LibraryManager(args.library || path.join(ROOT, 'library'));
  const packs = await library.scan();
  if (packs.length === 0) {
    console.log('\nNothing in the library to check.\n');
    return;
  }

  process.stdout.write('\nChecking the Kiwix catalogue… ');
  if (!(await catalog.isOnline())) {
    console.log('no connection.\nYou are offline. The vault still works; updates will have to wait.\n');
    await library.close();
    return;
  }
  console.log('connected.\n');

  const results = await library.checkUpdates();
  for (const result of results) {
    const pack = library.get(result.id);
    if (result.error) {
      console.log(`  ? ${pack.title}\n      check failed: ${result.error}\n`);
    } else if (!result.found) {
      console.log(`  ? ${pack.title}\n      not found in the catalogue (a custom or renamed pack)\n`);
    } else if (result.available) {
      console.log(`  ↑ ${pack.title}`);
      console.log(`      yours: ${pack.date}   available: ${result.date}   ${result.sizeHuman}`);
      console.log(`      ${result.url}\n`);
    } else {
      console.log(`  ✓ ${pack.title} — current (${pack.date})\n`);
    }
  }
  await library.close();
}

async function cmdInfo(args) {
  const { ZimFile } = require('../src/zim/reader');
  const target = args._[1];
  if (!target) {
    console.error('Usage: vault info <file.zim>');
    process.exit(1);
  }

  const zim = await ZimFile.open(path.resolve(target));
  const meta = await zim.metadata();

  console.log('');
  console.log(`  ${meta.Title || path.basename(target)}`);
  console.log('  ' + '─'.repeat(48));
  console.log(`  Cloned        ${meta.Date || 'unknown'}  (${ageDescription(meta.Date)})`);
  console.log(`  Name          ${meta.Name || '?'}${meta.Flavour ? ` (${meta.Flavour})` : ''}`);
  console.log(`  Language      ${meta.Language || '?'}`);
  console.log(`  Publisher     ${meta.Publisher || '?'}`);
  console.log(`  ZIM version   ${zim.header.majorVersion}.${zim.header.minorVersion}`);
  console.log(`  Entries       ${zim.entryCount.toLocaleString()}`);
  console.log(`  Clusters      ${zim.clusterCount.toLocaleString()}`);
  console.log(`  Titles        ${(await zim.titleCount()).toLocaleString()}`);
  if (meta.Description) console.log(`\n  ${meta.Description}`);

  const main = await zim.mainPageEntry();
  if (main) console.log(`\n  Main page     ${main.title} (${main.url})`);

  console.log('');
  await zim.close();
}

async function cmdSearch(args) {
  const { ArkServer } = require('../src/server');
  const query = args._.slice(1).join(' ');
  if (!query) {
    console.error('Usage: vault search <query>');
    process.exit(1);
  }

  const server = new ArkServer({ libraryDir: args.library || path.join(ROOT, 'library') });
  await server.init();
  const results = await server.search.searchAll(server.library, query);

  console.log('');
  if (results.content.length) {
    console.log('  From the handbook and school:');
    for (const hit of results.content.slice(0, 8)) {
      console.log(`    ${hit.title}  ·  ${hit.context}`);
      if (hit.snippet) console.log(`        ${hit.snippet.slice(0, 120)}`);
    }
    console.log('');
  }
  if (results.packs.length) {
    console.log('  From the packs:');
    for (const hit of results.packs.slice(0, 12)) {
      console.log(`    ${hit.title}  ·  ${hit.context}`);
    }
    console.log('');
  }
  if (results.total === 0) console.log('  Nothing found.\n');

  await server.library.close();
}

const COMMANDS = {
  serve: cmdServe,
  library: cmdLibrary,
  check: cmdCheck,
  info: cmdInfo,
  search: cmdSearch,
};

/**
 * Vault needs Node 22.15 or newer, which is where native zstd landed — that is
 * what lets it read modern ZIM files with no compiled dependency.
 */
function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 15)) return;

  console.error(`
  Vault needs Node.js 22.15 or newer. This is Node ${process.versions.node}.

  Download the current LTS release from https://nodejs.org, install it
  with the default options, then start Vault again.
`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'serve';

  checkNodeVersion();

  if (args.help || command === 'help') {
    console.log(`
  vault — offline knowledge vault

  vault serve [--port 8080]   run the vault and serve it on the local network
  vault library               list packs and when each was cloned
  vault check                 ask the catalogue whether anything newer exists
  vault info <file.zim>       inspect a pack file directly
  vault search <query>        search the handbook, school and packs
`);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command "${command}". Try: vault help`);
    process.exit(1);
  }
  await handler(args);
}

main().catch((err) => {
  console.error(`\nvault: ${err.message}\n`);
  process.exit(1);
});

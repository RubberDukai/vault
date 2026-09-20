'use strict';
/**
 * Builds a copy of the Vault to hand to someone else.
 *
 *   node tools/make-portable.js <destination>              code and content only
 *   node tools/make-portable.js <destination> --with-packs also the encyclopedias
 *   node tools/make-portable.js <destination> --with-maps  also the map archives
 *   node tools/make-portable.js <destination> --with-node  also this machine's Node.js, so nothing needs installing
 *
 * Your own progress, messages and map markings are never copied — the person
 * receiving it gets a clean Vault, not yours.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Everything the Vault needs to run. Anything not listed is left behind.
const ALWAYS = [
  'bin', 'src', 'web', 'content', 'tools',
  'package.json', 'README.md', '.gitignore',
  'Vault.bat', 'Create Desktop Shortcut.bat', 'vault.sh', 'vault.desktop',
];

const SKIP_NAMES = new Set(['.git', '.tmp', 'node_modules', 'data']);

function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

let copiedBytes = 0;
let copiedFiles = 0;

async function copyInto(source, destination) {
  const stat = await fsp.stat(source);

  if (stat.isDirectory()) {
    if (SKIP_NAMES.has(path.basename(source))) return;
    await fsp.mkdir(destination, { recursive: true });
    for (const entry of await fsp.readdir(source)) {
      await copyInto(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
  copiedBytes += stat.size;
  copiedFiles += 1;
  if (copiedFiles % 25 === 0) process.stdout.write(`\r  copied ${copiedFiles} files…`);
}

const START_HERE = `VAULT — an offline knowledge vault
===================================

Everything in this folder works with no internet connection.

TO START IT
-----------
Windows : double-click  Vault.bat
Linux   : ./vault.sh   (run "chmod +x vault.sh" once first)
macOS   : ./vault.sh

A black window opens and shows two or three web addresses.
LEAVE THAT WINDOW OPEN — closing it switches the Vault off.

The Vault should open by itself. If it does not, type the first
address into any web browser.

TO READ IT ON A PHONE OR TABLET
-------------------------------
Make sure it is on the same wifi as this computer, then type the
SECOND address from that black window into its browser. Nothing
needs installing.

IF IT SAYS NODE.JS IS MISSING
-----------------------------
If this copy has a "node" folder it needs nothing. Otherwise:
go to  https://nodejs.org , download the LTS version, install it
with all the default options, then start the Vault again. That is
the only thing it needs.

WHAT IS IN HERE
---------------
An encyclopedia, a survival handbook, offline maps you can draw on,
language lessons, a school curriculum, and a message board for
people on the same network.

Read the Manual tab first. It explains everything, including how to
add your own material.

MAKE A COPY
-----------
Please do. Copy this whole folder to anyone who wants it. That is
how a library survives — not by being guarded, but by being
duplicated until losing it becomes impossible.
`;

async function main() {
  const args = process.argv.slice(2);
  const destination = args.find((a) => !a.startsWith('--'));
  const withPacks = args.includes('--with-packs');
  const withMaps = args.includes('--with-maps');
  const withNode = args.includes('--with-node');

  if (!destination) {
    console.error(`
  Usage: node tools/make-portable.js <destination> [--with-packs] [--with-maps] [--with-node]

  Example:
    node tools/make-portable.js E:/Vault --with-packs
`);
    process.exit(1);
  }

  const target = path.resolve(destination);
  if (target === ROOT) {
    console.error('\n  That is the Vault you are copying from. Choose somewhere else.\n');
    process.exit(1);
  }

  console.log(`\n  Building a portable Vault at:\n    ${target}\n`);
  await fsp.mkdir(target, { recursive: true });

  for (const entry of ALWAYS) {
    const source = path.join(ROOT, entry);
    if (!fs.existsSync(source)) continue;
    await copyInto(source, path.join(target, entry));
  }

  // Empty folders so the Vault starts cleanly rather than complaining.
  await fsp.mkdir(path.join(target, 'library', 'maps'), { recursive: true });
  await fsp.mkdir(path.join(target, 'data'), { recursive: true });

  const libraryDir = path.join(ROOT, 'library');

  if (withPacks && fs.existsSync(libraryDir)) {
    const packs = (await fsp.readdir(libraryDir)).filter((f) => f.toLowerCase().endsWith('.zim'));
    for (const pack of packs) {
      console.log(`\n  Copying ${pack} — this takes a while…`);
      await copyInto(path.join(libraryDir, pack), path.join(target, 'library', pack));
    }
  }

  if (withMaps) {
    const mapsDir = path.join(libraryDir, 'maps');
    if (fs.existsSync(mapsDir)) {
      for (const file of await fsp.readdir(mapsDir)) {
        console.log(`\n  Copying map ${file}…`);
        await copyInto(path.join(mapsDir, file), path.join(target, 'library', 'maps', file));
      }
    }
  }

  // Node itself is one file. Bundling it makes the copy self-contained on
  // this kind of machine: unzip, double-click, no installer, no internet.
  if (withNode) {
    const nodeDir = path.join(target, 'node');
    await fsp.mkdir(nodeDir, { recursive: true });
    await copyInto(process.execPath, path.join(nodeDir, path.basename(process.execPath)));
    const licence = path.join(path.dirname(process.execPath), 'LICENSE');
    if (fs.existsSync(licence)) await copyInto(licence, path.join(nodeDir, 'LICENSE'));
    console.log(`\n  Bundled Node.js ${process.version} for ${process.platform}-${process.arch}: the copy runs on the same kind of machine with nothing installed.`);
  }

  await fsp.writeFile(path.join(target, 'START HERE.txt'), START_HERE, 'utf8');

  console.log(`\r  Copied ${copiedFiles} files, ${humanBytes(copiedBytes)}.          `);
  console.log(`
  Done.

  ${withPacks ? '' : 'The encyclopedias were NOT included — add --with-packs for those.\n  '}${withMaps ? '' : 'The maps were NOT included — add --with-maps for those.\n  '}${withNode ? '' : 'Node.js was NOT bundled — add --with-node and the copy needs no install at all.\n  '}
  Hand over the whole folder. Whoever receives it should read
  "START HERE.txt" first.
`);
}

main().catch((err) => {
  console.error(`\n  Failed: ${err.message}\n`);
  process.exit(1);
});

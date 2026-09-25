'use strict';
/**
 * The installer's own scripts.
 *
 * The build itself takes a minute and produces a 34 MB binary, so it is not
 * run here. What is checked is everything that silently breaks it — and the
 * encoding really did: PowerShell 5.1 reads a .ps1 as the machine's ANSI code
 * page unless it finds a byte-order mark, so every em dash became mojibake and
 * the script would not parse at all. It failed at run time, on the user's
 * machine, after they had downloaded 34 MB.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const psPath = path.join(ROOT, 'tools', 'installer', 'install.ps1');
const cmdPath = path.join(ROOT, 'tools', 'installer', 'install.cmd');

test('the installer scripts are there', () => {
  assert.ok(fs.existsSync(psPath), 'install.ps1');
  assert.ok(fs.existsSync(cmdPath), 'install.cmd');
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'make-installer.js')), 'make-installer.js');
});

test('install.ps1 starts with a byte-order mark', () => {
  const buf = fs.readFileSync(psPath);
  assert.deepStrictEqual(
    [buf[0], buf[1], buf[2]], [0xEF, 0xBB, 0xBF],
    'without a BOM, PowerShell 5.1 reads this as ANSI and the em dashes break the parser'
  );
});

test('install.cmd is plain ASCII, because cmd.exe reads it as ANSI', () => {
  const buf = fs.readFileSync(cmdPath);
  const offenders = [...buf].map((b, i) => [b, i]).filter(([b]) => b > 127);
  assert.deepStrictEqual(offenders, [], 'a smart quote or an em dash here becomes rubbish on another machine');
});

test('the installer defaults to a per-user location, so it needs no administrator', () => {
  const text = fs.readFileSync(psPath, 'utf8');
  assert.match(text, /LOCALAPPDATA/, 'installs under the user profile');
  assert.ok(!/HKLM/.test(text), 'nothing is written to the machine-wide registry');
  assert.ok(!/ProgramFiles/.test(text), 'nothing is written to Program Files');
});

test('an update keeps what the household made', () => {
  const text = fs.readFileSync(psPath, 'utf8');
  // The program folders are replaced; data and library are not in that list.
  const replaced = text.match(/foreach \(\$gone in @\(([^)]*)\)\)/);
  assert.ok(replaced, 'the update step lists what it replaces');
  assert.ok(!/'data'/.test(replaced[1]), 'data must never be in the list of things removed');
  assert.ok(!/'library'/.test(replaced[1]), 'library must never be in the list of things removed');
});

test('the uninstaller asks before deleting anything the person made', () => {
  const text = fs.readFileSync(psPath, 'utf8');
  assert.match(text, /Keep your notes and downloaded packs/, 'it asks');
});

test('the builder ships the program but none of the library', () => {
  const text = fs.readFileSync(path.join(ROOT, 'tools', 'make-installer.js'), 'utf8');
  assert.match(text, /--with-node/, 'Node is bundled so nothing has to be installed first');
  assert.ok(!/--with-packs/.test(text), 'the encyclopedias are chosen inside the Vault, not shipped');
  assert.ok(!/--with-maps/.test(text), 'the maps are chosen inside the Vault, not shipped');
});

test('the version comes from package.json and nowhere else', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'tools', 'make-installer.js'), 'utf8');
  assert.match(builder, /AppVersion = '\$\{VERSION\}'|\$\$AppVersion = '\$\{VERSION\}'/,
    'the builder stamps the version into the script it stages');
});

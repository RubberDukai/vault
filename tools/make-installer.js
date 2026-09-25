'use strict';
/**
 * Builds VaultSetup.exe — one file somebody downloads, double-clicks, and has
 * the Vault installed.
 *
 *   node tools/make-installer.js                 build it into dist/
 *   node tools/make-installer.js --out D:/builds  somewhere else
 *   node tools/make-installer.js --stage-only     stop after staging, for testing
 *
 * What goes in: the program, the handbook, the lessons, the languages, and a
 * copy of Node.js so nothing has to be installed first. What does not: the
 * encyclopedias, the maps and the books, which are tens of gigabytes and which
 * the person chooses from inside the Vault afterwards.
 *
 * How it is built: with what Windows already has. makecab and iexpress have
 * shipped with every version since XP, so the toolchain needs no downloads and
 * no npm — which is the same promise the Vault itself makes. The result is an
 * ordinary self-extracting executable: it unpacks to a temporary folder and
 * runs install.cmd, which hands over to install.ps1.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, execFileSync: run } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const VERSION = require('../package.json').version || '1.0.0';

function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function directorySize(dir) {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else total += (await fsp.stat(full)).size;
  }
  return total;
}

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = path.resolve(outIndex === -1 ? path.join(ROOT, 'dist') : args[outIndex + 1]);
  const stageOnly = args.includes('--stage-only');

  if (process.platform !== 'win32') {
    console.error('\n  This builds a Windows installer, and it uses Windows\' own tools to do it.\n  Run it on Windows.\n');
    process.exit(1);
  }

  console.log(`\n  Building the Vault installer, version ${VERSION}\n`);

  // ---------------------------------------------------------------- 1. stage
  const staging = path.join(ROOT, '.tmp', 'installer');
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  const appDir = path.join(staging, 'app');
  console.log('  1. Copying the program and its content…');
  // The portable builder already knows exactly what belongs in a copy and what
  // must never travel — your notes, your progress, your library.
  run(process.execPath, [path.join(ROOT, 'tools', 'make-portable.js'), appDir, '--with-node'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  // A fresh install has no data and no library; the folders are enough.
  await fsp.rm(path.join(appDir, 'data'), { recursive: true, force: true });
  const appBytes = await directorySize(appDir);
  console.log(`     ${humanBytes(appBytes)} staged.`);

  if (stageOnly) {
    console.log(`\n  Stopped after staging, as asked. The files are at:\n    ${appDir}\n`);
    return;
  }

  // ------------------------------------------------------------ 2. one payload
  console.log('  2. Packing it into a single archive…');
  const payload = path.join(staging, 'vault-payload.zip');
  // Compress-Archive is Windows' own, needs nothing installed, and the
  // installer unpacks it with Expand-Archive at the other end.
  powershell(
    `$ProgressPreference='SilentlyContinue'; ` +
    `Compress-Archive -Path '${appDir.replace(/'/g, "''")}\\*' ` +
    `-DestinationPath '${payload.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  );
  const payloadBytes = (await fsp.stat(payload)).size;
  console.log(`     ${humanBytes(payloadBytes)} packed (from ${humanBytes(appBytes)}).`);

  // ------------------------------------------------------ 3. the installer bits
  await fsp.copyFile(path.join(ROOT, 'tools', 'installer', 'install.cmd'), path.join(staging, 'install.cmd'));

  // The version lives in package.json and nowhere else; stamp it in as the
  // script is staged, so the Add/Remove Programs entry cannot drift from it.
  // The BOM matters: PowerShell 5.1 reads a .ps1 as the machine's ANSI code
  // page unless it finds one, which turned every em dash into mojibake and
  // stopped the installer parsing at all.
  const raw = await fsp.readFile(path.join(ROOT, 'tools', 'installer', 'install.ps1'), 'utf8');
  const stamped = raw.replace(/^(﻿?)/, '﻿').replace(/\$AppVersion = '[^']*'/, `$$AppVersion = '${VERSION}'`);
  await fsp.writeFile(path.join(staging, 'install.ps1'), stamped, 'utf8');

  // ------------------------------------------------------------- 4. wrap it up
  await fsp.mkdir(outDir, { recursive: true });
  const setupExe = path.join(outDir, 'VaultSetup.exe');
  await fsp.rm(setupExe, { force: true });

  // IExpress is driven by a directive file. The awkward parts: it wants
  // absolute paths, CRLF line endings, and its own peculiar section names.
  const sed = [
    '[Version]',
    'Class=IEXPRESS',
    'SEDVersion=3',
    '[Options]',
    'PackagePurpose=InstallApp',
    'ShowInstallProgramWindow=0',
    'HideExtractAnimation=1',
    'UseLongFileName=1',
    'InsideCompressed=0',
    'CAB_FixedSize=0',
    'CAB_ResvCodeSigning=0',
    'RebootMode=N',
    'InstallPrompt=%InstallPrompt%',
    'DisplayLicense=%DisplayLicense%',
    'FinishMessage=%FinishMessage%',
    `TargetName=%TargetName%`,
    'FriendlyName=%FriendlyName%',
    'AppLaunched=%AppLaunched%',
    'PostInstallCmd=%PostInstallCmd%',
    'AdminQuietInstCmd=',
    'UserQuietInstCmd=',
    'SourceFiles=SourceFiles',
    '[Strings]',
    'InstallPrompt=',
    'DisplayLicense=',
    'FinishMessage=',
    `TargetName=${setupExe}`,
    'FriendlyName=Vault — offline knowledge vault',
    'AppLaunched=cmd /c install.cmd',
    'PostInstallCmd=<None>',
    'FILE0="install.cmd"',
    'FILE1="install.ps1"',
    'FILE2="vault-payload.zip"',
    '[SourceFiles]',
    'SourceFiles0=' + staging,
    '[SourceFiles0]',
    '%FILE0%=',
    '%FILE1%=',
    '%FILE2%=',
    '',
  ].join('\r\n');

  const sedPath = path.join(staging, 'vault.sed');
  await fsp.writeFile(sedPath, sed, 'ascii');

  console.log('  3. Wrapping it as a self-extracting installer…');
  try {
    execFileSync(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'iexpress.exe'),
      ['/N', '/Q', sedPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error('\n  iexpress failed. The staged files are still at:');
    console.error(`    ${staging}\n`);
    throw err;
  }

  if (!fs.existsSync(setupExe)) {
    throw new Error('iexpress reported success but produced no file. The staged files are at ' + staging);
  }

  const setupBytes = (await fsp.stat(setupExe)).size;

  // ------------------------------------------------------------ 5. and a zip
  // Not everybody will run an unsigned .exe, and some machines refuse one
  // outright. The same install as a plain folder gives them a way in.
  console.log('  4. Making the no-installer version too…');
  const zipOut = path.join(outDir, `Vault-${VERSION}-portable.zip`);
  await fsp.rm(zipOut, { force: true });
  powershell(
    `$ProgressPreference='SilentlyContinue'; ` +
    `Compress-Archive -Path '${appDir.replace(/'/g, "''")}\\*' ` +
    `-DestinationPath '${zipOut.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  );
  const zipBytes = (await fsp.stat(zipOut)).size;

  console.log(`
  Done.

    ${path.basename(setupExe)}   ${humanBytes(setupBytes)}   double-click to install
    ${path.basename(zipOut)}   ${humanBytes(zipBytes)}   unzip and run Vault.bat

  Both are in:
    ${outDir}

  Neither contains any encyclopedia, map or book: those are chosen and
  downloaded from inside the Vault, which is the point.

  One thing to expect on somebody else's machine: an unsigned installer
  makes Windows show "Windows protected your PC". They click More info,
  then Run anyway. A code-signing certificate is the only thing that
  removes it, and it costs money every year.
`);
}

main().catch((err) => {
  console.error(`\n  Failed: ${err.message}\n`);
  process.exit(1);
});

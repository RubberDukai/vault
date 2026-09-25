# Vault — the installer that runs when somebody double-clicks VaultSetup.exe.
#
# It installs for the current user only, into %LOCALAPPDATA%\Programs\Vault.
# That is deliberate: a per-user install needs no administrator, raises no UAC
# prompt, and cannot touch anyone else's machine. Nothing is written outside
# that folder except a Start Menu shortcut and the Add/Remove Programs entry
# that lets it be uninstalled again.
#
# Everything here is plain PowerShell and Windows' own tools. There is no
# installer framework to trust, and nothing is fetched from the internet.

param(
  [string]$Dir = "",
  [switch]$NoShortcuts,
  [switch]$NoRegister,
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$AppName    = 'Vault'
$AppVersion = '1.0.0'
$Publisher  = 'Vault'

function Say([string]$text) { if (-not $Silent) { Write-Host $text } }

function Show-Banner {
  Say ''
  Say '  ============================================================'
  Say '   VAULT — an offline knowledge vault'
  Say '  ============================================================'
  Say ''
  Say '   This installs the Vault program itself, which is small.'
  Say '   The encyclopedias, maps and books are NOT included: you'
  Say '   choose which of those you want from inside the Vault once'
  Say '   it is running, and it downloads them for you.'
  Say ''
}

# --------------------------------------------------------------- where to put it

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $root 'vault-payload.zip'
if (-not (Test-Path $payload)) { throw "The installer is incomplete: vault-payload.zip is missing." }

if ([string]::IsNullOrWhiteSpace($Dir)) {
  $Dir = Join-Path $env:LOCALAPPDATA 'Programs\Vault'
}

Show-Banner
Say "   Installing to:  $Dir"
Say ''

if (-not $Silent) {
  $answer = Read-Host '   Press Enter to install, or type a different folder'
  if (-not [string]::IsNullOrWhiteSpace($answer)) { $Dir = $answer.Trim('"') }
}

# --------------------------------------------------------------- previous copy

$dataDir = Join-Path $Dir 'data'
$libraryDir = Join-Path $Dir 'library'
$keptData = $false

if (Test-Path $Dir) {
  Say '   A Vault is already installed there. Updating the program.'
  Say '   Your notes, settings and downloaded packs are kept.'
  # The program files are replaced; everything the household made is not.
  foreach ($gone in @('bin', 'src', 'web', 'content', 'tools', 'node')) {
    $p = Join-Path $Dir $gone
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
  }
  $keptData = Test-Path $dataDir
}

New-Item -ItemType Directory -Path $Dir -Force | Out-Null

# --------------------------------------------------------------- unpack

Say '   Unpacking…'
try {
  # Expand-Archive is slow on thousands of small files; the shell's own
  # extractor is not available headless, so this is the reliable route.
  Expand-Archive -Path $payload -DestinationPath $Dir -Force
} catch {
  throw "Could not unpack the Vault: $($_.Exception.Message)"
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $libraryDir 'maps') -Force | Out-Null

$exe = Join-Path $Dir 'Vault.bat'
if (-not (Test-Path $exe)) { throw 'The Vault did not unpack correctly: Vault.bat is missing.' }

# --------------------------------------------------------------- uninstaller

$uninstall = Join-Path $Dir 'Uninstall Vault.cmd'
@"
@echo off
rem Removes the Vault program. Asks before touching anything you made.
setlocal
echo.
echo   This will remove the Vault program from:
echo     $Dir
echo.
echo   Your notes, messages, calendar and downloaded encyclopedias are in
echo   the data and library folders. You will be asked about those next.
echo.
pause

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Vault" /f >nul 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Vault.lnk" >nul 2>nul
del "%USERPROFILE%\Desktop\Vault.lnk" >nul 2>nul

echo.
set /p keep=  Keep your notes and downloaded packs? (Y/n):
if /i "%keep%"=="n" goto wipe

for %%D in (bin src web content tools node) do if exist "$Dir\%%D" rd /s /q "$Dir\%%D"
del "$Dir\*.bat" >nul 2>nul
del "$Dir\*.txt" >nul 2>nul
del "$Dir\*.json" >nul 2>nul
del "$Dir\*.md" >nul 2>nul
echo.
echo   The program is gone. Your data and library folders were kept at:
echo     $Dir
echo.
pause
exit /b 0

:wipe
cd /d "%TEMP%"
rd /s /q "$Dir"
echo.
echo   Everything has been removed.
echo.
pause
exit /b 0
"@ | Set-Content -Path $uninstall -Encoding ASCII

# --------------------------------------------------------------- shortcuts

if (-not $NoShortcuts) {
  Say '   Making shortcuts…'
  $shell = New-Object -ComObject WScript.Shell
  $icon = Join-Path $Dir 'web\vault.ico'

  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Vault.lnk'
  $link = $shell.CreateShortcut($startMenu)
  $link.TargetPath = $exe
  $link.WorkingDirectory = $Dir
  $link.Description = 'Vault — an offline knowledge vault'
  if (Test-Path $icon) { $link.IconLocation = $icon }
  $link.Save()

  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Vault.lnk'
  $link2 = $shell.CreateShortcut($desktop)
  $link2.TargetPath = $exe
  $link2.WorkingDirectory = $Dir
  $link2.Description = 'Vault — an offline knowledge vault'
  if (Test-Path $icon) { $link2.IconLocation = $icon }
  $link2.Save()
}

# ------------------------------------------------- add/remove programs entry

if (-not $NoRegister) {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Vault'
  New-Item -Path $key -Force | Out-Null
  $size = [int]((Get-ChildItem $Dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
  Set-ItemProperty $key 'DisplayName'     "$AppName — offline knowledge vault"
  Set-ItemProperty $key 'DisplayVersion'  $AppVersion
  Set-ItemProperty $key 'Publisher'       $Publisher
  Set-ItemProperty $key 'InstallLocation' $Dir
  Set-ItemProperty $key 'UninstallString' "`"$uninstall`""
  Set-ItemProperty $key 'EstimatedSize'   $size -Type DWord
  Set-ItemProperty $key 'NoModify'        1 -Type DWord
  Set-ItemProperty $key 'NoRepair'        1 -Type DWord
  if (Test-Path (Join-Path $Dir 'web\vault.ico')) {
    Set-ItemProperty $key 'DisplayIcon' (Join-Path $Dir 'web\vault.ico')
  }
}

# --------------------------------------------------------------- done

Say ''
Say '  ------------------------------------------------------------'
Say '   Installed.'
Say '  ------------------------------------------------------------'
Say ''
Say "   Vault is in:  $Dir"
if (-not $NoShortcuts) { Say '   There is a Vault shortcut on your Desktop and in the Start Menu.' }
if ($keptData) { Say '   Your notes and settings from the previous version were kept.' }
Say ''
Say '   NEXT: open the Vault and go to Setup. That is where you choose'
Say '   which encyclopedias, maps and books to download. Nothing is'
Say '   downloaded until you ask for it, and once it is here it works'
Say '   with the internet switched off for good.'
Say ''

if (-not $Silent) {
  $go = Read-Host '   Open the Vault now? (Y/n)'
  if ($go -ne 'n' -and $go -ne 'N') { Start-Process -FilePath $exe -WorkingDirectory $Dir }
}

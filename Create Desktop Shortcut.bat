@echo off
rem  Puts a Vault icon on the Desktop. Run this once.

setlocal
set "VAULTDIR=%~dp0"
set "TARGET=%~dp0Vault.bat"
set "ICON=%~dp0web\vault.ico"

if not exist "%ICON%" (
  echo Generating the icon...
  node "%~dp0tools\make-icon.js"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$link = Join-Path $desktop 'Vault.lnk';" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$s = $shell.CreateShortcut($link);" ^
  "$s.TargetPath = '%TARGET%';" ^
  "$s.WorkingDirectory = '%VAULTDIR%';" ^
  "$s.IconLocation = '%ICON%';" ^
  "$s.Description = 'Vault - offline knowledge vault';" ^
  "$s.Save();" ^
  "Write-Host '';" ^
  "Write-Host ('  Shortcut created: ' + $link);" ^
  "Write-Host '';"

echo   You can now start Vault from the Desktop icon.
echo.
pause

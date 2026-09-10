@echo off
rem  Puts an Ark icon on the Desktop. Run this once.

setlocal
set "ARKDIR=%~dp0"
set "TARGET=%~dp0Ark.bat"
set "ICON=%~dp0web\ark.ico"

if not exist "%ICON%" (
  echo Generating the icon...
  node "%~dp0tools\make-icon.js"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$link = Join-Path $desktop 'Ark.lnk';" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$s = $shell.CreateShortcut($link);" ^
  "$s.TargetPath = '%TARGET%';" ^
  "$s.WorkingDirectory = '%ARKDIR%';" ^
  "$s.IconLocation = '%ICON%';" ^
  "$s.Description = 'Ark - offline knowledge vault';" ^
  "$s.Save();" ^
  "Write-Host '';" ^
  "Write-Host ('  Shortcut created: ' + $link);" ^
  "Write-Host '';"

echo   You can now start Ark from the Desktop icon.
echo.
pause

@echo off
rem ===================================================================
rem  Vault - offline knowledge vault
rem  Double-click this file to open the vault.
rem ===================================================================

setlocal
cd /d "%~dp0"
title Vault - Offline Knowledge Vault

rem A copy made with "make-portable --with-node" carries its own Node.js.
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" bin\vault.js serve --open %*
  goto closed
)

where node >nul 2>nul
if errorlevel 1 goto nodemissing

node bin\vault.js serve --open %*

:closed

echo.
echo   The vault has closed.
echo.
pause
exit /b 0

:nodemissing
echo.
echo   ------------------------------------------------------------
echo    Vault needs Node.js, and it is not installed on this machine.
echo   ------------------------------------------------------------
echo.
echo    1. Go to  https://nodejs.org
echo    2. Download the LTS version
echo    3. Install it, accepting all the default options
echo    4. Double-click Vault again
echo.
echo    Nothing else is needed. Vault has no other dependencies.
echo.
pause
exit /b 1

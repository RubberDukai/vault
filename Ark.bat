@echo off
rem ===================================================================
rem  Ark - offline knowledge vault
rem  Double-click this file to open the vault.
rem ===================================================================

setlocal
cd /d "%~dp0"
title Ark - Offline Knowledge Vault

where node >nul 2>nul
if errorlevel 1 goto nodemissing

node bin\ark.js serve --open %*

echo.
echo   The vault has closed.
echo.
pause
exit /b 0

:nodemissing
echo.
echo   ------------------------------------------------------------
echo    Ark needs Node.js, and it is not installed on this machine.
echo   ------------------------------------------------------------
echo.
echo    1. Go to  https://nodejs.org
echo    2. Download the LTS version
echo    3. Install it, accepting all the default options
echo    4. Double-click Ark again
echo.
echo    Nothing else is needed. Ark has no other dependencies.
echo.
pause
exit /b 1

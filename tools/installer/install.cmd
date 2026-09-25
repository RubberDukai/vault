@echo off
rem ===================================================================
rem  Vault setup -- the command IExpress runs once it has unpacked.
rem
rem  It only exists to hand over to install.ps1 with the execution
rem  policy relaxed for this one process, so the installer works on a
rem  machine where scripts are otherwise blocked. Nothing is changed
rem  system-wide.
rem ===================================================================

setlocal
cd /d "%~dp0"
title Vault setup

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RESULT=%ERRORLEVEL%

if not "%RESULT%"=="0" (
  echo.
  echo   Setup did not finish. Nothing has been left running.
  echo.
  pause
)

exit /b %RESULT%

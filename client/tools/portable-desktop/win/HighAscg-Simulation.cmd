@echo off
REM HighAsCG simulation from exFAT HIGHASCGEXF (requires Node on PATH).
REM This file sits at client/tools/portable-desktop/win/ — the repo root is four levels up.
REM Safe to double-click or run from any working directory (paths derive from %~dp0).
setlocal
cd /d "%~dp0..\..\..\.."
if not exist "package.json" (
  echo [HighAsCG sim] Expected package.json at the HighAsCG repo root. Current dir:
  echo   %CD%
  echo This script must live at client\tools\portable-desktop\win\ inside the repo (e.g. sim/highascg on the stick).
  pause
  exit /b 1
)
node "%~dp0..\launch-sim-from-exfat.cjs" %*
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 pause
exit /b %ERR%

@echo off
REM HighAsCG simulation from exFAT HIGHASCGEXF (requires Node on PATH).
REM Working directory MUST be .../sim/highascg when this file sits at tools/portable-desktop/win/
setlocal
cd /d "%~dp0..\..\.."
if not exist "package.json" (
  echo [HighAsCG sim] Expected package.json here (sim/highascg). Current dir:
  echo   %CD%
  echo Open this CMD from sim/highascg or run from explorer after navigating to sim/highascg.
  pause
  exit /b 1
)
node tools\portable-desktop\launch-sim-from-exfat.cjs %*
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 pause
exit /b %ERR%

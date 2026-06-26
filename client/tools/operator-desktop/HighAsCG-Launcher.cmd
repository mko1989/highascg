@echo off
setlocal
cd /d "%~dp0..\.."
if not exist "package.json" (
  echo Expected HighAsCG repo at %CD%
  pause
  exit /b 1
)
call npm run launcher
exit /b %ERRORLEVEL%

@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo plug.dj — installer
echo ────────────────────────────

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this system.
  echo.
  echo Install Node.js 18 or newer, then run this script again:
  echo   https://nodejs.org/
  echo.
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo Node.js detected: %NODE_VER%

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found ^(it usually ships with Node.js^).
  echo Reinstall Node from https://nodejs.org/ and try again.
  exit /b 1
)

echo Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  echo Check your network connection and try again.
  exit /b 1
)

if not exist "data" mkdir data
if not exist ".media-cache" mkdir .media-cache

echo.
echo Installation complete.
echo.
echo Start the LAN host with:
echo   start.bat
echo.
exit /b 0

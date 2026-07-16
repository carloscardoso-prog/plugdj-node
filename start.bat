@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if "%PLUGDJ_PORT%"=="" if "%PORT%"=="" set PORT=3000
if "%PLUGDJ_PORT%"=="" set PLUGDJ_PORT=%PORT%
if "%PORT%"=="" set PORT=%PLUGDJ_PORT%
if "%HOST%"=="" set HOST=0.0.0.0

echo.
echo plug.dj — starting LAN host
echo ────────────────────────────

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Run install.bat first, or install Node from https://nodejs.org/
  exit /b 1
)

if not exist "node_modules\" (
  echo Dependencies are missing ^(no node_modules\^).
  echo Run install.bat first.
  exit /b 1
)

if not exist "data" mkdir data
if not exist ".media-cache" mkdir .media-cache

echo.
echo Open in your browser:
echo   http://localhost:%PORT%/
echo.
echo On the same Wi-Fi / LAN, others can use:
echo   http://^<your-lan-ip^>:%PORT%/^<room-slug^>
echo.
echo Press Ctrl+C to stop the server.
echo ────────────────────────────
echo.

call npm start
if errorlevel 1 (
  echo.
  echo Server failed to start.
  echo Common causes: port %PORT% already in use, or a missing dependency.
  echo Try: set PLUGDJ_PORT=3001 ^&^& start.bat
  exit /b 1
)

exit /b 0

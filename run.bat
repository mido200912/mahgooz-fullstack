@echo off
chcp 65001 >nul
title MAHGOOZ Local Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Your Node.js version is too old. Please install Node.js 24 LTS from https://nodejs.org/
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing project packages for the first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Package installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting MAHGOOZ at http://localhost:3000
echo The admin dashboard is at http://localhost:3000/admin.html
echo Keep this window open while using the website.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
call npm start
pause

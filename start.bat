@echo off
cd /d "%~dp0"

:loop
echo Checking for updates...
git pull origin main --ff-only --quiet 2>nul || echo (git pull skipped)

cd /d "%~dp0server"
if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo.
echo Starting wall-assistant server...
echo Open http://localhost:3000 on your iPad
echo.
node index.js
echo.
echo Server exited, restarting...
echo.
cd /d "%~dp0"
goto loop

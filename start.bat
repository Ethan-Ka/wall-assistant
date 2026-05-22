@echo off
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

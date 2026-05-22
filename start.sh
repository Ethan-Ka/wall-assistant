#!/bin/sh
cd "$(dirname "$0")/server"
if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi
echo ""
echo "Starting wall-assistant server..."
echo "Open http://$(ipconfig getifaddr en0):3000 on your iPad"
echo ""
node index.js

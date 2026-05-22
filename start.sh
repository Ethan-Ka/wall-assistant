#!/bin/sh
cd "$(dirname "$0")"

while true; do
  echo "Checking for updates..."
  git pull origin main --ff-only --quiet 2>/dev/null || echo "(git pull skipped)"

  cd "$(dirname "$0")/server"
  if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
  fi

  echo ""
  echo "Starting wall-assistant server..."
  echo "Open http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}'):3000 on your iPad"
  echo ""
  node index.js
  echo ""
  echo "Server exited, restarting..."
  echo ""
  cd "$(dirname "$0")"
done

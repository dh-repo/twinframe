#!/bin/sh
set -eu
cd "$(dirname "$0")"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
# ensure deps ready then start vite dev in background
npm run dev >>/tmp/app-startup.log 2>&1 &
# wait a moment for vite
sleep 2
curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/ || true

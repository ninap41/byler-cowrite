#!/usr/bin/env bash
# Captures public/img/og-banner.png — the Open Graph banner (1200×630) — from
# the running homepage's hero in ?og=1 capture mode (buttons and chrome
# hidden). Run with the server up: PORT=3000 npm start, then scripts/og-banner.sh
set -euo pipefail
cd "$(dirname "$0")/.."
URL="${1:-http://localhost:3000/?og=1}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 --virtual-time-budget=9000 \
  --screenshot="$PWD/public/img/og-banner.png" "$URL" 2>/dev/null
echo "wrote public/img/og-banner.png"

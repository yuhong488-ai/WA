#!/bin/bash
cd "$(dirname "$0")"
echo "Installing dependencies. Please wait..."
xattr -r -d com.apple.quarantine . 2>/dev/null
export PUPPETEER_SKIP_DOWNLOAD=true
npm install
echo ""
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(which node)" 2>/dev/null
echo "Done. Double click 启动Mac.command to open WhatsApp Sender."
read -p "Press Enter to close..."

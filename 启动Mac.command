#!/bin/bash
cd "$(dirname "$0")"

LAUNCH_LABEL="com.highpeak.whatsapp-sender"
LAUNCH_PLIST="$HOME/Library/LaunchAgents/$LAUNCH_LABEL.plist"

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  open http://localhost:3000
  exit 0
fi

if [ -f "$LAUNCH_PLIST" ]; then
  launchctl bootstrap "gui/$(id -u)" "$LAUNCH_PLIST" >/dev/null 2>&1 || true
  launchctl kickstart "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
else
  nohup /usr/local/bin/node server.js >> server.log 2>> server-error.log &
  echo $! > server.pid
fi

for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
    open http://localhost:3000
    exit 0
  fi
  sleep 1
done

echo "WhatsApp Sender did not start. Please check server-error.log."
read -p "Press Enter to close..."
exit 1

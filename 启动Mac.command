#!/bin/bash
cd "$(dirname "$0")"

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is already in use. WhatsApp Sender was not started."
  echo "Please close the old Sender first, then double-click this file again."
  read -p "Press Enter to close..."
  exit 1
fi

nohup node server.js >> server.log 2>> server-error.log &
echo $! > server.pid

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

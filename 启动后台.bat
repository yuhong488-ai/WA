@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup-sender.ps1" >nul 2>&1
timeout /t 2 >nul
start "WhatsApp Sender" /min cmd /c "node server.js > server.log 2>&1"
timeout /t 24 >nul
start http://localhost:3000

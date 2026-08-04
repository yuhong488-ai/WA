@echo off
title Install WhatsApp Sender
cd /d %~dp0
echo Installing dependencies. Please wait...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force" >nul 2>&1
netsh advfirewall firewall add rule name="WhatsApp Sender" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
set PUPPETEER_SKIP_DOWNLOAD=true
npm install
echo.
echo Done. Double click start.vbs to open WhatsApp Sender.
pause

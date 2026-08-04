@echo off
title WhatsApp Sender
cd /d %~dp0
echo Cleaning old process...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup-sender.ps1" >nul 2>&1
timeout /t 2 >nul
echo Starting WhatsApp Sender...
start http://localhost:3000
node server.js

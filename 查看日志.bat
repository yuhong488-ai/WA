@echo off
cd /d "%~dp0"
if exist server.log (
    notepad server.log
) else (
    echo No server.log yet. Please start WhatsApp Sender first.
    pause
)

@echo off
cd /d "%~dp0"
npx vite > "%~dp0dev-server.log" 2>&1

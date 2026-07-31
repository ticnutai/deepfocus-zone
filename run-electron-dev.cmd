@echo off
REM Launch Electron in DEV mode against the already-running Vite dev server.
REM Started via explorer.exe so it detaches from the parent shell's job object
REM (otherwise the window closes as soon as the calling shell returns).
REM NOTE: "%~dp0" ends with a backslash, which would escape the closing quote —
REM always append a "." so the path argument stays well-formed.
cd /d "%~dp0"
set ELECTRON_DEV=1
set ELECTRON_DEV_URL=http://localhost:5000
set ELECTRON_DEBUG=1
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." > "%~dp0electron-dev.log" 2>&1

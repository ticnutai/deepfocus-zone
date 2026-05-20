@echo off
setlocal

set "LOG=%TEMP%\apply-chrome-vscode-policy.log"
echo ==== %date% %time% ====>>"%LOG%"

REM If not elevated, relaunch this script as administrator and exit this instance.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting administrator approval...
  echo Requesting elevation>>"%LOG%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Elevated run confirmed>>"%LOG%"

reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\":\"vscode\",\"allowed_origins\":[\"https://vscode.dev\",\"https://.vscode.dev\",\"http://127.0.0.1:*\",\"http://localhost:*\"]}]" /f >>"%LOG%" 2>&1
if errorlevel 1 (
  echo FAILED writing policy (errorlevel=%errorlevel%).>>"%LOG%"
  echo Failed. Check log: %LOG%
  exit /b 1
)

echo SUCCESS>>"%LOG%"
echo Policy applied successfully.
echo Log: %LOG%
exit /b 0

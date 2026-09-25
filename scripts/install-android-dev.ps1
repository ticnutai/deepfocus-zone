param([Parameter(Mandatory=$true)][string]$Serial)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    $devices = & adb devices
    if (!($devices -match ('^' + [regex]::Escape($Serial) + '\s+device$'))) { throw 'Selected device is not ready' }
    $stateDir = Join-Path $repo '.codex-runtime'
    New-Item -ItemType Directory -Force $stateDir | Out-Null
    $counterPath = Join-Path $stateDir 'android-dev-counter.txt'
    $previous = if (Test-Path $counterPath) { [int](Get-Content $counterPath) } else { 0 }
    $packageInfo = (& adb -s $Serial shell dumpsys package com.pashash.app.debug) -join "`n"
    if ($packageInfo -match 'versionName=\S+-dev\.(\d+)') { $previous = [Math]::Max($previous, [int]$Matches[1]) }
    $number = $previous + 1
    $env:VITE_APP_VARIANT = 'developer'
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Web build failed' }
    & npx.cmd cap sync android
    if ($LASTEXITCODE) { throw 'Android sync failed' }
    Push-Location android
    try { & ./gradlew.bat assembleDebug "-PdevInstallNumber=$number"; if ($LASTEXITCODE) { throw 'APK build failed' } } finally { Pop-Location }
    # Install only in the primary profile, never Samsung's cloned-app profile.
    & adb -s $Serial install --user 0 -r android/app/build/outputs/apk/debug/app-debug.apk
    if ($LASTEXITCODE) { throw 'Install failed; existing application was not removed' }
    # Record only successful installations. This stable debug package preserves data.
    [System.IO.File]::WriteAllText($counterPath, [string]$number)
    Write-Output "Installed Lema'an $number (com.pashash.app.debug)"
} finally { Remove-Item Env:VITE_APP_VARIANT -ErrorAction SilentlyContinue; Pop-Location }

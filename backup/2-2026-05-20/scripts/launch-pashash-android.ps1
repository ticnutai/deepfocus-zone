# הפעל אמולטור
Start-Process "C:\Users\jj121\AppData\Local\Android\Sdk\emulator\emulator.exe" -ArgumentList "-avd","Pashash_Dev","-no-snapshot-load","-scale","0.7"

Write-Host "ממתין לאמולטור..."
$timeout = 120
$elapsed = 0
do {
    Start-Sleep -Seconds 5
    $elapsed += 5
    $out = & "C:\Users\jj121\AppData\Local\Android\Sdk\platform-tools\adb.exe" shell getprop sys.boot_completed 2>$null
    Write-Host "$elapsed s..."
} while (($out -replace '\s','') -ne '1' -and $elapsed -lt $timeout)

Start-Sleep -Seconds 3

# התקן APK
Write-Host "מתקין APK..."
& "C:\Users\jj121\AppData\Local\Android\Sdk\platform-tools\adb.exe" install -r "c:\Users\jj121\mindful-blockade-suite\android\app\build\outputs\apk\debug\app-debug.apk"

# הפעל אפליקציה
Write-Host "מפעיל אפליקציה..."
& "C:\Users\jj121\AppData\Local\Android\Sdk\platform-tools\adb.exe" shell am start -n "com.pashash.app/com.pashash.app.MainActivity"
Write-Host "הושלם!"

param(
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'

$root = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code'
if (-not (Test-Path $root)) {
  throw "VS Code installation folder not found: $root"
}

# Versioned install payload folder names are hex-like (for example 8b640eef5a).
$versionDirs = Get-ChildItem -Path $root -Directory |
  Where-Object { $_.Name -match '^[0-9a-f]{8,}$' } |
  Sort-Object LastWriteTime -Descending

if (-not $versionDirs) {
  throw "No versioned VS Code payload folder found under: $root"
}

$payload = $versionDirs[0].FullName
$bundle = Join-Path $payload 'resources\app\extensions\github-authentication\dist\extension.js'
$backup = "$bundle.bak"

if (-not (Test-Path $bundle)) {
  throw "GitHub authentication bundle not found: $bundle"
}

if ($Restore) {
  if (-not (Test-Path $backup)) {
    throw "Backup file not found: $backup"
  }

  Copy-Item -Path $backup -Destination $bundle -Force
  Write-Host "Restored original bundle from backup."
  Write-Host "Bundle: $bundle"
  exit 0
}

$oldOrder = 'HP=[new YE,new OE,new uf,new wE]'
$newOrder = 'HP=[new OE,new YE,new uf,new wE]'

$content = Get-Content -Path $bundle -Raw

if ($content.Contains($newOrder)) {
  Write-Host "Already patched. No changes needed."
  Write-Host "Bundle: $bundle"
  exit 0
}

if (-not $content.Contains($oldOrder)) {
  throw "Expected flow-order token was not found. Bundle format may have changed: $bundle"
}

if (-not (Test-Path $backup)) {
  Copy-Item -Path $bundle -Destination $backup -Force
}

$updated = $content.Replace($oldOrder, $newOrder)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($bundle, $updated, $utf8NoBom)

Write-Host "Patch applied successfully."
Write-Host "Bundle: $bundle"
Write-Host "Backup: $backup"

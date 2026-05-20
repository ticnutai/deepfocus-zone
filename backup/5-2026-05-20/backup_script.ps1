$ErrorActionPreference = 'Stop'
$root = Get-Location
$today = Get-Date -Format 'yyyy-MM-dd'
$backupRoot = Join-Path $root 'backup'
if (-not (Test-Path $backupRoot)) { New-Item -ItemType Directory -Path $backupRoot | Out-Null }

# Find next numeric backup id (N-yyyy-MM-dd)
$existing = Get-ChildItem -Path $backupRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^(\d+)-\d{4}-\d{2}-\d{2}$' }
$next = 1
if ($existing) {
  $nums = $existing | ForEach-Object { [int]($_.Name.Split('-')[0]) }
  $next = (($nums | Measure-Object -Maximum).Maximum + 1)
}
$destName = "$next-$today"
$dest = Join-Path $backupRoot $destName
New-Item -ItemType Directory -Path $dest | Out-Null

# Scan MCP-related paths in repo (filename/path contains mcp)
$mcpPaths = @()
try {
  $mcpPaths = Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\backup\\' } |
    Where-Object { $_.Name -match '(?i)mcp' -or $_.FullName -match '(?i)\\mcp\\' } |
    Select-Object -ExpandProperty FullName
} catch {}

# Exclusions: non-code + requested exclusions
$xd = @(
  'node_modules','.git','backup','backups','dist','build','.next','.turbo','.cache',
  '.idea','.vscode','.history','coverage','tmp','temp','logs',
  'android\app\build',
  'סדר מועד'
)
$xf = @(
  '*.bak','*.tmp','*.log','*.sqlite','*.db','*.zip','*.7z','*.rar',
  '*.jpg','*.jpeg','*.png','*.gif','*.webp','*.mp4','*.mov','*.avi','*.mp3','*.wav',
  '*.pdf'
)

# Add MCP directories/files to exclusions when they exist
$source = $root.Path
$robocopyArgs = @($source,$dest,'/E','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP')
foreach ($d in $xd) {
  $candidate = Join-Path $source $d
  if (Test-Path $candidate) { $robocopyArgs += @('/XD', $candidate) }
}
foreach ($f in $xf) { $robocopyArgs += @('/XF', $f) }

foreach ($p in $mcpPaths) {
  if (Test-Path $p) {
    $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
    if ($null -ne $item) {
      if ($item.PSIsContainer) { $robocopyArgs += @('/XD', $item.FullName) }
      else { $robocopyArgs += @('/XF', $item.FullName) }
    }
  }
}

$null = & robocopy @robocopyArgs
$code = $LASTEXITCODE
if ($code -ge 8) { throw "robocopy failed with exit code $code" }

# Post-clean: ensure no nested backups, no סדר מועד, no mcp-named leftovers
Get-ChildItem -Path $dest -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('backup','backups','סדר מועד') -or $_.Name -match '(?i)mcp' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Get-ChildItem -Path $dest -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)mcp' -or $_.FullName -match '(?i)\\mcp\\' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

# Verification
$hasSederMoed = Test-Path (Join-Path $dest 'סדר מועד')
$leftMcp = Get-ChildItem -Path $dest -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)mcp' -or $_.FullName -match '(?i)\\mcp\\' }
$files = (Get-ChildItem -Path $dest -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
$dirs  = (Get-ChildItem -Path $dest -Recurse -Directory -ErrorAction SilentlyContinue | Measure-Object).Count

Write-Output "BACKUP_PATH=$dest"
Write-Output "FILES=$files DIRS=$dirs ROBOCOPY_EXIT=$code"
Write-Output "HAS_SEDER_MOED=$hasSederMoed"
Write-Output "MCP_LEFT_COUNT=$($leftMcp.Count)"
if ($leftMcp.Count -gt 0) {
  $leftMcp | Select-Object -First 20 | ForEach-Object { "MCP_LEFT=$($_.FullName)" }
}

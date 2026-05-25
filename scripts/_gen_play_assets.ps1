Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path play-assets | Out-Null
function Save-CropResize($srcPath, $dstPath, $targetW, $targetH) {
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath))
  try {
    $srcRatio = $src.Width / $src.Height
    $targetRatio = $targetW / $targetH
    if ($srcRatio -gt $targetRatio) {
      $cropH = $src.Height
      $cropW = [int]([math]::Round($cropH * $targetRatio))
      $cropX = [int](($src.Width - $cropW) / 2)
      $cropY = 0
    } else {
      $cropW = $src.Width
      $cropH = [int]([math]::Round($cropW / $targetRatio))
      $cropX = 0
      $cropY = [int](($src.Height - $cropH) / 2)
    }
    $bmp = New-Object System.Drawing.Bitmap $targetW, $targetH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Black)
    $srcRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropW, $cropH
    $dstRect = New-Object System.Drawing.Rectangle 0, 0, $targetW, $targetH
    $g.DrawImage($src, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save((Join-Path (Get-Location) $dstPath), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally {
    $src.Dispose()
  }
}
Save-CropResize "shemesh_screenshot.png" "play-assets/icon-512.png" 512 512
Save-CropResize "screenshot-30s.png" "play-assets/feature-1024x500.png" 1024 500
Save-CropResize "screenshot-30s.png" "play-assets/phone-1-2560x1440.png" 2560 1440
Save-CropResize "shemesh_scroll1.png" "play-assets/phone-2-1920x1080.png" 1920 1080
$outs = @("play-assets/icon-512.png","play-assets/feature-1024x500.png","play-assets/phone-1-2560x1440.png","play-assets/phone-2-1920x1080.png")
foreach($f in $outs){ $img=[System.Drawing.Image]::FromFile((Resolve-Path $f)); "{0}`t{1}x{2}" -f $f,$img.Width,$img.Height; $img.Dispose() }

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$resRoot = Join-Path $root 'android/app/src/main/res'
$preview = Join-Path $root 'qa/jiyixia-logo-preview.png'

function Color-Hex($hex, [int]$alpha = 255) {
  $clean = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    $alpha,
    [Convert]::ToInt32($clean.Substring(0, 2), 16),
    [Convert]::ToInt32($clean.Substring(2, 2), 16),
    [Convert]::ToInt32($clean.Substring(4, 2), 16)
  )
}

function New-RoundRect($x, $y, $w, $h, $r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundRect($g, $brush, $x, $y, $w, $h, $r) {
  $path = New-RoundRect $x $y $w $h $r
  $g.FillPath($brush, $path)
  $path.Dispose()
}

function Stroke-RoundRect($g, $pen, $x, $y, $w, $h, $r) {
  $path = New-RoundRect $x $y $w $h $r
  $g.DrawPath($pen, $path)
  $path.Dispose()
}

function Draw-Logo($g, [int]$size, [bool]$drawBackground, [bool]$roundMask) {
  $s = $size / 108.0
  $paper = Color-Hex '#F4EADB'
  $paperLight = Color-Hex '#FFF8EA'
  $green = Color-Hex '#2F7D68'
  $greenDark = Color-Hex '#1F5D4F'
  $line = Color-Hex '#D8C9A9'
  $red = Color-Hex '#C95A45'
  $ink = Color-Hex '#39443E'

  if ($drawBackground) {
    $bgBrush = New-Object System.Drawing.SolidBrush $paper
    if ($roundMask) {
      $g.FillEllipse($bgBrush, 0, 0, $size, $size)
    } else {
      Fill-RoundRect $g $bgBrush (3 * $s) (3 * $s) (102 * $s) (102 * $s) (24 * $s)
    }
    $bgBrush.Dispose()
  }

  $shadowBrush = New-Object System.Drawing.SolidBrush (Color-Hex '#000000' 28)
  Fill-RoundRect $g $shadowBrush (29 * $s) (23 * $s) (56 * $s) (70 * $s) (9 * $s)
  $shadowBrush.Dispose()

  $bookBrush = New-Object System.Drawing.SolidBrush $paperLight
  Fill-RoundRect $g $bookBrush (25 * $s) (18 * $s) (56 * $s) (70 * $s) (9 * $s)
  $bookBrush.Dispose()

  $borderPen = New-Object System.Drawing.Pen $greenDark, (2.1 * $s)
  Stroke-RoundRect $g $borderPen (25 * $s) (18 * $s) (56 * $s) (70 * $s) (9 * $s)
  $borderPen.Dispose()

  $spineBrush = New-Object System.Drawing.SolidBrush $green
  Fill-RoundRect $g $spineBrush (25 * $s) (18 * $s) (14 * $s) (70 * $s) (9 * $s)
  $spineBrush.Dispose()

  $linePen = New-Object System.Drawing.Pen $line, (1.6 * $s)
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  foreach ($y in 36, 47, 58) {
    $g.DrawLine($linePen, (46 * $s), ($y * $s), (70 * $s), ($y * $s))
  }
  $g.DrawLine($linePen, (46 * $s), (69 * $s), (60 * $s), (69 * $s))
  $linePen.Dispose()

  $dotBrush = New-Object System.Drawing.SolidBrush (Color-Hex '#E6C76B')
  $g.FillEllipse($dotBrush, (31 * $s), (31 * $s), (4 * $s), (4 * $s))
  $g.FillEllipse($dotBrush, (31 * $s), (51 * $s), (4 * $s), (4 * $s))
  $g.FillEllipse($dotBrush, (31 * $s), (71 * $s), (4 * $s), (4 * $s))
  $dotBrush.Dispose()

  $sealBrush = New-Object System.Drawing.SolidBrush $red
  Fill-RoundRect $g $sealBrush (53.5 * $s) (59.5 * $s) (24 * $s) (22 * $s) (5 * $s)
  $sealBrush.Dispose()

  $sealPen = New-Object System.Drawing.Pen (Color-Hex '#F8D8C8'), (1.15 * $s)
  Stroke-RoundRect $g $sealPen (56 * $s) (62 * $s) (19 * $s) (16.8 * $s) (3 * $s)
  $sealPen.Dispose()

  $glyphPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glyphFormat = New-Object System.Drawing.StringFormat
  try {
    $fontFamily = New-Object System.Drawing.FontFamily 'STKaiti'
  } catch {
    $fontFamily = New-Object System.Drawing.FontFamily 'KaiTi'
  }
  $glyphPath.AddString(([char]0x8BB0).ToString(), $fontFamily, [int][System.Drawing.FontStyle]::Bold, (20 * $s), (New-Object System.Drawing.PointF(0, 0)), $glyphFormat)
  $bounds = $glyphPath.GetBounds()
  $targetX = 58.4 * $s
  $targetY = 62.9 * $s
  $targetW = 14.8 * $s
  $targetH = 14.8 * $s
  $scale = [Math]::Min($targetW / $bounds.Width, $targetH / $bounds.Height)
  $matrix = New-Object System.Drawing.Drawing2D.Matrix
  $matrix.Translate(-$bounds.X, -$bounds.Y)
  $matrix.Scale($scale, $scale, [System.Drawing.Drawing2D.MatrixOrder]::Append)
  $matrix.Translate($targetX + (($targetW - $bounds.Width * $scale) / 2), $targetY + (($targetH - $bounds.Height * $scale) / 2), [System.Drawing.Drawing2D.MatrixOrder]::Append)
  $glyphPath.Transform($matrix)

  $textBrush = New-Object System.Drawing.SolidBrush (Color-Hex '#FFF8EA')
  $g.FillPath($textBrush, $glyphPath)
  $textBrush.Dispose()
  $matrix.Dispose()
  $glyphPath.Dispose()
  $glyphFormat.Dispose()

}

function Save-Icon($path, [int]$size, [bool]$background, [bool]$round) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  Draw-Logo $g $size $background $round
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bitmap.Dispose()
}

$densities = @(
  @{ Dir = 'mipmap-mdpi'; Size = 48; Foreground = 108 },
  @{ Dir = 'mipmap-hdpi'; Size = 72; Foreground = 162 },
  @{ Dir = 'mipmap-xhdpi'; Size = 96; Foreground = 216 },
  @{ Dir = 'mipmap-xxhdpi'; Size = 144; Foreground = 324 },
  @{ Dir = 'mipmap-xxxhdpi'; Size = 192; Foreground = 432 }
)

foreach ($density in $densities) {
  $dir = Join-Path $resRoot $density.Dir
  Save-Icon (Join-Path $dir 'ic_launcher.png') $density.Size $true $false
  Save-Icon (Join-Path $dir 'ic_launcher_round.png') $density.Size $true $true
  Save-Icon (Join-Path $dir 'ic_launcher_foreground.png') $density.Foreground $false $false
}

Save-Icon $preview 512 $true $false

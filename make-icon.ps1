# Rebuild Xvert's app, in-app and PortableApps icons from the family mark.
# Geometry mirrors skaleclub-apps/design/skale-css/marks/xvert.svg (24-unit grid); change the mark
# there first, then here. Glyph scale per the family rules: 64% on desktop sizes, 74% at 24 px and below.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$signal = [System.Drawing.ColorTranslator]::FromHtml('#ff8f45')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#04070d')

function New-Mark([int]$size) {
    $glyph = if ($size -le 24) { 0.74 } else { 0.64 }
    $ss = 8
    $big = $size * $ss
    $u = $big / 24.0
    $bmp = New-Object System.Drawing.Bitmap $big, $big, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    $r = 5.28 * $u * 2
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(0, 0, $r, $r, 180, 90)
    $tile.AddArc($big - $r, 0, $r, $r, 270, 90)
    $tile.AddArc($big - $r, $big - $r, $r, $r, 0, 90)
    $tile.AddArc(0, $big - $r, $r, $r, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $signal), $tile)

    $offset = 12 * (1 - $glyph)
    $pt = { param($x, $y) New-Object System.Drawing.PointF (($offset + $x * $glyph) * $u), (($offset + $y * $glyph) * $u) }
    $solid = [System.Drawing.PointF[]]@((& $pt 3.6 5.8), (& $pt 11.6 12), (& $pt 3.6 18.2))
    $outline = [System.Drawing.PointF[]]@((& $pt 12.2 5.8), (& $pt 20.2 12), (& $pt 12.2 18.2))

    $pen1 = New-Object System.Drawing.Pen $ink, (1.6 * $glyph * $u)
    $pen2 = New-Object System.Drawing.Pen $ink, (2.2 * $glyph * $u)
    foreach ($p in $pen1, $pen2) { $p.LineJoin = 'Round' }
    $g.FillPolygon((New-Object System.Drawing.SolidBrush $ink), $solid)
    $g.DrawPolygon($pen1, $solid)
    $g.DrawPolygon($pen2, $outline)
    $g.Dispose()

    $out = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $h = [System.Drawing.Graphics]::FromImage($out)
    $h.InterpolationMode = 'HighQualityBicubic'
    $h.PixelOffsetMode = 'HighQuality'
    $h.DrawImage($bmp, 0, 0, $size, $size)
    $h.Dispose(); $bmp.Dispose()
    $out
}

function Save-Png([int]$size, [string]$path) {
    $m = New-Mark $size
    $m.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $m.Dispose()
}

function Save-Ico([int[]]$sizes, [string]$path) {
    $frames = foreach ($s in $sizes) {
        $m = New-Mark $s; $ms = New-Object System.IO.MemoryStream
        $m.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $m.Dispose()
        , @($s, $ms.ToArray())
    }
    $fs = [System.IO.File]::Create($path); $w = New-Object System.IO.BinaryWriter $fs
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($f in $frames) {
        $dim = if ($f[0] -ge 256) { 0 } else { $f[0] }
        $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$f[1].Length); $w.Write([uint32]$offset)
        $offset += $f[1].Length
    }
    foreach ($f in $frames) { $w.Write($f[1]) }
    $w.Dispose()
}

$icons = Join-Path $PSScriptRoot 'src-tauri/icons'
$pngs = @{
    '32x32.png' = 32; '64x64.png' = 64; '128x128.png' = 128; '128x128@2x.png' = 256; 'icon.png' = 512
    'StoreLogo.png' = 50; 'Square30x30Logo.png' = 30; 'Square44x44Logo.png' = 44; 'Square71x71Logo.png' = 71
    'Square89x89Logo.png' = 89; 'Square107x107Logo.png' = 107; 'Square142x142Logo.png' = 142
    'Square150x150Logo.png' = 150; 'Square284x284Logo.png' = 284; 'Square310x310Logo.png' = 310
}
foreach ($name in $pngs.Keys) { Save-Png $pngs[$name] (Join-Path $icons $name) }
Save-Ico @(16, 24, 32, 48, 64, 256) (Join-Path $icons 'icon.ico')
Save-Png 128 (Join-Path $PSScriptRoot 'src/logo.png')

$portable = Join-Path $PSScriptRoot 'branding/portable'
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item -LiteralPath (Join-Path $icons 'icon.ico') -Destination (Join-Path $portable 'appicon.ico') -Force
foreach ($size in 16, 32, 75, 128) { Save-Png $size (Join-Path $portable "appicon_$size.png") }
Write-Host 'Xvert app, in-app and PortableApps icons regenerated from the family mark.'

# Rebuild Xvert's app and PortableApps icons from the approved Fold A master.
# icon-source.png is the transparent folded-file symbol, without a wordmark.
[CmdletBinding()]
param([string]$Source = (Join-Path $PSScriptRoot 'icon-source.png'))
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$cli = Join-Path $PSScriptRoot 'node_modules/@tauri-apps/cli/tauri.js'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Run npm ci before generating icons.' }
if (-not (Test-Path -LiteralPath $Source)) { throw "Icon source not found: $Source" }
$icons = Join-Path $PSScriptRoot 'src-tauri/icons'
& $node $cli icon $Source --output $icons
if ($LASTEXITCODE -ne 0) { throw "Icon generation failed with exit code $LASTEXITCODE" }
Copy-Item -LiteralPath (Join-Path $icons '128x128.png') -Destination (Join-Path $PSScriptRoot 'src/logo.png') -Force

# Tauri's standard output does not include the 16 px and 75 px PortableApps PNGs.
$extra = Join-Path $PSScriptRoot 'src-tauri/target/icon-extras'
& $node $cli icon $Source --output $extra --png 16 --png 75
if ($LASTEXITCODE -ne 0) { throw "Extra icon generation failed with exit code $LASTEXITCODE" }

$portable = Join-Path $PSScriptRoot 'branding/portable'
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item -LiteralPath (Join-Path $icons 'icon.ico') -Destination (Join-Path $portable 'appicon.ico') -Force
foreach ($size in @(16, 32, 75, 128)) {
    $folder = if ($size -in @(16, 75)) { $extra } else { $icons }
    Copy-Item -LiteralPath (Join-Path $folder "${size}x${size}.png") -Destination (Join-Path $portable "appicon_$size.png") -Force
}
Write-Host 'Xvert app, in-app and PortableApps icons regenerated.'

# Publish immutable image files without enabling R2 or a paid Cloudflare plan.
param([string]$Manifest='F:\pano\league\hanoi-bank\manifest.json')
$ErrorActionPreference='Stop'
. F:\pano\scripts\env.ps1
Set-Location F:\pano\collab-web
$env:LOCALAPPDATA='F:\pano\cache\node-local'
$env:APPDATA='F:\pano\config\node'
$env:WRANGLER_SEND_METRICS='false'
node scripts/prepare-image-assets.mjs $Manifest
if($LASTEXITCODE -ne 0){throw 'Image preparation failed'}
$bankDirectory=Split-Path -Parent (Resolve-Path -LiteralPath $Manifest).Path
node node_modules/wrangler/bin/wrangler.js deploy --config (Join-Path $bankDirectory 'images.wrangler.json')
if($LASTEXITCODE -ne 0){throw 'Image deployment failed; database was not changed'}
node node_modules/wrangler/bin/wrangler.js d1 migrations apply pano-game --env production --remote
if($LASTEXITCODE -ne 0){throw 'Migration failed'}
node node_modules/wrangler/bin/wrangler.js d1 execute pano-game --env production --remote --file (Join-Path $bankDirectory 'bank.sql')
if($LASTEXITCODE -ne 0){throw 'Bank import failed'}
Write-Output 'Images uploaded and new cases imported. Existing case versions and inactive flags are preserved.'

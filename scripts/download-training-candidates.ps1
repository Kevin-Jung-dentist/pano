param([switch]$OpenReport)
$ErrorActionPreference='Stop'
. F:\pano\scripts\env.ps1
Set-Location F:\pano\collab-web
$env:WRANGLER_SEND_METRICS='false'
node scripts/bank.mjs export-candidates pano-game F:\pano\league\returns\candidates.json
if($LASTEXITCODE -ne 0){throw 'Download failed. Existing local candidates were preserved. Check the Cloudflare login.'}
node scripts/collect-candidates.mjs F:\pano\league\returns\candidates.json F:\pano\league\hanoi-bank\manifest.json F:\pano\league\collected
if($LASTEXITCODE -ne 0){throw 'Collection validation failed. No training was started.'}
if($OpenReport){Start-Process -FilePath 'F:\pano\league\collected\index.html' -WindowStyle Hidden}

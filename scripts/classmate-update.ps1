# Windows 版更新脚本
# 用法: PowerShell -ExecutionPolicy Bypass -File scripts\classmate-update.ps1
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

$PORT = 3003
$job = $null

function Stop-DevServer {
    if ($job) { Stop-Job $job; Remove-Job $job -Force }
}

# 检测代理
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 7897); $tcp.Close()
    $env:SCRAPER_PROXY = "http://127.0.0.1:7897"
    Write-Host "Proxy detected at 127.0.0.1:7897"
} catch {}

Write-Host "Starting dev server..."
$job = Start-Job { Set-Location $using:PWD; npm run dev -- -p $using:PORT }

Write-Host "Waiting for server..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-WebRequest "http://localhost:$PORT/api/listings" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true; break
    } catch { Start-Sleep 1 }
}
if (-not $ready) { Stop-DevServer; Write-Error "Server failed to start"; exit 1 }

Write-Host "`n=== Scraping Hozuko ==="
$out = curl.exe -sf -N -X POST "http://localhost:$PORT/api/scrape?source=hozuko" 2>&1
if ($out -match '"phase":"done"') { Write-Host "Hozuko: OK" }
else { Write-Host "Hozuko: may have failed"; Write-Host $out }

Write-Host "`n=== PropertyGuru: Opening browser for Cloudflare check ==="
Write-Host "A browser window will open. Complete the Cloudflare check, then the script continues automatically."
node scripts/propertyguru-auto-bypass.mjs
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== Scraping PropertyGuru ==="
    $out = curl.exe -sf -N -X POST "http://localhost:$PORT/api/scrape?source=propertyguru" 2>&1
    if ($out -match '"phase":"done"') { Write-Host "PropertyGuru: OK" }
    else { Write-Host "PropertyGuru failed, using Hozuko data only." }
} else {
    Write-Host "Cloudflare bypass failed, continuing with Hozuko data only."
}

Stop-DevServer

# Push if changed
$diff = git diff data/listing.json
if ($diff -and (Test-Path "data/listing.json")) {
    $data = Get-Content "data/listing.json" | ConvertFrom-Json
    $count = if ($data.count) { $data.count } else { $data.listings.Count }
    $date = Get-Date -Format "yyyy-MM-dd"
    Write-Host "`n=== Pushing to GitHub ==="
    git add data/listing.json
    git commit -m "data: refresh listings $date ($count listings)"
    git push
    Write-Host "`nDone! Vercel will rebuild automatically."
    Write-Host "Check: https://ntu-rental.vercel.app (takes ~1 min)"
} else {
    Write-Host "`nNo changes to listing.json, nothing to push."
}

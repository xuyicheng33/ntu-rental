# Windows 版更新脚本
# 用法: PowerShell -ExecutionPolicy Bypass -File scripts\classmate-update.ps1
# 可选: PowerShell -ExecutionPolicy Bypass -File scripts\classmate-update.ps1 -HozukoOnly
param(
    [switch]$HozukoOnly
)

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

$PORT = 3003
$job = $null

function Find-ChromePath {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }

    return $null
}

function Stop-DevServer {
    if ($job) { Stop-Job $job; Remove-Job $job -Force }
}

function Test-PropertyGuruSession {
    Write-Host "`n=== PropertyGuru: Checking saved session ==="
    $env:SCRAPER_HEADLESS = "false"
    $env:PROPERTYGURU_BROWSER = "chrome"
    $env:PROPERTYGURU_VERIFICATION_BROWSER = "chrome"
    node scripts/propertyguru-check-session.mjs
    return $LASTEXITCODE -eq 0
}

function Ensure-PropertyGuruSession {
    if (Test-PropertyGuruSession) {
        Write-Host "PropertyGuru session: OK"
        return $true
    }

    Write-Host "`n=== PropertyGuru: Manual verification required ==="
    Write-Host "A Chrome window will open once. Complete the check there, then return to this terminal and press Enter."
    Write-Host "If verification cannot be saved, the script will not keep reopening verification windows."
    $env:SCRAPER_HEADLESS = "false"
    $env:PROPERTYGURU_BROWSER = "chrome"
    $env:PROPERTYGURU_VERIFICATION_BROWSER = "chrome"
    node scripts/propertyguru-session.mjs --browser=chrome
    if ($LASTEXITCODE -ne 0) {
        Write-Host "PropertyGuru verification did not save a reusable session."
        return $false
    }

    Write-Host "PropertyGuru session saved from the current loaded page."
    return $true
}

trap {
    Stop-DevServer
    throw $_
}

# 检测代理
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 7897); $tcp.Close()
    $env:SCRAPER_PROXY = "http://127.0.0.1:7897"
    Write-Host "Proxy detected at 127.0.0.1:7897"
} catch {}

$chromePath = Find-ChromePath
if ($chromePath) {
    $env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = $chromePath
    Write-Host "Browser detected: $chromePath"
} else {
    Write-Host "Chrome/Edge was not found. Playwright bundled Chromium will be used."
}

$env:SCRAPER_HEADLESS = "false"
$env:PROPERTYGURU_BROWSER = "chrome"
$env:PROPERTYGURU_VERIFICATION_BROWSER = "chrome"

Write-Host "Starting dev server..."
$job = Start-Job {
    Set-Location $using:PWD
    $env:SCRAPER_HEADLESS = "false"
    $env:PROPERTYGURU_BROWSER = "chrome"
    $env:PROPERTYGURU_VERIFICATION_BROWSER = "chrome"
    if ($using:chromePath) { $env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = $using:chromePath }
    npm run dev -- -p $using:PORT
}

Write-Host "Waiting for server..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-WebRequest "http://localhost:$PORT/api/listings" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true; break
    } catch { Start-Sleep 1 }
}
if (-not $ready) { Write-Error "Server failed to start"; exit 1 }

Write-Host "`n=== Scraping Hozuko ==="
$out = curl.exe -sf -N -X POST "http://localhost:$PORT/api/scrape?source=hozuko" 2>&1
if ($out -match '"phase":"done"') { Write-Host "Hozuko: OK" }
else { Write-Host "Hozuko: may have failed"; Write-Host $out }

if ($HozukoOnly) {
    Write-Host "`nSkipping PropertyGuru because -HozukoOnly was set."
} elseif (Ensure-PropertyGuruSession) {
    Write-Host "`n=== Scraping PropertyGuru ==="
    $out = curl.exe -sf -N -X POST "http://localhost:$PORT/api/scrape?source=propertyguru" 2>&1
    if ($out -match '"phase":"done"') { Write-Host "PropertyGuru: OK" }
    else { Write-Host "PropertyGuru failed after one verified-session attempt. Keeping Hozuko data."; Write-Host $out }
} else {
    Write-Host "PropertyGuru skipped after one session attempt. Keeping Hozuko data."
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

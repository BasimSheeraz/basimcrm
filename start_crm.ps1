# ==============================================================================
# Basim CRM - PowerShell Interactive Launcher
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "Basim CRM - Server Console"
Set-Location -Path $PSScriptRoot

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "                       BASIM CRM - LAUNCHER" -ForegroundColor White
Write-Host "             Private Outreach CRM & Combined Team Mailboxes" -ForegroundColor Gray
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[!] Node.js is not found on your system PATH." -ForegroundColor Yellow
    Write-Host "    An offline installer is provided at: tools\node-v24.19.0-x64.msi" -ForegroundColor Gray
    $choice = Read-Host "    Install Node.js now? (y/n)"
    if ($choice -match '^[yY]') {
        Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$PSScriptRoot\tools\node-v24.19.0-x64.msi`"" -Wait
        Write-Host "[✓] Installer completed. Please reopen PowerShell to refresh your PATH." -ForegroundColor Green
    }
    Exit
}

$nodeVer = node -v
Write-Host "[✓] Node.js runtime detected: $nodeVer" -ForegroundColor Green

# 2. Check if already running on port 3000
$runningPort = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($runningPort) {
    Write-Host "[✓] Basim CRM is already online at http://localhost:3000!" -ForegroundColor Green
    Write-Host "[*] Opening in default browser..." -ForegroundColor Cyan
    Start-Process "http://localhost:3000"
    Start-Sleep -Seconds 2
    Exit
}

# 3. Check .env.local
if (-not (Test-Path ".env.local")) {
    Write-Host "[!] .env.local not found. Copying template from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env.local"
    Write-Host "[i] Remember to enter your Supabase & Google keys in .env.local" -ForegroundColor Gray
}

# 4. Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies with npm install..." -ForegroundColor Cyan
    npm install
}

# 5. Background watcher to wait until HTTP 200 before opening browser
Start-Job -ScriptBlock {
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response -and $response.StatusCode -eq 200) {
                Start-Process "http://localhost:3000"
                break
            }
        } catch {}
    }
} | Out-Null

Write-Host "[*] Starting Next.js server..." -ForegroundColor Cyan
Write-Host "[i] Address: http://localhost:3000 (or http://127.0.0.1:3000)" -ForegroundColor Yellow
Write-Host "[i] The browser will open automatically once the server is ready." -ForegroundColor Gray
Write-Host "[i] Keep this window open while using the CRM." -ForegroundColor Gray
Write-Host "[i] To turn off: use 'TURN OFF Basim CRM' on your desktop." -ForegroundColor Gray
Write-Host ""

npm run dev

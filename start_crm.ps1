# ==============================================================================
# Basim CRM - PowerShell Interactive Launcher
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "Basim CRM - Outreach & Multi-Mailbox Console"
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

# 2. Check .env.local
if (-not (Test-Path ".env.local")) {
    Write-Host "[!] .env.local not found. Copying template from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env.local"
    Write-Host "[i] Remember to enter your Supabase & Google keys in .env.local" -ForegroundColor Gray
}

# 3. Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies with npm install..." -ForegroundColor Cyan
    npm install
}

# 4. Auto-open browser
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:3000"
} | Out-Null

Write-Host "[*] Starting development server on http://localhost:3000..." -ForegroundColor Cyan
Write-Host "[i] Press Ctrl + C to stop the server." -ForegroundColor Gray
Write-Host ""

npm run dev

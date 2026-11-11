@echo off
setlocal enabledelayedexpansion
title Basim CRM - Server Console

cd /d "%~dp0"

echo ==============================================================================
echo                      BASIM CRM - ONE-CLICK LAUNCHER
echo              Private Outreach CRM with Multi-Mailbox Isolation
echo ==============================================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your system PATH!
    echo.
    echo Would you like to run the included offline Node.js installer now?
    set /p INSTALL_NODE="Type Y to install or N to cancel (Y/N): "
    if /i "!INSTALL_NODE!"=="Y" (
        call "%~dp0tools\install_node.bat"
        echo After installation finishes, close and reopen this launcher.
    )
    pause
    exit /b 1
)

:: 2. Check if server is already running on port 3000
set ALREADY_RUNNING=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r /c:":3000 .*LISTENING"') do (
    set ALREADY_RUNNING=1
)
if "!ALREADY_RUNNING!"=="1" (
    echo [INFO] Basim CRM is already running!
    echo [INFO] Opening http://localhost:3000 in your browser...
    start http://localhost:3000
    timeout /t 3 /nobreak >nul
    exit /b 0
)

:: 3. Check if .env.local exists
if not exist ".env.local" (
    echo [WARNING] .env.local not found. Creating from .env.example...
    copy ".env.example" ".env.local" >nul
    echo.
    echo Please make sure to fill in your real Supabase and Google credentials
    echo in .env.local before connecting to production mailboxes.
    echo.
)

:: 4. Check node_modules
if not exist "node_modules" (
    echo [INFO] node_modules folder missing. Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed! Please check your network connection.
        pause
        exit /b 1
    )
)

:: 5. Launch background watcher that waits until HTTP 200 before opening browser
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i=0; $i -lt 45; $i++) { Start-Sleep -Seconds 1; try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue; if ($r -and $r.StatusCode -eq 200) { Start-Process 'http://localhost:3000'; break } } catch {} }"

:: 6. Start Next.js development server
echo [INFO] Starting Next.js Dev Server...
echo [INFO] Full URL: http://localhost:3000  (or http://127.0.0.1:3000)
echo [NOTE] Your browser will open automatically once the server is ready.
echo [NOTE] Keep this window open while using the CRM.
echo [NOTE] To turn off the server: double-click 'TURN OFF Basim CRM' on your desktop.
echo.

call npm run dev

pause

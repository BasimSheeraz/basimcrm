@echo off
setlocal enabledelayedexpansion
title Basim CRM - Starting Server...

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

:: 2. Check if .env.local exists
if not exist ".env.local" (
    echo [WARNING] .env.local not found. Creating from .env.example...
    copy ".env.example" ".env.local" >nul
    echo.
    echo Please make sure to fill in your real Supabase and Google credentials
    echo in .env.local before connecting to production mailboxes.
    echo.
)

:: 3. Check node_modules
if not exist "node_modules" (
    echo [INFO] node_modules folder missing. Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed! Please check your network connection.
        pause
        exit /b 1
    )
)

:: 4. Launch browser after 3 seconds in background
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: 5. Start Next.js development server
echo [INFO] Starting Next.js Dev Server on http://localhost:3000 ...
echo Press Ctrl + C to stop the server at any time.
echo.

call npm run dev

pause

@echo off
title Basim CRM - Clean Restart
cd /d "%~dp0"

echo ============================================================
echo   Basim CRM - Clean Restart (.next Cache Reset)
echo ============================================================
echo.

echo 1. Stopping any running Node processes on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>nul
)

echo 2. Removing cached build artifacts (.next)...
if exist ".next" (
    rmdir /s /q ".next"
)

echo 3. Starting fresh development server...
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
npm run dev

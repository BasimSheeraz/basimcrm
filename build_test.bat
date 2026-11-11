@echo off
title Basim CRM - Production Build Verification
cd /d "%~dp0"

echo ============================================================
echo   Basim CRM - Production Build Verification
echo ============================================================
echo.

if exist ".next" (
    echo Cleaning existing .next directory...
    rmdir /s /q ".next"
)

echo Running: npm run build
call npm run build

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   [SUCCESS] Production build passed cleanly with 0 errors!
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo   [ERROR] Production build encountered issues. See above.
    echo ========================================================
)

pause

@echo off
title Basim CRM - Install Node.js
echo ============================================================
echo   Basim CRM - Node.js v24.19.0 Installer
echo ============================================================
echo.
echo Launching official Windows installer for Node.js...
echo Please follow the prompts in the installer window.
echo.

if exist "%~dp0node-v24.19.0-x64.msi" (
    start "" msiexec /i "%~dp0node-v24.19.0-x64.msi"
) else (
    echo [ERROR] Installer node-v24.19.0-x64.msi not found in tools folder!
    echo Please download Node.js LTS from https://nodejs.org/
    pause
)

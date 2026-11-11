@echo off
title Basim CRM - Turning OFF...
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_crm.ps1"

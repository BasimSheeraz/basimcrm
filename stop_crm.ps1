# Basim CRM - Shutdown Script
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "                      BASIM CRM - SHUTDOWN" -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

$stopped = $false

# 1. Check ports 3000 to 3005
3000..3005 | ForEach-Object {
    $port = $_
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($p in $pids) {
                if ($p -and $p -ne 0) {
                    Write-Host "[INFO] Stopping server on port $port (PID: $p)..." -ForegroundColor Yellow
                    Start-Process "taskkill.exe" -ArgumentList "/F /T /PID $p" -Wait -WindowStyle Hidden
                    $stopped = $true
                }
            }
        }
    } catch {}
}

# 2. Check any remaining next dev node processes for basim_crm
try {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.CommandLine -like "*next*dev*" -or $_.CommandLine -like "*basim_crm*") -and $_.Name -eq "node.exe"
    }
    foreach ($proc in $procs) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
} catch {}

Write-Host ""
if ($stopped) {
    Write-Host "==============================================================================" -ForegroundColor Green
    Write-Host "   [SUCCESS] Basim CRM has been turned OFF." -ForegroundColor Green
    Write-Host "==============================================================================" -ForegroundColor Green
} else {
    Write-Host "==============================================================================" -ForegroundColor Yellow
    Write-Host "   [INFO] Basim CRM was not running or is already stopped." -ForegroundColor Yellow
    Write-Host "==============================================================================" -ForegroundColor Yellow
}

Write-Host ""
Start-Sleep -Seconds 2

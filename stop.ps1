# Stops anything listening on the Aeolus ports (default 8100 = backend, 5200 = frontend).
# Other ports:  .\stop.ps1 -BackendPort 9000 -FrontendPort 9100
param([int]$BackendPort = 8100, [int]$FrontendPort = 5200)
# Use it if a terminal was closed without pressing Ctrl+C, or if start.ps1 says a port is in use.
foreach ($port in $BackendPort, $FrontendPort) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { Write-Host "Port ${port}: nothing running"; continue }
    foreach ($l in $listeners) {
        & taskkill.exe /PID $l.OwningProcess /T /F *> $null
        Write-Host "Port ${port}: stopped process $($l.OwningProcess)"
    }
}

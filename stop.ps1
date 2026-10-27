# Stops anything listening on the WindKraft ports (8000 = backend, 5173 = frontend).
# Use it if a terminal was closed without pressing Ctrl+C, or if start.ps1 says a port is in use.
foreach ($port in 8000, 5173) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { Write-Host "Port ${port}: nothing running"; continue }
    foreach ($l in $listeners) {
        & taskkill.exe /PID $l.OwningProcess /T /F *> $null
        Write-Host "Port ${port}: stopped process $($l.OwningProcess)"
    }
}

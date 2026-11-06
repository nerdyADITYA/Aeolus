# Starts Aeolus on this PC only: backend (default http://127.0.0.1:8100) and frontend (default http://localhost:5200).
# Usage (from the repo root):  .\start.ps1        Stop with Ctrl+C (or run .\stop.ps1 from another terminal).
# Other ports:  .\start.ps1 -BackendPort 9000 -FrontendPort 9100   (use the same values with .\stop.ps1)
param([int]$BackendPort = 8100, [int]$FrontendPort = 5200)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-Tree($proc) {
    # npm starts node as a child, so stopping only the parent would leave the dev server running: kill the whole tree.
    if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F *> $null }
}

foreach ($p in $BackendPort, $FrontendPort) {
    if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $p is already in use. Run .\stop.ps1 first (or close whatever is using it)." -ForegroundColor Yellow
        exit 1
    }
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "Frontend dependencies are missing. Run:  cd frontend; npm install" -ForegroundColor Yellow
    exit 1
}

# The servers read their ports from the environment: the dev server port and API proxy target, and the CORS origins the backend allows.
$env:VITE_PORT = "$FrontendPort"
$env:VITE_API_TARGET = "http://127.0.0.1:$BackendPort"
$env:WINDKRAFT_CORS_ORIGINS = "[`"http://localhost:$FrontendPort`", `"http://127.0.0.1:$FrontendPort`"]"

Write-Host "Starting backend on http://127.0.0.1:$BackendPort  (API docs: /docs) ..."
$backend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\backend" python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort"

Write-Host "Starting frontend on http://localhost:$FrontendPort ..."
$frontend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\frontend" npm.cmd -ArgumentList "run", "dev"

Write-Host "Open http://localhost:$FrontendPort in your browser. Press Ctrl+C to stop both." -ForegroundColor Green
try {
    # If either server dies, stop the other one too, so nothing is left running by accident.
    while (-not $backend.HasExited -and -not $frontend.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    Stop-Tree $frontend
    Stop-Tree $backend
    Write-Host "Stopped."
}

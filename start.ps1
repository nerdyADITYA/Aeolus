# Starts WindKraft on this PC only: backend (http://127.0.0.1:8000) and frontend (http://localhost:5173).
# Usage (from the repo root):  .\start.ps1        Stop with Ctrl+C (or run .\stop.ps1 from another terminal).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-Tree($proc) {
    # npm starts node as a child, so stopping only the parent would leave the dev server running: kill the whole tree.
    if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F *> $null }
}

foreach ($p in 8000, 5173) {
    if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $p is already in use. Run .\stop.ps1 first (or close whatever is using it)." -ForegroundColor Yellow
        exit 1
    }
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "Frontend dependencies are missing. Run:  cd frontend; npm install" -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting backend on http://127.0.0.1:8000  (API docs: /docs) ..."
$backend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\backend" python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"

Write-Host "Starting frontend on http://localhost:5173 ..."
$frontend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\frontend" npm.cmd -ArgumentList "run", "dev"

Write-Host "Open http://localhost:5173 in your browser. Press Ctrl+C to stop both." -ForegroundColor Green
try {
    # If either server dies, stop the other one too, so nothing is left running by accident.
    while (-not $backend.HasExited -and -not $frontend.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    Stop-Tree $frontend
    Stop-Tree $backend
    Write-Host "Stopped."
}

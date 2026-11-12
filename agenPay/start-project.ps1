param(
    [switch]$ForceKillNodeOnPort
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $root "agenpay-backend"
$facilitatorPath = Join-Path $root "agenpay-facilitator"
$frontendPath = Join-Path $root "agenpay-frontend"

function Test-PortAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,

        [Parameter(Mandatory = $true)]
        [string]$ServiceName,

        [Parameter(Mandatory = $false)]
        [switch]$AllowNodeTermination
    )

    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $listener) {
        return $true
    }

    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $procName = if ($proc) { $proc.ProcessName } else { "unknown" }

    if ($proc -and $procName -match "node|node.exe") {
        if ($AllowNodeTermination) {
            Write-Host "Port $Port is in use by Node process $($proc.Id). Stopping it for $ServiceName..." -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force
            Start-Sleep -Milliseconds 700
            return $true
        }

        Write-Warning "$ServiceName is blocked: port $Port is already in use by Node process $($proc.Id)."
        Write-Warning "Rerun with -ForceKillNodeOnPort if you want this script to stop existing Node listeners automatically."
        return $false
    }

    Write-Warning "$ServiceName could not start because port $Port is already in use by process '$procName' (PID: $($listener.OwningProcess))."
    Write-Warning "Close that process manually, then rerun this script."
    return $false
}

function Start-ServiceWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,

        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    if (-not (Test-Path -Path $WorkingDirectory -PathType Container)) {
        Write-Warning "$Title could not start because the working directory does not exist: $WorkingDirectory"
        return
    }

    if (-not (Test-PortAvailable -Port $Port -ServiceName $Title -AllowNodeTermination:$ForceKillNodeOnPort)) {
        return
    }

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))

    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy", "RemoteSigned",
        "-EncodedCommand", $encoded
    ) -WorkingDirectory $WorkingDirectory | Out-Null

    Write-Host "Started $Title on port $Port in: $WorkingDirectory"
}

# Start each service in its own PowerShell window.
Start-ServiceWindow -Title "AgenPay Backend" -WorkingDirectory $backendPath -Command "npm run dev" -Port 3001
Start-ServiceWindow -Title "AgenPay Facilitator" -WorkingDirectory $facilitatorPath -Command "npm run dev" -Port 3002
Start-ServiceWindow -Title "AgenPay Frontend" -WorkingDirectory $frontendPath -Command "npm run dev" -Port 3000

Write-Host ""
Write-Host "AgenPay is starting..."
Write-Host "Frontend: http://localhost:3000"
Write-Host "Backend:  http://localhost:3001"
Write-Host "Facilitator: http://localhost:3002"
Write-Host ""
Write-Host "Keep the opened service windows running while you use the app."

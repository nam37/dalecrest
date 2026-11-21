$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $project
try {
    $settings = @{}
    if (Test-Path -LiteralPath '.env') {
        foreach ($line in Get-Content -LiteralPath '.env') {
            if ($line -match '^([A-Z_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2] }
        }
    }
    if (!$settings['DATABASE_URL'] -or $settings['DATABASE_URL'] -match '@127\.0\.0\.1:\d+/dalecrest$') {
        & (Join-Path $PSScriptRoot 'start-postgres.ps1')
    }
    if ($settings['OLLAMA_MODEL'] -and $settings['OLLAMA_BASE_URL'] -eq 'http://127.0.0.1:11435') {
        try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/api/tags' -TimeoutSec 2 }
        catch {
            $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
            if ($ollama) {
                $previousHost = $env:OLLAMA_HOST
                $previousCloud = $env:OLLAMA_NO_CLOUD
                try {
                    $env:OLLAMA_HOST = '127.0.0.1:11435'
                    $env:OLLAMA_NO_CLOUD = '1'
                    Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden
                } finally {
                    $env:OLLAMA_HOST = $previousHost
                    $env:OLLAMA_NO_CLOUD = $previousCloud
                }
            }
        }
    }
    $port = if ($settings['PORT']) { $settings['PORT'] } else { '4173' }
    $address = "http://127.0.0.1:$port"
    $running = $false
    try {
        $village = Invoke-RestMethod -Uri "$address/api/village" -TimeoutSec 2
        $running = $null -ne $village.actors -and $null -ne $village.world.minute
    } catch { }
    if ($running) { Write-Output "Dalecrest is running at $address"; return }
    if (!(Test-Path -LiteralPath 'node_modules/pg')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Could not install the application dependencies.' }
    }
    & npm.cmd start
} finally {
    Pop-Location
}

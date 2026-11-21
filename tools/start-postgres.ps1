param([int]$Port = 55432)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$local = Join-Path $project '.local'
$data = Join-Path $local 'database'
$bin = Join-Path $local 'pgsql/bin'
$dotenv = Join-Path $project '.env'
New-Item -Force -ItemType Directory $local | Out-Null

if (!(Test-Path "$bin/pg_ctl.exe")) {
    $installed = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($installed) {
        $bin = Split-Path $installed.Source
    } else {
        $zip = Join-Path $local 'postgresql.zip'
        if (!(Test-Path $zip)) {
            $url = 'https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip'
            Invoke-WebRequest -UseBasicParsing $url -OutFile "$zip.part"
            Move-Item -LiteralPath "$zip.part" -Destination $zip
        }
        & tar.exe -xf $zip -C $local pgsql/bin pgsql/share pgsql/lib
        if ($LASTEXITCODE) { throw 'PostgreSQL archive extraction failed.' }
    }
}

if (Test-Path $dotenv) {
    $line = Get-Content $dotenv | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line -notmatch '^DATABASE_URL=postgresql://dalecrest:([a-f0-9]+)@127\.0\.0\.1:(\d+)/dalecrest$') {
        throw 'The project already has a custom .env. Start the PostgreSQL instance configured there.'
    }
    $password = $Matches[1]
    $Port = [int]$Matches[2]
} else {
    if (Test-Path "$data/PG_VERSION") { throw 'Restore the project .env for the existing database.' }
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $password = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
    "DATABASE_URL=postgresql://dalecrest:${password}@127.0.0.1:${Port}/dalecrest" |
        Set-Content -Encoding ASCII -LiteralPath $dotenv
}

if (!(Test-Path "$data/PG_VERSION")) {
    $passwordFile = Join-Path $local ([Guid]::NewGuid().ToString() + '.tmp')
    try {
        Set-Content -LiteralPath $passwordFile -Encoding ASCII -Value $password
        & "$bin/initdb.exe" -D $data -U dalecrest --pwfile=$passwordFile --auth=scram-sha-256 --locale=C --encoding=UTF8
        if ($LASTEXITCODE) { throw 'PostgreSQL cluster initialization failed.' }
    } finally {
        Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue
    }
}
& "$bin/pg_ctl.exe" -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
    & "$bin/pg_ctl.exe" -D $data -l "$local/postgres.log" -o "-h 127.0.0.1 -p $Port" -w start
    if ($LASTEXITCODE) { throw 'PostgreSQL startup failed. Check .local/postgres.log.' }
}

$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $password
    $connection = @('-h','127.0.0.1','-p',"$Port",'-U','dalecrest','-w')
    $exists = & "$bin/psql.exe" @connection -XAt -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'dalecrest'"
    if ($LASTEXITCODE) { throw 'Could not connect to the local cluster.' }
    if ($exists -ne '1') {
        & "$bin/createdb.exe" @connection dalecrest
        if ($LASTEXITCODE) { throw 'Could not create the Dalecrest database.' }
    }
    & "$bin/psql.exe" @connection -XAt -d dalecrest -c "SELECT jsonb_build_object('database', current_database(), 'postgresql', current_setting('server_version'))"
    if ($LASTEXITCODE) { throw 'Database verification failed.' }
} finally {
    $env:PGPASSWORD = $previousPassword
}

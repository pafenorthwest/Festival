param([switch] $CheckConfig, [switch] $ApplicationOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot
$hadFestivalDb = Test-Path Env:FESTIVAL_DB
$previousFestivalDb = $env:FESTIVAL_DB
try {
    Remove-Item Env:FESTIVAL_DB -ErrorAction SilentlyContinue
    $runnerArgs = @('--env-file=./database.env', './tasks/fix-availability-jsonb/run-postgres-tests.ts')
    if ($CheckConfig) { $runnerArgs += '--check-config' }
    if ($ApplicationOnly) { $runnerArgs += '--application-only' }
    & bun @runnerArgs
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL configuration or suite failed; inspect sanitized output.' }
} finally {
    if ($hadFestivalDb) { $env:FESTIVAL_DB = $previousFestivalDb }
    else { Remove-Item Env:FESTIVAL_DB -ErrorAction SilentlyContinue }
}

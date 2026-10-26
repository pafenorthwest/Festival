param([Parameter(Mandatory)][ValidateSet('before', 'after')][string] $Phase)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot
$hadFestivalDb = Test-Path Env:FESTIVAL_DB
$previousFestivalDb = $env:FESTIVAL_DB
try {
    Remove-Item Env:FESTIVAL_DB -ErrorAction SilentlyContinue
    & bun --env-file=./database.env ./tasks/schema-parity-integration/verify-application.ts $Phase
    if ($LASTEXITCODE -ne 0) { throw 'Read-only application verification failed; private values withheld.' }
} finally {
    if ($hadFestivalDb) { $env:FESTIVAL_DB = $previousFestivalDb }
    else { Remove-Item Env:FESTIVAL_DB -ErrorAction SilentlyContinue }
}

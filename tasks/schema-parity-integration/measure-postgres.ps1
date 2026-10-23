param(
    [Parameter(Mandatory)][string] $Runner,
    [ValidateRange(1, 5)][int] $Rounds = 3
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot
$runnerPath = (Resolve-Path -LiteralPath $Runner).Path
$powerShell = (Get-Process -Id $PID).Path
$logRoot = '/private/tmp/schema-parity-integration-validation'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$measurements = @()
for ($round = 1; $round -le $Rounds; $round++) {
    Write-Output "Current-schema PostgreSQL measured round $round/$Rounds"
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    # The reviewed runner owns private loading, output sanitization, test bounds,
    # catalog preflight and task-owned namespace cleanup. Do not bypass it.
    $result = @(& $powerShell -NoProfile -File $runnerPath 2>&1)
    $exitCode = $LASTEXITCODE
    $runnerSucceeded = $exitCode -eq 0
    $timer.Stop()
    $output = ($result | ForEach-Object { $_.ToString() }) -join "`n"
    $output = [regex]::Replace($output, 'postgres(?:ql)?://[^\s"''<>]+', '[REDACTED_DATABASE_URL]', 'IgnoreCase')
    $logPath = Join-Path $logRoot "postgres-round-$round.log"
    Set-Content -LiteralPath $logPath -Value $output
    $measurement = [pscustomobject]@{
        round = $round
        wallMilliseconds = [math]::Round($timer.Elapsed.TotalMilliseconds, 1)
        succeeded = $runnerSucceeded
        exitCode = $exitCode
        log = $logPath
    }
    $measurements += $measurement
    $measurements | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $logRoot 'postgres-measurements.json')
    Write-Output $output
    Write-Output "Round $round wall time: $($measurement.wallMilliseconds) ms"
    if (!$runnerSucceeded) { throw "PostgreSQL measured round $round failed; inspect sanitized log." }
}
Write-Output ($measurements | ConvertTo-Json -Depth 3)

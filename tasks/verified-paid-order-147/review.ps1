param([ValidateSet('prepare', 'validate')][string] $Mode = 'validate')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot
$reviewPath = Join-Path $PSScriptRoot 'code-review.md'
if ($Mode -eq 'prepare') {
    $tracked = @(git diff HEAD --name-only)
    $untracked = @(git ls-files --others --exclude-standard)
    $files = @($tracked + $untracked | Where-Object { $_ -match '^(packages/|database/migrations/)' } | Sort-Object -Unique)
    $lines = @('# Code Review', '- Task name: verified-paid-order-147', '- Findings status: pending', '', '## Context', '- Base: HEAD plus current staged/unstaged changes and in-scope untracked code/migration files.', '- Diff command: `git diff HEAD; inspect listed untracked files`', '- Changed files:')
    foreach ($file in $files) { $lines += ('  - `' + $file + '`') }
    $lines += @('', '## Findings JSON', '```json', '[]', '```', '', '## Verdict', '- Verdict: pending', '- Confidence: pending', '- Justification: Preliminary only; parent has not frozen the patch.', '')
    Set-Content $reviewPath ($lines -join "`n") -NoNewline
    Write-Output "REVIEW READY: $reviewPath"
    exit 0
}
$review = Get-Content $reviewPath -Raw
$status = [regex]::Match($review, '(?m)^- Findings status: (none|complete)$').Groups[1].Value
$json = [regex]::Match($review, '(?ms)^## Findings JSON\r?\n```json\r?\n(.*?)\r?\n```').Groups[1].Value
if (!$json -or !$status) { throw 'Findings must be complete with valid JSON.' }
$findings = @($json | ConvertFrom-Json)
foreach ($finding in $findings) {
    if (!$finding.file -or !$finding.line_range -or $finding.severity -notin @('low', 'medium', 'high') -or !$finding.explanation) { throw 'Invalid finding fields.' }
    $range = $finding.line_range -split '-'
    $count = @(Get-Content (Join-Path $repoRoot $finding.file)).Count
    if ([int]$range[0] -lt 1 -or [int]$range[-1] -gt $count) { throw 'Finding citation outside file.' }
}
$confidenceText = [regex]::Match($review, '(?m)^- Confidence: ([0-9.]+)$').Groups[1].Value
$confidence = 0.0
if (!$confidenceText -or ![double]::TryParse($confidenceText, [ref]$confidence) -or $confidence -lt 0 -or $confidence -gt 1) { throw 'Confidence must be in [0,1].' }
if ($review -notmatch '(?m)^- Justification: .+') { throw 'Justification required.' }
if ($status -eq 'none' -and $findings.Count -eq 0 -and $review -match '(?m)^- Verdict: patch is correct$') { Write-Output 'READY'; exit 0 }
if ($status -eq 'complete' -and $findings.Count -gt 0 -and $review -match '(?m)^- Verdict: patch is incorrect$') { throw 'Actionable findings must be fixed.' }
throw 'Findings status, JSON and verdict are inconsistent.'

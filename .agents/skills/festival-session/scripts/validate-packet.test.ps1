$ErrorActionPreference = 'Stop'
$task = 's00-sdd-bounded-context-harness'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$validator = Join-Path $PSScriptRoot 'validate-packet.ps1'
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('festival-packet-test-' + [guid]::NewGuid())

try {
  New-Item -ItemType Directory -Path (Join-Path $fixture 'goals'), (Join-Path $fixture 'tasks') | Out-Null
  Copy-Item -Recurse -LiteralPath (Join-Path $root "goals/$task") -Destination (Join-Path $fixture 'goals')
  Copy-Item -Recurse -LiteralPath (Join-Path $root "tasks/$task") -Destination (Join-Path $fixture 'tasks')
  $review = Join-Path $fixture "tasks/$task/code-review.md"
  $clean = Get-Content -LiteralPath $review -Raw
  Push-Location $fixture
  try {
    & pwsh -NoProfile -File $validator -TaskName $task -RequireCodeReview
    if ($LASTEXITCODE -ne 0) { throw 'Clean review must pass the handoff gate' }

    $unclean = $clean.Replace('- Findings status: none', '- Findings status: complete').Replace('[]', '[{"file":"example","line_range":"1","severity":"medium","explanation":"Unresolved"}]').Replace('- Verdict: patch is correct', '- Verdict: patch is incorrect')
    Set-Content -LiteralPath $review -Value $unclean -Encoding UTF8
    & pwsh -NoProfile -File $validator -TaskName $task
    if ($LASTEXITCODE -ne 0) { throw 'A complete review with findings should remain valid for preflight' }
    & pwsh -NoProfile -File $validator -TaskName $task -RequireCodeReview
    if ($LASTEXITCODE -eq 0) { throw 'Unresolved findings must fail the handoff gate' }

    Set-Content -LiteralPath $review -Value $clean.Replace('- Verdict: patch is correct', '- Verdict: patch is incorrect') -Encoding UTF8
    & pwsh -NoProfile -File $validator -TaskName $task -RequireCodeReview
    if ($LASTEXITCODE -eq 0) { throw 'Incorrect verdict must fail the handoff gate' }
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
Write-Output 'Packet review gate tests passed'

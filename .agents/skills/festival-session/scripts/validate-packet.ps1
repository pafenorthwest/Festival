param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,
  [string]$Iteration = "v0",
  [switch]$RequireCodeReview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Validation {
  param([string]$Message)
  Write-Output "ERROR: $Message"
  exit 1
}

function Resolve-WorkspaceRoot {
  if ((Test-Path -LiteralPath './goals') -and (Test-Path -LiteralPath './tasks')) {
    return (Resolve-Path -LiteralPath '.').Path
  }
  $candidate = Join-Path $PSScriptRoot '../../../..'
  if ((Test-Path -LiteralPath (Join-Path $candidate 'goals')) -and (Test-Path -LiteralPath (Join-Path $candidate 'tasks'))) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }
  return (Resolve-Path -LiteralPath '.').Path
}

function Get-SectionLines {
  param([string[]]$Lines, [string]$Heading)
  $inSection = $false
  $collected = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $Lines) {
    if ($line -ceq $Heading) { $inSection = $true; continue }
    if ($inSection -and $line -match '^## ') { break }
    if ($inSection) { $collected.Add($line) }
  }
  return ,$collected.ToArray()
}

function Assert-LinesPresent {
  param([string[]]$Lines, [string[]]$Required, [string]$FileLabel)
  foreach ($expected in $Required) {
    if (-not ($Lines -ccontains $expected)) {
      Stop-Validation "$FileLabel is missing exact line '$expected'"
    }
  }
}

function Test-GoalsAndCriteria {
  param([string[]]$Lines, [string]$State, [string]$FileLabel)
  $goalLines = Get-SectionLines -Lines $Lines -Heading '## Goals'
  $goalCount = @($goalLines | Where-Object { $_ -match '^[0-9]+\.' }).Count
  if ($goalCount -gt 20) {
    Stop-Validation "$FileLabel defines $goalCount goals; maximum allowed is 20"
  }
  if ($State -in @('locked', 'draft') -and $goalCount -lt 1) {
    Stop-Validation "$FileLabel requires 1..20 numbered goals under '## Goals' when State is '$State'"
  }

  $criteriaLines = Get-SectionLines -Lines $Lines -Heading '## Success criteria'
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($line in $criteriaLines) {
    if ($line -cmatch '^- \[G') {
      if ($line -cnotmatch '^- \[G([0-9]+)\] \S') {
        Stop-Validation "$FileLabel has malformed criterion bullet '$line' under '## Success criteria'"
      }
      $rawIdx = $Matches[1]
      $idx = [int]$rawIdx
      if ($rawIdx -cne "$idx" -or $idx -lt 1 -or $idx -gt $goalCount) {
        Stop-Validation "$FileLabel has out-of-range criterion '[G$rawIdx]' under '## Success criteria' (expected 1..$goalCount)"
      }
      if (-not $seen.Add($idx)) {
        Stop-Validation "$FileLabel has duplicate criterion '[G$idx]' under '## Success criteria'"
      }
    }
  }
  for ($n = 1; $n -le $goalCount; $n++) {
    if (-not $seen.Contains($n)) {
      Stop-Validation "$FileLabel is missing a '- [G$n] ' bullet under '## Success criteria'"
    }
  }
  return $goalCount
}

function Test-GoalsPacket {
  param([string]$RootPath, [string]$Name, [string]$Iter)
  $establishRel = "goals/$Name/establish-goals.$Iter.md"
  $goalsRel = "goals/$Name/goals.$Iter.md"
  $establishPath = Join-Path $RootPath $establishRel
  $goalsPath = Join-Path $RootPath $goalsRel

  if (-not (Test-Path -LiteralPath $establishPath -PathType Leaf)) { Stop-Validation "Missing file '$establishRel'" }
  if (-not (Test-Path -LiteralPath $goalsPath -PathType Leaf)) { Stop-Validation "Missing file '$goalsRel'" }

  $lines = @(Get-Content -LiteralPath $goalsPath -Encoding UTF8)
  if ($lines.Count -eq 0 -or $lines[0] -cne '# Goals Extract') {
    Stop-Validation "$goalsRel must start with '# Goals Extract'"
  }
  Assert-LinesPresent -Lines $lines -Required @("- Task name: $Name", "- Iteration: $Iter") -FileLabel $goalsRel

  $stateLine = $lines | Where-Object { $_ -cmatch '^- State: (locked|draft|blocked)$' } | Select-Object -First 1
  if (-not $stateLine) {
    Stop-Validation "$goalsRel must contain '- State: locked|draft|blocked'"
  }
  $state = $stateLine -replace '^- State: ', ''

  $estLines = @(Get-Content -LiteralPath $establishPath -Encoding UTF8)
  if ($estLines.Count -eq 0 -or $estLines[0] -cne '# Establish Goals') {
    Stop-Validation "$establishRel must start with '# Establish Goals'"
  }
  Assert-LinesPresent -Lines $estLines -Required @("- Task name: $Name", "- Iteration: $Iter", "- State: $state") -FileLabel $establishRel
  $estStates = @($estLines | Where-Object { $_ -cmatch '^- State:' })
  if ($estStates.Count -ne 1 -or $estStates[0] -cne "- State: $state") {
    Stop-Validation "$establishRel must match '$goalsRel' state '- State: $state'"
  }

  Assert-LinesPresent -Lines $lines -Required @('## Goals', '## Non-goals', '## Success criteria') -FileLabel $goalsRel
  $goalCount = Test-GoalsAndCriteria -Lines $lines -State $state -FileLabel $goalsRel
  return @{ State = $state; GoalCount = $goalCount }
}

function Test-TaskSpec {
  param([string]$RootPath, [string]$Name)
  $specRel = "tasks/$Name/spec.md"
  $specPath = Join-Path $RootPath $specRel
  if (-not (Test-Path -LiteralPath $specPath -PathType Leaf)) { Stop-Validation "Missing file '$specRel'" }
  $lines = @(Get-Content -LiteralPath $specPath -Encoding UTF8)
  $requiredHeadings = @(
    '## Goal reference', '## Scope', '### In scope', '### Out of scope',
    '## Approach', '## Verification commands', '## Delivery', '## Quality gate results'
  )
  Assert-LinesPresent -Lines $lines -Required $requiredHeadings -FileLabel $specRel
}

function Get-FencedJsonArray {
  param([string[]]$SectionLines, [string]$FileLabel)
  $match = [regex]::Match(($SectionLines -join "`n"), '(?ms)^```json[ \t]*\n(.*?)^```[ \t]*$')
  if (-not $match.Success) {
    Stop-Validation "$FileLabel is missing a fenced json block under '## Findings JSON'"
  }
  $rawJson = $match.Groups[1].Value.Trim()
  if (-not $rawJson.StartsWith('[', [System.StringComparison]::Ordinal)) {
    Stop-Validation "$FileLabel '## Findings JSON' block must be a JSON array"
  }
  try {
    $parsed = ConvertFrom-Json -InputObject $rawJson -NoEnumerate -ErrorAction Stop
  } catch {
    Stop-Validation "$FileLabel contains invalid JSON under '## Findings JSON': $($_.Exception.Message)"
  }
  if ($parsed -isnot [System.Array]) {
    Stop-Validation "$FileLabel '## Findings JSON' block must evaluate to an array"
  }
  return ,$parsed
}

function Test-CleanVerdict {
  param([string[]]$Lines, [string]$FileLabel)
  Assert-LinesPresent -Lines $Lines -Required @('## Verdict') -FileLabel $FileLabel
  $verdictLines = Get-SectionLines -Lines $Lines -Heading '## Verdict'
  Assert-LinesPresent -Lines $verdictLines -Required @('- Verdict: patch is correct') -FileLabel $FileLabel
  if (-not ($verdictLines | Where-Object { $_ -cmatch '^- Confidence:\s*\S+' } | Select-Object -First 1)) {
    Stop-Validation "$FileLabel must contain '- Confidence:' under '## Verdict'"
  }
  if (-not ($verdictLines | Where-Object { $_ -cmatch '^- Justification:\s*\S+' } | Select-Object -First 1)) {
    Stop-Validation "$FileLabel must contain '- Justification:' under '## Verdict'"
  }
}

function Test-CodeReviewFile {
  param([string]$ReviewPath, [string]$ReviewRel, [string]$Name)
  $lines = @(Get-Content -LiteralPath $ReviewPath -Encoding UTF8)
  if ($lines.Count -eq 0 -or $lines[0] -cne '# Code Review') {
    Stop-Validation "$ReviewRel must start with '# Code Review'"
  }
  Assert-LinesPresent -Lines $lines -Required @("- Task name: $Name", '## Context', '## Findings JSON') -FileLabel $ReviewRel
  $statusLine = $lines | Where-Object { $_ -cmatch '^- Findings status: (none|complete)$' } | Select-Object -First 1
  if (-not $statusLine) {
    Stop-Validation "$ReviewRel must contain '- Findings status: none|complete'"
  }
  $status = $statusLine -replace '^- Findings status: ', ''
  $findings = Get-FencedJsonArray -SectionLines (Get-SectionLines -Lines $lines -Heading '## Findings JSON') -FileLabel $ReviewRel

  if ($status -ceq 'none') {
    if ($findings.Count -ne 0) {
      Stop-Validation "$ReviewRel declares 'Findings status: none' but Findings JSON has $($findings.Count) item(s)"
    }
    Test-CleanVerdict -Lines $lines -FileLabel $ReviewRel
  } else {
    if ($findings.Count -lt 1) {
      Stop-Validation "$ReviewRel declares 'Findings status: complete' but Findings JSON is empty"
    }
    Assert-LinesPresent -Lines $lines -Required @('## Verdict') -FileLabel $ReviewRel
    $verdictLines = Get-SectionLines -Lines $lines -Heading '## Verdict'
    if (-not ($verdictLines | Where-Object { $_ -cmatch '^- Verdict:\s*\S+' } | Select-Object -First 1)) {
      Stop-Validation "$ReviewRel must contain '- Verdict:' under '## Verdict'"
    }
  }
  return $status
}

if ($TaskName -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
  Stop-Validation "TaskName '$TaskName' must match '^[a-z0-9]+(-[a-z0-9]+)*$'"
}
if ($Iteration -cnotmatch '^v[0-9]+$') {
  Stop-Validation "Iteration '$Iteration' must match '^v[0-9]+$'"
}

$workspaceRoot = Resolve-WorkspaceRoot
$goalResult = Test-GoalsPacket -RootPath $workspaceRoot -Name $TaskName -Iter $Iteration
Test-TaskSpec -RootPath $workspaceRoot -Name $TaskName

$reviewRel = "tasks/$TaskName/code-review.md"
$reviewPath = Join-Path $workspaceRoot $reviewRel
$reviewSummary = 'not-present'
if ($RequireCodeReview -and -not (Test-Path -LiteralPath $reviewPath -PathType Leaf)) {
  Stop-Validation "Missing required code review file '$reviewRel'"
}
if (Test-Path -LiteralPath $reviewPath -PathType Leaf) {
  $reviewStatus = Test-CodeReviewFile -ReviewPath $reviewPath -ReviewRel $reviewRel -Name $TaskName
  $reviewSummary = "valid($reviewStatus)"
}

Write-Output "PACKET VALID: task=$TaskName iteration=$Iteration state=$($goalResult.State) goals=$($goalResult.GoalCount) codeReview=$reviewSummary"
exit 0

param([ValidatePattern('^v[0-9]+$')][string] $Iteration = 'v0')
$ErrorActionPreference = 'Stop'
$taskName = 'fix-availability-jsonb'
$expectedBranch = 'ericp/verified-paid-order'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot

# PowerShell equivalents of scaffold/extract/validate/bootstrap/preflight.
# Keep bootstrap resolution local to this process; do not rewrite global config,
# rebuild the shared goal manifest, or prune unrelated worktrees.
function Resolve-CodexAssets([string[]] $Required) {
    foreach ($candidate in @((Join-Path $repoRoot '.codex'), (Join-Path $repoRoot 'codex'), '/Users/eric/.codex')) {
        $valid = Test-Path $candidate
        foreach ($relative in $Required) { $valid = $valid -and (Test-Path (Join-Path $candidate $relative)) }
        if ($valid) { return $candidate }
    }
    throw "Unable to resolve Codex assets: $Required"
}
$goalRoot = Resolve-CodexAssets @('goals/establish-goals.template.md')
$implementationRoot = Resolve-CodexAssets @('scripts/task-scaffold.sh', 'scripts/implement-preflight.sh', 'project-structure.md')
$specRoot = Resolve-CodexAssets @('tasks/_templates/spec.template.md')
$goalDir = Join-Path $repoRoot "goals/$taskName"
New-Item -ItemType Directory -Path $goalDir -Force | Out-Null
$sourcePath = Join-Path $goalDir "establish-goals.$Iteration.md"
$normalizedPath = Join-Path $goalDir "goals.$Iteration.md"
$specPath = Join-Path $PSScriptRoot 'spec.md'
if (!(Test-Path $sourcePath)) { Copy-Item (Join-Path $goalRoot 'goals/establish-goals.template.md') $sourcePath }
if (!(Test-Path $specPath)) { Copy-Item (Join-Path $specRoot 'tasks/_templates/spec.template.md') $specPath }
$source = Get-Content $sourcePath -Raw
$state = [regex]::Match($source, '(?m)^- State: (.+)$').Groups[1].Value.Trim()
$sections = @()
foreach ($heading in @('Goals', 'Non-goals', 'Success criteria')) {
    $section = [regex]::Match($source, "(?ms)^## $heading[^`n]*`n.*?(?=^## |\z)").Value.Trim()
    if (!$section) { throw "Missing section: $heading" }
    $sections += $section
}
$normalized = "# Goals Extract`n- Task name: $taskName`n- Iteration: $Iteration`n- State: $state`n`n" + ($sections -join "`n`n") + "`n"
if (Test-Path $normalizedPath) {
    if ((Get-Content $normalizedPath -Raw).Replace("`r`n", "`n") -cne $normalized) { throw 'Existing immutable goals differ from extraction.' }
} else { Set-Content $normalizedPath $normalized -NoNewline }
$goalCount = [regex]::Matches($sections[0], '(?m)^\d+\.').Count
$criteriaCount = [regex]::Matches($sections[2], '(?m)^- \[G\d+\]').Count
if ($goalCount -lt 1 -or $goalCount -gt 20 -or $criteriaCount -lt 1 -or $state -ne 'locked') { throw 'Goal validation failed.' }
for ($goalNumber = 1; $goalNumber -le $goalCount; $goalNumber++) {
    if ($sections[2] -notmatch "\[G$goalNumber\]") { throw "Unmapped goal G$goalNumber" }
}
Write-Output "GOALS LOCKED: $goalCount goals, $criteriaCount mapped success criteria"
$branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $expectedBranch) { throw "Expected $expectedBranch, found $branch" }
$conflicts = @(git diff --name-only --diff-filter=U)
if ($LASTEXITCODE -ne 0 -or $conflicts.Count -gt 0) { throw "Unresolved conflicts: $conflicts" }
Write-Output "IMPLEMENT PREFLIGHT READY: $branch"
Write-Output "Goal template root: $goalRoot; implementation root: $implementationRoot; spec template root: $specRoot"
Write-Output 'Bootstrap/config sync, shared manifest rewrite and worktree prune intentionally omitted under task-only write boundary.'
git status --short

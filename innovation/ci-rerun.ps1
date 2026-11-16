<#
.SYNOPSIS
  The ONLY way the loop re-runs CI: one `gh run rerun <id> --failed` of a failed CI run of the loop's own PR,
  when every failing spec is a known-flaky one. Last output line: CI-RERUN OK <runId> | CI-RERUN REFUSED <why>

.DESCRIPTION
  Refuses unless ALL hold:
   - PR #<Pr> is open, from loop/<Issue>-<slug> of vekbui96/cardlens, opened by vekbui96
   - run <RunId> is a CI workflow run of vekbui96/cardlens for that PR's CURRENT head sha and branch
   - the run completed with failure, it is the run's first attempt (one rerun per run, ever), and the only
     failed job is Playwright E2E
   - every failing spec in `gh run view <id> --log-failed` is on the known-flaky list (gate-rules.ps1
     $FlakySpecs: the bulk-mark timing window and the Target specs)
  Then `gh run rerun <RunId> --failed -R vekbui96/cardlens` and logs it. Nothing is dispatched, cancelled,
  or re-run for any other ref. Wait for the new attempt with merge-pr.ps1 as usual.

.EXIT CODES
  0 rerun started | 1 refused (nothing re-run)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Pr,
    [Parameter(Mandatory)][int]$Issue,
    [Parameter(Mandatory)][long]$RunId
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
Start-ScriptLog "ci-rerun-$Issue-$RunId"
Add-GhToPath
$Repo = $script:Repo
function Refuse([string]$why) { Write-Log "refused: $why" 'ERROR'; Write-Output "CI-RERUN REFUSED $why"; exit 1 }
try {
    $p = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
    if ($p.state -ne 'open') { Refuse "PR #$Pr is $($p.state)" }
    if ($p.head.repo.full_name -ne $Repo) { Refuse "PR head is from $($p.head.repo.full_name)" }
    if ($p.head.ref -notmatch "^loop/$Issue-[a-z0-9][a-z0-9-]*$") { Refuse "PR branch '$($p.head.ref)' is not loop/$Issue-<slug>" }
    if ($p.user.login -ne $script:Owner) { Refuse "PR opened by $($p.user.login)" }
    $run = Get-GhJson @('api', "repos/$Repo/actions/runs/$RunId")
    if ($run.head_sha -ne $p.head.sha) { Refuse "run $RunId is for $($run.head_sha), not the PR head $($p.head.sha)" }
    if ($run.head_branch -ne $p.head.ref) { Refuse "run $RunId is for branch $($run.head_branch), not $($p.head.ref)" }
    if ($run.name -ne 'CI') { Refuse "run $RunId is workflow '$($run.name)', not CI" }
    if ($run.status -ne 'completed' -or $run.conclusion -ne 'failure') { Refuse "run $RunId is $($run.status)/$($run.conclusion), not a completed failure" }
    $jobs = Get-GhJson @('api', "repos/$Repo/actions/runs/$RunId/jobs?per_page=50")
    $failedJobs = @($jobs.jobs | Where-Object { $_.conclusion -in @('failure', 'timed_out', 'cancelled') } | ForEach-Object { "$($_.name)" })
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $log = (& $script:GhExe run view "$RunId" --log-failed -R $Repo 2>&1 | ForEach-Object { "$_" }) -join "`n"
    $ErrorActionPreference = $prev
    $v = Get-FlakyRerunVerdict -FailedLog $log -RunAttempt ([int]$run.run_attempt) -FailedJobs $failedJobs
    Write-Log "run $RunId attempt $($run.run_attempt) failed jobs [$($failedJobs -join ', ')] specs [$($v.Specs -join ', ')]: allowed=$($v.Allowed) ($($v.Reason))"
    if (-not $v.Allowed) { Refuse $v.Reason }
    Invoke-Gh -Arguments @('run', 'rerun', "$RunId", '--failed', '-R', $Repo) | Out-Null
    Save-State "ci-rerun-$Issue-$RunId" @{ issue = $Issue; pr = $Pr; runId = $RunId; headSha = $p.head.sha; specs = $v.Specs; utc = [DateTime]::UtcNow.ToString('o') }
    Write-Output "CI-RERUN OK $RunId ($($v.Reason))"
    exit 0
} catch {
    Write-Log "error: $_" 'ERROR'
    Write-Output "CI-RERUN REFUSED error: $_"
    exit 1
}

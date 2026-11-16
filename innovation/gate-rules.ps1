<#
.SYNOPSIS
  Pure decision rules for merge-pr.ps1, deploy.ps1 and ci-rerun.ps1 (no side effects; unit-tested by
  test-gate-rules.ps1).

.DESCRIPTION
  Kept out of lib.ps1 on purpose: lib.ps1 is one of the elevated side's files, and changing it makes the
  elevated copy stale until Ve re-runs install-task.ps1 -ElevatedOnly. Nothing here runs elevated.

  Get-CiVerdict       are the required CI jobs on the PR head green, still running, failed, or unacceptable?
  Get-FlakyRerunVerdict  may a failed CI run get its one rerun of failed jobs (known-flaky e2e specs only)?
  Get-GapDecision     which protected paths between the live server and a PR / merge block it?
#>

# CI is the e2e gate for every change (the loop runs no Playwright suite locally), so ALL of these must be
# completed + success on the PR's exact head before merge-pr merges with --match-head-commit.
$script:CiRequiredJobs = @(
    @{ Name = 'Typecheck / Lint / Unit / Build'; Pattern = '^Typecheck' },
    @{ Name = 'Playwright E2E'; Pattern = '^Playwright E2E$' },
    @{ Name = 'v2 Visual Regression'; Pattern = '^v2 Visual Regression$' }
)

# $CheckRuns: the check_runs array of GET repos/<r>/commits/<head>/check-runs (name, status, conclusion,
# started_at, html_url). $MissingMinutes: how long this head has been waited on. Returns State:
#   ok       every required job completed with success
#   failed   a required job completed with failure / timed_out: the loop may fix and push (CI fix round)
#   refuse   a required job is skipped, neutral, cancelled, stale or action_required, or is still missing
#            after -MissingGraceMinutes: never merged, never "fixed" by retrying
#   pending  anything still queued / in progress / not created yet
function Get-CiVerdict {
    param([object[]]$CheckRuns, [double]$MissingMinutes = 0, [double]$MissingGraceMinutes = 10, [object[]]$Required = $script:CiRequiredJobs)
    $lines = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList; $refuse = New-Object System.Collections.ArrayList
    $pending = $false; $missing = @()
    foreach ($req in $Required) {
        $job = @($CheckRuns | Where-Object { $_ -and "$($_.name)" -match $req.Pattern } | Sort-Object { "$($_.started_at)" } -Descending | Select-Object -First 1)
        if ($job.Count -eq 0) { $missing += $req.Name; [void]$lines.Add("$($req.Name)=missing"); continue }
        $j = $job[0]
        [void]$lines.Add("$($j.name)=$($j.status)/$($j.conclusion)")
        if ("$($j.status)" -ne 'completed') { $pending = $true; continue }
        switch ("$($j.conclusion)") {
            'success' { }
            { $_ -in @('failure', 'timed_out') } { [void]$failed.Add("$($j.name): $($j.conclusion) $($j.html_url)") }
            default { [void]$refuse.Add("$($j.name) was '$($j.conclusion)' (every required job must run and pass on the exact head)") }
        }
    }
    if ($missing.Count -gt 0) {
        if ($MissingMinutes -ge $MissingGraceMinutes) { foreach ($m in $missing) { [void]$refuse.Add("$m never appeared for this head ($([int]$MissingMinutes) min)") } }
        else { $pending = $true }
    }
    $state = 'ok'
    if ($refuse.Count -gt 0) { $state = 'refuse' } elseif ($failed.Count -gt 0) { $state = 'failed' } elseif ($pending) { $state = 'pending' }
    return [pscustomobject]@{ State = $state; Summary = ($lines -join '; '); Failed = @($failed); Refuse = @($refuse) }
}

# Specs with known timing flakiness in CI (bulk-mark timing window, the Target specs). A failed run may get
# ONE rerun of its failed jobs, and only when every failing spec is one of these.
$script:FlakySpecs = @('e2e/bulk-mark.spec.ts', 'e2e/v2/target-sealed.spec.ts')

# $FailedLog: text of `gh run view <id> --log-failed`. $RunAttempt: the run's run_attempt. $FailedJobs: names
# of the failed jobs. Returns Allowed + Reason + the failing specs found.
function Get-FlakyRerunVerdict {
    param([string]$FailedLog, [int]$RunAttempt, [string[]]$FailedJobs, [string[]]$Flaky = $script:FlakySpecs)
    $specs = @([regex]::Matches("$FailedLog", '(?<![\w/.-])((?:e2e/)?(?:[\w.-]+/)*[\w.-]+\.spec\.ts)') | ForEach-Object {
            $s = $_.Groups[1].Value.Replace('\', '/'); if (-not $s.StartsWith('e2e/')) { $s = "e2e/$s" }; $s } | Select-Object -Unique)
    if ($RunAttempt -gt 1) { return [pscustomobject]@{ Allowed = $false; Reason = "run already re-run (attempt $RunAttempt); only one rerun per run"; Specs = $specs } }
    $nonE2e = @($FailedJobs | Where-Object { $_ -notmatch '^Playwright E2E$' })
    if ($nonE2e.Count -gt 0) { return [pscustomobject]@{ Allowed = $false; Reason = "failed jobs other than Playwright E2E: $($nonE2e -join ', ')"; Specs = $specs } }
    if ($specs.Count -eq 0) { return [pscustomobject]@{ Allowed = $false; Reason = 'no failing spec found in the failed log'; Specs = $specs } }
    $other = @($specs | Where-Object { $Flaky -notcontains $_ })
    if ($other.Count -gt 0) { return [pscustomobject]@{ Allowed = $false; Reason = "failing specs not on the known-flaky list: $($other -join ', ')"; Specs = $specs } }
    return [pscustomobject]@{ Allowed = $true; Reason = "only known-flaky specs failed: $($specs -join ', ')"; Specs = $specs }
}

# Protected paths changed between the live server's HEAD and the target (merge-pr: the PR head; deploy: the
# merge). They come from two places:
#   the PR's / merge's OWN files   always refuse (a loop change may never touch a protected path)
#   the gap (commits Ve already merged to main that the live server does not have yet):
#     innovation/**                ignored: the live dir's copy is inert (the loop runs from
#                                  D:\projects\cardlens\innovation, the elevated side from its admin-only
#                                  copy in ProgramData), so Ve merging loop changes never blocks deploys
#     any other protected path     refuse: deploy-server.ps1 (elevated) refuses the same set, and widening the
#                                  elevated rule beyond innovation/** is a decision for Ve, not a side effect
# Callers log every gap commit so the issue shows what the deploy also carries.
function Get-GapDecision {
    param([string[]]$Protected, [string[]]$OwnFiles = @())
    $refuse = New-Object System.Collections.ArrayList; $ignored = New-Object System.Collections.ArrayList
    $own = @($OwnFiles | ForEach-Object { "$_".Replace('\', '/') })
    foreach ($f in @($Protected | Where-Object { $_ } | ForEach-Object { "$_".Replace('\', '/') } | Select-Object -Unique)) {
        if ($own -contains $f) { [void]$refuse.Add("$f (changed by this PR)") }
        elseif ($f -match '^innovation/') { [void]$ignored.Add($f) }
        else { [void]$refuse.Add("$f (in commits between the live server and this change)") }
    }
    return [pscustomobject]@{ Refuse = @($refuse); Ignored = @($ignored) }
}

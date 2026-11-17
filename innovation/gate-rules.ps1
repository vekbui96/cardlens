<#
.SYNOPSIS
  Pure decision rules for merge-pr.ps1, deploy.ps1, ci-rerun.ps1, check-approval.ps1 and run-loop.ps1 (no
  side effects; unit-tested by test-gate-rules.ps1).

.DESCRIPTION
  Kept out of lib.ps1 on purpose: lib.ps1 is one of the elevated side's files, and changing it makes the
  elevated copy stale until Ve re-runs install-task.ps1 -ElevatedOnly. Nothing here runs elevated. The gap
  rule's path classifier (Split-ProtectedByLiveImpact) does live in lib.ps1, because deploy-server.ps1 must
  apply the identical rule; dot-source lib.ps1 before this file.

  Get-CiVerdict       are the required CI jobs on the PR head green, still running, failed, or unacceptable?
  Get-FlakyRerunVerdict  may a failed CI run get its one rerun of failed jobs (known-flaky e2e specs only)?
  Get-GapDecision     which protected paths between the live server and a PR / merge block it?
  Get-ProposalSlots   how many proposals await review, and how many may still be opened (the ONE cap rule)?
  Get-RetryDecision   may an approved issue with loop:failed get its one automatic retry?
  Get-PrecheckDecision  does this run have anything to do at all, before claude is started?
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
# merge). Needs lib.ps1 dot-sourced first (Split-ProtectedByLiveImpact, shared with the elevated side). They
# come from two places:
#   the PR's / merge's OWN files   always refuse (a loop change may never touch a protected path)
#   the gap (commits already on main, merged by Ve or by the loop through its own gates, that the live server
#   does not have yet; Pages-only deploys never move the live checkout, so the gap grows with every
#   front-end merge):
#     inert there                  ignored, but listed (Ignored): innovation/**, .github/**, playwright config,
#                                  client-only src, scripts... nothing on server-pc executes them
#     changes what the server RUNS refuse (Block): card index (recognition restart), sync merge/validation
#                                  rules, the Target bot, .env. Those are Ve's merged changes, but they are
#                                  exactly what the loop may never take to production on its own; the refusal
#                                  names the commits so Ve can deploy them by hand first.
#   Non-protected server changes in the gap are not decided here: they ride along with the deploy (the live
#   checkout is reset to the merge) and merge-pr / deploy list them (Get-ServerPlan Foreign).
# deploy-server.ps1 (elevated) applies the same Block rule to live HEAD..target.
function Get-GapDecision {
    param([string[]]$Protected, [string[]]$OwnFiles = @(), [string[]]$ServerPaths = @('server', 'package.json', 'package-lock.json'))
    $refuse = New-Object System.Collections.ArrayList; $gapFiles = New-Object System.Collections.ArrayList
    $own = @($OwnFiles | ForEach-Object { "$_".Replace('\', '/') })
    foreach ($f in @($Protected | Where-Object { $_ } | ForEach-Object { "$_".Replace('\', '/') } | Select-Object -Unique)) {
        if ($own -contains $f) { [void]$refuse.Add("$f (changed by this PR)") } else { [void]$gapFiles.Add($f) }
    }
    $split = Split-ProtectedByLiveImpact -Protected @($gapFiles) -ServerPaths $ServerPaths
    foreach ($f in $split.Block) { [void]$refuse.Add("$f (in commits between the live server and this change; it changes what the live server runs)") }
    return [pscustomobject]@{ Refuse = @($refuse); Ignored = @($split.Inert); Block = @($split.Block) }
}

# ==================================================================================================
# The loop's queue: proposal slots, the one automatic retry of a failed build, and the $0 check before
# run-loop.ps1 starts claude. Used by check-approval.ps1 (-List / -Slots) and run-loop.ps1.
# ==================================================================================================

# ONE rule for "how many proposals may still be opened", shared by the loop (check-approval.ps1 -Slots,
# LOOP.md section 5) and the approval watcher's refill trigger (C:\ProgramData\innovation-loop-watch\
# watch-approvals.ps1 keeps a literal copy of this filter: it runs from an admin-only folder and must not
# dot-source anything from a user-writable checkout). A proposal holds a slot while it AWAITS REVIEW: open,
# labelled loop:proposal, and neither `approved` (that is the owner's build queue, not discovery's) nor
# `loop:failed` (listed as "failed, waiting on the owner" instead, see Get-RetryDecision).
$script:ProposalCap = 5
$script:MaxNewPerRun = 3

function Get-IssueLabelNames {
    param($Issue)
    return @(@($Issue.labels) | Where-Object { $_ } | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.name)" } })
}

# $Issues: open loop:proposal issues (gh issue list --json number,labels). Returns AwaitingReview (numbers),
# Open, Cap, Free (slots left, never below 0) and NewThisRun (min(MaxNewPerRun, Free)).
function Get-ProposalSlots {
    param([object[]]$Issues, [int]$Cap = $script:ProposalCap, [int]$MaxNew = $script:MaxNewPerRun)
    $open = @($Issues | Where-Object { $_ -and (Get-IssueLabelNames $_) -contains 'loop:proposal' })
    $awaiting = @($open | Where-Object { $n = Get-IssueLabelNames $_; -not ($n -contains 'approved' -or $n -contains 'loop:failed') } |
            ForEach-Object { [int]$_.number } | Sort-Object)
    $free = [math]::Max(0, $Cap - $awaiting.Count)
    return [pscustomobject]@{ AwaitingReview = @($awaiting); Open = $open.Count; Cap = $Cap; Free = [int]$free; NewThisRun = [int][math]::Min($MaxNew, $free) }
}

# Failure classes. The session writes the class of every build failure as a marker line in its final
# failure comment (LOOP.md section 3, "Failure classes"); run-loop.ps1 writes timeout / max-turns /
# session-ended itself when the session stopped mid-build. Retryable = the cause was outside the change, so
# the same approved change may be built once more without the owner.
$script:RetryableFailures = [ordered]@{
    'ci-infra'           = 'CI infrastructure (a runner, network or GitHub problem, or a required job cancelled or never started)'
    'ci-timeout'         = 'CI did not finish in time (MERGE-PR CI-TIMEOUT)'
    'gap-refused'        = 'merge refused by the live-server gap rule (commits already on main, not this change)'
    'deploy-unavailable' = 'the elevated deploy task or its lock was unavailable'
    'out-of-time'        = 'the run ran out of time before the merge'
    'timeout'            = 'the run hit its time limit mid-build'
    'max-turns'          = 'the session hit its turn limit mid-build'
}
$script:ChangeFailures = [ordered]@{
    'tests'         = 'tests or CI still failed after the fix rounds'
    'guard-refused' = 'refused because of the change''s own diff (protected path, secret or CORS line, guard)'
    'scope'         = 'out of scope for the loop (rule 8, config, or too large for one run)'
    'deploy-failed' = 'deploy or live verification failed and was rolled back'
    'session-ended' = 'the session stopped mid-build with work that needs a look (e.g. merged but not verified)'
    'other'         = 'other failure'
}
$script:FailureMarkerRx = '<!--\s*innovation-loop:failure\s+class=([a-z][a-z-]*)\s+outcome=([a-z][a-z-]*)\s*-->'

function Format-FailureMarker {
    param([string]$Class, [string]$Outcome = 'failed')
    $c = "$Class".ToLowerInvariant(); if (-not ($script:RetryableFailures.Contains($c) -or $script:ChangeFailures.Contains($c))) { $c = 'other' }
    $o = "$Outcome".ToLowerInvariant(); if ($o -notin @('failed', 'rolled-back', 'skipped')) { $o = 'failed' }
    return "<!-- innovation-loop:failure class=$c outcome=$o -->"
}

# Failure markers in $Comments (issue comments API objects) written by -Owner with the loop -Marker, created
# after -Since (the approval being built). Oldest first. Comments by anyone else never count.
function Get-FailureRecords {
    param([object[]]$Comments, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', $Since = $null)
    $sinceT = $null; if ($Since) { $sinceT = [datetime]$Since }
    $out = @()
    foreach ($c in @($Comments | Where-Object { $_ } | Sort-Object { [datetime]$_.created_at })) {
        if ("$($c.user.login)" -ne $Owner) { continue }
        $b = "$($c.body)"; if (-not $b.Contains($Marker)) { continue }
        if ($sinceT -and ([datetime]$c.created_at) -le $sinceT) { continue }
        $m = [regex]::Match($b, $script:FailureMarkerRx)
        if (-not $m.Success) { continue }
        $out += [pscustomobject]@{ Class = $m.Groups[1].Value; Outcome = $m.Groups[2].Value; At = $c.created_at; Id = $c.id }
    }
    return @($out)
}

function Get-FailureDescription {
    param([string]$Class)
    if ($script:RetryableFailures.Contains($Class)) { return $script:RetryableFailures[$Class] }
    if ($script:ChangeFailures.Contains($Class)) { return $script:ChangeFailures[$Class] }
    return "unknown failure class '$Class'"
}

# May an approved issue carrying loop:failed be built again without the owner? Once, and only when the
# latest failure since the approval was outside the change and nothing went live. Returns Failed (has
# loop:failed), Retry, Class and Reason (for "failed, waiting on the owner: #n (<reason>)").
function Get-RetryDecision {
    param([string[]]$Labels, [object[]]$Failures)
    $fs = @($Failures | Where-Object { $_ })
    $last = $null; if ($fs.Count -gt 0) { $last = $fs[$fs.Count - 1] }
    $class = ''; if ($last) { $class = "$($last.Class)" }
    $failed = ($Labels -contains 'loop:failed')
    $mk = { param([bool]$Retry, [string]$Why) [pscustomobject]@{ Failed = $failed; Retry = $Retry; Class = $class; Reason = $Why } }
    if (-not $failed) { return (& $mk $false '') }
    if ($Labels -contains 'loop:retried') {
        $d = 'failed again after the one automatic retry'; if ($class) { $d = "${class}, after the one automatic retry: $(Get-FailureDescription $class)" }
        return (& $mk $false $d)
    }
    if (-not $last) { return (& $mk $false 'failure not classified (no failure marker); not retried automatically') }
    if ($fs.Count -gt 1) { return (& $mk $false "${class}, failed $($fs.Count) times since the approval: $(Get-FailureDescription $class)") }
    if ("$($last.Outcome)" -eq 'rolled-back') { return (& $mk $false "${class}, rolled back (something went live or main was reverted): $(Get-FailureDescription $class)") }
    if (-not $script:RetryableFailures.Contains($class)) { return (& $mk $false "${class}: $(Get-FailureDescription $class)") }
    return (& $mk $true "${class}: $(Get-FailureDescription $class); retried once automatically")
}

# The check run-loop.ps1 makes before starting claude (costs nothing). $Queue: the parsed check-approval.ps1
# -List output, or $null when that failed (then claude is launched as before). Launch = $false only when
# neither phase has anything to do.
function Get-PrecheckDecision {
    param($Queue, [string]$Mode = 'FULL')
    if ($Mode -eq 'PRODUCT_REVIEW') { return [pscustomobject]@{ Launch = $true; Reason = 'product review: always runs' } }
    if ($null -eq $Queue -or $null -eq $Queue.slots) { return [pscustomobject]@{ Launch = $true; Reason = 'queue check failed: launching claude as usual' } }
    $b = @($Queue.buildable | Where-Object { $null -ne $_ }).Count
    $free = [int]$Queue.slots.free
    $aw = @($Queue.slots.awaitingReview | Where-Object { $null -ne $_ }).Count
    $why = @()
    if ($Mode -eq 'FULL') { $why += "$b buildable approved issue(s)" } else { $why += "$Mode (no Phase A)" }
    $why += "$free free proposal slot(s) ($aw awaiting review, cap $($Queue.slots.cap))"
    $launch = (($Mode -eq 'FULL' -and $b -gt 0) -or $free -gt 0)
    return [pscustomobject]@{ Launch = $launch; Reason = ($why -join ', ') }
}

# "Failed, waiting on <owner>" for the run summary and the run-data comments: one line, '' when none.
function Format-WaitingOnOwner {
    param([object[]]$Waiting, [string]$Who = 'the owner')
    $w = @($Waiting | Where-Object { $_ })
    if ($w.Count -eq 0) { return '' }
    return "Failed, waiting on ${Who}: " + ((@($w | ForEach-Object { "#$($_.issue) ($($_.reason))" })) -join '; ') + '.'
}

# The session stopped (killed at the time limit, turn limit, or exited) while an issue still carried
# loop:in-progress. $EndClass: timeout | max-turns | session-ended. $MergeSha: set when merge-pr merged this
# issue in this run (then it is never retried: a merge that was not verified needs the owner).
function Get-UnfinishedFailure {
    param([string]$EndClass, [string]$MergeSha = '', [int]$TimeoutMinutes = 0, [string]$Who = 'the owner')
    $class = $EndClass; if ($class -notin @('timeout', 'max-turns')) { $class = 'session-ended' }
    if ($MergeSha) { $class = 'session-ended' }
    $what = 'The session ended while this issue was still being built.'
    if ($EndClass -eq 'timeout') { $what = "The run hit its $TimeoutMinutes-minute limit while this issue was being built, and the session was stopped." }
    if ($EndClass -eq 'max-turns') { $what = 'The session hit its turn limit while this issue was being built.' }
    if ($MergeSha) {
        $state = "The change was merged as $MergeSha, but its deploy was not verified in this run. It needs $Who to check the live site and server (and roll back with rollback.ps1 if needed); it is not retried automatically."
    } elseif ($script:RetryableFailures.Contains($class)) {
        $state = 'Nothing was merged, so the live site and server are unchanged. Because the cause was the run''s limit, not the change, the next run retries it once automatically; a PR it opened stays open.'
    } else {
        $state = "Nothing was merged, so the live site and server are unchanged. It is not retried automatically; it waits for $Who."
    }
    return [pscustomobject]@{ Class = $class; Synopsis = "$what $state" }
}

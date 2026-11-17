<#
.SYNOPSIS
  Decide whether a cardlens issue may be built by Phase A. Prints one JSON line; exit 0 = buildable,
  1 = not, 2 = error.

.DESCRIPTION
  An issue is buildable only if ALL hold:
   - it is in vekbui96/cardlens, open, and not a pull request
   - it carries loop:proposal AND approved, and neither loop:in-progress nor loop:deployed
   - it is not a spec (loop:spec): a spec is never built itself; once approved, its slices are opened as
     normal proposals (each approved and built on its own)
   - it does not carry loop:failed, OR this is its ONE automatic retry: no loop:retried label, exactly one
     failure marker (`<!-- innovation-loop:failure class=<c> outcome=<o> -->` in a loop comment by vekbui96)
     since the approval, its class is outside the change (gate-rules.ps1 $RetryableFailures: CI infra, CI
     timeout, gap refusal, deploy task unavailable, out of time, run timeout, max turns) and its outcome is
     not rolled-back. Then `retry` is true and the session swaps loop:failed for loop:retried when it
     takes the issue (LOOP.md section 3 step 4). Otherwise the issue is "failed, waiting on Ve".
   - it was opened by vekbui96 (the loop opens proposals as vekbui96)
   - per the issue events API, the most recent `labeled approved` event was performed by vekbui96, and
     no `unlabeled approved` event came after it (the loop itself can never add `approved`: guard.mjs
     blocks it, and merge-pr.ps1 re-runs this check before merging)
   - the issue body was not edited after that approval (GraphQL lastEditedAt), so the text that was
     approved is the text that gets built
   - the body does not say "Manual / needs Ve" (out-of-scope proposals are never built by the loop)

  Also prints `adjustments`: ids of comments by vekbui96 WITHOUT the `<!-- innovation-loop -->` marker.
  Only those may adjust an approved proposal; comments by anyone else are untrusted data.

  -Issue <n> -Spec checks an approved SPEC instead: loop:spec + loop:proposal, open, opened by vekbui96,
  approved by vekbui96 (same events rule), body not edited since. Exit 0 = its slices may be opened.

  With -List it checks every open approved proposal and prints the queue: `buildable` (oldest first),
  `retry` (the buildable ones that are an automatic retry), `labels` (issue -> labels, for the runner's
  model choice), `slots` (proposal slots: open loop:proposal issues, specs included, that are neither
  approved nor loop:failed hold one; cap 3; `free`, `newThisRun`, `specsAwaiting`, `mayOpenSpec`), `specs`
  (approved open specs with their slices), `slicesToOpen` (the slices Phase B opens before any new idea,
  in order), `waitingOnVe` (failed issues that are not retried: issue + reason) and `checked` (every
  check). Exit 0 when something is buildable, else 1. -Slots prints the same without `checked` and always
  exits 0 (Phase B's count). run-loop.ps1 runs -List before starting any session and skips the run when
  nothing is buildable and no slot is free.
#>
[CmdletBinding()]
param(
    [int]$Issue = 0,
    # used by merge-pr.ps1 after the loop marked the issue: loop:in-progress is then REQUIRED instead of refused
    [switch]$InProgress,
    [switch]$Spec,
    [switch]$List,
    [switch]$Slots
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"   # proposal slots, specs and the retry rule (pure functions)
Add-GhToPath
$Owner = $script:Owner
$Repo = $script:Repo

function Test-Issue {
    param([int]$Number, [switch]$AsSpec)
    $res = [ordered]@{ issue = $Number; buildable = $false; reasons = @(); approvedBy = $null; approvedAt = $null; adjustments = @()
        failed = $false; retry = $false; failure = ''; retryReason = ''; waitingReason = ''; labels = @(); spec = $false }
    $i = Get-GhJson @('api', "repos/$Repo/issues/$Number")
    $labels = @($i.labels | ForEach-Object { $_.name })
    $res.labels = $labels
    $res.spec = ($labels -contains $script:SpecLabel)
    if ($i.PSObject.Properties.Name -contains 'pull_request' -and $i.pull_request) { $res.reasons += 'is a pull request' }
    if ($i.state -ne 'open') { $res.reasons += "state is $($i.state)" }
    if ($i.user.login -ne $Owner) { $res.reasons += "opened by $($i.user.login), not $Owner" }
    foreach ($need in 'loop:proposal', 'approved') { if ($labels -notcontains $need) { $res.reasons += "missing label $need" } }
    if ($labels -contains 'loop:deployed') { $res.reasons += 'has label loop:deployed' }
    if ($AsSpec) {
        if (-not $res.spec) { $res.reasons += "missing label $($script:SpecLabel)" }
    } else {
        if ($res.spec) { $res.reasons += 'is a spec (loop:spec): never built itself; its slices are opened as proposals and built one by one' }
        if ($InProgress) { if ($labels -notcontains 'loop:in-progress') { $res.reasons += 'missing label loop:in-progress' } }
        elseif ($labels -contains 'loop:in-progress') { $res.reasons += 'has label loop:in-progress' }
        if ("$($i.body)" -match '(?im)^\s*\**\s*(manual\s*/\s*needs\s+ve|manual step required)') { $res.reasons += 'proposal is flagged manual / needs Ve; the loop never builds it' }
    }

    $events = @()
    $page = 1
    do {
        $batch = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/events?per_page=100&page=$page"))
        $events += $batch; $page++
    } while ($batch.Count -eq 100 -and $page -lt 10)
    $approvalEvents = @($events | Where-Object { ($_.event -eq 'labeled' -or $_.event -eq 'unlabeled') -and $_.label -and $_.label.name -eq 'approved' })
    $lastLabeled = $approvalEvents | Where-Object { $_.event -eq 'labeled' } | Select-Object -Last 1
    if (-not $lastLabeled) { $res.reasons += 'no labeled-approved event found' }
    else {
        $res.approvedBy = $lastLabeled.actor.login
        $res.approvedAt = $lastLabeled.created_at
        if ($lastLabeled.actor.login -ne $Owner) { $res.reasons += "approved label added by $($lastLabeled.actor.login), not $Owner" }
        $later = @($approvalEvents | Where-Object { $_.event -eq 'unlabeled' -and [datetime]$_.created_at -gt [datetime]$lastLabeled.created_at })
        if ($later.Count -gt 0) { $res.reasons += 'approved label was removed after it was added' }
        $q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){lastEditedAt}}}'
        $g = Get-GhJson @('api', 'graphql', '-f', "query=$q", '-F', "o=$Owner", '-F', 'r=cardlens', '-F', "n=$Number")
        $edited = $g.data.repository.issue.lastEditedAt
        if ($edited -and ([datetime]$edited -gt [datetime]$lastLabeled.created_at)) { $res.reasons += "issue body edited at $edited, after approval; re-approve (remove and re-add approved) to build it" }
    }

    $comments = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/comments?per_page=100"))
    $res.adjustments = @($comments | Where-Object { $_.user.login -eq $Owner -and -not ($_.body -and $_.body.Contains($script:Marker)) } | ForEach-Object { $_.id })

    if (-not $AsSpec) {
        # loop:failed: buildable again only as the ONE automatic retry of a failure outside the change
        # (gate-rules.ps1 Get-RetryDecision; the failure markers count only when written after this approval).
        $failures = @(); if ($res.approvedAt) { $failures = @(Get-FailureRecords -Comments $comments -Owner $Owner -Marker $script:Marker -Since $res.approvedAt) }
        $rd = Get-RetryDecision -Labels $labels -Failures $failures
        $res.failed = $rd.Failed; $res.failure = $rd.Class
        if ($rd.Failed) {
            if ($rd.Retry) { $res.retry = $true; $res.retryReason = $rd.Reason }
            else { $res.reasons += "has label loop:failed ($($rd.Reason))"; $res.waitingReason = $rd.Reason }
        }
    }
    $res.buildable = ($res.reasons.Count -eq 0)
    return $res
}

# The queue as one object: buildable issues (oldest first; retries flagged), proposal slots (the ONE cap
# rule, gate-rules.ps1 Get-ProposalSlots), approved specs and the slices still to open, and the failed issues
# waiting on Ve.
function Get-Queue {
    $open = @(Get-GhJson @('issue', 'list', '-R', $Repo, '--state', 'open', '--label', 'loop:proposal', '--json', 'number,labels,createdAt', '--limit', '100') | Where-Object { $_ })
    $slots = Get-ProposalSlots -Issues $open
    $results = @()
    $approved = @($open | Where-Object { $l = Get-IssueLabelNames $_; ($l -contains 'approved') -and ($l -notcontains $script:SpecLabel) } | Sort-Object { [datetime]$_.createdAt })
    foreach ($o in $approved) { $results += (Test-Issue -Number $o.number) }
    $ok = @($results | Where-Object { $_.buildable })
    $waiting = @($results | Where-Object { $_.failed -and -not $_.buildable } | ForEach-Object {
            $why = $_.waitingReason; if (-not $why) { $why = ($_.reasons -join '; ') }
            [ordered]@{ issue = $_.issue; reason = $why } })
    $labels = [ordered]@{}; foreach ($r in $ok) { $labels["$($r.issue)"] = @($r.labels) }

    # approved specs: verify each approval like a build's, then work out its slices from every loop proposal
    $specs = @(); $toOpen = @()
    $approvedSpecs = @($open | Where-Object { $l = Get-IssueLabelNames $_; ($l -contains 'approved') -and ($l -contains $script:SpecLabel) } | Sort-Object { [datetime]$_.createdAt })
    if ($approvedSpecs.Count -gt 0) {
        $all = @(Get-GhJson @('issue', 'list', '-R', $Repo, '--state', 'all', '--label', 'loop:proposal', '--json', 'number,state,labels,body,author', '--limit', '300') | Where-Object { $_ })
        foreach ($s in $approvedSpecs) {
            $chk = Test-Issue -Number $s.number -AsSpec
            $body = @($all | Where-Object { [int]$_.number -eq [int]$s.number } | Select-Object -First 1)
            $entry = [ordered]@{ issue = [int]$s.number; approved = [bool]$chk.buildable; reasons = @($chk.reasons); of = 0; valid = $false; problem = ''; complete = $false; slices = @(); toOpen = @() }
            if ($chk.buildable -and $body.Count -gt 0) {
                $plan = Get-SpecPlan -Spec $body[0] -Issues $all -Owner $Owner -Marker $script:Marker
                $entry.of = $plan.Of; $entry.valid = $plan.Valid; $entry.problem = $plan.Problem; $entry.complete = $plan.Complete
                $entry.slices = @($plan.Slices | ForEach-Object { [ordered]@{ k = $_.K; title = $_.Title; issue = $_.Issue; status = $_.Status; done = $_.Done } })
                $entry.toOpen = @($plan.ToOpen | ForEach-Object { [ordered]@{ k = $_.K; title = $_.Title } })
                foreach ($t in $plan.ToOpen) { $toOpen += [ordered]@{ spec = [int]$s.number; k = $t.K; of = $plan.Of; title = $t.Title } }
            }
            $specs += $entry
        }
    }
    return [ordered]@{
        buildable    = @($ok | ForEach-Object { $_.issue })
        retry        = @($ok | Where-Object { $_.retry } | ForEach-Object { $_.issue })
        labels       = $labels
        slots        = [ordered]@{ awaitingReview = @($slots.AwaitingReview); open = $slots.Open; cap = $slots.Cap; free = $slots.Free; newThisRun = $slots.NewThisRun
            specsAwaiting = @($slots.SpecsAwaiting); mayOpenSpec = $slots.MayOpenSpec }
        specs        = @($specs)
        slicesToOpen = @($toOpen)
        waitingOnVe  = @($waiting)
        checked      = $results
    }
}

try {
    if ($List -or $Slots) {
        $q = Get-Queue
        if ($Slots) { $q.Remove('checked') }
        Write-Output ($q | ConvertTo-Json -Depth 8 -Compress)
        if ($Slots -or $q.buildable.Count -gt 0) { exit 0 } else { exit 1 }
    }
    if ($Issue -le 0) { throw 'pass -Issue <n> [-Spec], -List or -Slots' }
    $r = Test-Issue -Number $Issue -AsSpec:$Spec
    Write-Output ($r | ConvertTo-Json -Depth 5 -Compress)
    if ($r.buildable) { exit 0 } else { exit 1 }
} catch {
    Write-Output (@{ error = "$_" } | ConvertTo-Json -Compress)
    exit 2
}

<#
.SYNOPSIS
  Decide whether a cardlens issue may be built by Phase A. Prints one JSON line; exit 0 = buildable,
  1 = not, 2 = error.

.DESCRIPTION
  An issue is buildable only if ALL hold:
   - it is in vekbui96/cardlens, open, and not a pull request
   - it carries loop:proposal AND approved, and neither loop:in-progress nor loop:deployed; OR it is a slice
     AUTO-APPROVED through its approved spec (gate-rules.ps1 Get-ViaSpecDecision: spec approved by vekbui96
     and not held, slice opened by the loop after that approval in the loop's format and matching the spec's
     ## Slices list, earlier slices not failed / manual, not Manual, not loop:failed, never edited, not held
     by a `/hold` comment, no `approved` events of its own). Then `approval` is `via-spec` and `viaSpec` the
     spec number; the approval rules below are the spec's, already checked
   - it is not a spec (loop:spec): a spec is never built itself; once approved, its slices are opened as
     normal proposals (built on the spec's approval, or each on its own `approved`)
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

  With -List it checks every open approved proposal, and every open slice of an approved spec, and prints
  the queue: `viaSpec` (the auto-approved slices: issue, spec, specApprovedAt, noticed = the runner's one
  "Auto-approved via spec" comment is there), `approvals` (issue -> `label` | `via-spec #<spec>`), `buildable` (oldest first),
  `retry` (the buildable ones that are an automatic retry), `labels` (issue -> labels, for the runner's
  model choice), `slots` (proposal slots: open loop:proposal issues, specs included, that are neither
  approved nor loop:failed hold one; cap 5; `free`, `newThisRun`, `specsAwaiting`, `mayOpenSpec`), `specs`
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

$script:Fetched = @{}        # issue number -> @{ Issue; Comments } (fetched once per process)
$script:SpecChecks = @{}     # spec number -> Test-Issue -AsSpec result
$script:AllProposals = $null # every loop:proposal issue, open and closed (spec plans, earlier slices)

function Get-AllProposals {
    if ($null -eq $script:AllProposals) {
        $script:AllProposals = @(Get-GhJson @('issue', 'list', '-R', $Repo, '--state', 'all', '--label', 'loop:proposal', '--json', 'number,title,state,labels,body,author,createdAt', '--limit', '300') | Where-Object { $_ })
    }
    return $script:AllProposals
}

function Get-LastEditedAt {
    param([int]$Number)
    $q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){lastEditedAt}}}'
    $g = Get-GhJson @('api', 'graphql', '-f', "query=$q", '-F', "o=$Owner", '-F', 'r=cardlens', '-F', "n=$Number")
    return "$($g.data.repository.issue.lastEditedAt)"
}

# A slice without its own `approved`: is it auto-approved through its spec? (gate-rules.ps1 Get-ViaSpecDecision)
function Test-ViaSpec {
    param($Issue, [object[]]$Comments, [int]$ApprovalEvents)
    $link = Get-SliceLink -Body "$($Issue.body)"
    $sn = [int]$link.Spec
    if (-not $script:SpecChecks.ContainsKey($sn)) {
        try { $script:SpecChecks[$sn] = Test-Issue -Number $sn -AsSpec } catch { $script:SpecChecks[$sn] = [ordered]@{ buildable = $false; approvedAt = $null; reasons = @("cannot read #${sn}: $_") } }
    }
    $chk = $script:SpecChecks[$sn]
    $spec = $null; $specComments = @()
    if ($script:Fetched.ContainsKey($sn)) { $spec = $script:Fetched[$sn].Issue; $specComments = @($script:Fetched[$sn].Comments) }
    $edited = Get-LastEditedAt -Number ([int]$Issue.number)
    return (Get-ViaSpecDecision -Slice $Issue -SliceEditedAt $edited -SliceComments $Comments -SliceApprovalEvents $ApprovalEvents `
            -Spec $spec -SpecCheck $chk -SpecComments $specComments -Issues (Get-AllProposals) -Owner $Owner -Marker $script:Marker)
}

function Test-Issue {
    param([int]$Number, [switch]$AsSpec)
    $res = [ordered]@{ issue = $Number; buildable = $false; reasons = @(); approvedBy = $null; approvedAt = $null; adjustments = @()
        failed = $false; retry = $false; failure = ''; retryReason = ''; waitingReason = ''; labels = @(); spec = $false
        approval = 'label'; viaSpec = 0; viaSpecNoticed = $false; viaSpecReasons = @(); waitingOnSlice = $null }
    $i = Get-GhJson @('api', "repos/$Repo/issues/$Number")
    $labels = @($i.labels | ForEach-Object { $_.name })
    $res.labels = $labels
    $res.spec = ($labels -contains $script:SpecLabel)

    $events = @()
    $page = 1
    do {
        $batch = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/events?per_page=100&page=$page"))
        $events += $batch; $page++
    } while ($batch.Count -eq 100 -and $page -lt 10)
    $approvalEvents = @($events | Where-Object { ($_.event -eq 'labeled' -or $_.event -eq 'unlabeled') -and $_.label -and $_.label.name -eq 'approved' })
    $comments = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/comments?per_page=100"))
    $script:Fetched[$Number] = @{ Issue = $i; Comments = $comments }

    # no `approved` of its own: a slice may still be auto-approved through its approved spec
    $via = $null
    if (-not $AsSpec -and $labels -notcontains 'approved' -and -not $res.spec -and (Get-SliceLink -Body "$($i.body)")) {
        $via = Test-ViaSpec -Issue $i -Comments $comments -ApprovalEvents $approvalEvents.Count
        $res.viaSpecReasons = @($via.Reasons)
        if ($via.Eligible) {
            $res.approval = 'via-spec'; $res.viaSpec = [int]$via.Spec
            $res.viaSpecNoticed = (@($comments | Where-Object { "$($_.user.login)" -eq $Owner -and "$($_.body)".Contains($script:Marker) -and "$($_.body)".Contains($script:ViaSpecMarker) }).Count -gt 0)
        }
    }
    $isVia = ($res.approval -eq 'via-spec')

    if ($i.PSObject.Properties.Name -contains 'pull_request' -and $i.pull_request) { $res.reasons += 'is a pull request' }
    if ($i.state -ne 'open') { $res.reasons += "state is $($i.state)" }
    if ($i.user.login -ne $Owner) { $res.reasons += "opened by $($i.user.login), not $Owner" }
    foreach ($need in 'loop:proposal', 'approved') {
        if ($need -eq 'approved' -and $isVia) { continue }
        if ($labels -notcontains $need) { $res.reasons += "missing label $need" }
    }
    if ($via -and -not $isVia) { $res.reasons += "not auto-approved via spec #$($via.Spec): $(@($via.Reasons) -join '; ')" }
    if ($labels -contains 'loop:deployed') { $res.reasons += 'has label loop:deployed' }
    if ($AsSpec) {
        if (-not $res.spec) { $res.reasons += "missing label $($script:SpecLabel)" }
    } else {
        if ($res.spec) { $res.reasons += 'is a spec (loop:spec): never built itself; its slices are opened as proposals and built one by one' }
        if ($InProgress) { if ($labels -notcontains 'loop:in-progress') { $res.reasons += 'missing label loop:in-progress' } }
        elseif ($labels -contains 'loop:in-progress') { $res.reasons += 'has label loop:in-progress' }
        if ("$($i.body)" -match $script:ManualRx) { $res.reasons += 'proposal is flagged manual / needs Ve; the loop never builds it' }
    }

    if ($isVia) {
        # the approval is the spec's, verified by Test-Issue -AsSpec inside Get-ViaSpecDecision (and the slice
        # body was never edited, checked there)
        $res.approvedBy = $Owner
        $res.approvedAt = $via.SpecApprovedAt
    } else {
        $lastLabeled = $approvalEvents | Where-Object { $_.event -eq 'labeled' } | Select-Object -Last 1
        if (-not $lastLabeled) { $res.reasons += 'no labeled-approved event found' }
        else {
            $res.approvedBy = $lastLabeled.actor.login
            $res.approvedAt = $lastLabeled.created_at
            if ($lastLabeled.actor.login -ne $Owner) { $res.reasons += "approved label added by $($lastLabeled.actor.login), not $Owner" }
            $later = @($approvalEvents | Where-Object { $_.event -eq 'unlabeled' -and [datetime]$_.created_at -gt [datetime]$lastLabeled.created_at })
            if ($later.Count -gt 0) { $res.reasons += 'approved label was removed after it was added' }
            $edited = Get-LastEditedAt -Number $Number
            if ($edited -and ([datetime]$edited -gt [datetime]$lastLabeled.created_at)) { $res.reasons += "issue body edited at $edited, after approval; re-approve (remove and re-add approved) to build it" }
        }
    }

    $res.adjustments = @($comments | Where-Object { $_.user.login -eq $Owner -and -not ($_.body -and $_.body.Contains($script:Marker)) } | ForEach-Object { $_.id })

    if (-not $AsSpec) {
        # loop:failed: buildable again only as the ONE automatic retry of a failure outside the change
        # (gate-rules.ps1 Get-RetryDecision; the failure markers count only when written after this approval).
        # A slice that is only auto-approved never gets here with loop:failed (it is then not auto-approved).
        $failures = @(); if ($res.approvedAt) { $failures = @(Get-FailureRecords -Comments $comments -Owner $Owner -Marker $script:Marker -Since $res.approvedAt) }
        $rd = Get-RetryDecision -Labels $labels -Failures $failures
        $res.failed = $rd.Failed; $res.failure = $rd.Class
        if ($rd.Failed -and $via -and $labels -notcontains 'approved') {
            $res.waitingReason = "auto-approved slice of spec #$($via.Spec) failed$(if ($rd.Class) { " ($($rd.Class))" }); no automatic retry: remove loop:failed to rebuild it, or close it"
        } elseif ($rd.Failed) {
            if ($rd.Retry) { $res.retry = $true; $res.retryReason = $rd.Reason }
            else { $res.reasons += "has label loop:failed ($($rd.Reason))"; $res.waitingReason = $rd.Reason }
        }
        # otherwise buildable, but a slice whose earlier slice of the same spec is open and Manual waits for it
        # (gate-rules.ps1 Get-SliceWaitDecision): skipped by the runner, labels untouched, one notice. Not for
        # -InProgress (merge-pr.ps1): a build that already started is not stopped by this rule.
        if (-not $InProgress -and $res.reasons.Count -eq 0 -and (Get-SliceLink -Body "$($i.body)")) {
            $wd = Get-SliceWaitDecision -Issue $i -Issues (Get-AllProposals) -Owner $Owner -Marker $script:Marker
            if ($wd.Waiting) {
                $res.reasons += $wd.Reason
                $res.waitingOnSlice = [ordered]@{ issue = $Number; spec = [int]$wd.Spec; k = [int]$wd.K
                    blockers = @($wd.Blockers | ForEach-Object { [ordered]@{ k = $_.K; issue = $_.Issue } })
                    noticed = [bool](Test-SliceWaitNoticed -Comments $comments -Owner $Owner -Marker $script:Marker) }
            }
        }
    }
    $res.buildable = ($res.reasons.Count -eq 0)
    return $res
}

# The queue as one object: buildable issues (oldest first; retries flagged; label-approved and auto-approved
# slices alike), proposal slots (the ONE cap rule, gate-rules.ps1 Get-ProposalSlots; auto-approved slices hold
# none), approved specs and the slices still to open, and the failed issues waiting on Ve.
function Get-Queue {
    $open = @(Get-GhJson @('issue', 'list', '-R', $Repo, '--state', 'open', '--label', 'loop:proposal', '--json', 'number,labels,createdAt,body', '--limit', '100') | Where-Object { $_ })
    $results = @()
    $approved = @($open | Where-Object { $l = Get-IssueLabelNames $_; ($l -contains 'approved') -and ($l -notcontains $script:SpecLabel) })

    # approved specs: verify each approval like a build's, then work out its slices from every loop proposal
    $specs = @(); $toOpen = @(); $approvedSpecNums = @()
    $approvedSpecs = @($open | Where-Object { $l = Get-IssueLabelNames $_; ($l -contains 'approved') -and ($l -contains $script:SpecLabel) } | Sort-Object { [datetime]$_.createdAt })
    if ($approvedSpecs.Count -gt 0) {
        $all = Get-AllProposals
        foreach ($s in $approvedSpecs) {
            $chk = Test-Issue -Number $s.number -AsSpec
            $script:SpecChecks[[int]$s.number] = $chk
            $body = @($all | Where-Object { [int]$_.number -eq [int]$s.number } | Select-Object -First 1)
            $entry = [ordered]@{ issue = [int]$s.number; approved = [bool]$chk.buildable; approvedAt = "$($chk.approvedAt)"; reasons = @($chk.reasons); of = 0; valid = $false; problem = ''; complete = $false; slices = @(); toOpen = @() }
            if ($chk.buildable) { $approvedSpecNums += [int]$s.number }
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

    # open slices of approved specs without their own `approved`: candidates for auto-approval
    $candidates = @($open | Where-Object {
            $l = Get-IssueLabelNames $_
            $lk = Get-SliceLink -Body "$($_.body)"
            ($l -notcontains 'approved') -and ($l -notcontains $script:SpecLabel) -and $lk -and ($approvedSpecNums -contains [int]$lk.Spec) })

    foreach ($o in @(@($approved) + @($candidates) | Sort-Object { [datetime]$_.createdAt })) { $results += (Test-Issue -Number $o.number) }
    $ok = @($results | Where-Object { $_.buildable })
    $via = @($results | Where-Object { $_.approval -eq 'via-spec' })
    $waitSlice = @($results | Where-Object { $_.waitingOnSlice } | ForEach-Object { $_.waitingOnSlice })
    $waiting = @($results | Where-Object { $_.failed -and -not $_.buildable -and -not $_.waitingOnSlice } | ForEach-Object {
            $why = $_.waitingReason; if (-not $why) { $why = ($_.reasons -join '; ') }
            [ordered]@{ issue = $_.issue; reason = $why } })
    $labels = [ordered]@{}; foreach ($r in $ok) { $labels["$($r.issue)"] = @($r.labels) }
    $approvals = [ordered]@{}; foreach ($r in $ok) { $approvals["$($r.issue)"] = $(if ($r.approval -eq 'via-spec') { "via-spec #$($r.viaSpec)" } else { 'label' }) }
    $slots = Get-ProposalSlots -Issues $open -ApprovedViaSpec @($via | ForEach-Object { [int]$_.issue })

    # show auto-approved slices as such on the spec checklists
    foreach ($e in $specs) {
        foreach ($sl in @($e.slices)) {
            $v = @($via | Where-Object { [int]$_.issue -eq [int]$sl.issue })
            if ($v.Count -gt 0 -and $sl.status -eq 'awaiting review') {
                $sl.status = $(if ($v[0].buildable) { 'auto-approved via this spec, waiting to be built' } else { 'auto-approved via this spec' })
            }
        }
    }
    return [ordered]@{
        buildable    = @($ok | ForEach-Object { $_.issue })
        retry        = @($ok | Where-Object { $_.retry } | ForEach-Object { $_.issue })
        labels       = $labels
        approvals    = $approvals
        viaSpec      = @($via | ForEach-Object { [ordered]@{ issue = $_.issue; spec = $_.viaSpec; specApprovedAt = "$($_.approvedAt)"; buildable = [bool]$_.buildable; noticed = [bool]$_.viaSpecNoticed } })
        slots        = [ordered]@{ awaitingReview = @($slots.AwaitingReview); open = $slots.Open; cap = $slots.Cap; free = $slots.Free; newThisRun = $slots.NewThisRun
            specsAwaiting = @($slots.SpecsAwaiting); mayOpenSpec = $slots.MayOpenSpec }
        specs        = @($specs)
        slicesToOpen = @($toOpen)
        waitingOnVe  = @($waiting)
        waitingOnSlice = @($waitSlice)
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

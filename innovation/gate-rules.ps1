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
  Get-SpecPlan        an approved spec's slices: opened, still to open, done? (Format-SpecProgress: its checklist)
  Get-ViaSpecDecision is a slice of an approved spec buildable without its own `approved` (auto-approved)?
  Get-SliceWaitDecision  does a slice wait on an open Manual earlier slice of its spec (skipped, never failed)?
  Get-RetryDecision   may an approved issue with loop:failed get its one automatic retry?
  Get-PrecheckDecision  does this run have anything to do at all, before claude is started?
  Get-PlanBudgetVerdict / Test-BudgetAllowsModel / Split-BuildableByBudget  the ops hub's plan-budget
                      verdict (normal | no-opus | hold; fails open) and which sessions it lets start
  Get-LoopMdSections / Get-SessionConfig / Get-SessionModel  one session per job: its prompt, model, caps
  Get-BuildModelChoice / Test-ProposalNeedsServer  Sonnet or Opus for one build (Opus: model:opus, server, retry)
  Get-RunTimeBudget   the run's minutes, kept inside the scheduled task's ExecutionTimeLimit
  Get-NextBuildDecision  may the runner start another build session?
  Get-DrainDecision / New-DrainState  the approval watcher's queue drain (literal copy in the watcher)
  Get-BuildOutcome / Get-DeployCertainty  how did a build session end; did it leave the deploy state certain?
  Get-RunResult       the run's LOOP-RESULT over all its sessions
  Format-WaitCiLine / Get-CiLogTail  wait-ci.ps1's result line and log tail
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
$script:ProposalCap = 5     # the approval watcher's $Loops entry for this loop carries the same Cap
$script:MaxNewPerRun = 3
$script:SpecLabel = 'loop:spec'
$script:MaxOpenSpecs = 1    # unapproved specs open at the same time

function Get-IssueLabelNames {
    param($Issue)
    return @(@($Issue.labels) | Where-Object { $_ } | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.name)" } })
}

# $Issues: open loop:proposal issues (gh issue list --json number,labels). Returns AwaitingReview (numbers),
# Open, Cap, Free (slots left, never below 0) and NewThisRun (min(MaxNewPerRun, Free)).
# A spec (loop:spec, which also carries loop:proposal) is ONE proposal: it holds one slot while it awaits
# review, like any proposal, and none once approved (its slices then hold slots as they are opened).
# SpecsAwaiting lists the unapproved open specs; MayOpenSpec says whether this run may open a new spec (at most
# $MaxOpenSpecs unapproved specs at a time, and only with a free slot).
# -ApprovedViaSpec: slices auto-approved through their approved spec (Get-ViaSpecDecision); they are build
# queue, not review, so they hold no slot either. (The approval watcher's literal copy does not know them and
# counts them as awaiting review: its refill is only ever more cautious than the loop.)
function Get-ProposalSlots {
    param([object[]]$Issues, [int]$Cap = $script:ProposalCap, [int]$MaxNew = $script:MaxNewPerRun, [int]$MaxSpecs = $script:MaxOpenSpecs,
        [int[]]$ApprovedViaSpec = @(), [int[]]$RequestChildren = @())
    # -RequestChildren: issues the intake session opened for one of Ve's requests (listed in its plan); they are
    # Ve's own work, not discovery, so they hold no slot either.
    $open = @($Issues | Where-Object { $_ -and (Get-IssueLabelNames $_) -contains 'loop:proposal' })
    $viaSpec = @(@($ApprovedViaSpec) + @($RequestChildren) | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ })
    $awaitingIssues = @($open | Where-Object { $n = Get-IssueLabelNames $_; -not ($n -contains 'approved' -or $n -contains 'loop:failed' -or $viaSpec -contains [int]$_.number) })
    $awaiting = @($awaitingIssues | ForEach-Object { [int]$_.number } | Sort-Object)
    $specs = @($awaitingIssues | Where-Object { (Get-IssueLabelNames $_) -contains $script:SpecLabel } | ForEach-Object { [int]$_.number } | Sort-Object)
    $free = [math]::Max(0, $Cap - $awaiting.Count)
    $newThisRun = [int][math]::Min($MaxNew, $free)
    return [pscustomobject]@{ AwaitingReview = @($awaiting); Open = $open.Count; Cap = $Cap; Free = [int]$free; NewThisRun = $newThisRun
        SpecsAwaiting = @($specs); MayOpenSpec = ($newThisRun -gt 0 -and $specs.Count -lt $MaxSpecs) }
}

# ==================================================================================================
# Specs (loop:spec + loop:proposal): a one-page spec for a feature too big for one proposal. It is never
# built itself (check-approval.ps1 refuses it). Once the owner approves it, Phase B opens its slices, in
# order, as normal loop:proposal issues whose body carries "Part of #<spec> (slice <k> of <m>)"; they take
# proposal slots before any new idea. The runner keeps a "## Spec progress" checklist comment on the spec
# and closes the spec once every slice has been opened and is closed (deployed, or closed by the owner).
# ==================================================================================================
$script:SliceLinkRx = '(?im)^[ \t>*_]*Part of #(\d+)[ \t]*\(slice[ \t]+(\d+)[ \t]+of[ \t]+(\d+)\)'
$script:SpecProgressMarker = '<!-- innovation-loop:spec-progress -->'

# One line of text made safe for a comment: no HTML comments (cannot forge a marker), no @mentions, no
# newlines, bounded.
function ConvertTo-SafeLine {
    param([string]$Text, [int]$Max = 100)
    $t = ("$Text" -replace '[\r\n\t]+', ' ').Trim()
    $t = $t -replace '<!--', '&lt;!--' -replace '-->', '--&gt;' -replace '@', '&#64;'
    if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max - 3) + '...' }
    return $t
}

# Comments that interactive Claude agents (not the loop) post as the owner carry this marker. They are neither
# Ve's own words (never an adjustment, never a decision) nor the loop's output (never a loop notice, failure
# marker or plan comment), even when they also quote the loop marker. A /hold still counts (fail-safe).
$script:AgentMarker = '<!-- claude-agent -->'
function Test-AgentComment { param($Comment) return "$($Comment.body)".Contains($script:AgentMarker) }
# The owner's comment ids that may adjust an approved proposal: by -Owner, without the loop marker, not an agent's.
function Get-OwnerAdjustmentIds {
    param([object[]]$Comments = @(), [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    return @($Comments | Where-Object { $_ -and "$($_.user.login)" -eq $Owner -and -not "$($_.body)".Contains($Marker) -and -not (Test-AgentComment $_) } | ForEach-Object { $_.id })
}

# The planned slices of a spec body: the numbered items of its "## Slices" section ("1. **Title**: ..."), in
# order. Returns K and Title; an item without bold text is titled by its text up to the first ': ' / ' - '.
function Get-SpecSlices {
    param([string]$Body)
    $m = [regex]::Match("$Body", '(?ims)^##[ \t]+Slices\b[^\r\n]*\r?\n(.*?)(?=^##[ \t]|\z)')
    if (-not $m.Success) { return @() }
    $out = @(); $seen = @{}
    foreach ($l in ($m.Groups[1].Value -split "`r?`n")) {
        $x = [regex]::Match($l, '^ ?(\d+)[.)][ \t]+(.+)$')
        if (-not $x.Success) { continue }
        $k = [int]$x.Groups[1].Value
        if ($seen.ContainsKey($k)) { continue }
        $seen[$k] = $true
        $t = $x.Groups[2].Value.Trim()
        $b = [regex]::Match($t, '^\*\*(.+?)\*\*')
        if ($b.Success) { $t = $b.Groups[1].Value } else { $t = ($t -split ':\s|\s-\s', 2)[0] }
        $out += [pscustomobject]@{ K = $k; Title = (ConvertTo-SafeLine $t.Trim(' *_`') 100) }
    }
    return @($out | Sort-Object K)
}

# "Part of #<spec> (slice <k> of <m>)" in a proposal body, or $null.
function Get-SliceLink {
    param([string]$Body)
    $m = [regex]::Match("$Body", $script:SliceLinkRx)
    if (-not $m.Success) { return $null }
    return [pscustomobject]@{ Spec = [int]$m.Groups[1].Value; K = [int]$m.Groups[2].Value; Of = [int]$m.Groups[3].Value }
}

function Get-SliceStatus {
    param($Issue)
    $l = Get-IssueLabelNames $Issue
    if ("$($Issue.state)" -match '^(?i)closed$') { if ($l -contains 'loop:deployed') { return 'deployed' } else { return 'closed without building' } }
    if ($l -contains 'loop:in-progress') { return 'being built' }
    if ($l -contains 'loop:failed') { return 'failed, waiting on the owner' }
    if ($l -contains 'approved') { return 'approved, waiting to be built' }
    return 'awaiting review'
}

# The state of one spec. $Spec: the spec issue (number, body). $Issues: loop:proposal issues, open AND closed
# (number, state, labels, body, author). Only issues opened by -Owner whose body carries the loop -Marker and
# a slice link to this spec count as its slices. Returns Issue, Slices (K, Title, Issue, Status, Done),
# ToOpen (planned slices with no issue yet, in order), Complete (every planned slice opened and closed),
# Valid / Problem (a spec without a parsable "## Slices" list cannot be sliced) and Duplicates.
function Get-SpecPlan {
    param($Spec, [object[]]$Issues, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    $n = [int]$Spec.number
    $planned = @(Get-SpecSlices -Body "$($Spec.body)")
    $linked = @()
    foreach ($i in @($Issues | Where-Object { $_ })) {
        if ([int]$i.number -eq $n) { continue }
        if ((Get-IssueLabelNames $i) -contains $script:SpecLabel) { continue }
        $author = ''; if ($i.author) { $author = "$($i.author.login)" } elseif ($i.user) { $author = "$($i.user.login)" }
        if ($author -ne $Owner) { continue }
        if (-not "$($i.body)".Contains($Marker)) { continue }
        $lk = Get-SliceLink -Body "$($i.body)"
        if ($lk -and $lk.Spec -eq $n) { $linked += [pscustomobject]@{ K = $lk.K; Issue = $i } }
    }
    $items = @(); $dups = @()
    foreach ($p in $planned) {
        $c = @($linked | Where-Object { $_.K -eq $p.K } | ForEach-Object { $_.Issue })
        if ($c.Count -gt 1) { $dups += $p.K }
        # an open issue for the slice wins (it is the live one); otherwise the newest closed one
        $pick = @(@($c | Where-Object { "$($_.state)" -match '^(?i)open$' } | Sort-Object { [int]$_.number }) + @($c | Sort-Object { [int]$_.number } -Descending))
        $iss = $null; if ($pick.Count -gt 0) { $iss = $pick[0] }
        $status = 'not opened yet'; $num = 0; $done = $false
        if ($iss) { $num = [int]$iss.number; $status = Get-SliceStatus $iss; $done = ("$($iss.state)" -match '^(?i)closed$') }
        $items += [pscustomobject]@{ K = $p.K; Title = $p.Title; Issue = $num; Status = $status; Done = $done }
    }
    $problem = ''
    if ($planned.Count -eq 0) { $problem = 'no numbered list under a "## Slices" heading, so there is nothing to open' }
    $toOpen = @($items | Where-Object { $_.Issue -eq 0 })
    $complete = ($planned.Count -gt 0 -and @($items | Where-Object { -not $_.Done }).Count -eq 0)
    return [pscustomobject]@{ Issue = $n; Of = $planned.Count; Slices = @($items); ToOpen = @($toOpen); Complete = $complete; Valid = (-not $problem); Problem = $problem; Duplicates = @($dups) }
}

# The "## Spec progress" checklist comment the runner keeps on an approved spec (edited in place).
function Format-SpecProgress {
    param($Plan, [string]$RunId = '', [string]$Marker = '<!-- innovation-loop -->', [string]$Who = 'the owner')
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:SpecProgressMarker)
    [void]$sb.AppendLine('## Spec progress'); [void]$sb.AppendLine()
    if (-not $Plan.Valid) { [void]$sb.AppendLine("Cannot slice this spec: $($Plan.Problem). Edit the spec and re-approve it (remove and re-add ``approved``).") }
    foreach ($s in $Plan.Slices) {
        $box = ' '; if ($s.Done) { $box = 'x' }
        if ($s.Issue -gt 0) { $what = "#$($s.Issue) $($s.Status)" } else { $what = 'not opened yet (opened as a proposal when a slot is free; slices go before new ideas)' }
        [void]$sb.AppendLine("- [$box] $($s.K). $(ConvertTo-SafeLine $s.Title 100): $what")
    }
    if ($Plan.Duplicates.Count -gt 0) { [void]$sb.AppendLine(); [void]$sb.AppendLine("Note: more than one issue claims slice $($Plan.Duplicates -join ', '); the open one (or the newest) is shown.") }
    [void]$sb.AppendLine()
    if ($Plan.Complete) { [void]$sb.AppendLine('**All slices are done (deployed or closed). The loop closes this spec.**') }
    else { [void]$sb.AppendLine("Approving this spec approves its slices: each one the loop opens is built without its own ``approved``, in order, unless it is marked Manual / needs Ve, failed, edited or held. Comment ``/hold`` on a slice to stop that slice, or on this spec to stop them all. The spec closes when every slice is deployed or closed.") }
    $r = ''; if ($RunId) { $r = " after run ``$RunId``" }
    [void]$sb.AppendLine(); [void]$sb.AppendLine("<sub>Updated by the runner$r; this comment is edited in place.</sub>")
    return $sb.ToString()
}

# ==================================================================================================
# Slices auto-approved through their spec. Approving a spec approves the slices the loop opens for it: a
# slice is buildable WITHOUT its own `approved` label when every condition below holds (else it waits for the
# owner's `approved` like any proposal). The loop still never adds `approved`; check-approval.ps1 reports such
# a slice as approval `via-spec` and merge-pr.ps1 re-checks it the same way before merging.
#  1. its spec is open, loop:spec + loop:proposal, and approved under the normal rule (check-approval.ps1
#     -Spec: last `labeled approved` by the owner, not removed since, body not edited since); the spec has no
#     hold comment from the owner after that approval; and the slice was opened AFTER that approval
#  2. the slice was opened by the loop: loop:proposal (not loop:spec), opened by the owner's account, body's
#     first line is the loop marker and its next line `Part of #<spec> (slice <k> of <m>)`; <m> is the number
#     of slices in the spec's "## Slices" list, <k> is in it, the issue title matches that slice's title
#     (tolerant: case, punctuation, a prefix such as "Home (phone/desktop): ", most words), and it is the issue
#     the spec plan counts for slice <k> (no duplicate claims it instead)
#  3. not marked Manual / needs Ve, no loop:failed, and every EARLIER slice of the spec is opened and is
#     either closed or open without loop:failed / Manual (slices build in order; a failed or manual earlier
#     slice holds the later ones until it is closed)
#  4. no veto: slice open, no `approved` label events on the slice (the owner adding and then removing
#     `approved` is a decision), and no hold comment from the owner after the slice was opened
#  5. the slice body was never edited after it was opened (the loop never edits bodies, so any edit is someone
#     else's; the owner can still approve an edited slice with `approved`)
# A hold comment: a comment by the owner WITHOUT the loop marker whose text starts with `/hold` or `hold`
# (case-insensitive). To build a held slice anyway, the owner adds `approved` to it by hand.
# ==================================================================================================
$script:ManualRx = '(?im)^\s*\**\s*(manual\s*/\s*needs\s+ve|manual step required)'
$script:HoldRx = '^(?i)\s*/?hold\b'
$script:ViaSpecMarker = '<!-- innovation-loop:via-spec -->'

function Get-IssueAuthor {
    param($Issue)
    if ($Issue.author) { return "$($Issue.author.login)" }
    if ($Issue.user) { return "$($Issue.user.login)" }
    return ''
}
function Get-IssueCreated {
    param($Issue)
    foreach ($k in 'createdAt', 'created_at') { if ($Issue.PSObject.Properties.Name -contains $k -and $Issue.$k) { return [datetime]$Issue.$k } }
    return $null
}

# A title reduced to lowercase words (HTML entities decoded, punctuation dropped).
function ConvertTo-TitleKey {
    param([string]$Title)
    $t = [Net.WebUtility]::HtmlDecode("$Title").ToLowerInvariant()
    return (($t -replace '[^a-z0-9]+', ' ').Trim())
}

# Does an issue title match a spec's planned slice title? Equal, one containing the other as whole words (8+
# chars), or at least 60% of the longer title's words (3+ letters) shared.
function Test-SliceTitleMatch {
    param([string]$Planned, [string]$Actual)
    $a = ConvertTo-TitleKey $Planned; $b = ConvertTo-TitleKey $Actual
    if (-not $a -or -not $b) { return $false }
    if ($a -eq $b) { return $true }
    $short = $a; $long = $b; if ($a.Length -gt $b.Length) { $short = $b; $long = $a }
    if ($short.Length -ge 8 -and (" $long ").Contains(" $short ")) { return $true }
    $ta = @($a -split ' ' | Where-Object { $_.Length -ge 3 } | Select-Object -Unique)
    $tb = @($b -split ' ' | Where-Object { $_.Length -ge 3 } | Select-Object -Unique)
    if ($ta.Count -eq 0 -or $tb.Count -eq 0) { return $false }
    $common = @($ta | Where-Object { $tb -contains $_ }).Count
    return (($common / [double][math]::Max($ta.Count, $tb.Count)) -ge 0.6)
}

# The owner's first hold comment after -Since (comments API objects), or $null. Comments with the loop
# marker are the loop's own and never count; nor does anyone else's.
function Find-HoldComment {
    param([object[]]$Comments, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', $Since = $null)
    $sinceT = $null; if ($Since) { $sinceT = [datetime]$Since }
    foreach ($c in @($Comments | Where-Object { $_ } | Sort-Object { [datetime]$_.created_at })) {
        if ("$($c.user.login)" -ne $Owner) { continue }
        $b = "$($c.body)"; if ($b.Contains($Marker)) { continue }
        if ($sinceT -and ([datetime]$c.created_at) -le $sinceT) { continue }
        if ($b -match $script:HoldRx) { return $c }
    }
    return $null
}

# Is $Slice (an issue: number, title, state, labels, body, author/user, createdAt/created_at) buildable through
# its approved spec? $SliceEditedAt: GraphQL lastEditedAt ('' = never edited). $SliceComments: its comments.
# $SliceApprovalEvents: how many labeled/unlabeled `approved` events the slice has. $Spec: the spec issue
# (number, state, labels, body). $SpecCheck: check-approval.ps1's Test-Issue -AsSpec result (buildable,
# approvedAt, reasons). $SpecComments: the spec's comments. $Issues: every loop:proposal issue, open and
# closed (for the spec plan and the earlier slices). Returns Linked (the body names a spec at all), Eligible,
# Spec, K, Of, SpecApprovedAt and Reasons (why not; empty when Eligible).
function Get-ViaSpecDecision {
    param($Slice, [string]$SliceEditedAt = '', [object[]]$SliceComments = @(), [int]$SliceApprovalEvents = 0,
        $Spec = $null, $SpecCheck = $null, [object[]]$SpecComments = @(), [object[]]$Issues = @(),
        [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', [bool]$PolicyScope = $false)
    # -PolicyScope: the spec was approved via Ve's policy (Get-ViaPolicyDecision), so each slice must itself be covered by it
    $r = New-Object System.Collections.ArrayList
    $body = "$($Slice.body)"
    $link = Get-SliceLink -Body $body
    $specAt = ''; if ($SpecCheck -and $SpecCheck.approvedAt) { $specAt = "$($SpecCheck.approvedAt)" }
    if (-not $link) {
        return [pscustomobject]@{ Linked = $false; Eligible = $false; Spec = 0; K = 0; Of = 0; SpecApprovedAt = $specAt; Reasons = @('not a slice (no "Part of #<spec> (slice <k> of <m>)" line)') }
    }
    $labels = @(Get-IssueLabelNames $Slice)
    $created = Get-IssueCreated $Slice

    # 2. opened by the loop, in the loop's format
    if ($labels -notcontains 'loop:proposal') { [void]$r.Add('missing label loop:proposal') }
    if ($labels -contains $script:SpecLabel) { [void]$r.Add('is itself a spec') }
    $author = Get-IssueAuthor $Slice
    if ($author -ne $Owner) { [void]$r.Add("opened by $author, not $Owner") }
    $lines = @($body -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($lines.Count -lt 2 -or $lines[0] -ne $Marker -or -not ([regex]::Match($lines[1], $script:SliceLinkRx).Success)) {
        [void]$r.Add('body does not start with the loop marker line followed by the "Part of #<spec> (slice <k> of <m>)" line')
    }

    # 1. the spec and its approval; 2. the slice's place in the spec; 3. build order
    if (-not $Spec -or [int]$Spec.number -ne $link.Spec) { [void]$r.Add("spec #$($link.Spec) not found") }
    else {
        $sl = @(Get-IssueLabelNames $Spec)
        if ("$($Spec.state)" -notmatch '^(?i)open$') { [void]$r.Add("spec #$($link.Spec) is closed") }
        if ($sl -notcontains $script:SpecLabel -or $sl -notcontains 'loop:proposal') { [void]$r.Add("#$($link.Spec) is not a loop:spec issue") }
        if (-not $SpecCheck -or -not $SpecCheck.buildable -or -not $specAt) {
            $why = 'not checked'; if ($SpecCheck) { $why = (@($SpecCheck.reasons) -join '; ') }
            [void]$r.Add("spec #$($link.Spec) is not approved ($why)")
        } else {
            $specT = [datetime]$specAt
            $h = Find-HoldComment -Comments $SpecComments -Owner $Owner -Marker $Marker -Since $specT
            if ($h) { [void]$r.Add("$Owner put spec #$($link.Spec) on hold (comment $($h.id))") }
            if (-not $created -or $created -le $specT) { [void]$r.Add("opened before spec #$($link.Spec) was (last) approved") }
        }
        $plan = Get-SpecPlan -Spec $Spec -Issues $Issues -Owner $Owner -Marker $Marker
        if (-not $plan.Valid) { [void]$r.Add("spec #$($link.Spec): $($plan.Problem)") }
        else {
            if ($link.Of -ne $plan.Of) { [void]$r.Add("says $($link.Of) slices, spec #$($link.Spec) lists $($plan.Of)") }
            $item = @($plan.Slices | Where-Object { $_.K -eq $link.K } | Select-Object -First 1)
            if ($item.Count -eq 0) { [void]$r.Add("slice $($link.K) is not in spec #$($link.Spec)'s ## Slices list") }
            else {
                if (-not (Test-SliceTitleMatch -Planned $item[0].Title -Actual "$($Slice.title)")) { [void]$r.Add("title does not match slice $($link.K) of spec #$($link.Spec) ('$($item[0].Title)')") }
                if ([int]$item[0].Issue -ne [int]$Slice.number) { [void]$r.Add("spec #$($link.Spec) counts #$($item[0].Issue) as slice $($link.K), not this issue") }
                foreach ($e in @($plan.Slices | Where-Object { $_.K -lt $link.K } | Sort-Object K)) {
                    if ([int]$e.Issue -le 0) { [void]$r.Add("earlier slice $($e.K) is not opened yet"); continue }
                    $ei = @($Issues | Where-Object { [int]$_.number -eq [int]$e.Issue } | Select-Object -First 1)
                    if ($ei.Count -eq 0 -or "$($ei[0].state)" -notmatch '^(?i)open$') { continue }
                    if (@(Get-IssueLabelNames $ei[0]) -contains 'loop:failed') { [void]$r.Add("earlier slice $($e.K) (#$($e.Issue)) failed and is still open") }
                    elseif ("$($ei[0].body)" -match $script:ManualRx) { [void]$r.Add("earlier slice $($e.K) (#$($e.Issue)) is Manual / needs Ve and still open") }
                }
            }
        }
    }

    # 3. not manual, not failed
    if ($body -match $script:ManualRx) { [void]$r.Add('marked Manual / needs Ve') }
    if ($labels -contains 'loop:failed') { [void]$r.Add('has label loop:failed (an auto-approved slice gets no automatic retry)') }
    # 4. no veto
    if ("$($Slice.state)" -notmatch '^(?i)open$') { [void]$r.Add('slice is closed') }
    if ($SliceApprovalEvents -gt 0) { [void]$r.Add('`approved` was added to and removed from this slice by hand; that decision stands over the spec') }
    $hs = Find-HoldComment -Comments $SliceComments -Owner $Owner -Marker $Marker -Since $created
    if ($hs) { [void]$r.Add("$Owner put this slice on hold (comment $($hs.id))") }
    # 5. body never edited
    if ($SliceEditedAt) { [void]$r.Add("body edited at $SliceEditedAt, after it was opened") }
    if ($PolicyScope) {
        $ps = Get-ViaPolicyScope -Title "$($Slice.title)" -Body $body -IsSpec $false
        if (-not $ps.InScope) { [void]$r.Add("spec #$($link.Spec) was approved via Ve's policy, which covers only Pages-only work outside the server, stored data and protected areas: $(@($ps.Reasons) -join '; ')") }
    }
    return [pscustomobject]@{ Linked = $true; Eligible = ($r.Count -eq 0); Spec = $link.Spec; K = $link.K; Of = $link.Of; SpecApprovedAt = $specAt; Reasons = @($r) }
}

# The one comment the runner posts on a slice the first time it is treated as auto-approved.
function Format-ViaSpecNotice {
    param([int]$Spec, [string]$ApprovedAt, [string]$Who = 'the owner', [string]$Marker = '<!-- innovation-loop -->')
    $d = "$ApprovedAt"; try { $d = ([datetime]$ApprovedAt).ToUniversalTime().ToString('yyyy-MM-dd') } catch { }
    return "$Marker`n$($script:ViaSpecMarker)`nAuto-approved via spec #$Spec (approved by $Who on $d). Comment ``/hold`` to stop.`n"
}

# Waiting on a Manual earlier slice. A slice (any issue whose body says "Part of #<spec> (slice <k> of <m>)")
# whose EARLIER slices of the same spec include one that is still open and marked Manual / needs Ve is not
# built, whether it is approved by its own `approved` label or via the spec: the loop cannot build the
# Manual slice, so the later one would only be refused on scope or lack the data it needs (#117 before
# #111 / #112). The runner skips it before any claude session ($0), leaves its labels alone (never
# loop:failed), posts at most ONE comment on it (Format-SliceWaitNotice) and builds it in the first run after
# the blocking slices are closed. An earlier slice that is open and NOT Manual keeps the existing behaviour
# (a label-approved slice builds; an auto-approved one waits by Get-ViaSpecDecision rule 3).
# $Issue: the slice (number, body). $Issues: loop:proposal issues, open AND closed (number, state, labels,
# body, author/user). Only issues opened by -Owner with the loop -Marker and a slice link to the same spec
# count as its earlier slices. Returns Linked, Waiting, Spec, K, Blockers (K, Issue; in slice order), Reason.
$script:SliceWaitMarker = '<!-- innovation-loop:waiting-on-slice -->'
function Get-SliceWaitDecision {
    param($Issue, [object[]]$Issues, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    $link = Get-SliceLink -Body "$($Issue.body)"
    if (-not $link) { return [pscustomobject]@{ Linked = $false; Waiting = $false; Spec = 0; K = 0; Blockers = @(); Reason = '' } }
    $blockers = @()
    foreach ($i in @($Issues | Where-Object { $_ })) {
        if ([int]$i.number -eq [int]$Issue.number) { continue }
        if ("$($i.state)" -notmatch '^(?i)open$') { continue }
        if ((Get-IssueAuthor $i) -ne $Owner) { continue }
        if (-not "$($i.body)".Contains($Marker)) { continue }
        $lk = Get-SliceLink -Body "$($i.body)"
        if (-not $lk -or $lk.Spec -ne $link.Spec -or $lk.K -ge $link.K) { continue }
        if ("$($i.body)" -notmatch $script:ManualRx) { continue }
        $blockers += [pscustomobject]@{ K = [int]$lk.K; Issue = [int]$i.number }
    }
    $blockers = @($blockers | Sort-Object K, Issue)
    $reason = ''
    if ($blockers.Count -gt 0) { $reason = "waiting on $(Format-SliceWaitList $blockers) of spec #$($link.Spec); it builds once $(if ($blockers.Count -eq 1) { 'that slice is' } else { 'those slices are' }) closed" }
    return [pscustomobject]@{ Linked = $true; Waiting = ($blockers.Count -gt 0); Spec = $link.Spec; K = $link.K; Blockers = $blockers; Reason = $reason }
}

# "slice 2 (#111, Manual)" / "slices 2 (#111, Manual) and 3 (#112, Manual)". Blockers: K and Issue (or k / issue).
function Format-SliceWaitList {
    param([object[]]$Blockers)
    $b = @($Blockers | Where-Object { $_ } | ForEach-Object {
            $k = $_.K; if ($null -eq $k) { $k = $_.k }; $n = $_.Issue; if ($null -eq $n) { $n = $_.issue }
            "$k (#$n, Manual)" })
    if ($b.Count -eq 0) { return '' }
    if ($b.Count -eq 1) { return "slice $($b[0])" }
    return "slices $(($b[0..($b.Count - 2)]) -join ', ') and $($b[-1])"
}

# The ONE comment the runner posts on a slice that waits on a Manual earlier slice.
function Format-SliceWaitNotice {
    param([object[]]$Blockers, [string]$Marker = '<!-- innovation-loop -->')
    $one = (@($Blockers | Where-Object { $_ }).Count -eq 1)
    return "$Marker`n$($script:SliceWaitMarker)`nWaiting on $(Format-SliceWaitList $Blockers). It will build once $(if ($one) { 'that slice is' } else { 'those slices are' }) closed.`n"
}

# Has the runner already posted its waiting notice on this slice (a comment by -Owner with both markers)?
function Test-SliceWaitNoticed {
    param([object[]]$Comments, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    return (@($Comments | Where-Object { $_ -and "$($_.user.login)" -eq $Owner -and "$($_.body)".Contains($Marker) -and "$($_.body)".Contains($script:SliceWaitMarker) -and -not (Test-AgentComment $_) }).Count -gt 0)
}

# Which waiting slices get the notice now: those the queue says are not noticed yet (check-approval.ps1 -List
# `waitingOnSlice`, noticed = false) and not already posted by this runner process ($Posted: issue -> $true).
function Select-SliceWaitNotices {
    param([object[]]$Waiting, [hashtable]$Posted = @{})
    return @($Waiting | Where-Object { $_ -and -not $_.noticed -and -not $Posted.ContainsKey([int]$_.issue) })
}

# ==================================================================================================
# One claude session per job (run-loop.ps1): which LOOP.md sections a session gets, which model and limits,
# whether another build may start, whether a build left the deploy state uncertain, and the run's result.
# ==================================================================================================

# The intro (everything before the first "## <n>." heading) plus the listed numbered sections, in order.
# Blocks between a line `<!-- only:<kind>[,<kind>] -->` and a line `<!-- /only -->` are kept (markers removed)
# when -Kind is empty or listed, and left out otherwise (sessions.json options.compactPrompts): a proposal
# session does not need the build mechanics it has no permission to use anyway. Rules for every kind are
# never inside such a block.
function Get-LoopMdSections {
    param([string]$Text, [int[]]$Sections, [string]$Kind = '')
    $Text = [regex]::Replace("$Text", '(?ms)^[ \t]*<!-- only:([a-z,\- ]+) -->[ \t]*\r?\n(.*?)^[ \t]*<!-- /only -->[ \t]*(\r?\n|\z)', {
            param($m)
            $kinds = @($m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            if (-not $Kind -or $kinds -contains $Kind) { return $m.Groups[2].Value }
            return ''
        })
    # prettier puts blank lines around the markers; drop the runs they leave behind
    $Text = [regex]::Replace($Text, '\n[ \t]*\n([ \t]*\n)+', "`n`n")
    $ms = @([regex]::Matches("$Text", '(?m)^## (\d+)\.'))
    if ($ms.Count -eq 0) { return "$Text" }
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append($Text.Substring(0, $ms[0].Index))
    for ($i = 0; $i -lt $ms.Count; $i++) {
        $end = $Text.Length; if ($i + 1 -lt $ms.Count) { $end = $ms[$i + 1].Index }
        if ($Sections -contains [int]$ms[$i].Groups[1].Value) { [void]$sb.Append($Text.Substring($ms[$i].Index, $end - $ms[$i].Index)) }
    }
    return $sb.ToString()
}

# Defaults for innovation\sessions.json (the owner's file: models, turn caps, per-session time limits, USD
# caps, daily session caps). maxBudgetUsd is passed to claude as --max-budget-usd (0 = no cap); a build on a
# model that is not Opus uses build.smallMaxBudgetUsd instead (Get-SessionBudget). maxPerDay: at most this
# many sessions of the kind are started per local day across all runs (0 = no cap; Get-DailyCapDecision).
# Builds run on build.model (Sonnet, Ve's decision of 2026-11-23) and switch to build.opusModel only for the cases in
# Get-BuildModelChoice: an opusLabels label (model:opus), a proposal whose "What deploys" names the server, or the
# automatic retry of a non-Opus failure caused by the change (Get-RetryDecision Opus).
$script:SessionDefaults = [ordered]@{
    build   = [ordered]@{ model = 'claude-sonnet-5-5'; opusModel = 'claude-opus-5-5'; opusLabels = @('model:opus'); smallModel = 'claude-sonnet-5-5'; smallLabels = @('size:small', 'test-only')
        maxTurns = 150; timeoutMinutes = 150; maxBudgetUsd = 8; smallMaxBudgetUsd = 4; maxPerDay = 8
        sizeSmallLabels = @('size:small'); sizeSmallMaxTurns = 100; sizeSmallMaxBudgetUsd = 2.5 }
    propose = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 80; timeoutMinutes = 45; minMinutes = 15; maxBudgetUsd = 0.75; maxPerDay = 4 }
    review  = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 120; timeoutMinutes = 60; maxBudgetUsd = 4; maxPerDay = 1 }
    # Ve's requests (options.requestIntake): one intake session per request that needs planning
    intake  = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 40; timeoutMinutes = 20; maxBudgetUsd = 0.75; maxPerDay = 6 }
    # the memory agent (options.memoryAgent): tool-less, input in the prompt, JSON out, validated by the runner
    memory  = [ordered]@{ model = 'claude-haiku-5-5'; maxTurns = 5; timeoutMinutes = 5; maxBudgetUsd = 0.10; maxPerDay = 2 }
    # Phase 2 (options.observerPm): the Observer runs only when a workflow file or a metric changed (read-only,
    # findings JSON out); the PM replaces the propose session (reads findings, opens proposals that cite them)
    observe = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 30; timeoutMinutes = 15; maxBudgetUsd = 0.60; maxPerDay = 2 }
    pm      = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 80; timeoutMinutes = 45; minMinutes = 15; maxBudgetUsd = 0.75; maxPerDay = 4 }
    # Phase 3 (options.qaUx, product-qa.ps1): QA of each deployed build against its acceptance criteria on the live site,
    # and a UX review of UI changes (plus a weekly sample); both read-only, JSON out, validated by the runner
    qa      = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 25; timeoutMinutes = 15; minMinutes = 8; maxBudgetUsd = 0.50; maxPerDay = 8 }
    ux      = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 25; timeoutMinutes = 15; minMinutes = 8; maxBudgetUsd = 0.50; maxPerDay = 3 }
}

# Run-wide switches from sessions.json's "options" object (all optional; these are the safe defaults).
# proposeIssueDigest: the runner lists the issues once and puts a compact KNOWN_ISSUES block in the proposal /
#   review header (Format-KnownIssues), so the session does not list them itself; false = the session lists them
#   as before. compactPrompts: LOOP.md blocks marked <!-- only:<kinds> --> are left out of other kinds' prompts;
#   false = every session gets them. logKeepDays: run logs, prompts and transcripts older than this are deleted
#   at the start of a run (Select-PrunableLogs; rundata.json and the main run log are kept); 0 = never.
#   digestMaxIssues: at most this many issues in KNOWN_ISSUES (the oldest deployed ones are dropped first).
#   digestDeployedDays: deployed (closed) proposals are listed only when closed within this many days; older
#   ones are counted (they are in the code); 0 = list them all. Open and rejected ones are always listed.
#   Phase 1 (product intelligence), each OFF unless sessions.json turns it on:
#   productStore: the runner's deterministic decision collector (product-store.ps1) writes D:\hub\state\product\
#   cardlens\{cursors.json, decisions.jsonl}; productCollectMinutes: GitHub is asked at most this often.
#   memoryAgent: the Haiku memory session proposes preferences.json changes when memoryMinDecisions new decisions
#   piled up or memoryEveryDays passed (needs productStore). requestIntake: Ve's loop:request issues are planned by
#   an intake session and their issues built first (via-request approval).
#   designSkills: build, proposal and review sessions may use the pinned design skills (impeccable's engine:
#   context / shot / detect; ui-ux-pro-max's search.py) and get LOOP.md section 9 (Get-DesignSkillsSetup).
#   proposeMetricsDigest: the runner GETs /api/metrics/summary (7 and 30 days) once and puts it in the proposal /
#   review header as METRICS (Format-MetricsDigest), so the session needs no HTTP call for it.
#   Phase 2: observerPm splits Phase B into the Observer (only on change) and the PM (only on new input with a free
#   slot; product-intel.ps1 Get-CoordinatorDecision); off = the single propose session as before (needs productStore).
#   observeMetricPoints: a 7-day metrics rate that moved by at least this many percentage points since the last
#   observation makes the Observer run.
#   Phase 3: qaUx runs a QA session after each deployed build (and shipped request child) and a UX review after a UI
#   change, plus a weekly UX sample of one workflow not reviewed for uxStaleDays (every uxSampleDays); product-qa.ps1.
#   previewQa (needs qaUx): each build's PR is built as a mock-data preview on the tailnet (preview.ps1, ports 8460-8462)
#   and QA drives it with Playwright BEFORE the merge; merge-pr.ps1 refuses a user-facing merge until the QA gate allows it.
$script:LoopOptionDefaults = [ordered]@{ proposeIssueDigest = $true; proposeMetricsDigest = $true; compactPrompts = $true; logKeepDays = 30; digestMaxIssues = 150; digestDeployedDays = 3
    productStore = $false; productCollectMinutes = 10; memoryAgent = $false; memoryMinDecisions = 5; memoryEveryDays = 7; requestIntake = $false
    designSkills = $false; observerPm = $false; observeMetricPoints = 10; qaUx = $false; uxSampleDays = 7; uxStaleDays = 30; previewQa = $false }

# ---- design skills (options.designSkills) ----------------------------------------------------------
# Pinned copies outside Ve's ~\.claude (guard.mjs keeps sessions out of it: credentials live there). Only
# impeccable and ui-ux-pro-max are copied; the taste skill is not, and guard.mjs refuses its name anywhere.
# The engine binary was fetched once from the impeccable release and checked against the skill's
# engine-checksums.txt; the runner re-hashes it before every run and turns the feature off on a mismatch.
# The paths must match ENGINE / SEARCH in guard.mjs (test-gate-rules.ps1 checks).
$script:DesignSkillPaths = [ordered]@{
    Engine       = 'D:\loop-tools\impeccable-engine\0.1.27\impeccable.exe'
    EngineSha256 = 'ba9627d4552bca5666020624d8e994aea8b8b44c46b995e18b5babad0f431fc8'
    Impeccable   = 'D:\loop-tools\skills\impeccable'
    Search       = 'D:\loop-tools\skills\ui-ux-pro-max\scripts\search.py'
    # Python is a per-user install, not on the machine PATH the runner starts from (lib.ps1): prepended for sessions
    PythonDir    = ('{0}\Programs\Python\Python312' -f $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { "$env:USERPROFILE\AppData\Local" }))
}
$script:DesignSkillKinds = @('build', 'propose', 'review', 'observe', 'pm', 'qa', 'qapreview', 'ux')

# What the runner adds when options.designSkills is on and the files check out: Ok/Reason (why it is off),
# Allow (the permission rules for the session kinds in DesignSkillKinds), PathPrepend (Python's folder, put in
# front of PATH so the bare `python` of the allow rule resolves), Env (set for every session; the
# IMPECCABLE_* switches keep the engine off the network: no telemetry, update or staleness checks, no hook).
# -EngineHash lets tests skip hashing a 24 MB file.
function Get-DesignSkillsSetup {
    param([bool]$Enabled, [hashtable]$Paths = $null, [string]$EngineHash = '')
    $p = $script:DesignSkillPaths; if ($Paths) { $p = $Paths }
    $off = [pscustomobject]@{ Ok = $false; Reason = 'off (sessions.json options.designSkills)'; Allow = @(); Env = [ordered]@{ INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS = '' } }
    if (-not $Enabled) { return $off }
    foreach ($k in 'Engine', 'Search') { if (-not (Test-Path -LiteralPath $p[$k] -PathType Leaf)) { $off.Reason = "missing $($p[$k])"; return $off } }
    if (-not (Test-Path -LiteralPath (Join-Path $p.PythonDir 'python.exe') -PathType Leaf)) { $off.Reason = "missing python.exe in $($p.PythonDir)"; return $off }
    if (-not (Test-Path -LiteralPath (Join-Path $p.Impeccable 'reference\craft-floor.md') -PathType Leaf)) { $off.Reason = "missing the impeccable copy in $($p.Impeccable)"; return $off }
    $h = $EngineHash; if (-not $h) { $h = (Get-FileHash -LiteralPath $p.Engine -Algorithm SHA256).Hash }
    if ($h.ToLowerInvariant() -ne $p.EngineSha256.ToLowerInvariant()) { $off.Reason = "engine hash mismatch ($($h.ToLowerInvariant()))"; return $off }
    $e = $p.Engine
    $allow = @("PowerShell($e context)", "PowerShell($e context *)", "PowerShell($e shot *)", "PowerShell($e detect *)", "PowerShell(python $($p.Search) *)")
    $vars = [ordered]@{
        INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS = '1'; IMPECCABLE_BIN = $e; IMPECCABLE_SKILL_DIR = $p.Impeccable
        # never DO_NOT_TRACK: claude reads it too and then offers no PowerShell tool at all (runs 20261122-133356 to
        # -143708 had no shell); IMPECCABLE_NO_TELEMETRY already keeps the engine quiet
        IMPECCABLE_NO_TELEMETRY = '1'; IMPECCABLE_NO_UPDATE_CHECK = '1'; IMPECCABLE_NO_STALENESS_CHECK = '1'
        IMPECCABLE_HOOK_DISABLED = '1'; PYTHONDONTWRITEBYTECODE = '1'
    }
    return [pscustomobject]@{ Ok = $true; Reason = 'on'; Allow = $allow; Env = $vars; PathPrepend = $p.PythonDir }
}

# LOOP.md sections for a session kind, plus section 9 (design skills) when they are on for that kind.
function Add-DesignSkillsSection {
    param([int[]]$Sections, [string]$Kind, [bool]$On)
    if ($On -and $script:DesignSkillKinds -contains $Kind -and $Sections -notcontains 9) { return @($Sections) + 9 }
    return @($Sections)
}
function Get-LoopOptions {
    param($Json)
    $o = [ordered]@{}; foreach ($k in $script:LoopOptionDefaults.Keys) { $o[$k] = $script:LoopOptionDefaults[$k] }
    if ($Json -and $Json.PSObject.Properties.Name -contains 'options' -and $Json.options) {
        foreach ($p in $Json.options.PSObject.Properties) {
            if (-not $o.Contains($p.Name) -or $null -eq $p.Value -or "$($p.Value)" -eq '') { continue }
            if ($o[$p.Name] -is [bool]) {
                $v = "$($p.Value)".Trim().ToLowerInvariant()
                if ($v -in @('true', '1', 'yes')) { $o[$p.Name] = $true } elseif ($v -in @('false', '0', 'no')) { $o[$p.Name] = $false }
            } else { $n = 0; if ([int]::TryParse("$($p.Value)", [ref]$n) -and $n -ge 0) { $o[$p.Name] = $n } }
        }
    }
    return $o
}

# The USD cap for one session (claude --max-budget-usd), 0 = none. A build on a model that is not Opus uses
# build.smallMaxBudgetUsd; an empty model (claude's own default) counts as Opus, as in Test-BudgetAllowsModel.
function Get-SessionBudget {
    param([string]$Kind, [string]$Model = '', $Config)
    $c = $Config[$Kind]; if ($null -eq $c) { return [double]0 }
    $v = $c['maxBudgetUsd']
    $isOpus = ($Model.Trim() -eq '' -or $Model -match 'opus')
    if ($Kind -eq 'build' -and -not $isOpus -and $c.Contains('smallMaxBudgetUsd')) { $v = $c['smallMaxBudgetUsd'] }
    $d = [double]0
    if (-not [double]::TryParse("$v", [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d) -or $d -le 0) { return [double]0 }
    return $d
}
# '2.50' (invariant culture: claude reads a dot).
# The turn and USD caps of one build session (Ve, 2026-11-24: tighter caps for small builds). A build on a model that
# is not Opus whose issue carries a build.sizeSmallLabels label (size:small) gets build.sizeSmallMaxTurns /
# build.sizeSmallMaxBudgetUsd; anything else keeps build.maxTurns and Get-SessionBudget (smallMaxBudgetUsd for a
# non-Opus model, maxBudgetUsd for Opus). An Opus build (the automatic retry, model:opus, a server deploy) never gets
# the small caps. Every session of the same build (first, QA fix round, merge) uses the same caps. Returns Turns,
# BudgetUsd, Small, Why.
function Get-BuildCaps {
    param([string[]]$Labels = @(), [string]$Model = '', $Config)
    $c = $Config['build']
    $turns = [int]$c['maxTurns']; $usd = Get-SessionBudget -Kind 'build' -Model $Model -Config $Config
    $isOpus = ($Model.Trim() -eq '' -or $Model -match 'opus')
    $sl = @('size:small'); if ($c.Contains('sizeSmallLabels') -and @($c['sizeSmallLabels']).Count -gt 0) { $sl = @($c['sizeSmallLabels']) }
    $hit = @($Labels | Where-Object { $sl -contains $_ })
    if ($isOpus -or $hit.Count -eq 0) { return [pscustomobject]@{ Turns = $turns; BudgetUsd = $usd; Small = $false; Why = $(if ($isOpus) { 'Opus build: the full caps' } else { 'no size:small label: the normal caps' }) } }
    $t2 = 0; [void][int]::TryParse("$($c['sizeSmallMaxTurns'])", [ref]$t2)
    $u2 = [double]0; [void][double]::TryParse("$($c['sizeSmallMaxBudgetUsd'])", [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$u2)
    if ($t2 -gt 0 -and $t2 -lt $turns) { $turns = $t2 }
    if ($u2 -gt 0 -and ($usd -le 0 -or $u2 -lt $usd)) { $usd = $u2 }
    return [pscustomobject]@{ Turns = $turns; BudgetUsd = $usd; Small = $true; Why = "label $($hit[0]): small-build caps" }
}
# ---- the feasibility pre-check before a build session (Ve, 2026-11-24: token savers) -----------------------------
# The repo paths an issue body names (in backticks or bare: src/, server/, e2e/, public/, scripts/, docs/ + a file
# extension), minus the ones its line says are new ("new", "create", "add a/an ...", "introduce"). -Exists: a
# scriptblock (path -> $true when the file is on origin/main). Refuse when the body names at least one such path and
# NONE of them exists on main: the proposal describes code that is not there (renamed, removed, or never existed, e.g.
# #235's Settings screen), so a session would only explore and give up. Some missing: no refusal, the build session's
# header lists them (PRECHECK) so it checks them first. Returns Paths, Missing, Refuse, Why.
$script:PrecheckPathRx = '(?<![\w/.-])((?:src|server|e2e|public|scripts|docs)/[A-Za-z0-9_./\[\]-]*[A-Za-z0-9_\]-]\.(?:tsx?|jsx?|mjs|cjs|css|json|md|html|py|svg|png))(?![\w/-])'
$script:PrecheckNewRx = '(?i)\b(new|create[sd]?|creating|introduc\w*|add(s|ed|ing)? (a|an)\b)'
function Get-ProposalPathCheck {
    param([string]$Body = '', [scriptblock]$Exists, [int]$Max = 20)
    $b = [regex]::Replace("$Body", '(?s)<!--.*?-->', '')
    # a path the body ever calls new ("Add a new src/web/Foo.tsx") is left out everywhere it appears (portfolio #65
    # named its new public/404.html again in its test plan); backslashes read as slashes
    $paths = New-Object System.Collections.ArrayList; $isNew = @{}
    foreach ($line in @(($b -replace '\\', '/') -split "`r?`n")) {
        foreach ($m in [regex]::Matches($line, $script:PrecheckPathRx)) {
            $p = $m.Groups[1].Value
            if ($line.Substring(0, $m.Index) -match $script:PrecheckNewRx) { $isNew[$p] = $true; continue }
            if (-not $paths.Contains($p) -and $paths.Count -lt $Max) { [void]$paths.Add($p) }
        }
    }
    $paths = @($paths | Where-Object { -not $isNew.ContainsKey($_) })
    $missing = @($paths | Where-Object { -not (& $Exists $_) })
    $refuse = ($paths.Count -gt 0 -and $missing.Count -eq $paths.Count)
    $why = $(if ($paths.Count -eq 0) { 'the issue names no repo file: nothing to pre-check' }
        elseif ($refuse) { "none of the $($paths.Count) file(s) the issue names exists on main ($(@($missing | Select-Object -First 5) -join ', ')): the proposal no longer matches the code" }
        elseif ($missing.Count) { "$($missing.Count) of $($paths.Count) named file(s) not on main: $(@($missing | Select-Object -First 5) -join ', ')" }
        else { "all $($paths.Count) named file(s) exist on main" })
    return [pscustomobject]@{ Paths = @($paths); Missing = @($missing); Refuse = $refuse; Why = $why }
}

function Format-BudgetUsd { param([double]$Usd) return $Usd.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture) }

# ---- daily session caps (run-loop.ps1 keeps the counts in <LOOP_HOME>\state\daily-sessions.json) ----------
# Every approval starts a run, so without a cap a busy day has no upper bound. The counts are per local day
# and per kind (build | propose | review); a launch is counted when the session is started (never in a dry run).
$script:DailyCapKinds = @('build', 'propose', 'review', 'intake', 'memory', 'observe', 'pm', 'qa', 'ux')

# Today's counts from the saved state ($null / another day / garbage = all zero).
function Get-DailyCounts {
    param($State, [datetime]$Now = (Get-Date))
    $day = $Now.ToString('yyyy-MM-dd')
    $c = [ordered]@{ date = $day }; foreach ($k in $script:DailyCapKinds) { $c[$k] = 0 }
    if ($null -eq $State -or "$($State.date)" -ne $day) { return $c }
    foreach ($k in $script:DailyCapKinds) { $n = 0; if ([int]::TryParse("$($State.$k)", [ref]$n) -and $n -gt 0) { $c[$k] = $n } }
    return $c
}
# The state after one more $Kind launch now (a new day starts from zero).
function Add-DailyLaunch {
    param($State, [string]$Kind, [datetime]$Now = (Get-Date))
    $c = Get-DailyCounts -State $State -Now $Now
    if ($c.Contains($Kind)) { $c[$Kind] = [int]$c[$Kind] + 1 }
    return $c
}
# May another $Kind session start today? Allowed + Reason (one line for the log and summary).
# -Request marks a session started for one of Ve's loop:request issues (its intake, or a build of an issue
# that came from it): not counted against the daily cap. The plan budget and the per-session USD cap still apply.
function Get-DailyCapDecision {
    param([string]$Kind, $Counts, $Config, [switch]$Request)
    $mk = { param([bool]$A, [string]$Why) [pscustomobject]@{ Allowed = $A; Reason = $Why } }
    if ($Request) { return (& $mk $true "a direct request: not counted against the daily $Kind cap") }
    $cap = 0; if ($Config -and $Config[$Kind]) { [void][int]::TryParse("$($Config[$Kind]['maxPerDay'])", [ref]$cap) }
    $used = 0; if ($Counts -and $Counts.Contains($Kind)) { $used = [int]$Counts[$Kind] }
    if ($cap -le 0) { return (& $mk $true "no daily $Kind cap") }
    if ($used -ge $cap) { return (& $mk $false "daily cap reached: $used of $cap $Kind session(s) already started today (sessions.json $Kind.maxPerDay)") }
    return (& $mk $true "$Kind session $($used + 1) of at most $cap today")
}

# Loop log files that may be deleted: older than $KeepDays (by LastWriteTime), except the run data
# (*.rundata.json: the hub's token source) and the main run logs (run-<id>.log: the hub ledger reads them).
# $Files: objects with Name and LastWriteTime (FileInfo). $KeepDays <= 0 = nothing.
function Select-PrunableLogs {
    param([object[]]$Files = @(), [datetime]$Now = (Get-Date), [int]$KeepDays = 30)
    if ($KeepDays -le 0) { return @() }
    $cut = $Now.AddDays(-$KeepDays)
    return @($Files | Where-Object { $_ -and $_.LastWriteTime -lt $cut -and "$($_.Name)" -notmatch '\.rundata\.json$' -and "$($_.Name)" -notmatch '^run-\d{8}-\d{6}\.log$' })
}

# The KNOWN_ISSUES block for a proposal / review header, from ONE
# `gh issue list --state all --json number,title,state,labels,author,closedAt` (the runner's, before the session).
# Lists every loop proposal (open by state; closed split into deployed and rejected-or-failed) plus Ve's own
# open issues and Ve's open device-feedback issues. Titles are made single-line and shortened. Only issues
# labelled loop:proposal or written by $Owner are listed (anyone else's issue is untrusted and left out).
# Deployed ones are listed only when closed within $DeployedDays (0 = all); at most $Max issues in all, the
# oldest deployed ones dropped first. Dropped ones are counted, not listed. Returns lines.
# The METRICS lines for a proposal / review header: one line per window from the runner's own GET of
# /api/metrics/summary?days=<n>. $Results: ordered days -> the parsed summary, or a string (why it is unavailable).
# The per-day breakdown (`daily`) and `generatedAt` are left out; the rest is compact JSON, made safe (no markers,
# no mentions) and bounded. Counts only, data never instructions.
function Format-MetricsDigest {
    param([System.Collections.IDictionary]$Results, [int]$MaxChars = 2500)
    $out = @()
    # entries, not $Results[$d]: an int key on an ordered dictionary indexes by position
    foreach ($e in $Results.GetEnumerator()) {
        $d = $e.Key; $v = $e.Value
        if ($null -eq $v -or $v -is [string]) { $out += "  days=${d}: unavailable ($(ConvertTo-SafeLine "$v" 120)); say so and use the other evidence"; continue }
        $o = [ordered]@{}
        foreach ($p in $v.PSObject.Properties) { if ($p.Name -notin @('daily', 'generatedAt')) { $o[$p.Name] = $p.Value } }
        $out += "  days=${d}: $(ConvertTo-SafeLine ($o | ConvertTo-Json -Depth 6 -Compress) $MaxChars)"
    }
    return @($out)
}

function Format-KnownIssues {
    param([object[]]$Issues = @(), [string]$Owner = 'vekbui96', [int]$Max = 150, [int]$TitleMax = 64, [int]$DeployedTitleMax = 48, [int]$DeployedDays = 0, [datetime]$Now = (Get-Date),
        [hashtable]$Approvals = @{})
    $all = @($Issues | Where-Object { $_ } | Sort-Object { [int]$_.number } -Descending)
    $lab = { param($i) @($i.labels | ForEach-Object { if ($_.name) { "$($_.name)" } else { "$_" } }) }
    $who = { param($i) if ($i.author -and $i.author.login) { "$($i.author.login)" } else { "$($i.author)" } }
    $line = { param($i, [string]$Tag, [int]$Len = $TitleMax) $t = ConvertTo-SafeLine "$($i.title)" $Len; if ($Tag) { "  #$($i.number) [$Tag] $t" } else { "  #$($i.number) $t" } }
    $loop = @($all | Where-Object { (& $lab $_) -contains 'loop:proposal' })
    $open = @($loop | Where-Object { "$($_.state)" -match '^(?i)open$' })
    $closed = @($loop | Where-Object { "$($_.state)" -notmatch '^(?i)open$' })
    $deployed = @($closed | Where-Object { (& $lab $_) -contains 'loop:deployed' })
    $rejected = @($closed | Where-Object { (& $lab $_) -notcontains 'loop:deployed' })
    $own = @($all | Where-Object { "$($_.state)" -match '^(?i)open$' -and (& $who $_) -eq $Owner -and (& $lab $_) -notcontains 'loop:proposal' })
    $fb = @($own | Where-Object { (& $lab $_) -contains 'device-feedback' })
    $own = @($own | Where-Object { (& $lab $_) -notcontains 'device-feedback' })
    $room = [math]::Max(0, $Max - $open.Count - $rejected.Count - $own.Count - $fb.Count)
    $dropped = 0
    if ($DeployedDays -gt 0) {
        $since = $Now.AddDays(-$DeployedDays)
        $recent = @($deployed | Where-Object { $c = [datetime]::MinValue; [datetime]::TryParse("$($_.closedAt)", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$c) -and $c.ToLocalTime() -ge $since })
        $dropped = $deployed.Count - $recent.Count; $deployed = $recent
    }
    if ($deployed.Count -gt $room) { $dropped += $deployed.Count - $room; $deployed = @($deployed | Select-Object -First $room) }
    $out = @()
    $out += "open loop proposals ($($open.Count)):"
    foreach ($i in $open) {
        $l = & $lab $i
        $tag = 'awaiting review'
        $via = ''; if ($Approvals.ContainsKey([int]$i.number) -and "$($Approvals[[int]$i.number])" -like 'via-spec*') { $via = "$($Approvals[[int]$i.number])" }
        if ($l -contains 'loop:in-progress') { $tag = 'in progress' } elseif ($l -contains 'loop:failed') { $tag = 'failed' } elseif ($l -contains 'approved') { $tag = 'approved' } elseif ($via) { $tag = "auto-approved $via" }
        if ($l -contains 'loop:spec') { $tag = "spec, $tag" }
        if ($l -contains 'loop:product-review') { $tag = 'product review' }
        $out += (& $line $i $tag)
    }
    $out += "closed without loop:deployed = rejected or failed, never re-propose these or a close variant ($($rejected.Count)):"
    foreach ($i in $rejected) { $tag = ''; if ((& $lab $i) -contains 'loop:spec') { $tag = 'spec' }; $out += (& $line $i $tag) }
    $out += "deployed, closed$(if ($DeployedDays -gt 0) { " in the last $DeployedDays days" }) ($($deployed.Count)$(if ($dropped) { "; $dropped earlier ones not listed, they are in the code" })):"
    foreach ($i in $deployed) { $out += (& $line $i '' $DeployedTitleMax) }
    $out += "Ve's own open issues ($($own.Count)):"
    foreach ($i in $own) { $out += (& $line $i '') }
    $out += "Ve's open device-feedback issues ($($fb.Count)):"
    foreach ($i in $fb) { $out += (& $line $i '') }
    return @($out)
}

# The session settings: $SessionDefaults overlaid with the parsed sessions.json ($Json, may be $null).
# Unknown keys are ignored; empty values keep the default.
function Get-SessionConfig {
    param($Json)
    $cfg = [ordered]@{}
    foreach ($k in $script:SessionDefaults.Keys) {
        $c = [ordered]@{}; foreach ($f in $script:SessionDefaults[$k].Keys) { $c[$f] = $script:SessionDefaults[$k][$f] }
        if ($Json -and $Json.PSObject.Properties.Name -contains $k -and $Json.$k) {
            foreach ($p in $Json.$k.PSObject.Properties) { if ($c.Contains($p.Name) -and $null -ne $p.Value -and "$($p.Value)" -ne '') { $c[$p.Name] = $p.Value } }
        }
        $cfg[$k] = $c
    }
    return $cfg
}

# The model for a session. -Override (run-loop -Model) wins. A build: Get-BuildModelChoice.
function Get-SessionModel {
    param([string]$Kind, [string[]]$Labels = @(), $Config, [string]$Override = '', [bool]$OpusRetry = $false, [bool]$ServerDeploy = $false)
    if ($Override) { return $Override }
    if ($Kind -eq 'build') { return (Get-BuildModelChoice -Labels $Labels -Config $Config -OpusRetry $OpusRetry -ServerDeploy $ServerDeploy).Model }
    return "$($Config[$Kind].model)"
}

# The model of one build session and why (Ve's rule of 2026-11-23: builds on Sonnet, Opus only when needed), first match:
#   1. -Override (run-loop -Model)
#   2. a build.opusLabels label on the issue (model:opus; Ve adds it before approving)      -> build.opusModel
#   3. the ONE automatic retry of a non-Opus build that failed because of the change
#      (check-approval.ps1 -List `opusRetry`, gate-rules.ps1 Get-RetryDecision .Opus)          -> build.opusModel
#   4. the proposal says up front that it deploys the server ("## What deploys": Pages + server;
#      check-approval.ps1 -List `serverDeploy`, Test-ProposalNeedsServer)                       -> build.opusModel
#   5. a build.smallLabels label (size:small, test-only)                                       -> build.smallModel
#   6. otherwise build.model (Sonnet)
# The plan budget's no-opus verdict defers only the builds this returns an Opus model for (Split-BuildableByBudget).
function Get-BuildModelChoice {
    param([string[]]$Labels = @(), $Config, [string]$Override = '', [bool]$OpusRetry = $false, [bool]$ServerDeploy = $false)
    $c = $Config['build']
    $mk = { param([string]$M, [string]$Why) [pscustomobject]@{ Model = $M; Why = $Why; Opus = ($M.Trim() -eq '' -or $M -match 'opus') } }
    if ($Override) { return (& $mk $Override '-Model override') }
    $opus = "$($c.opusModel)"; if (-not $opus) { $opus = 'claude-opus-5-5' }
    $ol = @($Labels | Where-Object { @($c.opusLabels) -contains $_ })
    if ($ol.Count -gt 0) { return (& $mk $opus "label $($ol[0])") }
    if ($OpusRetry) { return (& $mk $opus 'automatic retry of a non-Opus build that failed on the change') }
    if ($ServerDeploy) { return (& $mk $opus 'the proposal deploys the server') }
    $sl = @($Labels | Where-Object { @($c.smallLabels) -contains $_ })
    if ($c.smallModel -and $sl.Count -gt 0) { return (& $mk "$($c.smallModel)" "label $($sl[0])") }
    return (& $mk "$($c.model)" 'default build model')
}

# Does the proposal say up front that the change deploys the server? Its "## What deploys" section (LOOP.md section 5
# proposal format: "Pages only" OR "Pages + server (files: ...)"). "Pages only" anywhere in it = no; else any mention
# of the server = yes; no such section = no (unknown up front: the build decides, LOOP.md section 3).
function Test-ProposalNeedsServer {
    param([string]$Body = '')
    $m = [regex]::Match("$Body", '(?ms)^\s*##\s*What deploys\s*$(.*?)(?=^\s*##\s|\z)')
    if (-not $m.Success) { return $false }
    $t = $m.Groups[1].Value
    if ($t -match '(?i)\bpages\s+only\b') { return $false }
    return ($t -match '(?i)\bserver\b')
}

# The run's time budget: the requested minutes (run-loop -TimeoutMinutes), cut so the run ends at least -MarginMinutes
# before the scheduled task's ExecutionTimeLimit (Task Scheduler kills the task there, mid-session). -TaskLimitMinutes
# 0 = unknown (not readable): the request stands. Minutes + Reason.
function Get-RunTimeBudget {
    param([int]$Requested = 360, [double]$TaskLimitMinutes = 0, [int]$MarginMinutes = 30)
    $mk = { param([int]$M, [string]$Why) [pscustomobject]@{ Minutes = $M; Reason = $Why } }
    if ($TaskLimitMinutes -le 0) { return (& $mk $Requested "$Requested min (task time limit unknown)") }
    $cap = [int][math]::Floor($TaskLimitMinutes - $MarginMinutes)
    if ($cap -lt $Requested) { return (& $mk ([math]::Max(60, $cap)) "$([math]::Max(60, $cap)) min: cut from $Requested to stay $MarginMinutes min inside the task's $([int]$TaskLimitMinutes)-min ExecutionTimeLimit") }
    return (& $mk $Requested "$Requested min (task limit $([int]$TaskLimitMinutes) min)")
}

# May the runner start another build session? $Done: the build sessions so far ({Issue; Outcome}, Outcome
# deployed | skipped | failed | rolled-back | unknown). A skipped build (the server rule, or the approval no
# longer valid) does not count toward MaxBuilds; any outcome but deployed or skipped ends Phase A.
# The first build needs FirstBuildMinMinutes left, every later one SecondBuildMinMinutes (alias NextBuildMinMinutes;
# default 100: a build takes ~60-75 min, a session's own limit is cut to what is left, and LOOP.md section 3 step 9
# stops before the merge when time runs short). With the 360-min run: 4 builds of up to ~85 min each fit.
function Get-NextBuildDecision {
    param([int[]]$Buildable = @(), [object[]]$Done = @(), [int]$MaxBuilds = 4, [double]$RemainingMinutes = 0,
        [Alias('NextBuildMinMinutes')][int]$SecondBuildMinMinutes = 100, [int]$FirstBuildMinMinutes = 60, [int]$MaxSkips = 2)
    $done = @($Done | Where-Object { $_ })
    $stop = { param([string]$Why) [pscustomobject]@{ Start = $false; Issue = 0; Reason = $Why } }
    $bad = @($done | Where-Object { $_.Outcome -notin @('deployed', 'skipped') })
    if ($bad.Count -gt 0) { return (& $stop "#$($bad[0].Issue) ended $($bad[0].Outcome): no further build this run") }
    $built = @($done | Where-Object { $_.Outcome -eq 'deployed' }).Count
    $skips = @($done | Where-Object { $_.Outcome -eq 'skipped' }).Count
    if ($built -ge $MaxBuilds) { return (& $stop "MaxBuilds ($MaxBuilds) reached") }
    if ($skips -ge $MaxSkips) { return (& $stop "$skips issue(s) skipped this run (server rule, approval or scope); not trying more") }
    $tried = @($done | ForEach-Object { [int]$_.Issue })
    $cand = @($Buildable | Where-Object { $tried -notcontains [int]$_ })
    if ($cand.Count -eq 0) { if ($done.Count -eq 0) { return (& $stop 'nothing buildable') } else { return (& $stop 'nothing more buildable') } }
    $need = $FirstBuildMinMinutes; if ($built -ge 1) { $need = $SecondBuildMinMinutes }
    if ($RemainingMinutes -lt $need) { return (& $stop "$([int]$RemainingMinutes) min left before the deadline; a build needs $need") }
    return [pscustomobject]@{ Start = $true; Issue = [int]$cand[0]; Reason = "build #$($cand[0]) ($($built + 1) of at most $MaxBuilds)" }
}

# How a build session left its issue, from the issue's labels afterwards and its LOOP-ISSUE-END word.
# deployed | failed | rolled-back | skipped (no state label at all: left untouched) | unknown.
# A scope refusal (LOOP.md section 3 step 3: loop:failed with LOOP-ISSUE-END <n> skipped) is 'skipped' too, so the next
# approved issue is built in the same run, but ONLY when $Merged is false (nothing was merged in that session, so nothing
# was deployed either); with a merge it stays 'failed' and ends Phase A like every real failure and rollback.
function Get-BuildOutcome {
    param([string[]]$Labels = @(), [string]$MarkerOutcome = '', [bool]$Merged = $false)
    if ($Labels -contains 'loop:deployed') { return 'deployed' }
    if ($Labels -contains 'loop:failed') {
        if ("$MarkerOutcome" -match '^rolled') { return 'rolled-back' }
        if ("$MarkerOutcome".Trim() -eq 'skipped' -and -not $Merged) { return 'skipped' }
        return 'failed'
    }
    if ($Labels -contains 'loop:in-progress') { return 'unknown' }
    if ("$MarkerOutcome" -match '^(deployed|fail|rolled)') { return 'unknown' }   # it said so, but the labels disagree
    return 'skipped'
}

# Did a build session leave production in a known state? $MergeRec (state\merge-<n>.json), $DeployRec
# (state\deploy-<n>.json), $RollbackRec (state\rollback-<n>.json). Certain when nothing was merged in the
# session, or the merge was deployed and verified (DEPLOY OK), or rolled back and verified (DEPLOY
# ROLLED-BACK, ROLLBACK OK). Anything else after a merge (no deploy, a deploy killed half way, a precondition
# failure without the revert, a failed rollback) is uncertain: the run stops there and waits for the owner.
function Get-DeployCertainty {
    param($SessionStart, $MergeRec, $DeployRec, $RollbackRec)
    $mk = { param([bool]$Certain, [string]$State, [string]$Why, [string]$Sha = '') [pscustomobject]@{ Certain = $Certain; State = $State; Reason = $Why; MergeSha = $Sha } }
    if (-not $MergeRec -or -not $MergeRec.mergedUtc) { return (& $mk $true 'none' 'nothing merged') }
    $start = [datetime]::MinValue; if ($SessionStart) { $start = ([datetime]$SessionStart).ToUniversalTime() }
    $merged = ([datetime]$MergeRec.mergedUtc).ToUniversalTime()
    if ($merged -lt $start) { return (& $mk $true 'none' 'nothing merged in this session') }
    $sha = "$($MergeRec.mergeSha)"; $s7 = $sha; if ($s7.Length -gt 7) { $s7 = $s7.Substring(0, 7) }
    $rb = ''; if ($RollbackRec -and "$($RollbackRec.mergeSha)" -eq $sha) { $rb = "$($RollbackRec.status)" }
    $dp = ''; if ($DeployRec -and "$($DeployRec.mergeSha)" -eq $sha) { $dp = "$($DeployRec.status)" }
    if ($rb -match '^ROLLBACK OK') { return (& $mk $true 'rolled-back' "merged as $s7, then rolled back and verified" $sha) }
    if ($dp -match '^DEPLOY OK') { return (& $mk $true 'deployed' "merged as $s7, deployed and verified" $sha) }
    if ($dp -match '^DEPLOY ROLLED-BACK') { return (& $mk $true 'rolled-back' "merged as $s7, the deploy failed and was rolled back" $sha) }
    $why = "merged as $s7 but the deploy was not verified"
    if ($rb) { $why += " (rollback: $rb)" } elseif ($dp) { $why += " (deploy: $dp)" } else { $why += ' (no deploy record)' }
    return (& $mk $false 'uncertain' $why $sha)
}

# The run's LOOP-RESULT from its sessions ({Kind; Issue; Status = OK | NOTHING-TO-DO | FAILED | ''; Reason;
# Ok = claude exited 0 without is_error}) and the runner's own findings ($Problems). FAILED wins, then OK.
function Get-RunResult {
    param([object[]]$Sessions = @(), [string[]]$Problems = @())
    $ss = @($Sessions | Where-Object { $_ })
    $fails = @($Problems | Where-Object { $_ })
    foreach ($s in $ss) {
        $who = "$($s.Kind)"; if ($s.Issue) { $who += " #$($s.Issue)" }
        if ("$($s.Status)" -eq 'FAILED') { $r = "$($s.Reason)".Trim(); if (-not $r) { $r = 'failed' }; $fails += "${who}: $r" }
        elseif ("$($s.Status)" -notin @('OK', 'NOTHING-TO-DO')) { $fails += "${who}: no LOOP-RESULT (the session ended without its summary)" }
        elseif (-not $s.Ok) { $fails += "${who}: claude exited with an error" }
    }
    if ($fails.Count -gt 0) { return [pscustomobject]@{ Status = 'FAILED'; Line = "LOOP-RESULT: FAILED $($fails -join '; ')" } }
    if (@($ss | Where-Object { $_.Status -eq 'OK' }).Count -gt 0) { return [pscustomobject]@{ Status = 'OK'; Line = 'LOOP-RESULT: OK' } }
    return [pscustomobject]@{ Status = 'NOTHING-TO-DO'; Line = 'LOOP-RESULT: NOTHING-TO-DO' }
}

# ==================================================================================================
# wait-ci.ps1: one blocking wait for the required CI jobs on a PR head, one result line.
# ==================================================================================================
# The tail of `gh run view <id> --log-failed` for the session: drops the "<job>\t<step>\t<timestamp> " prefix
# and ANSI codes, keeps the last -Lines lines of each failed job.
function Get-CiLogTail {
    param([string]$Log, [int]$Lines = 40)
    $byJob = [ordered]@{}
    foreach ($l in ("$Log" -split "`r?`n")) {
        if (-not $l.Trim()) { continue }
        $parts = $l -split "`t", 3
        $job = 'log'; $text = $l
        if ($parts.Count -eq 3) { $job = $parts[0]; $text = $parts[2] }
        $text = $text -replace '\x1b\[[0-9;]*[A-Za-z]', '' -replace '^\d{4}-\d\d-\d\dT[\d:.]+Z ?', ''
        if (-not $byJob.Contains($job)) { $byJob[$job] = New-Object System.Collections.ArrayList }
        [void]$byJob[$job].Add($text)
    }
    $out = @()
    foreach ($j in $byJob.Keys) {
        $all = @($byJob[$j]); $tail = @($all | Select-Object -Last $Lines)
        $out += "--- $j (last $($tail.Count) of $($all.Count) log lines) ---"
        $out += $tail
    }
    return @($out)
}

# The last line wait-ci.ps1 prints, from a Get-CiVerdict result.
function Format-WaitCiLine {
    param($Verdict, [string]$Sha, [double]$WaitedMinutes = 0, [double]$TimeoutMinutes = 45)
    $s7 = "$Sha"; if ($s7.Length -gt 7) { $s7 = $s7.Substring(0, 7) }
    $w = "after $([int]$WaitedMinutes) min"
    switch ($Verdict.State) {
        'ok' { return "WAIT-CI PASS $s7 ${w}: $($Verdict.Summary)" }
        'failed' {
            $jobs = @($Verdict.Failed | ForEach-Object { ("$_" -split ': ', 2)[0] }) -join ', '
            return "WAIT-CI FAIL $s7 $w; failed jobs: $jobs"
        }
        'refuse' { return "WAIT-CI REFUSED $s7 $w; $($Verdict.Refuse -join '; ') (not a test failure: a skipped, cancelled or missing job)" }
        default {
            if ($WaitedMinutes -ge $TimeoutMinutes) { return "WAIT-CI TIMEOUT $s7 still running $w (cap $([int]$TimeoutMinutes) min): $($Verdict.Summary)" }
            return "WAIT-CI PENDING $s7 ${w}: $($Verdict.Summary) (call wait-ci.ps1 again)"
        }
    }
}

# ---- CI red on main ------------------------------------------------------------------------------------
# On 2026-11-23/24 v2 Visual Regression failed on main itself 7 times (a flaky Home "prices rate limited" shot,
# fixed on main by 0a3704a). Every PR inherits a red main, so #303 and #304 were built, went red on a failure
# that was not theirs, were classed `other` (no automatic retry) and died. Two rules:
#   wait-ci.ps1   a PR failure that is the SAME failure as on main is labelled MAIN-RED: no fix round, class
#                 ci-infra (Get-MainRedDecision)
#   run-loop.ps1  no build session starts while a required CI job is red on main's latest finished CI run
#                 (Select-LatestMainCiRun + Get-RequiredFailedJobs)

# The latest finished CI run of main from GET repos/<r>/actions/runs?branch=main (workflow_runs): name CI,
# completed, success or failure (a cancelled run, superseded by a newer push, says nothing). $null if none.
function Select-LatestMainCiRun {
    param([object[]]$Runs, [string]$Workflow = 'CI')
    $c = @($Runs | Where-Object { $_ -and "$($_.name)" -eq $Workflow -and "$($_.head_branch)" -eq 'main' -and "$($_.status)" -eq 'completed' -and "$($_.conclusion)" -in @('success', 'failure') } |
            Sort-Object { "$($_.created_at)" } -Descending)
    if ($c.Count -eq 0) { return $null }
    return $c[0]
}

# Names of the REQUIRED jobs ($CiRequiredJobs) that failed, from a jobs list (GET .../runs/<id>/jobs: name,
# conclusion) or check runs.
function Get-RequiredFailedJobs {
    param([object[]]$Jobs, [object[]]$Required = $script:CiRequiredJobs)
    $out = @()
    foreach ($req in $Required) {
        $hit = @($Jobs | Where-Object { $_ -and "$($_.name)" -match $req.Pattern -and "$($_.conclusion)" -in @('failure', 'timed_out') })
        if ($hit.Count -gt 0) { $out += $req.Name }
    }
    return @($out)
}

# Failing Playwright tests in a `gh run view <id> --log-failed` text, as "<spec> > <title>" with the project and
# the line:column dropped (the line differs between branches; a flaky test fails at phone width in one run and
# at desktop width in the next), e.g. "e2e/v2/home.spec.ts > prices in flight @visual > prices rate limited".
# The GitHub annotation line ("::error ...title=...,line=83,col=42::  1) ...%0A ...") yields the same id: the
# title is cut at ",line=" and at the first encoded newline. Unique, sorted.
function Get-FailingTestIds {
    param([string]$Log)
    $ids = @()
    # Playwright separates the parts with U+203A (or '>' in some reporters); headers may end in a U+2500 rule
    # (built from char codes: this file stays ASCII, which Windows PowerShell 5.1 reads without a BOM)
    $sep = '\s+(?:' + [char]0x203A + '|>)\s+'
    $rx = '\[([\w.-]+)\]' + $sep + '((?:e2e/)?[\w./-]+\.spec\.ts):\d+:\d+' + $sep + '(.+?)[\s' + [char]0x2500 + ']*$'
    foreach ($l in ("$Log" -split "`r?`n")) {
        $t = ($l -replace '\x1b\[[0-9;]*[A-Za-z]', '')
        $m = [regex]::Match($t, $rx)
        if (-not $m.Success) { continue }
        $spec = $m.Groups[2].Value; if (-not $spec.StartsWith('e2e/')) { $spec = "e2e/$spec" }
        $title = $m.Groups[3].Value
        $title = ($title -split '%0A', 2)[0]
        $title = ($title -replace ',line=\d+,col=\d+::.*$', '')
        $title = ($title -replace $sep, ' > ' -replace ('[\s' + [char]0x2500 + ']+$'), '').Trim()
        if ($title) { $ids += "$spec > $title" }
    }
    return @($ids | Sort-Object -Unique)
}

# Is a PR's CI failure the same one main has? -PrJobs / -MainJobs: names of the failed required jobs.
# -PrTests / -MainTests: Get-FailingTestIds of each failed log. State:
#   main-red  every failed PR job also fails on main, and every failing PR test also fails there (or no test
#             could be parsed on either side): not caused by this change -> no fix round, class ci-infra
#   mixed     some failures are main's, some only here (OnlyHere): fix only those
#   own       nothing in common with main: an ordinary CI fix round
function Get-MainRedDecision {
    param([string[]]$PrJobs = @(), [string[]]$MainJobs = @(), [string[]]$PrTests = @(), [string[]]$MainTests = @())
    $pj = @($PrJobs | Where-Object { $_ }); $mj = @($MainJobs | Where-Object { $_ })
    $pt = @($PrTests | Where-Object { $_ }); $mt = @($MainTests | Where-Object { $_ })
    $sharedJobs = @($pj | Where-Object { $mj -contains $_ })
    $mk = { param([string]$S, [string[]]$Shared, [string[]]$Only, [string]$Why) [pscustomobject]@{ State = $S; Shared = @($Shared); OnlyHere = @($Only); Why = $Why } }
    if ($pj.Count -eq 0 -or $sharedJobs.Count -eq 0) { return (& $mk 'own' @() @($pt) 'main is not red in the same job') }
    $onlyJobs = @($pj | Where-Object { $mj -notcontains $_ })
    if ($pt.Count -gt 0 -and $mt.Count -gt 0) {
        $sharedT = @($pt | Where-Object { $mt -contains $_ }); $onlyT = @($pt | Where-Object { $mt -notcontains $_ })
        if ($sharedT.Count -eq 0) { return (& $mk 'own' @() @($pt) "main is red in $($sharedJobs -join ', ') too, but on other tests") }
        if ($onlyT.Count -eq 0 -and $onlyJobs.Count -eq 0) { return (& $mk 'main-red' $sharedT @() "the same tests fail on main: $($sharedT -join '; ')") }
        return (& $mk 'mixed' $sharedT (@($onlyT) + @($onlyJobs)) "failing on main too: $($sharedT -join '; '); only here: $((@($onlyT) + @($onlyJobs)) -join '; ')")
    }
    if ($onlyJobs.Count -eq 0) { return (& $mk 'main-red' $sharedJobs @() "the same job fails on main ($($sharedJobs -join ', ')); no test names to compare") }
    return (& $mk 'mixed' $sharedJobs $onlyJobs "failing on main too: $($sharedJobs -join ', '); only here: $($onlyJobs -join ', ')")
}

# Failure classes. The session writes the class of every build failure as a marker line in its final
# failure comment (LOOP.md section 3, "Failure classes"); run-loop.ps1 writes timeout / max-turns /
# max-budget / session-ended itself when the session stopped mid-build. Retryable = the cause was outside the change, so
# the same approved change may be built once more without the owner.
$script:RetryableFailures = [ordered]@{
    'ci-infra'           = 'CI infrastructure (a runner, network or GitHub problem, or a required job cancelled or never started)'
    'ci-timeout'         = 'CI did not finish in time (MERGE-PR CI-TIMEOUT)'
    'gap-refused'        = 'merge refused by the live-server gap rule (commits already on main, not this change)'
    'deploy-unavailable' = 'the elevated deploy task or its lock was unavailable'
    'out-of-time'        = 'the run ran out of time before the merge'
    'timeout'            = 'the run hit its time limit mid-build'
    'max-turns'          = 'the session hit its turn limit mid-build'
    'max-budget'         = 'the session hit its USD cap (sessions.json maxBudgetUsd) mid-build'
}
$script:ChangeFailures = [ordered]@{
    'tests'         = 'tests or CI still failed after the fix rounds'
    'guard-refused' = 'refused because of the change''s own diff (protected path, secret or CORS line, guard)'
    'scope'         = 'out of scope for the loop (rule 8, config, or too large for one run)'
    'deploy-failed' = 'deploy or live verification failed and was rolled back'
    'session-ended' = 'the session stopped mid-build with work that needs a look (e.g. merged but not verified)'
    'qa'            = 'QA on the PR preview still failed (a failed criterion or a regression) after the one fix round'
    'held'          = 'not merged: the approval no longer verified after the preview (Ve held it or withdrew the approval)'
    'other'         = 'other failure'
}
# The marker may name the build's model (model=<id>, from the session's MODEL header line); markers without it (all
# before 2026-11-23) never get the Opus retry of a change failure.
$script:FailureMarkerRx = '<!--\s*innovation-loop:failure\s+class=([a-z][a-z-]*)\s+outcome=([a-z][a-z-]*)(?:\s+model=([A-Za-z0-9._\[\]-]+))?\s*-->'
# A failure of a NON-Opus build in one of these classes is built once more on Opus (Get-RetryDecision .Opus): the change
# itself may need the stronger model. Infrastructure classes (ci-infra, ci-timeout, gap-refused, deploy-unavailable,
# out-of-time, timeout) are retried on the same model; guard-refused, scope, deploy-failed (rolled back) and
# session-ended are never retried automatically.
$script:OpusRetryClasses = @('tests', 'other', 'max-turns', 'max-budget')

function Format-FailureMarker {
    param([string]$Class, [string]$Outcome = 'failed', [string]$Model = '')
    $c = "$Class".ToLowerInvariant(); if (-not ($script:RetryableFailures.Contains($c) -or $script:ChangeFailures.Contains($c))) { $c = 'other' }
    $o = "$Outcome".ToLowerInvariant(); if ($o -notin @('failed', 'rolled-back', 'skipped')) { $o = 'failed' }
    $m = ''; if ("$Model" -match '^[A-Za-z0-9._\[\]-]+$') { $m = " model=$Model" }
    return "<!-- innovation-loop:failure class=$c outcome=$o$m -->"
}

# Failure markers in $Comments (issue comments API objects) written by -Owner with the loop -Marker, created
# after -Since (the approval being built). Oldest first. Comments by anyone else never count.
function Get-FailureRecords {
    param([object[]]$Comments, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', $Since = $null)
    $sinceT = $null; if ($Since) { $sinceT = [datetime]$Since }
    $out = @()
    foreach ($c in @($Comments | Where-Object { $_ } | Sort-Object { [datetime]$_.created_at })) {
        if ("$($c.user.login)" -ne $Owner) { continue }
        $b = "$($c.body)"; if (-not $b.Contains($Marker) -or (Test-AgentComment $c)) { continue }
        if ($sinceT -and ([datetime]$c.created_at) -le $sinceT) { continue }
        $m = [regex]::Match($b, $script:FailureMarkerRx)
        if (-not $m.Success) { continue }
        $out += [pscustomobject]@{ Class = $m.Groups[1].Value; Outcome = $m.Groups[2].Value; Model = $m.Groups[3].Value; At = $c.created_at; Id = $c.id }
    }
    return @($out)
}

function Get-FailureDescription {
    param([string]$Class)
    if ($script:RetryableFailures.Contains($Class)) { return $script:RetryableFailures[$Class] }
    if ($script:ChangeFailures.Contains($Class)) { return $script:ChangeFailures[$Class] }
    return "unknown failure class '$Class'"
}

# May an approved issue carrying loop:failed be built again without the owner? Once, and only when nothing
# went live and the latest failure since the approval was either outside the change, or caused by the change on a
# NON-Opus model in one of $OpusRetryClasses (then the retry runs on Opus: Opus = $true). Returns Failed (has
# loop:failed), Retry, Opus, Class and Reason (for "failed, waiting on the owner: #n (<reason>)").
function Get-RetryDecision {
    param([string[]]$Labels, [object[]]$Failures)
    $fs = @($Failures | Where-Object { $_ })
    $last = $null; if ($fs.Count -gt 0) { $last = $fs[$fs.Count - 1] }
    $class = ''; if ($last) { $class = "$($last.Class)" }
    $model = ''; if ($last -and $last.PSObject.Properties.Name -contains 'Model') { $model = "$($last.Model)" }
    $nonOpus = ($model -ne '' -and $model -notmatch 'opus')
    $toOpus = ($nonOpus -and $script:OpusRetryClasses -contains $class)
    $failed = ($Labels -contains 'loop:failed')
    $mk = { param([bool]$Retry, [string]$Why, [bool]$Opus = $false) [pscustomobject]@{ Failed = $failed; Retry = $Retry; Opus = $Opus; Class = $class; Reason = $Why } }
    if (-not $failed) { return (& $mk $false '') }
    if ($Labels -contains 'loop:retried') {
        $d = 'failed again after the one automatic retry'; if ($class) { $d = "${class}, after the one automatic retry: $(Get-FailureDescription $class)" }
        return (& $mk $false $d)
    }
    if (-not $last) { return (& $mk $false 'failure not classified (no failure marker); not retried automatically') }
    if ($fs.Count -gt 1) { return (& $mk $false "${class}, failed $($fs.Count) times since the approval: $(Get-FailureDescription $class)") }
    if ("$($last.Outcome)" -eq 'rolled-back') { return (& $mk $false "${class}, rolled back (something went live or main was reverted): $(Get-FailureDescription $class)") }
    if ($script:RetryableFailures.Contains($class)) {
        if ($toOpus) { return (& $mk $true "${class} on ${model}: $(Get-FailureDescription $class); retried once automatically, on Opus" $true) }
        return (& $mk $true "${class}: $(Get-FailureDescription $class); retried once automatically")
    }
    if ($toOpus) { return (& $mk $true "${class} on ${model}: $(Get-FailureDescription $class); retried once automatically, on Opus" $true) }
    return (& $mk $false "${class}: $(Get-FailureDescription $class)")
}

# ---- plan budget -------------------------------------------------------------------------------------
# The ops hub writes D:\hub\state\plan-budget.json every 15 min (schema 1): verdict normal | no-opus | hold
# from the Max plan's 5-hour and weekly utilization, which the loop shares with Ve's interactive use. The
# runner (never claude) reads it before every session. It FAILS OPEN: the hub is optional and the plan's own
# limits are the backstop, so a missing, unreadable, unknown-schema, unknown-verdict or stale file means
# normal (with Warn = $true, logged as a WARN).
$script:PlanBudgetPath = 'D:\hub\state\plan-budget.json'
$script:PlanBudgetVerdicts = @('normal', 'no-opus', 'hold')

# $Text: the file's content ($null / '' when the file is missing); $ReadError: why it could not be read.
# Returns Verdict (normal | no-opus | hold), Reason (one line for the log and summary), Warn (fell open).
function Get-PlanBudgetVerdict {
    param([AllowNull()][AllowEmptyString()][string]$Text, [datetime]$NowUtc = [datetime]::UtcNow, [switch]$Ignore, [string]$ReadError = '')
    $mk = { param([string]$V, [string]$Why, [bool]$Warn) [pscustomobject]@{ Verdict = $V; Reason = $Why; Warn = $Warn } }
    $open = { param([string]$Why) & $mk 'normal' "plan budget $($Why): treated as normal (fail open)" $true }
    if ($Ignore) { return (& $mk 'normal' 'plan budget not consulted (-IgnoreBudget)' $false) }
    if ($ReadError) { return (& $open "file unreadable ($(ConvertTo-SafeLine $ReadError 120))") }
    if ([string]::IsNullOrWhiteSpace($Text)) { return (& $open 'file missing or empty') }
    try { $j = $Text | ConvertFrom-Json } catch { return (& $open 'file is not valid JSON') }
    if ($null -eq $j -or -not ($j.PSObject.Properties.Name -contains 'schema') -or "$($j.schema)" -ne '1') { return (& $open "schema is not 1 (got '$(ConvertTo-SafeLine "$($j.schema)" 20)')") }
    $v = "$($j.verdict)".Trim().ToLowerInvariant()
    if ($script:PlanBudgetVerdicts -notcontains $v) { return (& $open "verdict '$(ConvertTo-SafeLine $v 20)' is unknown") }
    $gen = $null
    if ($j.generatedAt -is [datetime]) { $gen = $j.generatedAt.ToUniversalTime() }
    else {
        $p = [datetime]::MinValue
        $st = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
        if ([datetime]::TryParse("$($j.generatedAt)", [Globalization.CultureInfo]::InvariantCulture, $st, [ref]$p)) { $gen = $p }
    }
    if ($null -eq $gen) { return (& $open 'generatedAt is missing or not a date') }
    $staleMin = 30; $sv = 0
    if ([int]::TryParse("$($j.staleAfterMinutes)", [ref]$sv) -and $sv -gt 0) { $staleMin = $sv }
    $age = ($NowUtc.ToUniversalTime() - $gen).TotalMinutes
    if ($age -gt $staleMin) { return (& $open "is stale (generated $([int]$age) min ago, stale after $staleMin)") }
    $use = @()
    foreach ($w in @(@('fiveHour', '5h'), @('weekly', 'week'))) {
        $o = $j.($w[0]); if ($o -and $null -ne $o.pct -and "$($o.pct)" -ne '') { $use += "$($w[1]) $($o.pct)%" }
    }
    $why = "plan budget $v (generated $([int][math]::Max(0, $age)) min ago$(if ($use.Count) { '; ' + ($use -join ', ') })"
    $rs = @($j.reasons | Where-Object { "$_".Trim() } | ForEach-Object { ConvertTo-SafeLine "$_" 120 })
    if ($rs.Count -gt 0) { $why += ': ' + ($rs -join '; ') }
    return (& $mk $v ($why + ')') $false)
}

# May a session on $Model start under $Verdict? hold: nothing; no-opus: anything that is not an Opus model
# (an empty model, i.e. claude's own default, counts as Opus); normal: everything.
function Test-BudgetAllowsModel {
    param([string]$Verdict = 'normal', [string]$Model = '')
    if ($Verdict -eq 'hold') { return $false }
    if ($Verdict -eq 'no-opus') { return ($Model.Trim() -ne '' -and $Model -notmatch 'opus') }
    return $true
}

# Phase A under the plan budget: which buildable issues may start now (Allowed, in queue order) and which wait
# (Deferred: {Issue; Model}). A deferred issue stays approved and untouched: no label, no comment, no failure;
# it is simply picked up by the first run whose verdict allows its model. $LabelsOf: issue number -> labels.
# $OpusRetry / $ServerDeploy: the issues check-approval.ps1 -List names in `opusRetry` / `serverDeploy` (Get-BuildModelChoice).
function Split-BuildableByBudget {
    param([int[]]$Buildable = @(), [hashtable]$LabelsOf = @{}, $Config, [string]$Override = '', [string]$Verdict = 'normal', [int[]]$OpusRetry = @(), [int[]]$ServerDeploy = @())
    $allowed = @(); $deferred = @()
    foreach ($n in @($Buildable | Where-Object { $null -ne $_ })) {
        $l = @(); if ($LabelsOf.ContainsKey([int]$n)) { $l = @($LabelsOf[[int]$n]) }
        $m = Get-SessionModel -Kind 'build' -Labels $l -Config $Config -Override $Override -OpusRetry (@($OpusRetry) -contains [int]$n) -ServerDeploy (@($ServerDeploy) -contains [int]$n)
        if (Test-BudgetAllowsModel -Verdict $Verdict -Model $m) { $allowed += [int]$n } else { $deferred += [pscustomobject]@{ Issue = [int]$n; Model = $m } }
    }
    return [pscustomobject]@{ Allowed = @($allowed); Deferred = @($deferred) }
}

# The check run-loop.ps1 makes before starting claude (costs nothing). $Queue: the parsed check-approval.ps1
# -List output, or $null when that failed (then claude is launched as before). Launch = $false only when
# neither phase has anything to do.
# Plan budget: $Budget is Get-PlanBudgetVerdict's result ($null = normal). hold -> Launch = $false, Hold = $true,
# whatever the queue says. $Deferred: buildable issues whose build model the budget does not allow now
# (Split-BuildableByBudget); they do not count as buildable. $PhaseBAllowed: may the proposal / review
# session's model run under the budget (Test-BudgetAllowsModel)?
# Daily caps (Get-DailyCapDecision): $BuildCap / $PhaseBCap are the refusal reasons ('' = not capped). A capped
# kind counts as nothing to do, so a run where every kind with work is capped starts no session ($0).
# Ve's requests: $Intake = requests that need an intake session now and may have one (model allowed by the
# budget); $RequestBuilds = buildable issues that came from a request (not deferred). Both bypass the daily caps
# (-Request) but never the plan budget's hold.
function Get-PrecheckDecision {
    param($Queue, [string]$Mode = 'FULL', $Budget = $null, [int[]]$Deferred = @(), [bool]$PhaseBAllowed = $true,
        [string]$BuildCap = '', [string]$PhaseBCap = '', [int]$Intake = 0, [int[]]$RequestBuilds = @(), $Coordinator = $null, [int]$QaUx = 0, [int[]]$ParkedDue = @())
    $mk = { param([bool]$L, [string]$Why, [bool]$H = $false) [pscustomobject]@{ Launch = $L; Reason = $Why; Hold = $H } }
    if ($Budget -and $Budget.Verdict -eq 'hold') { return (& $mk $false "$($Budget.Reason): no claude session" $true) }
    # a parked via-policy merge whose look window is over (preview-rules.ps1 Get-UnparkDecision) finishes a build that
    # already started: it goes before everything else and the daily build cap does not apply to it
    $pkd = @($ParkedDue | Where-Object { $null -ne $_ })
    if ($Mode -eq 'FULL' -and $pkd.Count -gt 0) { return (& $mk $true "parked merge(s) whose look window is over: $(@($pkd | ForEach-Object { "#$_" }) -join ' ')") }
    if ($Mode -ne 'PRODUCT_REVIEW' -and $Intake -gt 0) { return (& $mk $true "$Intake request(s) of Ve's to plan (intake goes first)") }
    if ($Mode -eq 'FULL' -and $null -ne $Queue -and @($RequestBuilds | Where-Object { $null -ne $_ -and @($Deferred) -notcontains [int]$_ }).Count -gt 0) {
        return (& $mk $true "Ve's request issue(s) buildable: $(@($RequestBuilds | ForEach-Object { "#$_" }) -join ' ') (requests go first; no daily cap)")
    }
    if ($Mode -eq 'PRODUCT_REVIEW') {
        if ($PhaseBCap) { return (& $mk $false "product review: $PhaseBCap") }
        if (-not $PhaseBAllowed) { return (& $mk $false "product review: its model is not allowed by the $($Budget.Reason)") }
        return (& $mk $true 'product review: always runs')
    }
    if ($null -eq $Queue -or $null -eq $Queue.slots) {
        if ($PhaseBCap -and ($BuildCap -or $Mode -ne 'FULL')) { return (& $mk $false "queue check failed, and every session kind is capped ($(@($BuildCap, $PhaseBCap | Where-Object { $_ }) -join '; '))") }
        return (& $mk $true 'queue check failed: launching claude as usual')
    }
    $def = @($Deferred | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ })
    $b = @($Queue.buildable | Where-Object { $null -ne $_ -and $def -notcontains [int]$_ }).Count
    $free = [int]$Queue.slots.free
    $aw = @($Queue.slots.awaitingReview | Where-Object { $null -ne $_ }).Count
    $why = @()
    if ($Mode -eq 'FULL') {
        $why += "$b buildable approved issue(s)"
        if ($def.Count -gt 0) { $why += "$($def.Count) deferred by the plan budget ($(@($def | ForEach-Object { "#$_" }) -join ' '))" }
        if ($b -gt 0 -and $BuildCap) { $why += "builds: $BuildCap" }
    } else { $why += "$Mode (no Phase A)" }
    $why += "$free free proposal slot(s) ($aw awaiting review, cap $($Queue.slots.cap))"
    if ($free -gt 0 -and -not $PhaseBAllowed) { $why += 'the proposal model is not allowed by the plan budget' }
    if ($free -gt 0 -and $PhaseBCap) { $why += "proposals: $PhaseBCap" }
    $pb = ($free -gt 0 -and $PhaseBAllowed -and -not $PhaseBCap)
    # Phase 2 (options.observerPm): Phase B runs only when the coordinator (product-intel.ps1) says the Observer or
    # the PM has work; its caps and the plan budget are already folded into its decision. Idle = no session, $0.
    if ($null -ne $Coordinator) { $pb = [bool]$Coordinator.PhaseB; $why += "phase B: $(if ($pb) { 'observer/pm needed' } else { 'idle (no change to observe, nothing new for the PM)' })" }
    # Phase 3 (options.qaUx): QA / UX sessions the coordinator (product-qa.ps1 Get-QaUxPlan) would start now
    if ($QaUx -gt 0) { $why += "$QaUx QA/UX session(s) due" }
    $launch = (($Mode -eq 'FULL' -and $b -gt 0 -and -not $BuildCap) -or $pb -or ($Mode -ne 'PRODUCT_REVIEW' -and $QaUx -gt 0))
    return (& $mk $launch ($why -join ', '))
}

# "Failed, waiting on <owner>" for the run summary and the run-data comments: one line, '' when none.
function Format-WaitingOnOwner {
    param([object[]]$Waiting, [string]$Who = 'the owner')
    $w = @($Waiting | Where-Object { $_ })
    if ($w.Count -eq 0) { return '' }
    return "Failed, waiting on ${Who}: " + ((@($w | ForEach-Object { "#$($_.issue) ($($_.reason))" })) -join '; ') + '.'
}

# The session stopped (killed at the time limit, turn limit, or exited) while an issue still carried
# loop:in-progress. $EndClass: timeout | max-turns | max-budget | session-ended. $MergeSha: set when merge-pr merged this
# issue in this run (then it is never retried: a merge that was not verified needs the owner).
function Get-UnfinishedFailure {
    param([string]$EndClass, [string]$MergeSha = '', [int]$TimeoutMinutes = 0, [string]$Who = 'the owner')
    $class = $EndClass; if ($class -notin @('timeout', 'max-turns', 'max-budget')) { $class = 'session-ended' }
    if ($MergeSha) { $class = 'session-ended' }
    $what = 'The session ended while this issue was still being built.'
    if ($EndClass -eq 'timeout') { $what = "The run hit its $TimeoutMinutes-minute limit while this issue was being built, and the session was stopped." }
    if ($EndClass -eq 'max-turns') { $what = 'The session hit its turn limit while this issue was being built.' }
    if ($EndClass -eq 'max-budget') { $what = 'The session hit its USD cap (sessions.json maxBudgetUsd) while this issue was being built.' }
    if ($MergeSha) {
        $state = "The change was merged as $MergeSha, but its deploy was not verified in this run. It needs $Who to check the live site and server (and roll back with rollback.ps1 if needed); it is not retried automatically."
    } elseif ($script:RetryableFailures.Contains($class)) {
        $state = 'Nothing was merged, so the live site and server are unchanged. Because the cause was the run''s limit, not the change, the next run retries it once automatically; a PR it opened stays open.'
    } else {
        $state = "Nothing was merged, so the live site and server are unchanged. It is not retried automatically; it waits for $Who."
    }
    return [pscustomobject]@{ Class = $class; Synopsis = "$what $state" }
}

# ==================================================================================================
# Ve's requests (loop:request). Ve files an issue from .github/ISSUE_TEMPLATE/request.yml; the approval watcher
# starts a run at once; the runner's intake session plans it (proposals or a spec that say "From request #N",
# or one question + loop:needs-info, or loop:declined); the runner posts ONE plan comment on the request
# (edited in place as the progress checklist) and adds loop:planned. In "Build it" mode the children are
# approved through the request (Get-ViaRequestDecision) and built ahead of everything else; in "Plan first"
# mode they wait for Ve's `approved` like any proposal. The loop never opens, labels or edits a request
# itself (guard.mjs): only the request's own author, Ve, can.
# ==================================================================================================
$script:RequestLabel = 'loop:request'
$script:RequestPlanMarker = '<!-- innovation-loop:request-plan -->'
$script:RequestSynopsisMarker = '<!-- innovation-loop:request-synopsis -->'
$script:RequestLinkRx = '(?im)^[ \t>*_]*From request #(\d+)\b'
$script:RequestChildrenRx = '<!--\s*innovation-loop:request-children\s+([0-9,\s]*)-->'

# "From request #<n>" in an issue body -> n, or 0.
function Get-RequestLink {
    param([string]$Body)
    $m = [regex]::Match("$Body", $script:RequestLinkRx)
    if (-not $m.Success) { return 0 }
    return [int]$m.Groups[1].Value
}

# The request form's fields from an issue body (GitHub renders a form as "### <label>" sections; an empty
# optional field reads "_No response_"). Mode: build | plan | '' (unknown counts as plan: never auto-approved).
# Urgency: now | normal.
function Get-RequestForm {
    param([string]$Body)
    $sec = @{}
    foreach ($m in [regex]::Matches("$Body", '(?ms)^###[ \t]+([^\r\n]+)\r?\n(.*?)(?=^###[ \t]|\z)')) {
        $v = $m.Groups[2].Value.Trim(); if ($v -eq '_No response_') { $v = '' }
        $sec[($m.Groups[1].Value.Trim() -replace '\s*\([^)]*\)\s*$', '').ToLowerInvariant()] = $v   # "Constraints (optional)" = "constraints"
    }
    $get = { param([string]$k) if ($sec.ContainsKey($k)) { "$($sec[$k])" } else { '' } }
    $mode = ''; $mv = & $get 'mode'
    if ($mv -match '^(?i)\s*build it\b') { $mode = 'build' } elseif ($mv -match '^(?i)\s*plan first\b') { $mode = 'plan' }
    $urg = 'normal'; if ((& $get 'urgency') -match '^(?i)\s*now\b') { $urg = 'now' }
    return [pscustomobject]@{ What = (& $get 'what i want'); Notice = (& $get 'what i should notice'); Constraints = (& $get 'constraints'); Mode = $mode; Urgency = $urg }
}

# Is $Issue a request Ve filed (not something the loop or anyone else opened)? Reasons why not; empty = yes.
function Get-RequestProblems {
    param($Issue, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    $r = @()
    if (-not $Issue) { return @('request not found') }
    if ($Issue.PSObject.Properties.Name -contains 'pull_request' -and $Issue.pull_request) { $r += 'is a pull request' }
    if ("$($Issue.state)" -notmatch '^(?i)open$') { $r += 'request is closed' }
    $l = @(Get-IssueLabelNames $Issue)
    if ($l -notcontains $script:RequestLabel) { $r += "missing label $($script:RequestLabel)" }
    if ($l -contains 'loop:declined') { $r += 'request is loop:declined' }
    $a = Get-IssueAuthor $Issue; if ($a -ne $Owner) { $r += "opened by $a, not $Owner" }
    if ("$($Issue.body)".Contains($Marker)) { $r += 'request body carries the loop marker (the loop never files requests)' }
    return @($r)
}

# The runner's plan comment on a request (owner + loop marker + plan marker), oldest first, or $null.
function Find-RequestPlanComment {
    param([object[]]$Comments, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    foreach ($c in @($Comments | Where-Object { $_ } | Sort-Object { [datetime]$_.created_at })) {
        if ("$($c.user.login)" -eq $Owner -and "$($c.body)".Contains($Marker) -and "$($c.body)".Contains($script:RequestPlanMarker) -and -not (Test-AgentComment $c)) { return $c }
    }
    return $null
}
# The child issue numbers the plan comment lists (<!-- innovation-loop:request-children 12,13 -->).
function Get-RequestPlanChildren {
    param([string]$Body)
    $m = [regex]::Match("$Body", $script:RequestChildrenRx)
    if (-not $m.Success) { return @() }
    return @($m.Groups[1].Value -split '[,\s]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
}

# ==================================================================================================
# Queue drain. The approval watcher starts a run on an approval, a request or a refill; approved work left over after a
# run (MaxBuilds reached, time ran out, a deferred build) waited for the daily run. At the end of every FULL run the
# runner writes <LOOP_HOME>\state\drain.json (New-DrainState: the queue as check-approval.ps1 -List saw it at the end,
# with the builds that would need Opus, and the last runs' history); the watcher reads that file as DATA and asks
# Get-DrainDecision whether to start the loop's task again. The watcher keeps a LITERAL COPY of Get-DrainDecision
# (it runs from an admin-only folder and must not dot-source anything from a user-writable checkout; the loop's
# test-queue-rules.ps1 checks that the two are identical). It decides nothing about safety: the run re-checks
# every approval itself (a forged drain.json can at most start a run that finds nothing, $0).
# ==================================================================================================

# The drain.json record for this run. $Previous: the parsed earlier drain.json ($null = none); its history is kept
# (newest last, at most $Keep runs including this one). $Buildable / $NeedsOpus: issue numbers; $Progress: builds
# that ended loop:deployed in this run; $RolledBack: a build of this run was rolled back; $NeedsVe: the run stopped
# on an uncertain deploy (DEPLOY STATE UNCERTAIN); $BuildCapped: the daily build cap's refusal ('' = not capped);
# $PolicyDueAt: the earliest end of a via-policy veto window still to come (ISO UTC, '' = none); $MergeDueAt: the
# earliest end of a look window of a parked via-policy merge (preview-rules.ps1 Get-NextMergeDue; '' = none).
function New-DrainState {
    param([string]$RunId, [datetime]$EndedAt = (Get-Date), [string]$Result = '', [int[]]$Buildable = @(), [int[]]$NeedsOpus = @(),
        [int]$Progress = 0, [bool]$RolledBack = $false, [bool]$NeedsVe = $false, [string]$BuildCapped = '', $Previous = $null, [int]$Keep = 6,
        [string]$PolicyDueAt = '', [string]$MergeDueAt = '')
    $b = @($Buildable | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ })
    $head = 0; if ($b.Count -gt 0) { $head = $b[0] }
    $h = @(); if ($Previous -and $Previous.PSObject.Properties.Name -contains 'history') { $h = @($Previous.history | Where-Object { $_ -and "$($_.runId)" -ne $RunId }) }
    $h += [pscustomobject][ordered]@{ runId = $RunId; endedAt = $EndedAt.ToString('o'); head = $head; progress = $Progress; result = $Result; rolledBack = $RolledBack }
    if ($h.Count -gt $Keep) { $h = @($h | Select-Object -Last $Keep) }
    return [ordered]@{ schema = 1; runId = $RunId; endedAt = $EndedAt.ToString('o'); result = $Result; buildable = @($b); head = $head
        needsOpus = @($NeedsOpus | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ }); progress = $Progress; rolledBack = $RolledBack; needsVe = $NeedsVe
        buildCapped = $BuildCapped; policyDueAt = $PolicyDueAt; mergeDueAt = $MergeDueAt; history = @($h) }
}

# May the watcher start the loop's task to drain the queue now? $Drain: the parsed drain.json; $Running: the task is
# running or a live run holds the loop's lock; $Verdict: the ops hub's plan-budget verdict; $Done: the watcher's
# state keys (a drain key starts at most one run per finished run). Start + Key + Reason. In order:
#   no drain state                                                                   -> no
#   nothing buildable, and no via-policy veto window or look window ended yet         -> no
#   (policyDueAt / mergeDueAt)
#   already drained after this run                                                   -> no
#   the last run stopped on an uncertain deploy (needsVe)                            -> no (Ve first)
#   plan budget hold; no-opus while every buildable issue needs Opus                 -> no
#   a run in progress                                                                -> no
#   the last run ended less than $IdleMinutes ago                                    -> not yet
#   the daily build cap was reached today                                            -> no
#   a via-policy veto window or a parked merge's look window ended (nothing else       -> start (the run re-checks it)
#   buildable)
#   the last run rolled a build back, or the last $FailRuns runs all had the same queue head and deployed nothing
#   (failed, skipped or stopped)                                                     -> back off $BackoffMinutes after the last run
#   otherwise                                                                        -> start
# policyDueAt (drain.json): the earliest end of a via-policy veto window after that run (gate-rules.ps1
# Get-ViaPolicyDecision). Once it has passed an issue may be buildable; the run re-checks every approval itself, and
# finds nothing ($0) if Ve held or closed it meanwhile. mergeDueAt (drain.json): the earliest end of the look window of a
# via-policy build parked before its merge (preview-rules.ps1); the run then re-checks the hold and the PR head and merges.
function Get-DrainDecision {
    param($Drain, [bool]$Running = $false, [string]$Verdict = 'normal', [datetime]$Now = (Get-Date), [string[]]$Done = @(), [string]$Repo = '',
        [int]$IdleMinutes = 15, [int]$FailRuns = 2, [int]$BackoffMinutes = 120)
    $mk = { param([bool]$S, [string]$K, [string]$Why) [pscustomobject]@{ Start = $S; Key = $K; Reason = $Why } }
    if ($null -eq $Drain -or "$($Drain.schema)" -ne '1' -or -not "$($Drain.runId)") { return (& $mk $false '' 'no drain state') }
    $key = "drain:${Repo}:$($Drain.runId)"
    $toUtc = { param($x) if ($x -is [datetime]) { return $x.ToUniversalTime() }; $p = [datetime]::MinValue
        if ([datetime]::TryParse("$x", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$p)) { return $p.ToUniversalTime() }; return $null }
    $b = @(@($Drain.buildable) | Where-Object { "$_" -match '^\d+$' } | ForEach-Object { [int]"$_" })
    $pd = $null; if ($Drain.PSObject.Properties.Name -contains 'policyDueAt' -and "$($Drain.policyDueAt)") { $pd = & $toUtc $Drain.policyDueAt }
    $md = $null; if ($Drain.PSObject.Properties.Name -contains 'mergeDueAt' -and "$($Drain.mergeDueAt)") { $md = & $toUtc $Drain.mergeDueAt }
    $what = 'via-policy veto window'
    if ($null -ne $md -and ($null -eq $pd -or $md -lt $pd)) { $pd = $md; $what = 'look window of a parked merge' }
    $policy = ($b.Count -eq 0 -and $null -ne $pd -and $Now.ToUniversalTime() -ge $pd)
    if ($b.Count -eq 0 -and -not $policy) {
        if ($null -ne $pd) { return (& $mk $false '' "nothing buildable after run $($Drain.runId); next $what ends $($pd.ToLocalTime().ToString('yyyy-MM-dd HH:mm'))") }
        return (& $mk $false '' "nothing buildable after run $($Drain.runId)")
    }
    if (@($Done) -contains $key) { return (& $mk $false '' "already started a drain run after run $($Drain.runId)") }
    if ("$($Drain.needsVe)" -eq 'True') { return (& $mk $false '' "run $($Drain.runId) stopped on an uncertain deploy: waiting for Ve") }
    $v = "$Verdict".Trim().ToLowerInvariant()
    if ($v -eq 'hold') { return (& $mk $false '' 'plan budget hold') }
    $op = @(@($Drain.needsOpus) | Where-Object { "$_" -match '^\d+$' } | ForEach-Object { [int]"$_" })
    if ($v -eq 'no-opus' -and $b.Count -gt 0 -and @($b | Where-Object { $op -notcontains $_ }).Count -eq 0) { return (& $mk $false '' 'plan budget no-opus and every buildable issue needs Opus') }
    if ($Running) { return (& $mk $false '' 'a run is in progress') }
    $end = & $toUtc $Drain.endedAt
    if ($null -eq $end) { return (& $mk $false '' 'drain state has no endedAt') }
    $idle = ($Now.ToUniversalTime() - $end).TotalMinutes
    if ($idle -lt $IdleMinutes) { return (& $mk $false '' "run $($Drain.runId) ended $([int]$idle) min ago (wait $IdleMinutes)") }
    if ("$($Drain.buildCapped)" -and $end.ToLocalTime().Date -eq $Now.Date) { return (& $mk $false '' "daily build cap reached today ($($Drain.buildCapped))") }
    if ($policy) { return (& $mk $true $key "$what ended $($pd.ToLocalTime().ToString('yyyy-MM-dd HH:mm')) after run $($Drain.runId): re-check the queue") }
    $h = @(@($Drain.history) | Where-Object { $_ })
    $last = @($h | Select-Object -Last $FailRuns)
    $stuck = ($last.Count -ge $FailRuns -and @($last | Where-Object { "$($_.head)" -eq "$($b[0])" -and "$($_.progress)" -eq '0' }).Count -eq $last.Count)
    if ("$($Drain.rolledBack)" -eq 'True' -or $stuck) {
        $why = "the last $FailRuns runs had queue head #$($b[0]) and deployed nothing"; if ("$($Drain.rolledBack)" -eq 'True') { $why = "run $($Drain.runId) rolled a build back" }
        if ($idle -lt $BackoffMinutes) { return (& $mk $false '' "backing off: $why; next try $([int]($BackoffMinutes - $idle)) min from now") }
        return (& $mk $true $key "drain after back-off ($why): $($b.Count) buildable, head #$($b[0])")
    }
    return (& $mk $true $key "drain: $($b.Count) buildable approved issue(s) left after run $($Drain.runId) (head #$($b[0]))")
}

# ==================================================================================================
# The needs-Ve flag: <LOOP_HOME>\state\needs-ve.json, a file of its own (never part of drain.json, so no later run can
# overwrite it). run-loop.ps1 writes it the moment a build leaves the deploy state uncertain (DEPLOY STATE UNCERTAIN:
# merged, but neither deployed-and-verified nor rolled-back-and-verified). While it exists:
#   - run-loop.ps1 stops before the queue check and before any claude session (LOOP-RESULT: FAILED NEEDS VE, $0): no
#     build, merge, deploy or proposal, in FULL and PROPOSE_ONLY alike;
#   - the approval watcher starts the loop's task for nothing (approval, request, refill, drain) and logs why.
# Only the owner removes it: clear-needs-ve.ps1 -Clear -Note "<what was checked>" (moves it to
# state\needs-ve-cleared-<time>.json). The loop's sessions cannot: the guard confines their writes to the clones and
# WORK, and clear-needs-ve.ps1 is not one of the session scripts. A flag file that exists but cannot be read or parsed
# still blocks (fail closed).
# ==================================================================================================
$script:NeedsVeFileName = 'needs-ve.json'

# The record run-loop.ps1 writes. $Reason: the uncertain deploy, one line (cut to 400 characters).
function New-NeedsVeRecord {
    param([string]$RunId, [string]$Loop = '', [string]$Reason = '', [int[]]$Issues = @(), [datetime]$SetAt = (Get-Date), [string]$ClearCommand = '')
    $r = ("$Reason" -replace '\s+', ' ').Trim(); if ($r.Length -gt 400) { $r = $r.Substring(0, 399) + '...' }
    return [ordered]@{ schema = 1; runId = $RunId; loop = $Loop; setAt = $SetAt.ToString('o')
        issues = @($Issues | Where-Object { $_ -gt 0 } | Sort-Object -Unique); reason = $r; clear = $ClearCommand }
}

# Does the needs-Ve flag block a run (or a watcher trigger) now? $Exists: the file is there; $Text: its content;
# $ReadError: why it could not be read; $Kind: what is being skipped (for the reason). Blocked + Key + Reason + RunId.
# The approval watcher keeps a LITERAL COPY of this function (it runs from an admin-only folder and must not dot-source
# anything from a user-writable checkout); test-queue-rules.ps1 checks that the two are identical.
function Get-NeedsVeBlock {
    param([bool]$Exists = $false, [string]$Text = '', [string]$ReadError = '', [string]$Kind = 'run')
    $mk = { param([bool]$B, [string]$K, [string]$Why, [string]$Run = '') [pscustomobject]@{ Blocked = $B; Key = $K; Reason = $Why; RunId = $Run } }
    if (-not $Exists) { return (& $mk $false '' 'no needs-Ve flag') }
    $j = $null
    if (-not $ReadError) { try { $j = "$Text".TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $ReadError = "$($_.Exception.Message)" } }
    if ($null -eq $j -or -not "$($j.runId)") {
        $why = 'the needs-Ve flag exists but cannot be read'; if ($ReadError) { $why += " ($ReadError)" }
        return (& $mk $true 'needs-ve:unreadable' "$Kind skipped: $why; failing closed until Ve clears it")
    }
    $iss = @(@($j.issues) | Where-Object { "$_" -match '^\d+$' } | ForEach-Object { "#$_" }) -join ' '
    $why = "$Kind skipped: NEEDS VE since $($j.setAt): run $($j.runId) left the deploy state uncertain"
    if ($iss) { $why += " ($iss)" }
    if ("$($j.reason)") { $why += ": $($j.reason)" }
    return (& $mk $true "needs-ve:$($j.runId)" $why "$($j.runId)")
}

# Get-NeedsVeBlock over a file (run-loop.ps1, clear-needs-ve.ps1). Never throws.
function Get-NeedsVeState {
    param([string]$Path, [string]$Kind = 'run')
    $ex = $false; $t = ''; $e = ''
    try { $ex = Test-Path -LiteralPath $Path -PathType Leaf } catch { $ex = $true; $e = "$($_.Exception.Message)" }
    if ($ex -and -not $e) { try { $t = [IO.File]::ReadAllText($Path) } catch { $e = "$($_.Exception.Message)" } }
    return (Get-NeedsVeBlock -Exists $ex -Text $t -ReadError $e -Kind $Kind)
}

# Write the flag unless it is already set (the FIRST uncertain deploy is the one Ve must look at; a set flag is never
# overwritten). Returns 'set' | 'kept' (already there) | 'error: <why>'.
function Set-NeedsVeFlag {
    param([string]$Path, $Record)
    try {
        $dir = Split-Path -Parent $Path
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $bytes = (New-Object Text.UTF8Encoding $false).GetBytes(($Record | ConvertTo-Json -Depth 5))
        $fs = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Close() }
        return 'set'
    } catch [IO.IOException] {
        if (Test-Path -LiteralPath $Path) { return 'kept' }
        return "error: $($_.Exception.Message)"
    } catch { return "error: $($_.Exception.Message)" }
}

# The comment the runner posts on the issue whose deploy is uncertain (loop marker: never read as Ve's words).
function Format-NeedsVeComment {
    param([int]$Issue, [string]$RunId, [string]$Reason, [string]$ClearCommand, [string]$Marker = '<!-- innovation-loop -->', [string]$Who = 'Ve')
    return "$Marker`n## Needs $Who`: the loop is stopped`n`nRun ``$RunId`` merged this change but could not verify its deploy: $Reason.`n`n" +
        "Until $Who clears it, every automatic run of this loop is skipped: the daily run stops before any session, and the approval watcher " +
        "starts nothing (approvals, requests, refill, queue drain). Check production first (innovation/README.md, ""Needs Ve: an uncertain deploy""), then clear it from a normal PowerShell:`n`n" +
        "``````powershell`n$ClearCommand`n```````n"
}

# Does a request need an intake session now? Returns NeedsIntake, Key (the approval watcher's once-key:
# 'req:<n>:<id of Ve's latest comment, or 0>') and Reason. Yes when it is a valid request, not loop:planned,
# not loop:declined, and either not loop:needs-info or Ve has commented (without the loop marker) after the
# loop's latest comment. The approval watcher keeps a LITERAL COPY of this function (it runs from an
# admin-only folder and dot-sources nothing): change both together (test-queue-rules.ps1 compares them).
function Get-RequestTriggerDecision {
    param($Issue, [object[]]$Comments = @(), [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', [string]$AgentMarker = '<!-- claude-agent -->')
    $mk = { param([bool]$N, [string]$K, [string]$Why) [pscustomobject]@{ NeedsIntake = $N; Key = $K; Reason = $Why } }
    if (-not $Issue) { return (& $mk $false '' 'no issue') }
    $l = @(@($Issue.labels) | Where-Object { $_ } | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.name)" } })
    $author = ''; if ($Issue.author) { $author = "$($Issue.author.login)" } elseif ($Issue.user) { $author = "$($Issue.user.login)" }
    if ("$($Issue.state)" -notmatch '^(?i)open$') { return (& $mk $false '' 'closed') }
    if ($l -notcontains 'loop:request') { return (& $mk $false '' 'not a loop:request') }
    if ($author -ne $Owner) { return (& $mk $false '' "opened by $author, not $Owner") }
    if ("$($Issue.body)".Contains($Marker)) { return (& $mk $false '' 'body carries the loop marker') }
    if ($l -contains 'loop:declined') { return (& $mk $false '' 'declined') }
    if ($l -contains 'loop:planned') { return (& $mk $false '' 'already planned') }
    # a comment an agent posted as the owner (<!-- claude-agent -->) is neither Ve's answer nor the loop's question
    $cs = @($Comments | Where-Object { $_ -and "$($_.user.login)" -eq $Owner -and -not "$($_.body)".Contains($AgentMarker) } | Sort-Object { [datetime]$_.created_at })
    $ve = @($cs | Where-Object { -not "$($_.body)".Contains($Marker) })
    $loop = @($cs | Where-Object { "$($_.body)".Contains($Marker) })
    $lastVe = $null; if ($ve.Count -gt 0) { $lastVe = $ve[-1] }
    $lastLoop = $null; if ($loop.Count -gt 0) { $lastLoop = $loop[-1] }
    $vid = '0'; if ($lastVe) { $vid = "$($lastVe.id)" }
    $key = "req:$($Issue.number):$vid"
    if ($l -contains 'loop:needs-info') {
        if (-not $lastVe -or ($lastLoop -and [datetime]$lastVe.created_at -le [datetime]$lastLoop.created_at)) { return (& $mk $false '' 'waiting for an answer (loop:needs-info)') }
        return (& $mk $true $key 'the question was answered')
    }
    return (& $mk $true $key 'not planned yet')
}

# Is $Child (an issue: number, title, state, labels, body, author/user) approved through Ve's request?
# $ChildEditedAt: GraphQL lastEditedAt ('' = never edited); $ChildComments; $ChildApprovalEvents: how many
# labeled/unlabeled `approved` events it has. $Request: the request issue; $RequestEditedAt; $RequestComments.
# ALL must hold: the request is open, loop:request, opened by the owner, no loop marker in its body, not
# declined; its Mode is "Build it"; the runner's plan comment exists and lists this child; the request body
# was not edited after that plan comment; the child is a loop:proposal opened by the owner whose body starts
# with the loop marker and says "From request #<n>"; no owner /hold on the request or on the child; the child
# is open, not Manual, not loop:failed, its body never edited, and no `approved` added/removed on it by hand.
# Returns Linked (the body names a request), Eligible, Request, Mode, PlanAt, Reasons.
function Get-ViaRequestDecision {
    param($Child, [string]$ChildEditedAt = '', [object[]]$ChildComments = @(), [int]$ChildApprovalEvents = 0,
        $Request = $null, [string]$RequestEditedAt = '', [object[]]$RequestComments = @(),
        [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    $r = New-Object System.Collections.ArrayList
    $body = "$($Child.body)"
    $n = Get-RequestLink -Body $body
    if ($n -le 0) { return [pscustomobject]@{ Linked = $false; Eligible = $false; Request = 0; Mode = ''; PlanAt = ''; Listed = $false; RequestValid = $false; Reasons = @('not from a request (no "From request #<n>" line)') } }
    $labels = @(Get-IssueLabelNames $Child)
    # the child: opened by the loop, in the loop's format
    if ($labels -notcontains 'loop:proposal') { [void]$r.Add('missing label loop:proposal') }
    if ($labels -contains $script:RequestLabel) { [void]$r.Add('is itself a request') }
    $author = Get-IssueAuthor $Child; if ($author -ne $Owner) { [void]$r.Add("opened by $author, not $Owner") }
    $lines = @($body -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($lines.Count -lt 1 -or $lines[0] -ne $Marker) { [void]$r.Add('body does not start with the loop marker line') }
    # the request
    $mode = ''; $planAt = ''; $listed = $false; $valid = $false
    if (-not $Request -or [int]$Request.number -ne $n) { [void]$r.Add("request #$n not found") }
    else {
        $probs = @(Get-RequestProblems -Issue $Request -Owner $Owner -Marker $Marker); $valid = ($probs.Count -eq 0)
        foreach ($p in $probs) { [void]$r.Add("request #${n}: $p") }
        $mode = (Get-RequestForm -Body "$($Request.body)").Mode
        if ($mode -ne 'build') { [void]$r.Add("request #$n is in ""Plan first"" mode (or names no mode): its issues need ``approved`` by hand") }
        $plan = Find-RequestPlanComment -Comments $RequestComments -Owner $Owner -Marker $Marker
        if (-not $plan) { [void]$r.Add("request #$n has no plan comment yet") }
        else {
            $planAt = "$($plan.created_at)"
            $listed = (@(Get-RequestPlanChildren -Body "$($plan.body)") -contains [int]$Child.number)
            if (-not $listed) { [void]$r.Add("the plan on request #$n does not list this issue") }
            if ($RequestEditedAt -and [datetime]$RequestEditedAt -gt [datetime]$planAt) { [void]$r.Add("request #$n was edited at $RequestEditedAt, after its plan; approve this issue by hand or file a new request") }
        }
        $h = Find-HoldComment -Comments $RequestComments -Owner $Owner -Marker $Marker
        if ($h) { [void]$r.Add("$Owner put request #$n on hold (comment $($h.id))") }
    }
    # the child's own state
    if ("$($Child.state)" -notmatch '^(?i)open$') { [void]$r.Add('issue is closed') }
    if ($body -match $script:ManualRx) { [void]$r.Add('marked Manual / needs Ve') }
    if ($labels -contains 'loop:failed') { [void]$r.Add('has label loop:failed (an issue approved through a request gets no automatic retry)') }
    if ($ChildApprovalEvents -gt 0) { [void]$r.Add('`approved` was added to and removed from this issue by hand; that decision stands over the request') }
    $hc = Find-HoldComment -Comments $ChildComments -Owner $Owner -Marker $Marker
    if ($hc) { [void]$r.Add("$Owner put this issue on hold (comment $($hc.id))") }
    if ($ChildEditedAt) { [void]$r.Add("body edited at $ChildEditedAt, after it was opened") }
    return [pscustomobject]@{ Linked = $true; Eligible = ($r.Count -eq 0); Request = $n; Mode = $mode; PlanAt = $planAt; Listed = $listed; RequestValid = $valid; Reasons = @($r) }
}

# One child's line on the request checklist: Number, Title, Status, Done (closed), Deployed, Failed, Manual.
function Get-RequestChildState {
    param($Issue)
    $l = @(Get-IssueLabelNames $Issue)
    $manual = ("$($Issue.body)" -match $script:ManualRx)
    $closed = ("$($Issue.state)" -match '^(?i)closed$')
    $st = Get-SliceStatus $Issue
    if (-not $closed -and $manual) { $st = 'Manual / needs Ve (the loop does not build it)' }
    if (-not $closed -and $l -contains $script:SpecLabel) { $st = "spec, $st" }
    return [pscustomobject]@{ Number = [int]$Issue.number; Title = (ConvertTo-SafeLine "$($Issue.title)" 90); Status = $st; Done = $closed
        Deployed = ($closed -and $l -contains 'loop:deployed'); Failed = ((-not $closed) -and $l -contains 'loop:failed'); Manual = $manual }
}

# The plan / progress comment on a request (edited in place). $Children: Get-RequestChildState objects.
function Format-RequestPlan {
    param([int]$Request, [object[]]$Children = @(), [string]$Mode = '', [string]$RunId = '', [string]$Marker = '<!-- innovation-loop -->', [string]$Who = 'Ve')
    $ch = @($Children | Where-Object { $_ } | Sort-Object Number)
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:RequestPlanMarker)
    [void]$sb.AppendLine("<!-- innovation-loop:request-children $(@($ch | ForEach-Object { $_.Number }) -join ',') -->")
    [void]$sb.AppendLine('## Plan'); [void]$sb.AppendLine()
    if ($Mode -eq 'build') { [void]$sb.AppendLine("Mode: **Build it**. Each issue below is built without its own ``approved`` (approved through this request), ahead of the loop's own ideas, unless it is Manual, failed, edited or held. Comment ``/hold`` here to stop them all, or on one issue to stop that one.") }
    else { [void]$sb.AppendLine("Mode: **Plan first**. Nothing is built until $Who adds ``approved`` to an issue below. Comment ``/hold`` to stop.") }
    [void]$sb.AppendLine()
    foreach ($c in $ch) {
        $box = ' '; if ($c.Done) { $box = 'x' }
        $st = $c.Status
        # in Build it mode an open child without `approved` is approved through the request, not waiting for review
        if ($Mode -eq 'build' -and $st -eq 'awaiting review') { $st = 'approved via this request, waiting to be built' }
        [void]$sb.AppendLine("- [$box] #$($c.Number) $($c.Title): $st")
    }
    $fails = @($ch | Where-Object { $_.Failed })
    if ($fails.Count -gt 0) { [void]$sb.AppendLine(); [void]$sb.AppendLine("Failed, waiting on ${Who}: $(@($fails | ForEach-Object { "#$($_.Number)" }) -join ', ') (the failure comment on each issue says why)") }
    $r = ''; if ($RunId) { $r = " after run ``$RunId``" }
    [void]$sb.AppendLine(); [void]$sb.AppendLine("<sub>Updated by the runner$r; this comment is edited in place. The request closes with a synopsis when every issue is deployed or closed.</sub>")
    return $sb.ToString()
}

# The closing synopsis, in plain language. $Children: Get-RequestChildState objects (all closed).
function Format-RequestSynopsis {
    param([int]$Request, [object[]]$Children = @(), [string]$What = '', [string]$Marker = '<!-- innovation-loop -->')
    $ch = @($Children | Where-Object { $_ } | Sort-Object Number)
    $dep = @($ch | Where-Object { $_.Deployed }); $other = @($ch | Where-Object { -not $_.Deployed })
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:RequestSynopsisMarker)
    [void]$sb.AppendLine('## Synopsis'); [void]$sb.AppendLine()
    $w = ConvertTo-SafeLine $What 160
    if ($w) { [void]$sb.AppendLine("You asked: $w"); [void]$sb.AppendLine() }
    if ($dep.Count -gt 0) {
        [void]$sb.AppendLine("Done and live ($($dep.Count)):")
        foreach ($c in $dep) { [void]$sb.AppendLine("- #$($c.Number) $($c.Title): built, merged, deployed and checked on the live site.") }
    }
    if ($other.Count -gt 0) {
        [void]$sb.AppendLine(); [void]$sb.AppendLine("Closed without a deploy ($($other.Count)):")
        foreach ($c in $other) { [void]$sb.AppendLine("- #$($c.Number) $($c.Title): closed, not built by the loop.") }
    }
    [void]$sb.AppendLine(); [void]$sb.AppendLine('Every issue from this request is finished, so the loop closes it. Reopen it, or file a new request, if something is missing.')
    return $sb.ToString()
}

# JSON that survives a console pipe: every non-ASCII character as a \uXXXX escape (check-approval.ps1 prints its
# result to stdout, which run-loop.ps1 and merge-pr.ps1 read through the console code page; Windows PowerShell 5.1
# would otherwise turn e.g. U+00B7 in a request into two OEM characters). Surrogate pairs stay valid JSON.
function ConvertTo-AsciiJson {
    param([string]$Json)
    return [regex]::Replace("$Json", '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
}
# ==================================================================================================
# Via-policy approval: Ve's STANDING approval policy. Ve decided on 2026-11-23 (in an interactive session, asked
# directly: "How much should the loops auto-approve without asking you?" -> "Everything but server/data", for the
# CardLens and Ops hub loops) that the loop's own proposals and specs are approved after a veto window, except
# ones that change the server, stored data or protected areas. The approving authority is Ve's written policy
# file, innovation/AUTONOMY.json, read from Ve's checkout (next to the scripts, like FOCUS.md); the loop's
# sessions can never write it (guard.mjs denies it, merge-pr.ps1 refuses innovation/**). Never the loop's own
# judgement: eligibility is decided here, deterministically, and fails closed. The loop still never adds the
# `approved` label; via-policy is a runner decision like via-spec.
#
# An open issue is approved via policy when ALL hold (Get-ViaPolicyDecision):
#  0. the policy is on: AUTONOMY.json exists, parses, schema 1, this loop, approval "via-policy", enabled true,
#     vetoHours 1..168, includeSpecs a boolean, exclude names exactly the exclusions this file implements
#     (server-deploy, stored-data, manual, protected). Anything else = manual approval (fail closed).
#     enabled: false is Ve's off switch: manual approval again, at once.
#  1. it is the loop's own proposal: loop:proposal, opened by the owner's account, body's first line the loop
#     marker; not a slice (via-spec rule), not from a request (via-request rule), no `approved` label (Ve's
#     label approval wins, immediately); a spec only with includeSpecs (its slices then follow via-spec, and each
#     slice must itself pass the scope rule below)
#  2. not Manual / needs Ve, not loop:failed, not loop:deployed
#  3. scope (Get-ViaPolicyScope): "What deploys" says Pages only (a spec: every slice says Pages only), nothing
#     names the server; "Scope" says "In scope for the loop"; and no sensitive area is named outside a negated
#     clause: stored data shapes, sync / merge rules, the scanner gate or card index, secrets, CORS / CSP,
#     innovation/ / CI / the loop itself, the Target bot, metrics events, or a protected path
#  4. no veto: open (Ve closing it rejects it), no `approved` added and removed by hand, no owner /hold comment
#  5. the runner posted its ONE notice comment (Format-ViaPolicyNotice) and recorded it in
#     <LOOP_HOME>\state\via-policy.json; the comment is still there; the body was not edited after the notice
#  6. the veto window (vetoHours) has passed since the notice; the plan budget is not `hold`
# merge-pr.ps1 re-checks it before merging, refuses any protected path (the backstop for a misclassified
# proposal) and refuses a via-policy merge that needs a server deploy.
# ==================================================================================================
$script:AutonomyFileName = 'AUTONOMY.json'
$script:ViaPolicyLoop = 'cardlens'
$script:ViaPolicyMarker = '<!-- innovation-loop:via-policy -->'
$script:ViaPolicyStateName = 'via-policy.json'
$script:ViaPolicyLogName = 'via-policy-log.jsonl'
$script:ViaPolicyExcludes = @('server-deploy', 'stored-data', 'manual', 'protected')
$script:ViaPolicyNegationRx = "(?i)(\b(no|not|never|none|nothing|without|unchanged|untouched|unaffected|neither|nor)\b|n't\b)"
# area name -> pattern; matched per clause, ignored only when a negation comes BEFORE the match in that clause
$script:ViaPolicySensitive = @(
    @{ Name = 'stored data shapes'; Rx = '(?i)\b(stored (data |row )?shapes?|data shapes?|schemas?|migrat\w*|whitelists?|tombstones?|watermarks?|or-set|canonicalfinish|storage keys?|cache keys?|cache[- ]versions?|collection\.json|binders\.json|shares\.json)\b|d:\\+services\\+data' },
    @{ Name = 'sync / merge rules'; Rx = '(?i)\b(sync(ing|ed|s)?|merge rules?|merge logic|conflict resolution|last-write-wins|outbox)\b' },
    @{ Name = 'the scanner gate / card index'; Rx = '(?i)\b(accept gate|scanner gate|gate constants?|phash|min_margin\w*|near_exact|min_detail|judge\.py|build-card-index|card[- ]index (re)?builds?)\b' },
    @{ Name = 'secrets'; Rx = '(?i)\b(secrets?|api[- ]keys?|passwords?|credentials?|auth(entication)? tokens?|bearer|VITE_\w*(TOKEN|KEY|SECRET))\b|(?<![\w-])\.env\b' },
    @{ Name = 'CORS / CSP'; Rx = '(?i)\b(cors|allowed[_ ]origins|access-control-allow-\w+|content-security-policy|csp)\b' },
    @{ Name = 'innovation/, CI or the loop itself'; Rx = '(?i)(\binnovation[\\/]|\.github[\\/]|\.claude[\\/]|\bautonomy\.json\b|\bci workflows?\b)' },
    @{ Name = 'the Target bot'; Rx = '(?i)(\btarget ?bot\b|/api/target|\bautobuy\b)' },
    @{ Name = 'a metrics event (needs a server deploy)'; Rx = '(?i)\b(metrics? events?|metricsevents)\b' }
)

# Ve's policy file, parsed. $Exists / $Text / $ReadError: the file as run-loop.ps1 / check-approval.ps1 read it from
# the scripts dir (Ve's checkout). Returns Enabled, VetoHours, IncludeSpecs, Exclude, SetBy, SetOn, Reason. Every
# problem means Enabled = $false (manual approval), with the reason.
function Get-AutonomyPolicy {
    param([bool]$Exists = $true, [AllowNull()][AllowEmptyString()][string]$Text = '', [string]$ReadError = '', [string]$Loop = $script:ViaPolicyLoop)
    $off = { param([string]$Why) [pscustomobject]@{ Enabled = $false; VetoHours = 0; MergeLookHours = 0; IncludeSpecs = $false; Exclude = @(); SetBy = ''; SetOn = ''; Reason = $Why } }
    if (-not $Exists) { return (& $off "no innovation/$($script:AutonomyFileName): manual approval only") }
    if ($ReadError) { return (& $off "$($script:AutonomyFileName) unreadable ($(ConvertTo-SafeLine $ReadError 120)): manual approval only (fail closed)") }
    if ([string]::IsNullOrWhiteSpace($Text)) { return (& $off "$($script:AutonomyFileName) is empty: manual approval only (fail closed)") }
    $j = $null
    try { $j = "$Text".TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { return (& $off "$($script:AutonomyFileName) is not valid JSON: manual approval only (fail closed)") }
    if ($null -eq $j -or -not ($j -is [pscustomobject])) { return (& $off "$($script:AutonomyFileName) is not a JSON object: manual approval only (fail closed)") }
    $names = @($j.PSObject.Properties.Name)
    if ("$($j.schema)" -ne '1') { return (& $off "$($script:AutonomyFileName) schema is not 1: manual approval only (fail closed)") }
    if ("$($j.loop)" -ne $Loop) { return (& $off "$($script:AutonomyFileName) is for loop '$(ConvertTo-SafeLine "$($j.loop)" 30)', not '$Loop': manual approval only (fail closed)") }
    if ("$($j.approval)" -ne 'via-policy') { return (& $off "$($script:AutonomyFileName) approval is not 'via-policy': manual approval only (fail closed)") }
    if ($names -notcontains 'enabled' -or -not ($j.enabled -is [bool])) { return (& $off "$($script:AutonomyFileName) enabled is not true or false: manual approval only (fail closed)") }
    if (-not $j.enabled) { return (& $off "switched off by Ve ($($script:AutonomyFileName) enabled: false): manual approval only") }
    $vh = $j.vetoHours
    if (-not ($vh -is [int] -or $vh -is [long] -or $vh -is [double] -or $vh -is [decimal]) -or [double]$vh -lt 1 -or [double]$vh -gt 168) { return (& $off "$($script:AutonomyFileName) vetoHours must be a number from 1 to 168: manual approval only (fail closed)") }
    # mergeLookHours (Ve, 2026-11-24): the look window on the working preview before a via-policy merge (preview-rules.ps1
    # Get-LookWindowDecision). Optional (absent = 0, no window); when present, a number from 0 to 24.
    $lh = [double]0
    if ($names -contains 'mergeLookHours') {
        $mv = $j.mergeLookHours
        if (-not ($mv -is [int] -or $mv -is [long] -or $mv -is [double] -or $mv -is [decimal]) -or [double]$mv -lt 0 -or [double]$mv -gt 24) { return (& $off "$($script:AutonomyFileName) mergeLookHours must be a number from 0 to 24: manual approval only (fail closed)") }
        $lh = [double]$mv
    }
    if ($names -notcontains 'includeSpecs' -or -not ($j.includeSpecs -is [bool])) { return (& $off "$($script:AutonomyFileName) includeSpecs is not true or false: manual approval only (fail closed)") }
    $ex = @(@($j.exclude) | Where-Object { $null -ne $_ } | ForEach-Object { "$_".Trim().ToLowerInvariant() } | Select-Object -Unique)
    $missing = @($script:ViaPolicyExcludes | Where-Object { $ex -notcontains $_ })
    $unknown = @($ex | Where-Object { $script:ViaPolicyExcludes -notcontains $_ })
    if ($missing.Count -gt 0) { return (& $off "$($script:AutonomyFileName) exclude lacks $($missing -join ', '): manual approval only (fail closed)") }
    if ($unknown.Count -gt 0) { return (& $off "$($script:AutonomyFileName) exclude names $(ConvertTo-SafeLine ($unknown -join ', ') 80), which this loop does not implement: manual approval only (fail closed)") }
    $by = ConvertTo-SafeLine "$($j.setBy)" 40; $on = ConvertTo-SafeLine "$($j.setOn)" 20
    return [pscustomobject]@{ Enabled = $true; VetoHours = [double]$vh; MergeLookHours = $lh; IncludeSpecs = [bool]$j.includeSpecs; Exclude = @($ex); SetBy = $by; SetOn = $on
        Reason = "via-policy on (set by $by on $on; veto window $([double]$vh) h; look window before the merge $lh h; specs $(if ($j.includeSpecs) { 'included' } else { 'excluded' }))" }
}
# Get-AutonomyPolicy over a file. Never throws.
function Read-AutonomyPolicy {
    param([string]$Path, [string]$Loop = $script:ViaPolicyLoop)
    $ex = $false; $t = ''; $e = ''
    try { $ex = Test-Path -LiteralPath $Path -PathType Leaf } catch { $ex = $true; $e = "$($_.Exception.Message)" }
    if ($ex -and -not $e) { try { $t = [IO.File]::ReadAllText($Path) } catch { $e = "$($_.Exception.Message)" } }
    return (Get-AutonomyPolicy -Exists $ex -Text $t -ReadError $e -Loop $Loop)
}

# The text of one "## <Heading>" section of an issue body, or $null when there is none.
function Get-MdSection {
    param([string]$Body, [string]$Heading)
    $m = [regex]::Match("$Body", ('(?ms)^\s*##\s*' + [regex]::Escape($Heading) + '\s*$(.*?)(?=^\s*##\s|\z)'))
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value
}

# Sensitive areas named in $Text outside a negated clause ("no stored shape, merge rule or cache key changes" is
# fine; "changes the merge rule" is not). Clauses: sentences, semicolons and lines. Also path-like tokens that match
# a protected path pattern. Returns the area names hit (unique).
function Find-ViaPolicySensitive {
    param([string]$Text, [object[]]$Rules = $script:ViaPolicySensitive, [string[]]$ProtectedPatterns = $script:ProtectedPathPatterns)
    $hits = New-Object System.Collections.ArrayList
    foreach ($cl in @("$Text" -split '(?<=[.;!?])\s+|;|\r?\n')) {
        $c = "$cl".Trim(); if (-not $c) { continue }
        foreach ($rule in $Rules) {
            foreach ($m in [regex]::Matches($c, $rule.Rx)) {
                if ($c.Substring(0, $m.Index) -match $script:ViaPolicyNegationRx) { continue }
                if (-not $hits.Contains($rule.Name)) { [void]$hits.Add($rule.Name) }
                break
            }
        }
        foreach ($m in [regex]::Matches($c, '[A-Za-z0-9_.\-]*[\\/][A-Za-z0-9_.\-\\/]+|(?<![\w/\\-])\.env\S*')) {
            $p = (($m.Value.Replace('\', '/') -replace '^\./', '') -replace '^/+', '').TrimEnd('.', ',', ')', ':')
            if ($m.Value -match '^\.env') { $p = $m.Value }
            foreach ($re in @($ProtectedPatterns)) {
                if ($p -match $re -or ($p.TrimEnd('/') + '/') -match $re) {
                    if ($c.Substring(0, $m.Index) -match $script:ViaPolicyNegationRx) { break }
                    $nm = "protected path $p"
                    if (-not $hits.Contains($nm)) { [void]$hits.Add($nm) }
                    break
                }
            }
        }
    }
    return @($hits)
}

# What may ship under the policy (loop-specific): the "## What deploys" section of a proposal, or the "## Slices"
# list of a spec. CardLens: "Pages only", never the server. Returns the reasons it is not covered (empty = covered).
function Test-ViaPolicyDeploy {
    param([string]$Body, [bool]$IsSpec = $false)
    $r = @()
    if ($IsSpec) {
        $sec = Get-MdSection -Body $Body -Heading 'Slices'
        $items = @(); if ($null -ne $sec) { $items = @($sec -split "`r?`n" | Where-Object { $_ -match '^\s?\d+[.)]\s+' }) }
        if ($items.Count -eq 0) { return @('spec has no numbered "## Slices" list') }
        foreach ($it in $items) {
            $k = ([regex]::Match($it, '^\s?(\d+)')).Groups[1].Value
            if ($it -notmatch '(?i)\bpages\s+only\b') { $r += "slice $k does not say Pages only" }
            elseif ($it -match '(?i)\b(server|service|restart)\b|\+\s*server') { $r += "slice $k names the server" }
        }
        return $r
    }
    $wd = Get-MdSection -Body $Body -Heading 'What deploys'
    if ($null -eq $wd) { return @('no "## What deploys" section') }
    if ($wd -notmatch '(?i)\bpages\s+only\b') { $r += '"What deploys" is not "Pages only"' }
    elseif ($wd -match '(?i)\b(server|service|services|restart|recognition|card[- ]index|data)\b') { $r += '"What deploys" names the server or its data' }
    return $r
}

# Is the issue's CONTENT covered by the policy (deploy, scope, sensitive areas)? Title + body (HTML comments
# removed). Returns InScope + Reasons.
function Get-ViaPolicyScope {
    param([string]$Title = '', [string]$Body = '', [bool]$IsSpec = $false)
    $r = New-Object System.Collections.ArrayList
    $b = [regex]::Replace("$Body", '(?s)<!--.*?-->', '')
    if ("$Body" -match $script:ManualRx) { [void]$r.Add('marked Manual / needs Ve') }
    foreach ($x in @(Test-ViaPolicyDeploy -Body $b -IsSpec $IsSpec)) { [void]$r.Add($x) }
    if (-not $IsSpec) {
        $sc = Get-MdSection -Body $b -Heading 'Scope'
        if ($null -eq $sc -or $sc -notmatch '(?i)in scope for the loop') { [void]$r.Add('"Scope" does not say "In scope for the loop"') }
    }
    $hits = @(Find-ViaPolicySensitive -Text "$Title`n$b")
    if ($hits.Count -gt 0) { [void]$r.Add("names $($hits -join ', ')") }
    return [pscustomobject]@{ InScope = ($r.Count -eq 0); Reasons = @($r) }
}

function ConvertTo-ViaPolicyUtc {
    param($Value)
    if ($null -eq $Value -or "$Value" -eq '') { return $null }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
    $p = [datetime]::MinValue
    if ([datetime]::TryParse("$Value", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$p)) { return $p.ToUniversalTime() }
    return $null
}
# A due time as Ve reads it: server-pc local time, e.g. "Mon 2026-11-23 4:00 PM".
function Format-ViaPolicyTime {
    param($Utc)
    $u = ConvertTo-ViaPolicyUtc $Utc
    if ($null -eq $u) { return '' }
    return $u.ToLocalTime().ToString('ddd yyyy-MM-dd h:mm tt', [Globalization.CultureInfo]::InvariantCulture)
}

# The runner's notice comment on $Comments (by -Owner, loop marker + via-policy marker, not an agent's), by id
# when -CommentId is given, else the first. $null when there is none.
function Find-ViaPolicyNotice {
    param([object[]]$Comments = @(), [string]$Owner, [string]$Marker = '<!-- innovation-loop -->', [long]$CommentId = 0)
    foreach ($c in @($Comments | Where-Object { $_ } | Sort-Object { [datetime]$_.created_at })) {
        if ("$($c.user.login)" -ne $Owner) { continue }
        $b = "$($c.body)"
        if (-not $b.Contains($Marker) -or -not $b.Contains($script:ViaPolicyMarker) -or (Test-AgentComment $c)) { continue }
        if ($CommentId -gt 0 -and [long]$c.id -ne $CommentId) { continue }
        return $c
    }
    return $null
}

# Is $Issue (number, title, state, labels, body, author/user, createdAt/created_at, pull_request) approved through
# Ve's policy now? $EditedAt: GraphQL lastEditedAt ('' = never edited). $Comments: its comments. $ApprovalEvents:
# labeled/unlabeled `approved` events. $Policy: Get-AutonomyPolicy. $Record: this issue's entry in
# state\via-policy.json ($null = no notice yet). $Budget: the plan-budget verdict. Returns:
#   Status   off | not-applicable | ineligible | needs-notice | waiting | due | held | voided | closed
#   Eligible (Status due: buildable without `approved`), NoticedAt / DueAt (ISO UTC, '' when none), CommentId,
#   Spec (it is a spec), Reasons (why not; for waiting: when it vetoes).
# held / voided / closed are final for that issue (Ve approves it by hand if he still wants it).
function Get-ViaPolicyDecision {
    param($Issue, [string]$EditedAt = '', [object[]]$Comments = @(), [int]$ApprovalEvents = 0, $Policy = $null, $Record = $null,
        [string]$Budget = 'normal', [datetime]$NowUtc = [datetime]::UtcNow, [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
    $r = New-Object System.Collections.ArrayList
    $labels = @(Get-IssueLabelNames $Issue)
    $isSpec = ($labels -contains $script:SpecLabel)
    $noticedAt = ''; $dueAt = ''; $cid = [long]0
    $mk = { param([string]$S) [pscustomobject]@{ Status = $S; Eligible = ($S -eq 'due'); NoticedAt = $noticedAt; DueAt = $dueAt; CommentId = $cid; Spec = $isSpec; Reasons = @($r) } }
    if ($null -eq $Policy -or -not $Policy.Enabled) { $why = 'no policy'; if ($Policy) { $why = "$($Policy.Reason)" }; [void]$r.Add($why); return (& $mk 'off') }
    $body = "$($Issue.body)"
    if ($labels -contains 'approved') { [void]$r.Add("has Ve's approved label (label approval)"); return (& $mk 'not-applicable') }
    if (Get-SliceLink -Body $body) { [void]$r.Add('a slice of a spec (the via-spec rule decides)'); return (& $mk 'not-applicable') }
    if ((Get-RequestLink -Body $body) -gt 0) { [void]$r.Add("from one of Ve's requests (the via-request rule decides)"); return (& $mk 'not-applicable') }
    if ($labels -contains $script:RequestLabel) { [void]$r.Add('a loop:request (Ve''s own request)'); return (& $mk 'not-applicable') }
    # final vetoes first: closed, approved-and-removed by hand, /hold
    if ("$($Issue.state)" -notmatch '^(?i)open$') { [void]$r.Add('closed (closing a proposal rejects it)'); return (& $mk 'closed') }
    if ($ApprovalEvents -gt 0) { [void]$r.Add('`approved` was added and removed by hand; that decision stands over the policy'); return (& $mk 'voided') }
    $created = Get-IssueCreated $Issue
    $h = Find-HoldComment -Comments $Comments -Owner $Owner -Marker $Marker -Since $created
    if ($h) { [void]$r.Add("$Owner put it on hold (comment $($h.id))"); return (& $mk 'held') }
    # 1. the loop's own proposal
    if ($isSpec -and -not $Policy.IncludeSpecs) { [void]$r.Add('a spec, and the policy excludes specs (includeSpecs: false)') }
    if ($labels -notcontains 'loop:proposal') { [void]$r.Add('missing label loop:proposal') }
    $author = Get-IssueAuthor $Issue
    if ($author -ne $Owner) { [void]$r.Add("opened by $author, not $Owner") }
    $lines = @($body -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($lines.Count -lt 1 -or $lines[0] -ne $Marker) { [void]$r.Add('body does not start with the loop marker line (not the loop''s own proposal)') }
    if ($Issue.PSObject.Properties.Name -contains 'pull_request' -and $Issue.pull_request) { [void]$r.Add('is a pull request') }
    # 2. manual / failed / deployed
    if ($labels -contains 'loop:failed') { [void]$r.Add('has label loop:failed (via-policy gives no automatic retry)') }
    if ($labels -contains 'loop:deployed') { [void]$r.Add('has label loop:deployed') }
    # 3. scope
    $sc = Get-ViaPolicyScope -Title "$($Issue.title)" -Body $body -IsSpec $isSpec
    foreach ($x in $sc.Reasons) { [void]$r.Add($x) }
    if ($r.Count -gt 0) { return (& $mk 'ineligible') }
    # 5. the notice
    if ($null -eq $Record -or -not "$($Record.noticedAt)") {
        if (Find-ViaPolicyNotice -Comments $Comments -Owner $Owner -Marker $Marker) { [void]$r.Add('a via-policy notice comment is on the issue but the runner has no record of it (fail closed)'); return (& $mk 'voided') }
        [void]$r.Add('eligible: the runner posts the notice next and the veto window starts then'); return (& $mk 'needs-notice')
    }
    $nt = ConvertTo-ViaPolicyUtc $Record.noticedAt
    if ($null -eq $nt) { [void]$r.Add('the runner''s notice record has no readable time (fail closed)'); return (& $mk 'voided') }
    $noticedAt = $nt.ToString('o'); $cid = [long]0; try { $cid = [long]$Record.commentId } catch { }
    $due = $nt.AddHours([double]$Policy.VetoHours); $dueAt = $due.ToString('o')
    if ($cid -le 0 -or -not (Find-ViaPolicyNotice -Comments $Comments -Owner $Owner -Marker $Marker -CommentId $cid)) { [void]$r.Add("the runner's notice comment ($cid) is no longer on the issue (fail closed)"); return (& $mk 'voided') }
    $ed = ConvertTo-ViaPolicyUtc $EditedAt
    if ($ed -and $ed -gt $nt) { [void]$r.Add("body edited at $EditedAt, after the policy notice; approve it by hand if it should still be built"); return (& $mk 'voided') }
    # 6. the veto window and the plan budget
    if ($NowUtc.ToUniversalTime() -lt $due) { [void]$r.Add("auto-approves at $(Format-ViaPolicyTime $due) unless $Owner comments /hold"); return (& $mk 'waiting') }
    if ("$Budget".Trim().ToLowerInvariant() -eq 'hold') { [void]$r.Add('veto window over, but the plan budget is hold'); return (& $mk 'waiting') }
    return (& $mk 'due')
}

# The ONE comment the runner posts when an issue first becomes eligible. $DueUtc: notice time + vetoHours.
function Format-ViaPolicyNotice {
    param($DueUtc, [string]$Who = 'Ve', [string]$Marker = '<!-- innovation-loop -->')
    return "$Marker`n$($script:ViaPolicyMarker)`nAuto-approves via $Who's policy at $(Format-ViaPolicyTime $DueUtc) unless you comment ``/hold``. Policy: innovation/$($script:AutonomyFileName)`n`n" +
        "<sub>The loop's own proposal, Pages only, outside the server, stored data and protected areas (checked by gate-rules.ps1 Get-ViaPolicyDecision). Adding ``approved`` yourself builds it at once; closing it rejects it; editing the body after this notice cancels the auto-approval.</sub>`n"
}

# The runner's state file <LOOP_HOME>\state\via-policy.json, parsed: Ok, Issues (number -> record), Raw, Reason.
# A missing file is an empty state; a file that exists but cannot be read or parsed is NOT ok (callers then treat
# the policy as off: no notice, no approval; fail closed).
function Get-ViaPolicyState {
    param([bool]$Exists = $false, [string]$Text = '', [string]$ReadError = '')
    $map = @{}
    if (-not $Exists) { return [pscustomobject]@{ Ok = $true; Issues = $map; Raw = $null; Reason = 'no via-policy state yet' } }
    $j = $null
    if (-not $ReadError) { try { $j = "$Text".TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $ReadError = "$($_.Exception.Message)" } }
    if ($null -eq $j -or "$($j.schema)" -ne '1') {
        $why = 'via-policy state unreadable'; if ($ReadError) { $why += " ($(ConvertTo-SafeLine $ReadError 120))" } else { $why += ' (schema)' }
        return [pscustomobject]@{ Ok = $false; Issues = $map; Raw = $null; Reason = "$why; via-policy approval off until it is fixed (fail closed)" }
    }
    foreach ($e in @($j.issues | Where-Object { $_ -and "$($_.issue)" -match '^\d+$' })) { $map[[int]$e.issue] = $e }
    return [pscustomobject]@{ Ok = $true; Issues = $map; Raw = $j; Reason = "via-policy state: $($map.Count) issue(s)" }
}
function Read-ViaPolicyState {
    param([string]$Path)
    $ex = $false; $t = ''; $e = ''
    try { $ex = Test-Path -LiteralPath $Path -PathType Leaf } catch { $ex = $true; $e = "$($_.Exception.Message)" }
    if ($ex -and -not $e) { try { $t = [IO.File]::ReadAllText($Path) } catch { $e = "$($_.Exception.Message)" } }
    return (Get-ViaPolicyState -Exists $ex -Text $t -ReadError $e)
}

# The next state (runner side, pure). $State: Get-ViaPolicyState; $Entries: check-approval.ps1 -List `viaPolicy`
# (issue, title, spec, status, noticedAt, dueAt, commentId, reasons); $Approvals: issue -> approval of the buildable
# queue; $Posted: notices posted now (issue -> @{ noticedAt; commentId; dueAt }); $Outcomes: builds of this run
# (issue -> deployed | failed | rolled-back | skipped); -Previews: PR previews of this run (issue -> preview-rules.ps1
# New-ViaPolicyPreview: status up | down, url, pr, headSha, qa, upAt, expiresAt), kept on the record as `preview` (the hub
# shows issues[].preview.url while issues[].preview.status is up); -PolicyEnabled $false (Ve switched it off): waiting records become off.
# Only issues that were ever noticed are kept. Returns State
# (the file's object) and Events (log records for status changes). A record that drops out of the open candidates
# becomes approved-by-hand (Ve's label) or gone (closed, deployed, ...), unless a build outcome says more.
function Update-ViaPolicyState {
    param($State, [object[]]$Entries = @(), [hashtable]$Approvals = @{}, [hashtable]$Posted = @{}, [hashtable]$Outcomes = @{}, [hashtable]$Previews = @{}, $Policy = $null, [bool]$PolicyEnabled = $true,
        [string]$RunId = '', [string]$Repo = '', [string]$Loop = $script:ViaPolicyLoop, [datetime]$NowUtc = [datetime]::UtcNow, [hashtable]$Parked = @{})
    $now = $NowUtc.ToUniversalTime().ToString('o')
    $old = @{}; if ($State -and $State.Issues) { foreach ($k in $State.Issues.Keys) { $old[[int]$k] = $State.Issues[$k] } }
    $out = [ordered]@{}; $events = New-Object System.Collections.ArrayList
    $get = { param($o, [string]$n) if ($null -ne $o -and $o.PSObject.Properties.Name -contains $n) { return $o.$n }; return $null }
    $seen = @{}
    foreach ($e in @($Entries | Where-Object { $_ })) {
        $n = [int]$e.issue; $seen[$n] = $true
        $prev = $null; if ($old.ContainsKey($n)) { $prev = $old[$n] }
        $st = "$($e.status)"; $nAt = "$($e.noticedAt)"; $dAt = "$($e.dueAt)"; $cid = [long]0; try { $cid = [long]$e.commentId } catch { }
        if ($Posted.ContainsKey($n)) { $p = $Posted[$n]; $st = 'waiting'; $nAt = "$($p.noticedAt)"; $dAt = "$($p.dueAt)"; $cid = [long]$p.commentId }
        if (-not $prev -and -not $Posted.ContainsKey($n)) { continue }   # never noticed: nothing to keep
        if ($prev -and -not $nAt) { $nAt = "$(& $get $prev 'noticedAt')"; $dAt = "$(& $get $prev 'dueAt')"; try { $cid = [long](& $get $prev 'commentId') } catch { } }
        $pst = "$(& $get $prev 'status')"
        if ($Outcomes.ContainsKey($n)) { $st = "$($Outcomes[$n])" }
        elseif ($Parked.ContainsKey($n)) { $st = 'parked' }   # parked before its merge: Ve can look at the preview until mergeAt
        elseif ($pst -in @('deployed', 'failed', 'rolled-back') -and $st -in @('ineligible', 'closed')) { $st = $pst }   # keep the build result
        $rec = [ordered]@{ issue = $n; title = (ConvertTo-SafeLine "$($e.title)" 120); spec = [bool]$e.spec; status = $st; noticedAt = $nAt; dueAt = $dAt; commentId = $cid
            reasons = @(@($e.reasons) | Where-Object { $_ } | ForEach-Object { ConvertTo-SafeLine "$_" 200 } | Select-Object -First 4)
            statusAt = $(if ($pst -eq $st -and $prev) { "$(& $get $prev 'statusAt')" } else { $now }); url = $(if ($Repo) { "https://github.com/$Repo/issues/$n" } else { '' })
            approvedAt = "$(& $get $prev 'approvedAt')"; outcome = "$(& $get $prev 'outcome')"; runId = "$(& $get $prev 'runId')"; preview = (& $get $prev 'preview'); mergeAt = '' }
        if ($Previews.ContainsKey($n)) { $rec.preview = $Previews[$n] }
        if ($Parked.ContainsKey($n) -and -not $Outcomes.ContainsKey($n)) { $rec.mergeAt = "$($Parked[$n].mergeAt)"; if ("$($Parked[$n].url)" -and $null -eq $rec.preview) { $rec.preview = [ordered]@{ status = 'up'; url = "$($Parked[$n].url)"; pr = [int]$Parked[$n].pr; headSha = "$($Parked[$n].sha)"; mergeAt = "$($Parked[$n].mergeAt)" } } }
        if ($st -eq 'due' -and -not $rec.approvedAt) { $rec.approvedAt = $dAt }
        if ($Outcomes.ContainsKey($n)) { $rec.outcome = "$($Outcomes[$n])"; $rec.runId = $RunId }
        $out["$n"] = $rec
        if ($pst -ne $st) { [void]$events.Add([ordered]@{ ts = $now; runId = $RunId; issue = $n; title = $rec.title; event = $(if ($Posted.ContainsKey($n)) { 'noticed' } elseif ($Outcomes.ContainsKey($n)) { 'built' } else { 'status' }); from = $pst; status = $st; dueAt = $dAt; reason = "$(@($rec.reasons) | Select-Object -First 1)" }) }
    }
    foreach ($n in @($old.Keys | Sort-Object)) {
        if ($seen.ContainsKey([int]$n)) { continue }
        $p = $old[$n]; $pst = "$(& $get $p 'status')"
        $st = $pst
        if ($Outcomes.ContainsKey([int]$n)) { $st = "$($Outcomes[[int]$n])" }
        elseif ($Parked.ContainsKey([int]$n)) { $st = 'parked' }
        elseif ($pst -in @('waiting', 'due', 'needs-notice', 'parked') -and -not $PolicyEnabled) { $st = 'off' }
        elseif ($pst -in @('waiting', 'due', 'needs-notice', 'parked')) { if ($Approvals.ContainsKey([int]$n) -and "$($Approvals[[int]$n])" -eq 'label') { $st = 'approved-by-hand' } else { $st = 'gone' } }
        $rec = [ordered]@{}; foreach ($pp in $p.PSObject.Properties) { $rec[$pp.Name] = $pp.Value }
        $rec.status = $st
        if ($Previews.ContainsKey([int]$n)) { $rec.preview = $Previews[[int]$n] }
        $rec.mergeAt = $(if ($Parked.ContainsKey([int]$n) -and -not $Outcomes.ContainsKey([int]$n)) { "$($Parked[[int]$n].mergeAt)" } else { '' })
        if ($st -ne $pst) { $rec.statusAt = $now }
        if ($Outcomes.ContainsKey([int]$n)) { $rec.outcome = "$($Outcomes[[int]$n])"; $rec.runId = $RunId }
        $out["$n"] = $rec
        if ($st -ne $pst) { [void]$events.Add([ordered]@{ ts = $now; runId = $RunId; issue = [int]$n; title = "$($rec.title)"; event = $(if ($Outcomes.ContainsKey([int]$n)) { 'built' } else { 'status' }); from = $pst; status = $st; dueAt = "$($rec.dueAt)"; reason = '' }) }
    }
    $recs = @($out.Values | Sort-Object { [int]$_.issue })
    $next = @($recs | Where-Object { $_.status -eq 'waiting' -and $_.dueAt } | ForEach-Object { ConvertTo-ViaPolicyUtc $_.dueAt } | Where-Object { $_ } | Sort-Object | Select-Object -First 1)
    $nextM = @($recs | Where-Object { $_.status -eq 'parked' -and "$($_.mergeAt)" } | ForEach-Object { ConvertTo-ViaPolicyUtc $_.mergeAt } | Where-Object { $_ } | Sort-Object | Select-Object -First 1)
    $pol = [ordered]@{ enabled = $false; reason = 'unknown' }
    if ($Policy) { $pol = [ordered]@{ enabled = [bool]$Policy.Enabled; vetoHours = $Policy.VetoHours; mergeLookHours = $(if ($Policy.PSObject.Properties.Name -contains 'MergeLookHours') { $Policy.MergeLookHours } else { 0 }); includeSpecs = [bool]$Policy.IncludeSpecs; setBy = $Policy.SetBy; setOn = $Policy.SetOn; reason = "$($Policy.Reason)"; file = "innovation/$($script:AutonomyFileName)" } }
    $file = [ordered]@{ schema = 1; loop = $Loop; repo = $Repo; updatedAt = $now; runId = $RunId; policy = $pol
        nextDueAt = $(if ($next.Count -gt 0) { $next[0].ToString('o') } else { '' })
        nextMergeAt = $(if ($nextM.Count -gt 0) { $nextM[0].ToString('o') } else { '' }); issues = @($recs) }
    return [pscustomobject]@{ State = $file; Events = @($events) }
}

# One line for the run summary / log: what the policy did and will do ('' when nothing to say).
function Format-ViaPolicyLine {
    param([object[]]$Entries = @(), $Policy = $null)
    $e = @($Entries | Where-Object { $_ })
    $parts = @()
    $due = @($e | Where-Object { $_.status -eq 'due' }); if ($due.Count) { $parts += "approved via Ve's standing policy: $(@($due | ForEach-Object { "#$($_.issue)" }) -join ' ')" }
    $w = @($e | Where-Object { $_.status -eq 'waiting' }); if ($w.Count) { $parts += "waiting out the veto window: $(@($w | ForEach-Object { "#$($_.issue) (auto-approves $(Format-ViaPolicyTime $_.dueAt))" }) -join ', ')" }
    $nn = @($e | Where-Object { $_.status -eq 'needs-notice' }); if ($nn.Count) { $parts += "notice to post: $(@($nn | ForEach-Object { "#$($_.issue)" }) -join ' ')" }
    $hv = @($e | Where-Object { $_.status -in @('held', 'voided') }); if ($hv.Count) { $parts += "held or voided: $(@($hv | ForEach-Object { "#$($_.issue) ($($_.status))" }) -join ', ')" }
    if ($parts.Count -eq 0) { return '' }
    return "Via-policy: $($parts -join '; ')"
}

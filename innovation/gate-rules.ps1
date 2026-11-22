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
  Get-NextBuildDecision  may the runner start another build session?
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
        [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
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
$script:SessionDefaults = [ordered]@{
    build   = [ordered]@{ model = 'claude-opus-5-5'; smallModel = 'claude-sonnet-5-5'; smallLabels = @('size:small', 'test-only'); maxTurns = 150; timeoutMinutes = 150
        maxBudgetUsd = 8; smallMaxBudgetUsd = 2.5; maxPerDay = 8 }
    propose = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 80; timeoutMinutes = 45; minMinutes = 15; maxBudgetUsd = 0.75; maxPerDay = 4 }
    review  = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 120; timeoutMinutes = 60; maxBudgetUsd = 4; maxPerDay = 1 }
    # Ve's requests (options.requestIntake): one intake session per request that needs planning
    intake  = [ordered]@{ model = 'claude-sonnet-5-5'; maxTurns = 40; timeoutMinutes = 20; maxBudgetUsd = 0.75; maxPerDay = 6 }
    # the memory agent (options.memoryAgent): tool-less, input in the prompt, JSON out, validated by the runner
    memory  = [ordered]@{ model = 'claude-haiku-5-5'; maxTurns = 5; timeoutMinutes = 5; maxBudgetUsd = 0.10; maxPerDay = 2 }
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
$script:LoopOptionDefaults = [ordered]@{ proposeIssueDigest = $true; proposeMetricsDigest = $true; compactPrompts = $true; logKeepDays = 30; digestMaxIssues = 150; digestDeployedDays = 3
    productStore = $false; productCollectMinutes = 10; memoryAgent = $false; memoryMinDecisions = 5; memoryEveryDays = 7; requestIntake = $false
    designSkills = $false }

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
$script:DesignSkillKinds = @('build', 'propose', 'review')

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
function Format-BudgetUsd { param([double]$Usd) return $Usd.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture) }

# ---- daily session caps (run-loop.ps1 keeps the counts in <LOOP_HOME>\state\daily-sessions.json) ----------
# Every approval starts a run, so without a cap a busy day has no upper bound. The counts are per local day
# and per kind (build | propose | review); a launch is counted when the session is started (never in a dry run).
$script:DailyCapKinds = @('build', 'propose', 'review', 'intake', 'memory')

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

# The model for a session. -Override (run-loop -Model) wins. A build uses build.smallModel when the issue
# carries one of build.smallLabels (size:small, test-only), else build.model.
function Get-SessionModel {
    param([string]$Kind, [string[]]$Labels = @(), $Config, [string]$Override = '')
    if ($Override) { return $Override }
    $c = $Config[$Kind]
    if ($Kind -eq 'build' -and $c.smallModel -and @($Labels | Where-Object { @($c.smallLabels) -contains $_ }).Count -gt 0) { return "$($c.smallModel)" }
    return "$($c.model)"
}

# May the runner start another build session? $Done: the build sessions so far ({Issue; Outcome}, Outcome
# deployed | skipped | failed | rolled-back | unknown). A skipped build (the server rule, or the approval no
# longer valid) does not count toward MaxBuilds; any outcome but deployed or skipped ends Phase A.
function Get-NextBuildDecision {
    param([int[]]$Buildable = @(), [object[]]$Done = @(), [int]$MaxBuilds = 2, [double]$RemainingMinutes = 0,
        [int]$SecondBuildMinMinutes = 120, [int]$FirstBuildMinMinutes = 60, [int]$MaxSkips = 2)
    $done = @($Done | Where-Object { $_ })
    $stop = { param([string]$Why) [pscustomobject]@{ Start = $false; Issue = 0; Reason = $Why } }
    $bad = @($done | Where-Object { $_.Outcome -notin @('deployed', 'skipped') })
    if ($bad.Count -gt 0) { return (& $stop "#$($bad[0].Issue) ended $($bad[0].Outcome): no further build this run") }
    $built = @($done | Where-Object { $_.Outcome -eq 'deployed' }).Count
    $skips = @($done | Where-Object { $_.Outcome -eq 'skipped' }).Count
    if ($built -ge $MaxBuilds) { return (& $stop "MaxBuilds ($MaxBuilds) reached") }
    if ($skips -ge $MaxSkips) { return (& $stop "$skips issue(s) skipped this run (server rule or approval); not trying more") }
    $tried = @($done | ForEach-Object { [int]$_.Issue })
    $cand = @($Buildable | Where-Object { $tried -notcontains [int]$_ })
    if ($cand.Count -eq 0) { if ($done.Count -eq 0) { return (& $stop 'nothing buildable') } else { return (& $stop 'nothing more buildable') } }
    $need = $FirstBuildMinMinutes; if ($built -ge 1) { $need = $SecondBuildMinMinutes }
    if ($RemainingMinutes -lt $need) { return (& $stop "$([int]$RemainingMinutes) min left before the deadline; a build needs $need") }
    return [pscustomobject]@{ Start = $true; Issue = [int]$cand[0]; Reason = "build #$($cand[0]) ($($built + 1) of at most $MaxBuilds)" }
}

# How a build session left its issue, from the issue's labels afterwards and its LOOP-ISSUE-END word.
# deployed | failed | rolled-back | skipped (no state label at all: left untouched) | unknown.
function Get-BuildOutcome {
    param([string[]]$Labels = @(), [string]$MarkerOutcome = '')
    if ($Labels -contains 'loop:deployed') { return 'deployed' }
    if ($Labels -contains 'loop:failed') { if ("$MarkerOutcome" -match '^rolled') { return 'rolled-back' } else { return 'failed' } }
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
        $b = "$($c.body)"; if (-not $b.Contains($Marker) -or (Test-AgentComment $c)) { continue }
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
function Split-BuildableByBudget {
    param([int[]]$Buildable = @(), [hashtable]$LabelsOf = @{}, $Config, [string]$Override = '', [string]$Verdict = 'normal')
    $allowed = @(); $deferred = @()
    foreach ($n in @($Buildable | Where-Object { $null -ne $_ })) {
        $l = @(); if ($LabelsOf.ContainsKey([int]$n)) { $l = @($LabelsOf[[int]$n]) }
        $m = Get-SessionModel -Kind 'build' -Labels $l -Config $Config -Override $Override
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
        [string]$BuildCap = '', [string]$PhaseBCap = '', [int]$Intake = 0, [int[]]$RequestBuilds = @())
    $mk = { param([bool]$L, [string]$Why, [bool]$H = $false) [pscustomobject]@{ Launch = $L; Reason = $Why; Hold = $H } }
    if ($Budget -and $Budget.Verdict -eq 'hold') { return (& $mk $false "$($Budget.Reason): no claude session" $true) }
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
    $launch = (($Mode -eq 'FULL' -and $b -gt 0 -and -not $BuildCap) -or ($free -gt 0 -and $PhaseBAllowed -and -not $PhaseBCap))
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

# Does a request need an intake session now? Returns NeedsIntake, Key (the approval watcher's once-key:
# 'req:<n>:<id of Ve's latest comment, or 0>') and Reason. Yes when it is a valid request, not loop:planned,
# not loop:declined, and either not loop:needs-info or Ve has commented (without the loop marker) after the
# loop's latest comment. The approval watcher keeps a LITERAL COPY of this function (it runs from an
# admin-only folder and dot-sources nothing): change both together (test-queue-rules.ps1 compares them).
function Get-RequestTriggerDecision {
    param($Issue, [object[]]$Comments = @(), [string]$Owner, [string]$Marker = '<!-- innovation-loop -->')
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
    $cs = @($Comments | Where-Object { $_ -and "$($_.user.login)" -eq $Owner } | Sort-Object { [datetime]$_.created_at })
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
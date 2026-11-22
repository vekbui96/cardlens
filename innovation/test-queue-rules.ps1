<#
.SYNOPSIS
  Unit tests for the queue and session rules in gate-rules.ps1: proposal slots (the ONE cap rule shared with
  the approval watcher, specs included), specs and their slices, failure markers and the one automatic retry,
  the precheck before claude, issues left mid-build, and the one-session-per-job planning (LOOP.md sections
  per session, models, the next-build decision, build outcomes, the run's result). No network, no git.
  powershell -ExecutionPolicy Bypass -File innovation\test-queue-rules.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$mk = '<!-- innovation-loop -->'

# ---- proposal slots: the ONE cap rule (loop + watcher) -----------------------------------------------
function Iss { param([int]$N, [string[]]$L, [string]$State = 'OPEN', [string]$Body = '', [string]$By = 'vekbui96')
    [pscustomobject]@{ number = $N; state = $State; body = $Body; author = [pscustomobject]@{ login = $By }; labels = @($L | ForEach-Object { [pscustomobject]@{ name = $_ } }) } }
Check ($script:ProposalCap -eq 5 -and $script:MaxNewPerRun -eq 3 -and $script:MaxOpenSpecs -eq 1) 'cap 5 slots, at most 3 new per run, at most 1 unapproved spec'
$open5 = @((Iss 33 'loop:proposal', 'approved', 'loop:failed'), (Iss 45 'loop:proposal'), (Iss 50 'loop:proposal', 'approved', 'loop:in-progress'),
    (Iss 57 'loop:proposal', 'area:x'))
$s = Get-ProposalSlots -Issues $open5
Check (($s.AwaitingReview -join ',') -eq '45,57' -and $s.Free -eq 3 -and $s.Open -eq 4 -and $s.NewThisRun -eq 3) "approved and failed do not hold slots (got awaiting $($s.AwaitingReview -join ','), free $($s.Free))"
$s = Get-ProposalSlots -Issues @(1..4 | ForEach-Object { Iss $_ 'loop:proposal' })
Check ($s.Free -eq 1 -and $s.NewThisRun -eq 1 -and $s.MayOpenSpec) '4 awaiting review -> one slot left, a spec still allowed'
$s = Get-ProposalSlots -Issues @(1..5 | ForEach-Object { Iss $_ 'loop:proposal' })
Check ($s.Free -eq 0 -and $s.NewThisRun -eq 0 -and -not $s.MayOpenSpec) '5 awaiting review -> no slot, no spec'
$s = Get-ProposalSlots -Issues @(1..7 | ForEach-Object { Iss $_ 'loop:proposal' })
Check ($s.Free -eq 0) 'over the cap (e.g. after lowering it) -> free 0, never negative'
$s = Get-ProposalSlots -Issues @()
Check ($s.Free -eq 5 -and $s.NewThisRun -eq 3 -and $s.MayOpenSpec) 'none open -> 5 free, at most 3 new this run, a spec allowed'
$s = Get-ProposalSlots -Issues @((Iss 1 'loop:product-review'), (Iss 2 'loop:proposal', 'loop:failed'))
Check ($s.Free -eq 5 -and $s.Open -eq 1) 'only loop:proposal issues count; a failed one (even unapproved) holds no slot'
$s = Get-ProposalSlots -Issues @([pscustomobject]@{ number = 9; labels = @('loop:proposal') })
Check ($s.AwaitingReview -contains 9) 'labels as plain strings work too'

# ---- specs hold slots like proposals ------------------------------------------------------------------
$s = Get-ProposalSlots -Issues @((Iss 70 'loop:proposal', 'loop:spec'), (Iss 71 'loop:proposal'))
Check ($s.Free -eq 3 -and ($s.SpecsAwaiting -join ',') -eq '70' -and -not $s.MayOpenSpec) 'an unapproved spec takes ONE slot; a second spec is not allowed while it waits'
$s = Get-ProposalSlots -Issues @((Iss 70 'loop:proposal', 'loop:spec', 'approved'), (Iss 72 'loop:proposal'))
Check ($s.Free -eq 4 -and $s.SpecsAwaiting.Count -eq 0 -and $s.MayOpenSpec) 'an approved spec holds no slot; a new spec is allowed again'
$s = Get-ProposalSlots -Issues @((Iss 70 'loop:proposal', 'loop:spec', 'approved'), (Iss 73 'loop:proposal'), (Iss 74 'loop:proposal'), (Iss 75 'loop:proposal'), (Iss 76 'loop:proposal'), (Iss 77 'loop:proposal'))
Check ($s.Free -eq 0 -and -not $s.MayOpenSpec) 'its open slices hold slots like any proposal; full -> nothing new'

# ---- spec bodies, slice links, the spec plan ----------------------------------------------------------
$specBody = @"
$mk
## Problem and evidence
Collectors cannot see how value changed.
## User flow
### Glasses (600x600, gestures only)
1. Not a slice: a numbered step in another section.
### Web
## Success metric
## Risks and out of scope
## Slices
1. **Store a daily value total**: server keeps one number a day (Pages + server).
2. **Show the trend on Home**: a sparkline under the total.
3. Price-spike alert: a badge when a card moves 20% - glasses only
 4) **Glasses swipe to the trend** - one gesture
   5. nested, not a slice
## Notes
1. not a slice either
"@
$sl = @(Get-SpecSlices -Body $specBody)
Check ($sl.Count -eq 4 -and ($sl | ForEach-Object { $_.K }) -join ',' -eq '1,2,3,4') "four slices parsed from ## Slices only (got $($sl.Count): $(@($sl | ForEach-Object { $_.K }) -join ','))"
Check ($sl[0].Title -eq 'Store a daily value total' -and $sl[2].Title -eq 'Price-spike alert' -and $sl[3].Title -eq 'Glasses swipe to the trend') "slice titles: bold text, else text up to the first ': ' or ' - ' ($(@($sl | ForEach-Object { $_.Title }) -join ' | '))"
Check (@(Get-SpecSlices -Body "## Slices`n1. **x <!-- innovation-loop --> @someone**: y")[0].Title -notmatch '<!--|@someone') 'a slice title cannot forge a marker or a mention'
Check (@(Get-SpecSlices -Body "## What`nno slices here").Count -eq 0) 'no Slices section -> nothing'
$lk = Get-SliceLink -Body "$mk`nPart of #70 (slice 2 of 4)`n## What"
Check ($lk.Spec -eq 70 -and $lk.K -eq 2 -and $lk.Of -eq 4) 'slice link parsed'
Check ($null -eq (Get-SliceLink -Body 'see #70, part of the plan')) 'prose mentioning a spec is not a link'
Check ((Get-SliceLink -Body "**Part of #70 (slice 1 of 4)**").K -eq 1) 'bold link line works'

$spec = Iss 70 'loop:proposal', 'loop:spec', 'approved' -Body $specBody
$all = @($spec,
    (Iss 81 'loop:proposal', 'loop:deployed' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 1 of 4)"),
    (Iss 82 'loop:proposal', 'approved' -Body "$mk`nPart of #70 (slice 2 of 4)"),
    (Iss 83 'loop:proposal' -Body "Part of #70 (slice 3 of 4)"),                                   # no loop marker: not ours
    (Iss 84 'loop:proposal' -Body "$mk`nPart of #70 (slice 3 of 4)" -By 'someone-else'),           # not the owner
    (Iss 85 'loop:proposal' -Body "$mk`nPart of #71 (slice 3 of 4)"))                               # another spec
$pl = Get-SpecPlan -Spec $spec -Issues $all -Owner 'vekbui96' -Marker $mk
Check ($pl.Valid -and $pl.Of -eq 4 -and -not $pl.Complete) 'plan: valid, 4 slices, not complete'
Check ($pl.Slices[0].Issue -eq 81 -and $pl.Slices[0].Done -and $pl.Slices[0].Status -eq 'deployed') 'slice 1 deployed (closed)'
Check ($pl.Slices[1].Issue -eq 82 -and -not $pl.Slices[1].Done -and $pl.Slices[1].Status -match 'approved') 'slice 2 approved, open'
Check ((@($pl.ToOpen | ForEach-Object { $_.K }) -join ',') -eq '3,4') "slices 3 and 4 still to open: a link without the loop marker, by someone else or to another spec does not count (got $(@($pl.ToOpen | ForEach-Object { $_.K }) -join ','))"
$done = @($spec, (Iss 81 'loop:proposal', 'loop:deployed' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 1 of 4)"),
    (Iss 82 'loop:proposal' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 2 of 4)"),
    (Iss 86 'loop:proposal', 'loop:deployed' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 3 of 4)"),
    (Iss 87 'loop:proposal', 'loop:deployed' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 4 of 4)"))
$pd = Get-SpecPlan -Spec $spec -Issues $done -Owner 'vekbui96' -Marker $mk
Check ($pd.Complete -and $pd.ToOpen.Count -eq 0 -and $pd.Slices[1].Status -eq 'closed without building') 'every slice deployed or closed by the owner -> complete'
$dup = @($spec, (Iss 88 'loop:proposal' -State 'CLOSED' -Body "$mk`nPart of #70 (slice 1 of 4)"), (Iss 89 'loop:proposal' -Body "$mk`nPart of #70 (slice 1 of 4)"))
$pdu = Get-SpecPlan -Spec $spec -Issues $dup -Owner 'vekbui96' -Marker $mk
Check ($pdu.Slices[0].Issue -eq 89 -and ($pdu.Duplicates -join ',') -eq '1') 'two issues for one slice: the open one wins, flagged as a duplicate'
$bad = Get-SpecPlan -Spec (Iss 90 'loop:proposal', 'loop:spec' -Body "$mk`n## What`nno slices") -Issues @() -Owner 'vekbui96'
Check (-not $bad.Valid -and -not $bad.Complete -and $bad.ToOpen.Count -eq 0) 'a spec without a Slices list is invalid, never complete, opens nothing'
$fp = Format-SpecProgress -Plan $pl -RunId 'R1' -Marker $mk -Who 'Ve'
Check ($fp.Contains($mk) -and $fp.Contains($script:SpecProgressMarker) -and $fp -match '## Spec progress') 'checklist: both markers and the heading'
Check ($fp -match '- \[x\] 1\. Store a daily value total: #81 deployed' -and $fp -match '- \[ \] 2\. .*#82 approved' -and $fp -match '- \[ \] 3\. Price-spike alert: not opened yet') "checklist lines ($fp)"
Check ((Format-SpecProgress -Plan $pd) -match 'loop closes this spec') 'complete -> says it closes'
Check ((Format-SpecProgress -Plan $bad) -match 'Cannot slice this spec') 'invalid -> says why'

# ---- failure markers + the one automatic retry ------------------------------------------------------
$appr = '2026-11-16T10:00:00Z'
function Cm { param([string]$Body, [string]$At, [string]$By = 'vekbui96', [long]$Id = 1) [pscustomobject]@{ id = $Id; body = $Body; created_at = $At; user = [pscustomobject]@{ login = $By } } }
Check ((Format-FailureMarker 'ci-infra' 'failed') -eq '<!-- innovation-loop:failure class=ci-infra outcome=failed -->') 'marker format'
Check ((Format-FailureMarker 'made-up' 'weird') -eq '<!-- innovation-loop:failure class=other outcome=failed -->') 'unknown class/outcome normalised'
$cs = @((Cm "$mk`n$(Format-FailureMarker 'tests')`n## Synopsis" '2026-11-15T10:00:00Z' -Id 1),
    (Cm "$mk`n$(Format-FailureMarker 'gap-refused')`n## Synopsis" '2026-11-16T12:00:00Z' -Id 2),
    (Cm "$(Format-FailureMarker 'ci-infra')`nno loop marker" '2026-11-16T12:30:00Z' -Id 3),
    (Cm "$mk`n$(Format-FailureMarker 'ci-infra')" '2026-11-16T13:00:00Z' -By 'someone' -Id 4))
$fr = @(Get-FailureRecords -Comments $cs -Owner 'vekbui96' -Marker $mk -Since $appr)
Check ($fr.Count -eq 1 -and $fr[0].Class -eq 'gap-refused' -and $fr[0].Outcome -eq 'failed') "only the owner's loop comments after the approval count (got $($fr.Count))"
function Fr { param([string]$Class, [string]$Outcome = 'failed') [pscustomobject]@{ Class = $Class; Outcome = $Outcome } }
$L = @('loop:proposal', 'approved', 'loop:failed')
foreach ($c in 'ci-infra', 'ci-timeout', 'gap-refused', 'deploy-unavailable', 'out-of-time', 'timeout', 'max-turns') {
    $d = Get-RetryDecision -Labels $L -Failures @(Fr $c)
    Check ($d.Retry -and $d.Failed -and $d.Class -eq $c) "$c (outside the change) -> one retry"
}
foreach ($c in 'tests', 'guard-refused', 'scope', 'deploy-failed', 'session-ended', 'other', 'unknown-x') {
    $d = Get-RetryDecision -Labels $L -Failures @(Fr $c)
    Check (-not $d.Retry -and $d.Reason -match [regex]::Escape($c)) "$c (the change / unknown) -> not retried ($($d.Reason))"
}
Check (-not (Get-RetryDecision -Labels $L -Failures @(Fr 'ci-infra' 'rolled-back')).Retry) 'retryable class but rolled back -> not retried'
Check (-not (Get-RetryDecision -Labels ($L + 'loop:retried') -Failures @(Fr 'ci-infra')).Retry) 'loop:retried -> never a second retry'
Check (-not (Get-RetryDecision -Labels $L -Failures @((Fr 'ci-infra'), (Fr 'ci-timeout'))).Retry) 'two failures since the approval -> not retried'
Check (-not (Get-RetryDecision -Labels $L -Failures @()).Retry) 'no marker -> not retried'
$d = Get-RetryDecision -Labels @('loop:proposal', 'approved') -Failures @(Fr 'ci-infra')
Check (-not $d.Failed -and -not $d.Retry -and $d.Reason -eq '') 'not loop:failed -> no retry decision'

# ---- precheck before claude -------------------------------------------------------------------------
function Q { param([int[]]$B, [int]$Free, [int[]]$Aw = @()) [pscustomobject]@{ buildable = @($B); retry = @(); slots = [pscustomobject]@{ free = $Free; cap = 5; awaitingReview = @($Aw) }; waitingOnVe = @() } }
$p = Get-PrecheckDecision -Queue (Q @() 0 @(1, 2, 3)) -Mode 'FULL'
Check (-not $p.Launch -and $p.Reason -match '0 buildable' -and $p.Reason -match '0 free proposal slot') "nothing buildable, no slot -> skip ($($p.Reason))"
Check ((Get-PrecheckDecision -Queue (Q @(33) 0) -Mode 'FULL').Launch) 'a buildable issue -> launch'
Check ((Get-PrecheckDecision -Queue (Q @() 2) -Mode 'FULL').Launch) 'a free slot -> launch'
Check (-not (Get-PrecheckDecision -Queue (Q @(33) 0) -Mode 'PROPOSE_ONLY').Launch) 'PROPOSE_ONLY ignores buildable issues'
Check ((Get-PrecheckDecision -Queue (Q @() 0) -Mode 'PRODUCT_REVIEW').Launch) 'product review always launches'
Check ((Get-PrecheckDecision -Queue $null -Mode 'FULL').Launch) 'queue check failed -> launch as before'
$w = Format-WaitingOnOwner @([pscustomobject]@{ issue = 33; reason = 'tests: x' }, [pscustomobject]@{ issue = 40; reason = 'scope: y' }) 'Ve'
Check ($w -eq 'Failed, waiting on Ve: #33 (tests: x); #40 (scope: y).') "waiting line ($w)"

# ---- an issue left mid-build when the session stopped ----------------------------------------------
$u = Get-UnfinishedFailure -EndClass 'timeout' -TimeoutMinutes 150 -Who 'Ve'
Check ($u.Class -eq 'timeout' -and $u.Synopsis -match '150-minute' -and $u.Synopsis -match 'retries it once') 'killed at its time limit, nothing merged -> timeout (retryable)'
Check ((Get-UnfinishedFailure -EndClass 'max-turns').Class -eq 'max-turns') 'turn limit -> max-turns (retryable)'
$u = Get-UnfinishedFailure -EndClass 'timeout' -MergeSha 'abc1234' -Who 'Ve'
Check ($u.Class -eq 'session-ended' -and $u.Synopsis -match 'abc1234') 'merged but not verified -> session-ended (never retried)'

# ---- one session per job: the LOOP.md sections each session gets -----------------------------------
$md = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LOOP.md'))
$b = Get-LoopMdSections -Text $md -Sections @(0, 1, 2, 3, 4, 6)
Check ($b.StartsWith('# CardLens innovation loop') -and $b -match '(?m)^## 0\. ' -and $b -match '(?m)^## 3\. ' -and $b -match '(?m)^## 6\. ') 'build prompt: intro, hard rules, Phase A, end of run'
Check ($b -notmatch '(?m)^## 5\. ' -and $b -notmatch '(?m)^## 7\. ') 'build prompt: no Phase B, no product review'
$pp = Get-LoopMdSections -Text $md -Sections @(0, 1, 2, 5, 6)
Check ($pp -match '(?m)^## 5\. ' -and $pp -notmatch '(?m)^## 3\. ' -and $pp -notmatch '(?m)^## 4\. ') 'proposal prompt: Phase B, no Phase A'
Check ($pp.Length -lt $md.Length -and $b.Length -lt $md.Length) "each prompt is smaller than LOOP.md (build $($b.Length), propose $($pp.Length), all $($md.Length) chars)"
Check ((Get-LoopMdSections -Text "intro`n## 1. a`nA`n## 2. b`nB`n" -Sections @(2)) -eq "intro`n## 2. b`nB`n") 'section split keeps the intro and the chosen section only'

# ---- models, caps and limits (sessions.json) --------------------------------------------------------
$cfg = Get-SessionConfig $null
Check ($cfg.build.model -eq 'claude-opus-5-5' -and $cfg.build.smallModel -eq 'claude-sonnet-5-5' -and $cfg.propose.model -eq 'claude-sonnet-5-5' -and $cfg.review.model -eq 'claude-sonnet-5-5') 'defaults: builds on Opus, proposals and the review on Sonnet'
Check ($cfg.build.maxTurns -eq 150 -and $cfg.propose.maxTurns -eq 80) 'defaults: 150 turns per build session, 80 for proposals'
$cfg2 = Get-SessionConfig ('{"build":{"model":"m-big","maxTurns":120,"bogus":1},"propose":{"model":""}}' | ConvertFrom-Json)
Check ($cfg2.build.model -eq 'm-big' -and $cfg2.build.maxTurns -eq 120 -and -not $cfg2.build.Contains('bogus') -and $cfg2.propose.model -eq 'claude-sonnet-5-5') 'sessions.json overrides known keys; unknown keys ignored; empty keeps the default'
$real = Join-Path $PSScriptRoot 'sessions.json'
if (Test-Path $real) {
    $cfg3 = Get-SessionConfig ([IO.File]::ReadAllText($real) | ConvertFrom-Json)
    Check ($cfg3.build.maxTurns -gt 0 -and $cfg3.propose.maxTurns -gt 0 -and $cfg3.build.model -and $cfg3.propose.model) 'the checked-in sessions.json parses'
}
Check ((Get-SessionModel -Kind 'build' -Labels @('loop:proposal', 'approved') -Config $cfg) -eq 'claude-opus-5-5') 'build model: Opus by default'
Check ((Get-SessionModel -Kind 'build' -Labels @('loop:proposal', 'approved', 'size:small') -Config $cfg) -eq 'claude-sonnet-5-5') 'build model: size:small -> Sonnet'
Check ((Get-SessionModel -Kind 'build' -Labels @('test-only') -Config $cfg) -eq 'claude-sonnet-5-5') 'build model: test-only -> Sonnet'
Check ((Get-SessionModel -Kind 'propose' -Config $cfg) -eq 'claude-sonnet-5-5') 'proposal model: Sonnet'
Check ((Get-SessionModel -Kind 'build' -Labels @('size:small') -Config $cfg -Override 'x-model') -eq 'x-model') '-Model overrides everything'

# ---- the next build -----------------------------------------------------------------------------------
function D { param([int]$I, [string]$O) [pscustomobject]@{ Issue = $I; Outcome = $O } }
$n = Get-NextBuildDecision -Buildable @(12, 14) -Done @() -MaxBuilds 2 -RemainingMinutes 240
Check ($n.Start -and $n.Issue -eq 12) 'first build: the oldest buildable issue'
$n = Get-NextBuildDecision -Buildable @(12, 14) -Done @(D 12 'deployed') -MaxBuilds 2 -RemainingMinutes 150
Check ($n.Start -and $n.Issue -eq 14) 'after a deploy, with time left: the next issue'
$n = Get-NextBuildDecision -Buildable @(14) -Done @(D 12 'deployed') -MaxBuilds 2 -RemainingMinutes 100
Check (-not $n.Start -and $n.Reason -match 'min left') 'second build needs SecondBuildMinMinutes'
$n = Get-NextBuildDecision -Buildable @(14, 15) -Done @((D 12 'deployed'), (D 14 'deployed')) -MaxBuilds 2 -RemainingMinutes 200
Check (-not $n.Start -and $n.Reason -match 'MaxBuilds') 'MaxBuilds reached'
foreach ($o in 'failed', 'rolled-back', 'unknown') {
    $n = Get-NextBuildDecision -Buildable @(14) -Done @(D 12 $o) -MaxBuilds 2 -RemainingMinutes 200
    Check (-not $n.Start -and $n.Reason -match $o) "a build that ended $o stops Phase A"
}
$n = Get-NextBuildDecision -Buildable @(12, 14) -Done @(D 12 'skipped') -MaxBuilds 1 -RemainingMinutes 200
Check ($n.Start -and $n.Issue -eq 14) 'a skipped issue (server rule) does not count toward MaxBuilds; the next one is tried'
$n = Get-NextBuildDecision -Buildable @(12, 14, 15) -Done @((D 12 'skipped'), (D 14 'skipped')) -MaxBuilds 2 -RemainingMinutes 200
Check (-not $n.Start -and $n.Reason -match 'skipped') 'at most 2 skips per run'
Check (-not (Get-NextBuildDecision -Buildable @() -Done @() -RemainingMinutes 240).Start) 'nothing buildable -> no session'
Check (-not (Get-NextBuildDecision -Buildable @(12) -Done @() -RemainingMinutes 30).Start) 'too little time for even the first build'

# ---- how a build session ended -----------------------------------------------------------------------
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved', 'loop:deployed') -MarkerOutcome 'deployed') -eq 'deployed') 'deployed label -> deployed'
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved', 'loop:failed') -MarkerOutcome 'rolled back') -eq 'rolled-back') 'failed + rolled-back marker -> rolled-back'
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved', 'loop:failed') -MarkerOutcome '') -eq 'failed') 'failed label -> failed'
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved') -MarkerOutcome 'skipped') -eq 'skipped') 'no state label, skipped marker -> skipped'
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved') -MarkerOutcome 'deployed') -eq 'unknown') 'claims deployed but no label -> unknown (stops Phase A)'
Check ((Get-BuildOutcome -Labels @('loop:proposal', 'approved', 'loop:in-progress')) -eq 'unknown') 'still in progress -> unknown'

# ---- the run's LOOP-RESULT over its sessions ----------------------------------------------------------
function S { param([string]$K, [int]$I = 0, [string]$St = 'OK', [string]$R = '', [bool]$Ok = $true) [pscustomobject]@{ Kind = $K; Issue = $I; Status = $St; Reason = $R; Ok = $Ok } }
Check ((Get-RunResult -Sessions @((S 'build' 12), (S 'propose' -St 'NOTHING-TO-DO'))).Line -eq 'LOOP-RESULT: OK') 'a deployed build + nothing proposed -> OK'
Check ((Get-RunResult -Sessions @((S 'propose' -St 'NOTHING-TO-DO'))).Status -eq 'NOTHING-TO-DO') 'only nothing-to-do -> NOTHING-TO-DO'
$r = Get-RunResult -Sessions @((S 'build' 12 'FAILED' 'deploy rolled back'), (S 'propose'))
Check ($r.Status -eq 'FAILED' -and $r.Line -match 'build #12: deploy rolled back') "a failed session -> FAILED, named ($($r.Line))"
$r = Get-RunResult -Sessions @((S 'build' 12 '' '' $false))
Check ($r.Status -eq 'FAILED' -and $r.Line -match 'no LOOP-RESULT') 'a killed session (no summary) -> FAILED'
$r = Get-RunResult -Sessions @((S 'build' 12)) -Problems @('#12: DEPLOY STATE UNCERTAIN')
Check ($r.Status -eq 'FAILED' -and $r.Line -match 'UNCERTAIN') 'a runner problem -> FAILED'
Check ((Get-RunResult -Sessions @((S 'propose' -Ok $false))).Status -eq 'FAILED') 'claude exited with an error -> FAILED'
Check ((Get-RunResult).Status -eq 'NOTHING-TO-DO') 'no sessions -> NOTHING-TO-DO'

# ---- slices auto-approved through their approved spec (Get-ViaSpecDecision) ---------------------------------
$vsSpecBody = @"
$mk
## Problem and evidence
x
## Slices
1. **Since you last looked (device-local)**: Home line. Size S, Pages only.
2. **Value history design and storage decision**: decision note.
3. **Snapshot writer**: records one row a day.
4. **Value over time chart on Home**: reads the history.
"@
function VsIss { param([int]$N, [string]$Title, [string[]]$L = @('loop:proposal'), [string]$Body, [string]$State = 'OPEN', [string]$By = 'vekbui96', [string]$Created = '2026-11-20T18:57:17Z')
    [pscustomobject]@{ number = $N; title = $Title; state = $State; body = $Body; createdAt = $Created; author = [pscustomobject]@{ login = $By }; labels = @($L | ForEach-Object { [pscustomobject]@{ name = $_ } }) } }
function VsBody { param([int]$K, [int]$Of = 4, [int]$Spec = 108, [string]$Extra = '') "$mk`nPart of #$Spec (slice $K of $Of)`n## What`nthe slice.$Extra" }
function VsCmt { param([string]$Body, [string]$At = '2026-11-21T10:00:00Z', [string]$By = 'vekbui96', [int]$Id = 5) [pscustomobject]@{ id = $Id; body = $Body; created_at = $At; user = [pscustomobject]@{ login = $By } } }
$vsSpec = VsIss 108 'Spec: Collection value over time' @('loop:proposal', 'approved', 'loop:spec') $vsSpecBody -Created '2026-11-20T16:39:09Z'
$vsOk = [pscustomobject]@{ buildable = $true; approvedAt = '2026-11-20T17:00:00Z'; reasons = @() }
$s1 = VsIss 110 'Since you last looked (device-local)' -Body (VsBody 1)
$s2 = VsIss 111 'Value history design and storage decision' -Body (VsBody 2)
$s3 = VsIss 112 'Snapshot writer' -Body (VsBody 3)
$s4 = VsIss 117 'Home (phone/desktop): Value over time chart on Home' -Body (VsBody 4) -Created '2026-11-22T00:24:55Z'
function Vs { param($Slice, [object[]]$Issues = @($vsSpec, $s1, $s2, $s3, $s4), $Check = $vsOk, $Spec = $vsSpec, [string]$Edited = '', [object[]]$Comments = @(), [object[]]$SpecComments = @(), [int]$Ev = 0)
    Get-ViaSpecDecision -Slice $Slice -SliceEditedAt $Edited -SliceComments $Comments -SliceApprovalEvents $Ev -Spec $Spec -SpecCheck $Check -SpecComments $SpecComments -Issues $Issues -Owner 'vekbui96' -Marker $mk }
function Why { param($D) ($D.Reasons -join ' | ') }

$d = Vs $s4
Check ($d.Linked -and $d.Eligible -and $d.Spec -eq 108 -and $d.K -eq 4 -and $d.Of -eq 4 -and $d.SpecApprovedAt -eq '2026-11-20T17:00:00Z') "approved spec, loop slice, earlier slices fine -> auto-approved (got: $(Why $d))"
$d = Vs $s1
Check ($d.Eligible) "first slice, nothing earlier -> auto-approved (got: $(Why $d))"
# 1. the spec's approval
$d = Vs $s4 -Check ([pscustomobject]@{ buildable = $false; approvedAt = $null; reasons = @('no labeled-approved event found') })
Check (-not $d.Eligible -and (Why $d) -match 'not approved') 'unapproved spec -> not auto-approved'
$d = Vs $s4 -Check ([pscustomobject]@{ buildable = $false; approvedAt = '2026-11-20T17:00:00Z'; reasons = @('approved label was removed after it was added') })
Check (-not $d.Eligible -and (Why $d) -match 'removed') 'spec approval removed -> not auto-approved'
$d = Vs $s4 -Check ([pscustomobject]@{ buildable = $false; approvedAt = '2026-11-20T17:00:00Z'; reasons = @('issue body edited at x, after approval') })
Check (-not $d.Eligible -and (Why $d) -match 'edited') 'spec edited after approval -> not auto-approved'
$d = Vs $s4 -Spec (VsIss 108 'Spec' @('loop:proposal', 'approved', 'loop:spec') $vsSpecBody -State 'CLOSED')
Check (-not $d.Eligible -and (Why $d) -match 'spec #108 is closed') 'closed spec -> not auto-approved'
$d = Vs $s4 -Spec (VsIss 108 'Spec' @('loop:proposal', 'approved') $vsSpecBody)
Check (-not $d.Eligible -and (Why $d) -match 'not a loop:spec') 'linked issue is not a loop:spec -> not auto-approved'
$d = Vs $s4 -Spec $null
Check (-not $d.Eligible -and (Why $d) -match 'not found') 'spec missing -> not auto-approved'
$d = Vs $s4 -SpecComments @((VsCmt '/hold until I look at the chart' -At '2026-11-21T09:00:00Z'))
Check (-not $d.Eligible -and (Why $d) -match 'put spec #108 on hold') '/hold on the spec after its approval -> every slice held'
$d = Vs $s4 -SpecComments @((VsCmt '/hold' -At '2026-11-20T16:50:00Z'))
Check ($d.Eligible) "a hold on the spec BEFORE its (re-)approval no longer counts (got: $(Why $d))"
$early = VsIss 117 'Value over time chart on Home' -Body (VsBody 4) -Created '2026-11-20T16:59:00Z'
$d = Vs $early -Issues @($vsSpec, $s1, $s2, $s3, $early)
Check (-not $d.Eligible -and (Why $d) -match 'opened before spec #108') 'slice opened before the spec approval -> not auto-approved'
# 2. opened by the loop, in the loop's format, in the spec's list
$d = Vs (VsIss 117 'Value over time chart on Home' -Body (VsBody 4) -By 'someone') -Issues @($vsSpec, $s1, $s2, $s3)
Check (-not $d.Eligible -and (Why $d) -match 'opened by someone') 'slice not opened by the owner account -> not auto-approved'
$noMark = VsIss 117 'Value over time chart on Home' -Body "Part of #108 (slice 4 of 4)`n$mk`nbody" -Created '2026-11-22T00:24:55Z'
$d = Vs $noMark -Issues @($vsSpec, $s1, $s2, $s3, $noMark)
Check (-not $d.Eligible -and (Why $d) -match 'does not start with the loop marker') 'marker not the first line -> not auto-approved (and the plan ignores it)'
$d = Vs (VsIss 117 'Value over time chart on Home' @('size:small') -Body (VsBody 4) -Created '2026-11-22T00:24:55Z')
Check (-not $d.Eligible -and (Why $d) -match 'missing label loop:proposal') 'no loop:proposal -> not auto-approved'
$k9 = VsIss 120 'Value over time chart on Home' -Body (VsBody 9 -Of 4) -Created '2026-11-22T00:24:55Z'
$d = Vs $k9 -Issues @($vsSpec, $s1, $s2, $s3, $k9)
Check (-not $d.Eligible -and (Why $d) -match 'slice 9 is not in spec') 'slice index not in the spec -> not auto-approved'
$of5 = VsIss 120 'Value over time chart on Home' -Body (VsBody 4 -Of 5) -Created '2026-11-22T00:24:55Z'
$d = Vs $of5 -Issues @($vsSpec, $s1, $s2, $s3, $of5)
Check (-not $d.Eligible -and (Why $d) -match 'says 5 slices') 'slice count differs from the spec -> not auto-approved'
$bt = VsIss 117 'Delete every binder' -Body (VsBody 4) -Created '2026-11-22T00:24:55Z'
$d = Vs $bt -Issues @($vsSpec, $s1, $s2, $s3, $bt)
Check (-not $d.Eligible -and (Why $d) -match 'title does not match') 'title unlike the spec slice -> not auto-approved'
$d = Vs $s1 -Spec (VsIss 108 'Spec' @('loop:proposal', 'approved', 'loop:spec') "$mk`n## Problem`nno slices")
Check (-not $d.Eligible -and (Why $d) -match 'nothing to open') 'spec without a ## Slices list -> not auto-approved'
$dup = VsIss 116 'Value over time chart on Home' -Body (VsBody 4) -Created '2026-11-21T00:00:00Z'
$d = Vs $s4 -Issues @($vsSpec, $s1, $s2, $s3, $dup, $s4)
Check (-not $d.Eligible -and (Why $d) -match 'counts #116 as slice 4') 'a duplicate that the plan counts instead -> this one is not auto-approved'
$d = Vs (VsIss 999 'x' -Body "$mk`nno link")
Check (-not $d.Linked -and -not $d.Eligible) 'not a slice at all -> Linked false'
Check (Test-SliceTitleMatch 'Since you last looked (device-local)' 'Home (phone/desktop): since you last looked, device local') 'title match tolerates case, punctuation and a screen prefix'
Check (Test-SliceTitleMatch 'Value over time chart on Home' 'Value-over-time chart on the Home screen') 'title match tolerates minor rewording'
Check (-not (Test-SliceTitleMatch 'Snapshot writer' 'Binder undo')) 'unrelated titles do not match'
Check (-not (Test-SliceTitleMatch 'Home' 'Home (phone/desktop): Biggest movers strip')) 'a very short title is not matched by containment alone'
# 3. Manual, failed, build order
$man = VsIss 110 'Since you last looked (device-local)' -Body (VsBody 1 -Extra "`n**Manual / needs Ve** because it adds a storage key.")
$d = Vs $man -Issues @($vsSpec, $man, $s2, $s3, $s4)
Check (-not $d.Eligible -and (Why $d) -match 'marked Manual') 'Manual / needs Ve slice -> never auto-approved'
$d = Vs $s4 -Issues @($vsSpec, $man, $s2, $s3, $s4)
Check (-not $d.Eligible -and (Why $d) -match 'earlier slice 1 \(#110\) is Manual') 'an open Manual earlier slice holds the later ones'
$manClosed = VsIss 110 'Since you last looked (device-local)' -Body (VsBody 1 -Extra "`n**Manual / needs Ve**") -State 'CLOSED'
$d = Vs $s4 -Issues @($vsSpec, $manClosed, $s2, $s3, $s4)
Check ($d.Eligible) "an earlier Manual slice that Ve closed releases the later ones (got: $(Why $d))"
$f = VsIss 117 'Value over time chart on Home' @('loop:proposal', 'loop:failed') -Body (VsBody 4) -Created '2026-11-22T00:24:55Z'
$d = Vs $f -Issues @($vsSpec, $s1, $s2, $s3, $f)
Check (-not $d.Eligible -and (Why $d) -match 'loop:failed') 'failed slice -> not auto-approved (no automatic retry)'
$f2 = VsIss 111 'Value history design and storage decision' @('loop:proposal', 'loop:failed') -Body (VsBody 2)
$d = Vs $s4 -Issues @($vsSpec, $s1, $f2, $s3, $s4)
Check (-not $d.Eligible -and (Why $d) -match 'earlier slice 2 \(#111\) failed') 'an open failed earlier slice holds the later ones'
$d = Vs $s4 -Issues @($vsSpec, $s1, $s2, $s4)
Check (-not $d.Eligible -and (Why $d) -match 'earlier slice 3 is not opened yet') 'an earlier slice not opened yet holds the later ones'
# 4. veto
$d = Vs (VsIss 117 'Value over time chart on Home' -Body (VsBody 4) -State 'CLOSED' -Created '2026-11-22T00:24:55Z')
Check (-not $d.Eligible -and (Why $d) -match 'slice is closed') 'closed slice -> not auto-approved'
$d = Vs $s4 -Comments @((VsCmt '/hold' -At '2026-11-22T01:00:00Z'))
Check (-not $d.Eligible -and (Why $d) -match 'put this slice on hold') '/hold comment from Ve -> vetoed'
$d = Vs $s4 -Comments @((VsCmt 'Hold: let me check the colours first' -At '2026-11-22T01:00:00Z'))
Check (-not $d.Eligible) '"hold ..." (no slash, any case) also vetoes'
$d = Vs $s4 -Comments @((VsCmt '/hold' -At '2026-11-22T01:00:00Z' -By 'stranger'))
Check ($d.Eligible) "a /hold from anyone else is data, not a veto (got: $(Why $d))"
$d = Vs $s4 -Comments @((VsCmt "$mk`n/hold" -At '2026-11-22T01:00:00Z'))
Check ($d.Eligible) 'a loop comment (marker) never counts as a hold'
$d = Vs $s4 -Comments @((VsCmt 'looks good, but keep the chart small' -At '2026-11-22T01:00:00Z'))
Check ($d.Eligible) 'an ordinary adjustment comment is not a hold'
$d = Vs $s4 -Comments @((VsCmt 'I will withhold judgement' -At '2026-11-22T01:00:00Z'))
Check ($d.Eligible) 'the word hold inside a sentence is not a hold'
$d = Vs $s4 -Ev 2
Check (-not $d.Eligible -and (Why $d) -match 'added to and removed') '`approved` added and removed on the slice by hand -> that decision stands'
# 5. edited
$d = Vs $s4 -Edited '2026-11-22T02:00:00Z'
Check (-not $d.Eligible -and (Why $d) -match 'body edited') 'slice body edited after it was opened -> not auto-approved'
# slots and the notice
$sv = Get-ProposalSlots -Issues @((Iss 108 'loop:proposal', 'loop:spec', 'approved'), (Iss 117 'loop:proposal'), (Iss 118 'loop:proposal')) -ApprovedViaSpec @(117)
Check (($sv.AwaitingReview -join ',') -eq '118' -and $sv.Free -eq 4) "an auto-approved slice holds no proposal slot (got awaiting $($sv.AwaitingReview -join ','))"
$nt = Format-ViaSpecNotice -Spec 108 -ApprovedAt '2026-11-20T17:00:00Z' -Who 'Ve' -Marker $mk
Check ($nt.StartsWith($mk) -and $nt.Contains($script:ViaSpecMarker) -and $nt -match 'Auto-approved via spec #108 \(approved by Ve on 2026-11-20\)\. Comment `/hold` to stop\.') "notice text (got: $nt)"
Check (-not ($nt -match $script:HoldRx)) 'the notice itself does not read as a hold'
Check ((Format-SpecProgress -Plan $pl -Who 'Ve') -match 'Approving this spec approves its slices' -and (Format-SpecProgress -Plan $pl) -match '/hold') 'the spec checklist explains auto-approval and /hold'

if ($script:fail -gt 0) { Write-Host "TEST-QUEUE-RULES FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-QUEUE-RULES PASS ($script:pass checks)"
exit 0

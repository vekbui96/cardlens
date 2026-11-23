<#
.SYNOPSIS
  Unit tests for product-intel.ps1 (Phase 2 of the product intelligence layer): the coordinator's decisions (idle ->
  no session, change -> Observer, findings -> PM, slots full -> no PM), workflow mapping, metric deltas, the Observer's
  and the PM's JSON validation (invalid output dropped), finding dedup and status transitions, opportunity scoring,
  and the proposal-cites-a-finding check. No network, no git, no claude; writes only to a temp folder.
  powershell -ExecutionPolicy Bypass -File innovation\test-product-intel.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
. "$PSScriptRoot\product-store.ps1"
. "$PSScriptRoot\product-intel.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$now = [datetime]'2026-11-22T12:00:00Z'
$wfJson = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'workflows.json')) | ConvertFrom-Json
$WF = ConvertTo-Workflows $wfJson

# ---- workflows ---------------------------------------------------------------------------------------------------
Check ('src/v2/screens/home/HomeScreen.tsx' -match (ConvertTo-GlobRegex 'src/v2/screens/home/**')) 'glob: ** matches a file below the folder'
Check ('src/v2/screens/home/a/b/c.ts' -match (ConvertTo-GlobRegex 'src/v2/screens/home/**')) 'glob: ** matches any depth'
Check (-not ('src/v2/screens/homes/x.ts' -match (ConvertTo-GlobRegex 'src/v2/screens/home/**'))) 'glob: a sibling folder with a longer name does not match'
Check ('src/v2/screens/home/EmptyHome.tsx' -match (ConvertTo-GlobRegex 'src/v2/screens/home/Empty*') -and -not ('src/v2/screens/home/x/EmptyHome.tsx' -match (ConvertTo-GlobRegex 'src/v2/screens/home/Empty*'))) 'glob: * stays within one folder'
Check ('src/a.ts' -match (ConvertTo-GlobRegex 'src/**/a.ts') -and 'src/x/y/a.ts' -match (ConvertTo-GlobRegex 'src/**/a.ts')) 'glob: **/ matches zero or more folders'
foreach ($w in 'home', 'collection', 'set', 'wantlist', 'search', 'scan', 'binders', 'sealed', 'settings-sync', 'onboarding', 'shell') { Check ($WF.Contains($w)) "workflows.json has $w" }
$ch = Get-ChangedWorkflows -Files @('src/v2/screens/home/EmptyHome.tsx', 'src/v2/screens/scan/batch.ts', 'docs/handoff.md', 'innovation/run-loop.ps1', 'src\web\binders\WebBinderScreen.tsx') -Workflows $WF
Check ((@($ch.Map.Keys) -join ',') -eq 'home,scan,binders,onboarding') "changed files mapped to workflows in workflows.json order, a file in two (got $(@($ch.Map.Keys) -join ','))"
Check ((@($ch.Unmapped) -join ',') -eq 'docs/handoff.md,innovation/run-loop.ps1') "files in no workflow are listed apart (got $(@($ch.Unmapped) -join ','))"
Check (@((Get-ChangedWorkflows -Files @('README.md') -Workflows $WF).Map.Keys).Count -eq 0) 'docs-only change: no workflow'
Check (@((ConvertTo-Workflows ([pscustomobject]@{ workflows = [pscustomobject]@{ 'Bad Name!' = [pscustomobject]@{ globs = @('x/**') }; ok = [pscustomobject]@{ globs = @() } } })).Keys).Count -eq 0) 'bad names and empty globs are ignored'

# ---- metrics -----------------------------------------------------------------------------------------------------
$sum = [pscustomobject]@{ rates = [pscustomobject]@{ syncFailureRate = 0.0435; homePriceCoverage = 0.9189; syncRuns = 46; screenViewShares = [pscustomobject]@{ home = 0.2 }; avgBatchSize = 1 } }
$rt = Get-MetricRates $sum
Check ((@($rt.Keys) -join ',') -eq 'syncFailureRate,homePriceCoverage') "only rates in 0..1 are kept, not counts or share maps (got $(@($rt.Keys) -join ','))"
$old = [pscustomobject]@{ syncFailureRate = 0.04; homePriceCoverage = 0.70 }
$dl = @(Get-MetricDeltas -Old $old -New $rt -Points 10)
Check (@($dl | Where-Object { $_.Moved } | ForEach-Object { $_.Key }) -join ',' -eq 'homePriceCoverage') 'a 22-point move is past 10 points; 0.4 points is not'
Check (@(Get-MetricDeltas -Old $null -New $rt -Points 10).Count -eq 0) 'no snapshot yet: no delta, no move'
Check (@(Get-MetricDeltas -Old ([pscustomobject]@{ syncFailureRate = 0.0 }) -New ([ordered]@{ syncFailureRate = 0.1 }) -Points 10 | Where-Object { $_.Moved }).Count -eq 1) 'exactly the threshold counts as moved'
Check ((Format-MetricDelta $dl[1]) -eq 'homePriceCoverage 0.7 -> 0.9189 (+0.2189)') "delta line ($(Format-MetricDelta $dl[1]))"

# ---- coordinator -------------------------------------------------------------------------------------------------
$none = Get-ChangedWorkflows -Files @() -Workflows $WF
$slots3 = [pscustomobject]@{ newThisRun = 3; free = 3; mayOpenSpec = $true }
$slots0 = [pscustomobject]@{ newThisRun = 0; free = 0; mayOpenSpec = $false }
$idle = Get-CoordinatorDecision -Changed $none -Deltas @() -Slots $slots3
Check (-not $idle.Observe -and -not $idle.PmNow -and -not $idle.PhaseB) 'idle day (no change, no new input, free slots): neither runs ($0)'
Check (($idle.Reasons -join ' ') -match 'no workflow file changed' -and ($idle.Reasons -join ' ') -match 'nothing new since its last run') "idle reasons are logged ($($idle.Reasons -join ' | '))"
$docs = Get-CoordinatorDecision -Changed (Get-ChangedWorkflows -Files @('docs/x.md') -Workflows $WF) -Slots $slots3
Check (-not $docs.PhaseB) 'a change outside every workflow: idle'
$chg = Get-CoordinatorDecision -Changed $ch -Slots $slots3
Check ($chg.Observe -and -not $chg.PmNow -and $chg.PmAfterObserve -and $chg.PhaseB) 'workflow change -> Observer; the PM only if the Observer adds findings'
$met = Get-CoordinatorDecision -Changed $none -Deltas $dl -Slots $slots3
Check ($met.Observe -and ($met.Reasons -join ' ') -match 'homePriceCoverage') 'a metric past the threshold -> Observer'
$fnd = Get-CoordinatorDecision -Changed $none -NewFindings 2 -Slots $slots3
Check ($fnd.PmNow -and -not $fnd.Observe -and $fnd.PhaseB) 'new findings, free slot -> PM (no Observer)'
Check ((Get-CoordinatorDecision -Changed $none -NewDecisions 1 -Slots $slots3).PmNow) 'a new decision -> PM'
Check ((Get-CoordinatorDecision -Changed $none -NewResearch 1 -Slots $slots3).PmNow) 'a new research answer -> PM'
Check ((Get-CoordinatorDecision -Changed $none -SlicesToOpen 1 -Slots $slots3).PmNow) 'an approved slice to open -> PM'
$full = Get-CoordinatorDecision -Changed $none -NewFindings 5 -NewDecisions 3 -Slots $slots0
Check (-not $full.PmNow -and -not $full.PmAfterObserve -and -not $full.PhaseB -and ($full.Reasons -join ' ') -match 'no free proposal slot') 'slots full -> no PM, even with new findings'
$fullChg = Get-CoordinatorDecision -Changed $ch -Slots $slots0
Check ($fullChg.Observe -and -not $fullChg.PmAfterObserve) 'slots full but a change -> the Observer still runs (findings wait for a slot), no PM'
Check (-not (Get-CoordinatorDecision -Changed $none -NewFindings 2 -Slots $null).PmNow) 'queue unknown (no slots) -> no PM'
$capO = Get-CoordinatorDecision -Changed $ch -Slots $slots3 -ObserveBlocked 'daily cap reached'
Check (-not $capO.Observe -and -not $capO.PmAfterObserve -and -not $capO.PhaseB -and ($capO.Reasons -join ' ') -match 'needed but not now \(daily cap') 'observer capped -> not run, reason logged'
$capP = Get-CoordinatorDecision -Changed $none -NewFindings 2 -Slots $slots3 -PmBlocked 'plan budget'
Check (-not $capP.PmNow -and -not $capP.PhaseB -and ($capP.Reasons -join ' ') -match 'pm: not now') 'pm capped -> not run'
Check (-not (Get-CoordinatorDecision -Changed $null -Slots $slots3).Observe) 'unreadable diff -> no Observer (nothing to point it at)'
Check ((Get-PmDecisionAfterObserve -Coordinator $chg -NewFindings 2).Run) 'after the Observer: 2 new findings -> PM'
Check (-not (Get-PmDecisionAfterObserve -Coordinator $chg -NewFindings 0).Run) 'after the Observer: nothing new -> no PM'
Check ((Get-PmDecisionAfterObserve -Coordinator $fnd -NewFindings 0).Run) 'PM inputs already new before the Observer -> PM'
Check (-not (Get-PmDecisionAfterObserve -Coordinator $fullChg -NewFindings 3).Run) 'slots full -> no PM even after new findings'
# the precheck: an idle coordinator means no claude session at all
$q = [pscustomobject]@{ buildable = @(); slots = [pscustomobject]@{ free = 3; newThisRun = 3; cap = 5; awaitingReview = @(1, 2) } }
$p1 = Get-PrecheckDecision -Queue $q -Mode 'FULL' -Coordinator $idle
Check (-not $p1.Launch -and $p1.Reason -match 'idle') "precheck: free slots but an idle coordinator -> no launch ($($p1.Reason))"
Check ((Get-PrecheckDecision -Queue $q -Mode 'FULL' -Coordinator $chg).Launch) 'precheck: coordinator Phase B -> launch'
Check ((Get-PrecheckDecision -Queue $q -Mode 'FULL').Launch) 'precheck without the coordinator (flag off): free slots launch as before'
$qb = [pscustomobject]@{ buildable = @(12); slots = $q.slots }
Check ((Get-PrecheckDecision -Queue $qb -Mode 'FULL' -Coordinator $idle).Launch) 'precheck: a buildable issue launches even when Phase B is idle'
Check (-not (Get-PrecheckDecision -Queue $qb -Mode 'PROPOSE_ONLY' -Coordinator $idle).Launch) 'precheck: ProposeOnly + idle coordinator -> no launch'

# ---- agent JSON ------------------------------------------------------------------------------------------------
$fence = "Summary.`n``````json`n{""a"":1}`n```````nmore`n``````json`n{""result"":""nothing-new"",""findings"":[]}`n```````nLOOP-RESULT: NOTHING-TO-DO nothing-new"
Check ((ConvertFrom-AgentJson $fence).Json.result -eq 'nothing-new') 'the LAST json fence wins'
Check ((ConvertFrom-AgentJson 'I looked. {"result":"findings","findings":[]} done').Json.result -eq 'findings') 'bare JSON object parsed'
Check ((ConvertFrom-AgentJson 'nothing here').Error -ne '' -and (ConvertFrom-AgentJson '{not json}').Error -ne '' -and (ConvertFrom-AgentJson "``````json`n[1,2]`n``````").Error -ne '') 'no JSON / bad JSON / an array -> dropped with a reason'

# ---- Observer output ---------------------------------------------------------------------------------------------
$exists = { param([string]$R) $R -in @('src/v2/screens/home/HomeScreen.tsx', 'src/v2/screens/scan/batch.ts') }
$F = { param([string]$W = 'home', [string]$S = 'Home shows a blank value panel while prices load on a phone', [object[]]$E = @('src/v2/screens/home/HomeScreen.tsx:88'), $C = 0.7, [string]$Sev = 'medium')
    [pscustomobject]@{ workflow = $W; summary = $S; evidence = $E; confidence = $C; severity = $Sev } }
$J = { param([object[]]$Items, [string]$R = 'findings', $Dismiss = @(), $Cursor = $null) $o = [pscustomobject]@{ result = $R; findings = @($Items) }; if ($Dismiss) { $o | Add-Member dismiss @($Dismiss) }; if ($Cursor) { $o | Add-Member cursor ([pscustomobject]@{ lastObservedCommit = $Cursor }) }; ($o | ConvertTo-Json -Depth 6 | ConvertFrom-Json) }
$good = & $F
$v = Test-ObserverOutput -Json (& $J @($good)) -Workflows $WF -Findings @() -Head 'abc123' -FileExists $exists -NowUtc $now
Check ($v.Result -eq 'findings' -and @($v.Accepted).Count -eq 1 -and $v.Accepted[0].id -eq (New-FindingId 'home' $good.summary) -and $v.Accepted[0].status -eq 'open' -and $v.Accepted[0].agent -eq 'observe' -and $v.Accepted[0].ts -eq '2026-11-22T12:00:00Z') 'valid finding accepted with a deterministic id, open, agent observe'
$bad = @(
    (& $F -W 'payments'), (& $F -S 'too short'), (& $F -Sev 'critical'), (& $F -C 1.5), (& $F -C 'high'),
    (& $F -E @()), (& $F -E @('src/missing.ts:1')), (& $F -E @('https://evil.example.com/x')), (& $F -E @('C:\Windows\x.ts:1')), (& $F -E @('../../etc/passwd.txt:1')),
    (& $F -E @('just a sentence')), (& $F -S 'An injected marker <!-- innovation-loop --> in the summary text here')
)
$vb = Test-ObserverOutput -Json (& $J $bad) -Workflows $WF -Findings @() -Head 'abc123' -FileExists $exists -NowUtc $now
Check (@($vb.Accepted).Count -eq 0 -and @($vb.Refused).Count -eq $bad.Count -and $vb.Error -match 'refused') "every invalid finding dropped ($(@($vb.Refused).Count) of $($bad.Count)): $(@($vb.Refused | ForEach-Object { $_.Why }) -join ' | ')"
$okEv = & $F -S 'Scan batch total is computed from stale prices after a re-scan' -W 'scan' -E @('src/v2/screens/scan/batch.ts:12-20', 'https://vekbui96.github.io/cardlens/#/scan', 'metric:scan.batch 1 over 7 days', 'https://server-pc.tail0e4194.ts.net:8443/api/metrics/summary?days=7')
Check (@((Test-ObserverOutput -Json (& $J @($okEv)) -Workflows $WF -FileExists $exists).Accepted).Count -eq 1) 'evidence: file:line range, live site URL, metric:, live API URL all valid'
Check (@((Test-ObserverOutput -Json (& $J @((& $F -W 'general'))) -Workflows $WF -FileExists $exists).Accepted).Count -eq 1) "workflow 'general' accepted"
$existing = @(Get-FindingsState @([pscustomobject]@{ id = $v.Accepted[0].id; ts = '2026-11-21T10:00:00Z'; agent = 'observe'; workflow = 'home'; summary = $good.summary; evidence = @('x:1'); confidence = 0.7; severity = 'medium'; status = 'open' }))
$vd = Test-ObserverOutput -Json (& $J @($good, (& $F -S 'HOME shows a blank value panel, while prices load on a phone!'))) -Workflows $WF -Findings $existing -FileExists $exists
Check (@($vd.Accepted).Count -eq 0 -and @($vd.Refused | Where-Object { $_.Why -match 'duplicate' }).Count -eq 2) 'dedup: the same observation (case / punctuation aside) is a duplicate of the stored finding'
$twice = & $F -S 'Search results lose their scroll position after opening a card' -W 'search'
$vt = Test-ObserverOutput -Json (& $J @($twice, $twice)) -Workflows $WF -FileExists $exists
Check (@($vt.Accepted).Count -eq 1 -and @($vt.Refused | Where-Object { $_.Why -match 'same reply' }).Count -eq 1) 'dedup within one reply'
$dupOf = & $F -S 'A differently worded version of the blank value panel problem' ; $dupOf | Add-Member duplicateOf $existing[0].id
Check (@((Test-ObserverOutput -Json (& $J @($dupOf)) -Workflows $WF -Findings $existing -FileExists $exists).Accepted).Count -eq 0) 'duplicateOf an existing finding -> dropped'
$many = @(1..10 | ForEach-Object { & $F -S "Distinct observation number $_ about the home screen value" })
$vm = Test-ObserverOutput -Json (& $J $many) -Workflows $WF -FileExists $exists
Check (@($vm.Accepted).Count -eq 8 -and @($vm.Refused).Count -eq 2) 'at most 8 findings per run'
$vn = Test-ObserverOutput -Json (& $J @() 'nothing-new' -Cursor 'abc123') -Workflows $WF -Head 'abc123'
Check ($vn.Result -eq 'nothing-new' -and $vn.Cursor -eq 'abc123' -and $vn.Error -eq '') 'nothing-new with the right cursor'
$vc = Test-ObserverOutput -Json (& $J @() 'nothing-new' -Cursor 'zzz999') -Workflows $WF -Head 'abc123'
Check ($vc.Cursor -eq '' -and @($vc.Refused | Where-Object { $_.What -eq 'cursor' }).Count -eq 1) 'a suggested cursor that is not the observed head is ignored'
Check ((Test-ObserverOutput -Json ([pscustomobject]@{ result = 'maybe' }) -Workflows $WF).Result -eq 'invalid' -and (Test-ObserverOutput -Json $null -Workflows $WF).Result -eq 'invalid') 'unknown result / no JSON -> invalid'
$dis = [pscustomobject]@{ id = $existing[0].id; why = 'The value panel now shows a skeleton while loading'; evidence = @('src/v2/screens/home/HomeScreen.tsx:90') }
$vx = Test-ObserverOutput -Json (& $J @() 'nothing-new' -Dismiss @($dis)) -Workflows $WF -Findings $existing -FileExists $exists
Check ($vx.Result -eq 'findings' -and @($vx.Dismissed).Count -eq 1 -and $vx.Dismissed[0].status -eq 'dismissed') 'dismiss an open finding with evidence'
$addr = @(Get-FindingsState @($existing[0], [pscustomobject]@{ id = $existing[0].id; ts = '2026-11-22T00:00:00Z'; status = 'addressed'; refs = @('#212') }))
Check (@((Test-ObserverOutput -Json (& $J @() 'nothing-new' -Dismiss @($dis)) -Workflows $WF -Findings $addr -FileExists $exists).Dismissed).Count -eq 0) 'dismissing an addressed finding is refused (addressed is final)'
$disNoEv = [pscustomobject]@{ id = $existing[0].id; why = 'It is fine now, trust me on this' }
Check (@((Test-ObserverOutput -Json (& $J @() 'nothing-new' -Dismiss @($disNoEv)) -Workflows $WF -Findings $existing -FileExists $exists).Dismissed).Count -eq 0) 'dismiss without evidence refused'

# ---- findings state and status transitions -------------------------------------------------------------------
Check ((Test-FindingTransition 'open' 'addressed') -and (Test-FindingTransition 'open' 'dismissed') -and -not (Test-FindingTransition 'addressed' 'open') -and -not (Test-FindingTransition 'dismissed' 'open') -and -not (Test-FindingTransition 'addressed' 'dismissed')) 'transitions: open -> addressed | dismissed; both final'
$recs = @(
    [pscustomobject]@{ id = 'f-00000001'; ts = '2026-11-20T00:00:00Z'; agent = 'observe'; workflow = 'home'; summary = 'one'; evidence = @('a:1'); confidence = 0.5; severity = 'low'; status = 'open' },
    [pscustomobject]@{ id = 'f-00000002'; ts = '2026-11-21T00:00:00Z'; agent = 'observe'; workflow = 'scan'; summary = 'two'; evidence = @('a:1'); confidence = 0.9; severity = 'high'; status = 'open' },
    [pscustomobject]@{ id = 'f-00000003'; ts = '2026-11-22T00:00:00Z'; agent = 'observe'; workflow = 'set'; summary = 'three'; evidence = @('a:1'); confidence = 0.6; severity = 'high'; status = 'open' },
    [pscustomobject]@{ id = 'f-00000001'; ts = '2026-11-22T01:00:00Z'; agent = 'runner'; status = 'addressed'; refs = @('#300') },
    [pscustomobject]@{ id = 'f-00000001'; ts = '2026-11-22T02:00:00Z'; agent = 'observe'; status = 'open' },
    [pscustomobject]@{ id = 'f-0000000f'; ts = '2026-11-22T02:00:00Z'; agent = 'runner'; status = 'addressed' }
)
$st = @(Get-FindingsState $recs)
Check ($st.Count -eq 3 -and $st[0].status -eq 'addressed' -and (@($st[0].refs) -join ',') -eq '#300' -and $st[0].summary -eq 'one') 'state: status folded from later records, refs merged, an illegal reopen ignored, an orphan status record dropped'
Check ((@(Select-OpenFindings $st) | ForEach-Object { $_.id }) -join ',' -eq 'f-00000002,f-00000003') 'top open findings: severity, then confidence'
Check (@(Select-OpenFindings -Findings @(1..30 | ForEach-Object { [pscustomobject]@{ id = ('f-{0:x8}' -f $_); status = 'open'; severity = 'low'; confidence = 0.5; ts = "t$_" } })).Count -eq 20) 'at most 20 open findings loaded'
Check (@(Select-FindingsSince -Findings $st -SinceUtc '2026-11-21T12:00:00Z').Count -eq 1 -and @(Select-FindingsSince -Findings $st -SinceUtc '').Count -eq 2) 'new open findings since the PM''s last run'
$ad = @(Get-AddressedRecords -Findings $st -Ids @('f-00000001', 'f-00000002', 'f-00000002', 'f-99999999') -Ref '#301' -NowUtc $now)
Check ($ad.Count -eq 1 -and $ad[0].id -eq 'f-00000002' -and $ad[0].status -eq 'addressed' -and (@($ad[0].refs) -join ',') -eq '#301') 'addressed records: open ones only, once each, unknown ids ignored'

# ---- PM output and opportunities --------------------------------------------------------------------------------
Check ((Get-OpportunityScore 5 1 1 1) -eq 5 -and (Get-OpportunityScore 4 0.5 3 2) -eq 0.96 -and (Get-OpportunityScore 1 0 1 1) -eq 0) 'score = value x confidence x (6-effort) x (6-risk) / 25'
$decIds = @{ 'd-0123456789' = $true }
$O = { param([string]$T = 'Show a skeleton in the Home value panel while prices load', $V = 4, $C = 0.8, $E = 2, $R = 1, [string[]]$Fi = @('f-00000002'), [string[]]$De = @(), [string]$Id = '', [string]$S = 'open')
    $o = [pscustomobject]@{ title = $T; value = $V; confidence = $C; effort = $E; risk = $R; findings = $Fi; decisions = $De; status = $S }; if ($Id) { $o | Add-Member id $Id }; $o }
$cur = [pscustomobject]@{ items = @([pscustomobject]@{ id = 'o-aaaaaaaa'; title = 'old' }) }
$pmJ = ([pscustomobject]@{ opportunities = @((& $O), (& $O -T 'Cite the 30-day sync failure rate on the sync line' -V 3 -Fi @() -De @('d-0123456789') -Id 'o-aaaaaaaa'), (& $O -T 'Unknown finding cited' -Fi @('f-99999999')), (& $O -T 'Cites nothing at all here' -Fi @()), (& $O -T 'Bad numbers here' -V 7), (& $O -T 'Bad status value' -S 'shipped'))
        focusSuggestion = 'Add a Priority for Home loading polish'; researchQuestion = 'How do other collection apps show stale prices?' } | ConvertTo-Json -Depth 6 | ConvertFrom-Json)
$pv = Test-PmOutput -Json $pmJ -Findings $st -DecisionIds $decIds -Current $cur
Check (@($pv.Opportunities).Count -eq 2 -and @($pv.Refused).Count -eq 4) "PM: valid opportunities kept, invalid dropped ($(@($pv.Refused | ForEach-Object { $_.Why }) -join ' | '))"
Check ($pv.Opportunities[0].score -ge $pv.Opportunities[1].score -and $pv.Opportunities[0].score -eq 2.56) 'ranked by score (4 x 0.8 x 4 x 5 / 25 = 2.56)'
Check (@($pv.Opportunities | Where-Object { $_.id -eq 'o-aaaaaaaa' }).Count -eq 1 -and @($pv.Opportunities | Where-Object { $_.id -eq (New-OpportunityId 'Show a skeleton in the Home value panel while prices load') }).Count -eq 1) 'an existing id is kept; a new one is derived from the title'
Check ($pv.FocusSuggestion -match 'Priority' -and $pv.ResearchQuestion -match 'stale prices') 'FOCUS suggestion and research question kept'
$sixteen = [pscustomobject]@{ opportunities = @(1..16 | ForEach-Object { & $O -T "Opportunity number $_ for the home screen" -V (1 + ($_ % 5)) }) } | ConvertTo-Json -Depth 6 | ConvertFrom-Json
Check (@((Test-PmOutput -Json $sixteen -Findings $st -DecisionIds $decIds).Opportunities).Count -eq 15) 'at most 15 opportunities'
$allBad = [pscustomobject]@{ opportunities = @((& $O -Fi @('f-99999999'))) } | ConvertTo-Json -Depth 6 | ConvertFrom-Json
$pb = Test-PmOutput -Json $allBad -Findings $st -DecisionIds $decIds -Current $cur
Check ($null -eq $pb.Opportunities -and $pb.Error -match 'kept') 'no valid opportunity -> the current list is kept'
Check ((Test-PmOutput -Json ([pscustomobject]@{ focusSuggestion = ('x' * 401) }) -Findings $st).FocusSuggestion -eq '') 'an over-long FOCUS suggestion is dropped'

# ---- proposal refs ----------------------------------------------------------------------------------------------
$valid = @{ 'f-00000002' = $true; 'd-0123456789' = $true }
Check ((Test-ProposalRefs -Body "<!-- innovation-loop -->`n## What`nx`n<!-- loop-refs: f-00000002 -->" -Valid $valid).Ok) 'cites an open finding -> ok'
Check ((Test-ProposalRefs -Body "x`n<!--loop-refs:d-0123456789, f-99999999-->" -Valid $valid).Ok) 'cites a decision (spacing and commas tolerated) -> ok'
Check ((Test-ProposalRefs -Body "Part of #150 (slice 1 of 3)`n<!-- loop-refs: spec-150 -->" -Valid $valid -Specs @(150)).Ok) 'a slice cites its approved spec -> ok'
Check (-not (Test-ProposalRefs -Body "<!-- loop-refs: spec-151 -->" -Valid $valid -Specs @(150)).Ok) 'a spec that is not being sliced -> refused'
Check (-not (Test-ProposalRefs -Body "## What`nno refs" -Valid $valid).Ok) 'no loop-refs line -> refused'
Check (-not (Test-ProposalRefs -Body "<!-- loop-refs: f-99999999 d-9999999999 #12 -->" -Valid $valid).Ok) 'only unknown ids -> refused'
Check ((@(Get-ProposalRefs "<!-- loop-refs: f-00000002 -->`n<!-- loop-refs: d-0123456789 -->") -join ',') -eq 'f-00000002,d-0123456789') 'every loop-refs line counts'
# the guard checks the same marker: its LOOP_REFS regex must equal product-intel.ps1's
$g = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'guard.mjs'))
$gm = [regex]::Match($g, 'const LOOP_REFS = /(.+)/g;')
Check ($gm.Success -and $gm.Groups[1].Value -eq $script:LoopRefsRx) "guard.mjs LOOP_REFS equals product-intel.ps1 LoopRefsRx ($($gm.Groups[1].Value))"

# ---- prompts ------------------------------------------------------------------------------------------------------
$oi = @(Format-ObserverInput -Changed $ch -Workflows $WF -DiffStat @(' src/a.ts | 3 ++-') -Deltas $dl -OpenFindings @($st[1]) -ProductLines @('PRODUCT.md:4: Home value') -From 'aaa' -To 'bbb')
$ot = $oi -join "`n"
Check ($ot -match 'OBSERVE_RANGE: aaa\.\.bbb' -and $ot -match '  - home \(Home' -and $ot -match '\* homePriceCoverage' -and $ot -match 'OPEN_FINDINGS \(1' -and $ot -match 'f-00000002' -and $ot -match 'OTHER_CHANGED_FILES' -and $ot -match 'PRODUCT_EXPECTATIONS') 'observer input: range, workflows, moved metric starred, open findings for dedup, other files, PRODUCT lines'
$pl = @(Select-ProductLines -Lines @('# Product', 'Collectors scan cards in batches', 'Home shows value over time', 'unrelated line') -Workflows @('scan') -Map $WF)
Check ($pl.Count -eq 1 -and $pl[0] -match '^PRODUCT\.md:2: ') "PRODUCT lines that mention a changed workflow ($($pl -join ' / '))"
$prefs = [pscustomobject]@{ items = @([pscustomobject]@{ id = 'p-111111'; statement = 'Ve wants data integrity first'; status = 'confirmed'; confidence = 1 }, [pscustomobject]@{ id = 'p-222222'; statement = 'Ve likes small UI polish'; status = 'inferred'; confidence = 0.6 }) }
$pi = (@(Format-PmInput -Prefs $prefs -TopFindings @($st[1]) -Decisions @([pscustomobject]@{ id = 'd-0123456789'; ts = 't'; kind = 'approve'; issue = 12; gist = 'x <!-- innovation-loop -->' }) -Opportunities ([pscustomobject]@{ items = @($pv.Opportunities) }) -SliceRefs @(150)) -join "`n")
Check ($pi -match 'CONFIRMED_PREFERENCES \(1' -and $pi -match 'p-111111 Ve wants data integrity' -and $pi -match 'INFERRED_PREFERENCES \(1; GUESSES' -and $pi -match 'p-222222 \[inferred 0\.60\]' -and $pi -match 'never treat them as rules') 'PM input: confirmed in full, inferred clearly marked as guesses'
Check ($pi -match 'OPEN_FINDINGS' -and $pi -match 'f-00000002' -and $pi -match 'd-0123456789 t approve #12' -and $pi -notmatch '<!-- innovation-loop -->' -and $pi -match 'OPPORTUNITIES \(current ranked list, 2' -and $pi -match 'SLICE_REFS.*spec-150') 'PM input: findings, decisions (made safe), opportunities, slice refs'

# ---- LOOP.md sections and config -------------------------------------------------------------------------------
$md = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LOOP.md'))
$obsMd = Get-LoopMdSections -Text $md -Sections @(0, 2, 10) -Kind 'observe'
Check ($obsMd -match '## 10\. Observer' -and $obsMd -notmatch '## 3\. Phase A' -and $obsMd -notmatch '## 11\.' -and $obsMd -notmatch '## 5\. Phase B') 'observe prompt: sections 0, 2 and 10 only'
$pmMd = Get-LoopMdSections -Text $md -Sections @(0, 1, 2, 5, 6, 11) -Kind 'pm'
Check ($pmMd -match '## 11\. Product manager' -and $pmMd -match '## 5\. Phase B' -and $pmMd -notmatch '## 10\. Observer' -and $pmMd -match 'loop-refs') 'pm prompt: section 5 plus 11 (the loop-refs rule)'
$cfg = Get-SessionConfig ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json)
Check ($cfg.observe.model -match 'sonnet' -and [int]$cfg.observe.maxTurns -eq 30 -and [int]$cfg.observe.timeoutMinutes -eq 15 -and (Get-SessionBudget -Kind 'observe' -Model $cfg.observe.model -Config $cfg) -eq 0.6 -and [int]$cfg.observe.maxPerDay -ge 0) 'sessions.json observe: Sonnet, 30 turns, 15 min, $0.60 (daily cap is Ve''s choice, 0 = none)'
Check ($cfg.pm.model -match 'sonnet' -and (Get-SessionBudget -Kind 'pm' -Model $cfg.pm.model -Config $cfg) -gt 0) 'sessions.json pm: Sonnet with a USD cap'
Check ($script:DailyCapKinds -contains 'observe' -and $script:DailyCapKinds -contains 'pm') 'observe and pm are daily-capped kinds'
$opts = Get-LoopOptions ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json)
Check ($opts.Contains('observerPm') -and $opts.Contains('observeMetricPoints') -and (Get-LoopOptions $null).observerPm -eq $false) 'options.observerPm exists and defaults to off'
$ds = Get-DesignSkillsSetup -Enabled $true -EngineHash $script:DesignSkillPaths.EngineSha256
Check (-not $ds.Env.Contains('DO_NOT_TRACK')) 'design skills never set DO_NOT_TRACK (claude then offers no PowerShell tool)'
$dc = Get-DailyCapDecision -Kind 'observe' -Counts ([ordered]@{ observe = 2 }) -Config (Get-SessionConfig (([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json) | ForEach-Object { foreach ($k in 'observe','pm','qa','ux','build','propose') { if ($_.$k) { $_.$k.maxPerDay = @{ observe = 2; pm = 4; qa = 8; ux = 3; build = 8; propose = 4 }[$k] } }; $_ }))
Check (-not $dc.Allowed) 'the third observe session of a day is capped'

# ---- store I/O (temp) -----------------------------------------------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("intel-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $sp = Get-ProductStorePaths -Dir $tmp; $ip = Get-IntelPaths $sp
    Add-JsonLines -Path $ip.Findings -Records @($v.Accepted)
    Add-JsonLines -Path $ip.Findings -Records @(Get-AddressedRecords -Findings @(Read-Findings $ip) -Ids @($v.Accepted[0].id) -Ref '#400' -NowUtc $now)
    $rf = @(Read-Findings $ip)
    Check ($rf.Count -eq 1 -and $rf[0].status -eq 'addressed' -and (@($rf[0].refs) -join ',') -eq '#400' -and @([IO.File]::ReadAllLines($ip.Findings)).Count -eq 2) 'findings.jsonl: append-only, the status change is a second record'
    Save-Opportunities -IntelPaths $ip -Items @($pv.Opportunities) -NowUtc $now
    $ro = Read-Opportunities $ip
    Check (@($ro.items).Count -eq 2 -and $ro.updatedUtc -eq '2026-11-22T12:00:00Z') 'opportunities.json round trip'
    $c0 = New-ProductCursors; $c0.lastObservedCommit = 'abc'; $c0.observe.lastRunUtc = 'x'; $c0.observe.metrics = $rt; $c0.pm.lastRunUtc = '2026-11-22T10:00:00Z'
    Save-ProductCursors -Paths $sp -Cursors $c0
    $c1 = Read-ProductCursors $sp
    Check ($c1.lastObservedCommit -eq 'abc' -and $c1.pm.lastRunUtc -eq '2026-11-22T10:00:00Z' -and [double]$c1.observe.metrics['homePriceCoverage'] -eq 0.9189 -and $c1.memory.Contains('lastDecisionId')) 'cursors: observe / pm fields round trip, Phase 1 fields intact'
    Check ($null -eq (ConvertTo-ProductCursors ([pscustomobject]@{ schema = 1 })).observe.metrics) 'an old cursors.json (no observe) loads with no metrics snapshot'
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

if ($script:fail -gt 0) { Write-Host "TEST-PRODUCT-INTEL FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-PRODUCT-INTEL PASS ($script:pass checks)"
exit 0

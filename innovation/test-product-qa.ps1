<#
.SYNOPSIS
  Unit tests for product-qa.ps1 (Phase 3 of the product intelligence layer): acceptance-criteria extraction (the Plan
  comment's loop-criteria block, untrusted authors ignored, the "How it would be tested" fallback), the deterministic
  scope precheck (tests / docs / innovation only -> no QA; UI change -> UX), the coordinator (dedupe, daily caps, time,
  plan budget hold, stale items, the weekly UX sample), the QA and UX JSON validation, the findings they write (tags,
  QA first for the PM), the cursors round trip, the memory agent's lessons (input only), the run-data line and the
  precheck. No network, no git, no claude; writes only to a temp folder.
  powershell -ExecutionPolicy Bypass -File innovation\test-product-qa.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
. "$PSScriptRoot\reporting.ps1"
. "$PSScriptRoot\product-store.ps1"
. "$PSScriptRoot\product-intel.ps1"
. "$PSScriptRoot\product-qa.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$now = [datetime]'2026-11-23T12:00:00Z'
$WF = ConvertTo-Workflows ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'workflows.json')) | ConvertFrom-Json)
$wfNames = @($WF.Keys)
$M = '<!-- innovation-loop -->'

# ---- acceptance criteria ---------------------------------------------------------------------------------------
$plan = @"
$M
## Plan
Files: src/v2/screens/wantlist/WantList.tsx

### Acceptance criteria
<!-- loop-criteria -->
- wantlist | /wantlist | The Want list screen title reads "Want list" on the live site.
- home | / | At 390px the Value over time card shows 7d, 30d and 1y buttons at least 44px tall.
- nonsense line without pipes
- bogus | /x | A workflow that does not exist in workflows.json at all.
- shell | javascript:alert(1) | A path that is not a hash route is refused.
- general | / | short
<!-- /loop-criteria -->
"@
$ac = Get-AcceptanceCriteria -Text $plan -Workflows $wfNames
Check (@($ac.Criteria).Count -eq 2) "criteria: two valid lines kept (got $(@($ac.Criteria).Count))"
Check (@($ac.Refused).Count -eq 4) "criteria: no pipes, unknown workflow, bad path, short text refused (got $(@($ac.Refused).Count))"
Check ($ac.Criteria[0].Id -eq 'ac1' -and $ac.Criteria[0].Workflow -eq 'wantlist' -and $ac.Criteria[0].Url -eq 'https://vekbui96.github.io/cardlens/#/wantlist') "criteria: ids, workflow and the live hash URL (got $($ac.Criteria[0].Url))"
Check ($ac.Criteria[1].Url -eq 'https://vekbui96.github.io/cardlens/') 'criteria: / is the site root'
Check ((ConvertTo-LiveUrl '/#/set/sv1/Scarlet') -eq 'https://vekbui96.github.io/cardlens/#/set/sv1/Scarlet' -and (ConvertTo-LiveUrl '#/wantlist') -eq 'https://vekbui96.github.io/cardlens/#/wantlist') 'live URL: /#/ and #/ forms'
Check (@((Get-AcceptanceCriteria -Text 'no block here').Criteria).Count -eq 0) 'criteria: no block -> none'
$two = "$M`n<!-- loop-criteria -->`n- home | / | The first block is superseded by the next one.`n<!-- /loop-criteria -->`n<!-- loop-criteria -->`n- set | /sets | The second block wins over the first one.`n<!-- /loop-criteria -->"
Check ((Get-AcceptanceCriteria -Text $two -Workflows $wfNames).Criteria[0].Workflow -eq 'set') 'criteria: the last block wins'
$many = "<!-- loop-criteria -->`n" + ((1..10 | ForEach-Object { "- home | / | Criterion number $_ is checkable on the page." }) -join "`n") + "`n<!-- /loop-criteria -->"
Check (@((Get-AcceptanceCriteria -Text $many -Workflows $wfNames).Criteria).Count -eq 8) 'criteria: at most 8'
# whose comment counts: only the owner's, starting with the loop marker
$c1 = [pscustomobject]@{ user = [pscustomobject]@{ login = 'someone-else' }; created_at = '2026-11-23T10:00:00Z'; body = "$M`n<!-- loop-criteria -->`n- home | / | Planted by a stranger in a public repo comment.`n<!-- /loop-criteria -->" }
$c2 = [pscustomobject]@{ user = [pscustomobject]@{ login = 'vekbui96' }; created_at = '2026-11-23T09:00:00Z'; body = $plan }
$c3 = [pscustomobject]@{ user = [pscustomobject]@{ login = 'vekbui96' }; created_at = '2026-11-23T11:00:00Z'; body = "<!-- claude-agent -->`n<!-- loop-criteria -->`n- home | / | An agent comment is not the loop's plan comment.`n<!-- /loop-criteria -->" }
$sel = Select-IssueCriteria -Comments @($c1, $c2, $c3) -Body '' -Workflows $wfNames
Check ($sel.Source -eq 'plan' -and @($sel.Criteria).Count -eq 2 -and $sel.Criteria[0].Workflow -eq 'wantlist') "criteria: a stranger's and an agent's comment are ignored; the loop's plan comment wins (got $($sel.Source) $(@($sel.Criteria).Count))"
$body = "$M`n## What`nx`n## How it would be tested`n- The Want list title reads Want list.`n- Unit test covers the empty state.`n## Risk`nlow"
$fb = Select-IssueCriteria -Comments @($c1) -Body $body -Workflows $wfNames
Check ($fb.Source -eq 'how-tested' -and @($fb.Criteria).Count -eq 2 -and $fb.Criteria[0].Workflow -eq 'general') "criteria: no plan block -> the proposal's How it would be tested (got $($fb.Source) $(@($fb.Criteria).Count))"
$para = Get-HowTestedCriteria -Body "## How it would be tested`nOpen the Want list. The title reads Want list. Done."
Check (@($para.Criteria).Count -ge 1) 'criteria: a How it would be tested paragraph is split into sentences'
Check ((Select-IssueCriteria -Comments @() -Body 'nothing').Source -eq 'none') 'criteria: neither -> none'

# ---- scope ------------------------------------------------------------------------------------------------------
$sc = Get-QaScope -Files @('innovation/run-loop.ps1', 'docs/handoff.md', 'src/v2/screens/home/HomeScreen.test.tsx', 'e2e/visual.spec.ts-snapshots/home-390.png', 'README.md')
Check (-not $sc.UserFacing -and -not $sc.UiChanged) "scope: tests, docs, innovation and baselines only -> no user-facing change ($($sc.Reason))"
$sc = Get-QaScope -Files @('src/v2/screens/wantlist/WantList.tsx', 'src/v2/screens/wantlist/WantList.test.tsx') -DeployRec ([pscustomobject]@{ expectString = 'Want list'; noVisibleString = '' })
Check ($sc.UserFacing -and $sc.UiChanged) 'scope: a deploy verified by an ExpectString changed the UI'
$sc = Get-QaScope -Files @('src/models/newThing.ts') -DeployRec ([pscustomobject]@{ expectString = ''; noVisibleString = 'adds a model nothing imports yet' })
Check ($sc.UserFacing -and -not $sc.UiChanged) 'scope: a NoVisibleString deploy is user-facing code but no UI change (QA yes, UX no)'
$sc = Get-QaScope -Files @('server/catalogPrices.ts') -DeployRec ([pscustomobject]@{ expectString = ''; noVisibleString = '' })
Check ($sc.UserFacing -and -not $sc.UiChanged) 'scope: a server-only change gets QA, not UX'
$sc = Get-QaScope -Files @('src/v2/screens/home/HomeScreen.tsx', 'e2e/visual.spec.ts-snapshots/home-390.png') -DeployRec ([pscustomobject]@{ expectString = ''; noVisibleString = '' })
Check ($sc.UiChanged -and @($sc.Snapshots).Count -eq 1) 'scope: an updated visual baseline means the UI changed'
Check ((Get-QaScope -Files @('src/v2/tokens.css')).UiChanged) 'scope: no deploy record -> a UI file decides'

# ---- cursors -----------------------------------------------------------------------------------------------------
$cur = New-ProductCursors
Check (Add-QaPending -Cursors $cur -Issue 177 -Sha '64394548f3f6ce5e65272e1495d34086af2242c5' -Ui $true -Workflows @('wantlist', 'shell') -NowUtc $now) 'pending: a deploy is queued'
Check (-not (Add-QaPending -Cursors $cur -Issue 177 -Sha '64394548f3f6ce5e65272e1495d34086af2242c5' -Ui $true -NowUtc $now)) 'pending: the same sha is not queued twice'
$cur.qa.done['85d7081703ec612ad963fb31a1dad297eb98aca1'] = '2026-11-23T10:00:00Z'
Check (-not (Add-QaPending -Cursors $cur -Issue 174 -Sha '85d7081703ec612ad963fb31a1dad297eb98aca1' -Ui $false -NowUtc $now)) 'pending: a commit already QAed (no UI) is not queued again'
$cur.ux.workflows['home'] = '2026-11-01T00:00:00Z'; $cur.ux.lastSampleUtc = '2026-11-10T00:00:00Z'
$rt = ConvertTo-ProductCursors (($cur | ConvertTo-Json -Depth 6) | ConvertFrom-Json)
Check (@($rt.qa.pending).Count -eq 1 -and $rt.qa.pending[0].issue -eq 177 -and $rt.qa.pending[0].ui -and (@($rt.qa.pending[0].workflows) -join ',') -eq 'wantlist,shell') 'cursors: pending survives a save and load'
Check ($rt.qa.done.Contains('85d7081703ec612ad963fb31a1dad297eb98aca1') -and $rt.ux.workflows['home'] -eq '2026-11-01T00:00:00Z' -and $rt.ux.lastSampleUtc -eq '2026-11-10T00:00:00Z') 'cursors: done map, workflow reviews and the sample time survive'
Check ($null -ne (ConvertTo-ProductCursors $null).qa -and @((ConvertTo-ProductCursors $null).qa.pending).Count -eq 0) 'cursors: a fresh store has empty qa / ux cursors'
$old = ([pscustomobject]@{ schema = 1; lastObservedCommit = 'abc'; qa = [pscustomobject]@{ pending = @([pscustomobject]@{ issue = 1; sha = 'not-a-sha' }) } })
Check (@((ConvertTo-ProductCursors $old).qa.pending).Count -eq 0) 'cursors: a pending item with a bad sha is dropped'
$big = [ordered]@{}; 1..70 | ForEach-Object { $big["{0:x40}" -f $_] = "2026-11-{0:00}T00:00:00Z" -f (($_ % 28) + 1) }
Check (@((Limit-ShaMap $big 60).Keys).Count -eq 60) 'cursors: the done map keeps the newest 60'

# ---- the coordinator -------------------------------------------------------------------------------------------------
$pA = [pscustomobject]@{ issue = 177; sha = 'a' * 40; ts = '2026-11-23T11:00:00Z'; ui = $true; workflows = @('wantlist') }
$pB = [pscustomobject]@{ issue = 174; sha = 'b' * 40; ts = '2026-11-23T11:10:00Z'; ui = $false; workflows = @('onboarding') }
$p = Get-QaUxPlan -Pending @($pA, $pB) -QaDone @{} -UxDone @{} -NowUtc $now
Check ((@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' ') -eq 'qa#177 qa#174 ux#177') "plan: every QA first, then UX for the UI change only (got $(@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' '))"
$p = Get-QaUxPlan -Pending @($pA, $pB) -QaDone @{ ('a' * 40) = 'x' } -UxDone @{ ('a' * 40) = 'x' } -NowUtc $now
Check ((@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' ') -eq 'qa#174') 'plan: a commit QAed and reviewed is never done twice'
$p = Get-QaUxPlan -Pending @($pA, $pA) -NowUtc $now
Check (@($p.Actions | Where-Object { $_.Kind -eq 'qa' }).Count -eq 1) 'plan: a sha listed twice runs once'
$p = Get-QaUxPlan -Pending @($pA, $pB) -QaLeft 1 -UxLeft 0 -NowUtc $now
Check ((@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' ') -eq 'qa#177' -and @($p.Keep).Count -eq 2) "plan: the daily caps stop the rest; both items are kept (keep $(@($p.Keep).Count))"
$p = Get-QaUxPlan -Pending @($pA, $pB) -MinutesLeft 25 -QaMinutes 10 -UxMinutes 10 -NowUtc $now
Check ((@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' ') -eq 'qa#177 qa#174' -and @($p.Keep | ForEach-Object { $_.issue }) -contains 177) 'plan: out of time -> UX waits for the next run, the item is kept'
$p = Get-QaUxPlan -Pending @($pA) -MinutesLeft 5 -QaMinutes 10 -NowUtc $now
Check (@($p.Actions).Count -eq 0 -and @($p.Keep).Count -eq 1 -and (@($p.Reasons) -join ' ') -match 'next run') 'plan: no time at all -> next run'
$p = Get-QaUxPlan -Pending @($pA, $pB) -Verdict 'hold' -NowUtc $now
Check (@($p.Actions).Count -eq 0 -and @($p.Keep).Count -eq 2) 'plan: plan budget hold stops everything, keeps everything'
$stale = [pscustomobject]@{ issue = 100; sha = 'c' * 40; ts = '2026-11-01T00:00:00Z'; ui = $true }
$p = Get-QaUxPlan -Pending @($stale) -NowUtc $now
Check (@($p.Actions).Count -eq 0 -and @($p.Keep).Count -eq 0) 'plan: an item pending more than 7 days is dropped'
$smp = [pscustomobject]@{ Workflow = 'binders'; Path = '/binders'; Url = 'https://vekbui96.github.io/cardlens/#/binders' }
$p = Get-QaUxPlan -Pending @($pB) -Sample $smp -NowUtc $now
Check ((@($p.Actions | ForEach-Object { "$($_.Kind)#$($_.Issue)" }) -join ' ') -eq 'qa#174 ux#0' -and $p.Actions[1].Sample.Workflow -eq 'binders') 'plan: the weekly sample runs when no UX deploy item does'
$p = Get-QaUxPlan -Pending @($pA) -Sample $smp -NowUtc $now
Check (@($p.Actions | Where-Object { $_.Kind -eq 'ux' }).Count -eq 1 -and $null -eq (@($p.Actions | Where-Object { $_.Kind -eq 'ux' })[0].Sample)) 'plan: a UI deploy takes the UX slot before the sample'
$ux0 = (New-ProductCursors).ux
$s0 = Get-UxSample -UxCursor $ux0 -Workflows $wfNames -NowUtc $now
Check ($s0 -and $s0.Workflow -eq 'home') "sample: never reviewed -> the first workflow (got $($s0.Workflow))"
$ux0.workflows['home'] = '2026-11-20T00:00:00Z'; $ux0.workflows['collection'] = '2026-09-01T00:00:00Z'
foreach ($w in $wfNames) { if (-not $ux0.workflows.Contains($w)) { $ux0.workflows[$w] = '2026-11-15T00:00:00Z' } }
Check ((Get-UxSample -UxCursor $ux0 -Workflows $wfNames -NowUtc $now).Workflow -eq 'collection') 'sample: the workflow reviewed longest ago, past 30 days'
$ux0.workflows['collection'] = '2026-11-15T00:00:00Z'
Check ($null -eq (Get-UxSample -UxCursor $ux0 -Workflows $wfNames -NowUtc $now)) 'sample: none older than 30 days -> no sample'
$ux0.lastSampleUtc = '2026-11-20T00:00:00Z'; $ux0.workflows['collection'] = '2026-01-01T00:00:00Z'
Check ($null -eq (Get-UxSample -UxCursor $ux0 -Workflows $wfNames -NowUtc $now)) 'sample: at most one a week'

# ---- QA output ---------------------------------------------------------------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) "loop-qa-test-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$art = Join-Path $tmp 'artifacts'; New-Item -ItemType Directory -Path (Join-Path $art 'qa\r-177\ac1') -Force | Out-Null
[IO.File]::WriteAllBytes((Join-Path $art 'qa\r-177\ac1\390x844.png'), [byte[]](137, 80, 78, 71))
$artOk = { param([string]$Rel) Test-Path -LiteralPath (Join-Path $art ($Rel -replace '/', '\')) -PathType Leaf }
$crit = @($ac.Criteria)
$j = (ConvertFrom-AgentJson @'
Checked both.
```json
{"criteria":[{"id":"ac1","result":"pass","evidence":["artifact:qa/r-177/ac1/390x844.png"],"note":"title reads Want list"},
 {"id":"ac2","result":"fail","evidence":["https://vekbui96.github.io/cardlens/"],"note":"the 1y button is 30px tall at 390px"}],
 "regressions":[{"workflow":"shell","summary":"The header overflows at 390px since this change","evidence":["artifact:qa/r-177/ac1/390x844.png"]}],
 "lesson":"Check the header at 390px whenever a screen title changes."}
```
LOOP-RESULT: OK qa fail
'@).Json
$v = Test-QaOutput -Json $j -Criteria $crit -Workflows $WF -ArtifactExists $artOk
Check ($v.Verdict -eq 'fail' -and @($v.Criteria | Where-Object { $_.Result -eq 'fail' }).Count -eq 1 -and @($v.Regressions).Count -eq 1) "qa: a failed criterion and a regression -> fail (got $($v.Verdict))"
Check ($v.Lesson -like 'Check the header*') 'qa: the lesson is kept'
$jp = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('artifact:qa/r-177/ac1/390x844.png'); note = '' }, [pscustomobject]@{ id = 'ac2'; result = 'pass'; evidence = @('https://vekbui96.github.io/cardlens/'); note = '' }) }
Check ((Test-QaOutput -Json $jp -Criteria $crit -Workflows $WF -ArtifactExists $artOk).Verdict -eq 'pass') 'qa: every criterion passed -> pass'
$ju = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('artifact:qa/r-177/ac1/390x844.png') }, [pscustomobject]@{ id = 'ac2'; result = 'unverified'; evidence = @(); note = 'needs a signed-in collection to show movers' }) }
Check ((Test-QaOutput -Json $ju -Criteria $crit -Workflows $WF -ArtifactExists $artOk).Verdict -eq 'partial') 'qa: none failed, one unverified -> partial'
$jm = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('artifact:qa/r-177/ac1/390x844.png') }) }
$vm = Test-QaOutput -Json $jm -Criteria $crit -Workflows $WF -ArtifactExists $artOk
Check ($vm.Verdict -eq 'partial' -and $vm.Criteria[1].Result -eq 'unverified') 'qa: a criterion left out is unverified, never a pass'
$jb = [pscustomobject]@{ criteria = @(
        [pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('artifact:qa/r-177/ac1/missing.png') },
        [pscustomobject]@{ id = 'ac2'; result = 'pass'; evidence = @('artifact:../../secrets.png') },
        [pscustomobject]@{ id = 'ac9'; result = 'pass'; evidence = @('https://vekbui96.github.io/cardlens/') }) }
$vb = Test-QaOutput -Json $jb -Criteria $crit -Workflows $WF -ArtifactExists $artOk
Check ($vb.Verdict -eq 'partial' -and @($vb.Refused).Count -eq 3) "qa: a missing screenshot, a path escape and an unknown id are refused (refused $(@($vb.Refused).Count))"
$jlong = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('src/app/documentTitle.ts'); note = ('x' * 400) }) }
$fe0 = { param([string]$Rel) $Rel -eq 'src/app/documentTitle.ts' }
$vl = Test-QaOutput -Json $jlong -Criteria $crit -Workflows $WF -FileExists $fe0
Check ($vl.Criteria[0].Result -eq 'pass' -and $vl.Criteria[0].Note.Length -le 300) 'qa: a long note is cut, not refused; a repo file without a line number is evidence'
Check ((Test-QaEvidence -Item 'src/app/nope.ts' -FileExists $fe0) -ne '' -and (Test-QaEvidence -Item 'README' -FileExists $fe0) -ne '') 'qa: a missing file or a bare word is not evidence'
$jf = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'fail'; evidence = @('https://vekbui96.github.io/cardlens/') }) }
Check (@((Test-QaOutput -Json $jf -Criteria $crit -Workflows $WF).Refused).Count -eq 1) 'qa: a fail with no note is refused'
$jx = [pscustomobject]@{ criteria = @([pscustomobject]@{ id = 'ac1'; result = 'pass'; evidence = @('https://evil.example.com/x') }) }
Check (@((Test-QaOutput -Json $jx -Criteria $crit -Workflows $WF).Refused).Count -eq 1) 'qa: evidence on another host is refused'
Check ((Test-QaOutput -Json $null -Criteria $crit -Workflows $WF).Verdict -eq 'invalid') 'qa: no JSON -> invalid'
Check ((Test-QaOutput -Json ([pscustomobject]@{ verdict = 'pass' }) -Criteria $crit -Workflows $WF).Verdict -eq 'invalid') 'qa: no criteria array -> invalid (a bare verdict is not trusted)'
$jl = [pscustomobject]@{ criteria = @(); lesson = "two`nlines" }
Check ((Test-QaOutput -Json $jl -Criteria $crit -Workflows $WF).Lesson -eq '') 'qa: a multi-line lesson is refused'

# ---- QA findings and records ---------------------------------------------------------------------------------------------
$fs = @(New-QaFindings -Qa $v -Issue 177 -NowUtc $now)
Check ($fs.Count -eq 2 -and @($fs | Where-Object { $_.agent -eq 'qa' -and $_.severity -eq 'high' -and (@($_.tags) -join ',') -eq 'qa' -and (@($_.refs) -join ',') -eq '#177' }).Count -eq 2) 'qa findings: failed criterion and regression -> high, tagged qa, citing the issue'
Check (@(New-QaFindings -Qa $v -Issue 177 -Findings @(Get-FindingsState @($fs)) -NowUtc $now).Count -eq 0) 'qa findings: the same failure is not written twice'
$state = @(Get-FindingsState @(@([ordered]@{ id = 'f-11111111'; ts = '2026-11-23T13:00:00Z'; agent = 'observe'; workflow = 'home'; summary = 'An observer finding with high severity and confidence'; evidence = @('src/a.ts:1'); confidence = 0.99; severity = 'high'; status = 'open'; refs = @() }) + $fs))
Check ((Select-OpenFindings -Findings $state)[0].agent -eq 'qa') 'pm input: QA failures come first, ahead of a stronger observer finding'
Check ((Format-FindingLine ($state | Where-Object { $_.agent -eq 'qa' } | Select-Object -First 1)) -match ', qa\]') 'pm input: the qa tag shows in the finding line'
$rec = New-QaRecord -Issue 177 -Sha ('a' * 40) -RunId 'r' -Verdict $v.Verdict -Source 'plan' -Qa $v -FindingIds @($fs | ForEach-Object { $_.id }) -Cost 0.31 -NowUtc $now
$line = Format-QaRunDataLine $rec
Check ($line -match '^QA: \*\*fail\*\*' -and $line -match '1 passed, 1 failed, 0 unverified of 2' -and $line -match 'Failed: ac2' -and $line -match '\$0\.31') "run data: the QA line ($line)"
Check ((Format-QaRunDataLine (New-QaRecord -Issue 5 -Sha 'x' -RunId 'r' -Verdict 'skipped' -Reason 'no user-facing change')) -eq 'QA: skipped (no user-facing change).') 'run data: the skip line'
$rj = ($rec | ConvertTo-Json -Depth 6 -Compress) | ConvertFrom-Json
Check ($rj.verdict -eq 'fail' -and @($rj.criteria).Count -eq 2 -and $rj.lesson) 'qa.jsonl: the record round-trips as JSON'

# ---- memory: lessons are input only -------------------------------------------------------------------------------------
$les = @(Select-QaLessons -Records @($rj, [pscustomobject]@{ ts = '2026-11-01T00:00:00Z'; lesson = 'an old lesson that was already seen'; issue = 1 }, [pscustomobject]@{ ts = '2026-11-23T12:30:00Z'; lesson = 'a dry run lesson'; dryRun = $true; issue = 2 }) -SinceUtc '2026-11-20T00:00:00Z')
Check ($les.Count -eq 1 -and $les[0].issue -eq 177) 'memory: only new, real lessons'
$mp = Format-MemoryPrompt -Decisions @() -Prefs (New-Preferences) -Lessons $les
Check ($mp -match 'QA LESSONS' -and $mp -match 'never evidence') 'memory: the prompt carries the lessons as context, never evidence'
$chg = @([pscustomobject]@{ op = 'add'; statement = 'Ve wants the header checked at 390px'; status = 'inferred'; confidence = 0.6; evidence = @('qa:177') })
$tv = Test-PreferenceChanges -Changes $chg -Prefs (New-Preferences) -DecisionsById @{} -FileLines @{ 'FOCUS.md' = @(); 'PRODUCT.md' = @() }
Check (@($tv.Accepted).Count -eq 0) 'memory: a preference citing a QA lesson (no decision) is refused'

# ---- UX output -----------------------------------------------------------------------------------------------------------
New-Item -ItemType Directory -Path (Join-Path $art 'ux\r-177\home') -Force | Out-Null
[IO.File]::WriteAllBytes((Join-Path $art 'ux\r-177\home\390x844.png'), [byte[]](137, 80, 78, 71))
Check (Test-MeasurableRecommendation 'Tap target 32 -> 44px on the range switch') 'ux: a number is measurable'
Check (Test-MeasurableRecommendation 'Move the save button from the footer -> the header') 'ux: a from -> to change is measurable'
Check (-not (Test-MeasurableRecommendation 'Make it feel more modern and clean')) 'ux: a vague wish is not'
$uj = [pscustomobject]@{ result = 'findings'; reviewed = @('home', 'nope'); findings = @(
        [pscustomobject]@{ workflow = 'home'; summary = 'Range switch buttons are 30px tall at 390px, under the web tap target'; recommendation = 'Range switch height 30 -> 44px under 600px'; evidence = @('artifact:ux/r-177/home/390x844.png'); severity = 'medium'; confidence = 0.8 },
        [pscustomobject]@{ workflow = 'home'; summary = 'The page could look nicer overall to most people'; recommendation = 'Make it nicer and cleaner'; evidence = @('artifact:ux/r-177/home/390x844.png'); severity = 'low'; confidence = 0.4 },
        [pscustomobject]@{ workflow = 'atlantis'; summary = 'A workflow that does not exist in the map'; recommendation = 'Height 30 -> 44px'; evidence = @('https://vekbui96.github.io/cardlens/'); severity = 'low'; confidence = 0.4 },
        [pscustomobject]@{ workflow = 'home'; summary = 'A finding whose screenshot was never taken'; recommendation = 'Height 30 -> 44px'; evidence = @('artifact:ux/r-177/home/nope.png'); severity = 'low'; confidence = 0.4 }) }
$uv = Test-UxOutput -Json $uj -Workflows $WF -Issue 177 -ArtifactExists $artOk -NowUtc $now
Check (@($uv.Accepted).Count -eq 1 -and @($uv.Refused).Count -eq 3) "ux: one valid finding; vague, unknown workflow and missing screenshot refused (accepted $(@($uv.Accepted).Count), refused $(@($uv.Refused).Count))"
$uf = $uv.Accepted[0]
Check ($uf.agent -eq 'ux' -and (@($uf.tags) -join ',') -eq 'ux' -and $uf.recommendation -like 'Range switch*' -and (@($uf.refs) -join ',') -eq '#177' -and $uf.summary -like 'UX: *') 'ux: the finding is tagged ux, keeps its recommendation and cites the issue'
Check ((@($uv.Workflows) -join ',') -eq 'home') 'ux: only known reviewed workflows go to the cursor'
$st2 = @(Get-FindingsState @($uf))
Check ($st2[0].recommendation -like 'Range switch*' -and (@($st2[0].tags) -join ',') -eq 'ux') 'findings state keeps tags and the recommendation'
Check ((Format-FindingLine $st2[0]) -match 'recommendation: Range switch') 'pm input: the recommendation shows in the finding line'
Check (@((Test-UxOutput -Json $uj -Workflows $WF -Findings $st2 -Issue 177 -ArtifactExists $artOk).Accepted).Count -eq 0) 'ux: a finding already on file is a duplicate'
Check ((Test-UxOutput -Json ([pscustomobject]@{ result = 'nothing-new'; findings = @() }) -Workflows $WF).Result -eq 'nothing-new') 'ux: nothing new is fine'
Check ((Test-UxOutput -Json ([pscustomobject]@{ result = 'great' }) -Workflows $WF).Result -eq 'invalid') 'ux: a bad result word is invalid'
$many6 = [pscustomobject]@{ result = 'findings'; findings = @(1..8 | ForEach-Object { [pscustomobject]@{ workflow = 'home'; summary = "Distinct UX problem number $_ on the home screen"; recommendation = "Gap $_ -> 16px"; evidence = @('https://vekbui96.github.io/cardlens/'); severity = 'low'; confidence = 0.5 } }) }
Check (@((Test-UxOutput -Json $many6 -Workflows $WF).Accepted).Count -eq 6) 'ux: at most 6 findings per review'

# ---- prompt blocks ------------------------------------------------------------------------------------------------------
$qi = @(Format-QaInput -Issue 177 -Title 'Web: name the browser tab' -Sha ('a' * 40) -Criteria $sel -Scope (Get-QaScope -Files @('src/v2/screens/wantlist/WantList.tsx')) -DiffStat @(' src/x.tsx | 4 ++') -Workflows $WF -ChangedWorkflows @('wantlist') -ShotsDir "$art\qa\r-177" -ArtifactsDir $art)
Check ((@($qi) -join "`n") -match 'ac1 \[wantlist\] https://vekbui96\.github\.io/cardlens/#/wantlist' -and (@($qi) -join "`n") -match 'artifact:qa/r-177/ac1/390x844\.png') 'qa input: criteria with live URLs and the artifact citation form'
$ui = @(Format-UxInput -Issue 0 -Workflows $WF -Review @('binders') -Sample $smp -ShotsDir "$art\ux\r-binders" -ArtifactsDir $art -Clone 'C:\clone')
Check ((@($ui) -join "`n") -match 'weekly sample' -and (@($ui) -join "`n") -match '04-binders\.md' -and (@($ui) -join "`n") -match 'tokens\.css') 'ux input: the sample names its spec and the design system'
$prefs = [pscustomobject]@{ items = @([pscustomobject]@{ id = 'p-aaaaaa'; status = 'confirmed'; statement = 'Ve wants 44px tap targets on phones' }, [pscustomobject]@{ id = 'p-bbbbbb'; status = 'confirmed'; statement = 'Ve prefers server work on weekends' }, [pscustomobject]@{ id = 'p-cccccc'; status = 'inferred'; statement = 'Ve likes dark layouts' }) }
Check ((@(Select-UiPreferences $prefs) | ForEach-Object { $_.id }) -join ',' -eq 'p-aaaaaa') 'ux input: confirmed UI preferences only'

# ---- config, caps, precheck ------------------------------------------------------------------------------------------------
$cfg = Get-SessionConfig ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json)
Check ($cfg.qa.model -like 'claude-sonnet*' -and [int]$cfg.qa.maxTurns -eq 25 -and [double]$cfg.qa.maxBudgetUsd -eq 0.5 -and [int]$cfg.qa.maxPerDay -eq 8) 'sessions.json: qa is Sonnet, 25 turns, $0.50, 8 a day'
Check ($cfg.ux.model -like 'claude-sonnet*' -and [int]$cfg.ux.maxTurns -eq 25 -and [double]$cfg.ux.maxBudgetUsd -eq 0.5 -and [int]$cfg.ux.maxPerDay -eq 3) 'sessions.json: ux is Sonnet, 25 turns, $0.50, 3 a day'
$opts = Get-LoopOptions ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json)
Check ($opts.Contains('qaUx') -and [int]$opts.uxStaleDays -eq 30 -and [int]$opts.uxSampleDays -eq 7) 'sessions.json: options.qaUx and the sample settings exist'
Check (-not (Get-LoopOptions $null).qaUx) 'qaUx is off by default'
$capS = [pscustomobject]@{ date = (Get-Date).ToString('yyyy-MM-dd'); qa = 8; ux = 1 }
Check (-not (Get-DailyCapDecision -Kind 'qa' -Counts (Get-DailyCounts -State $capS) -Config $cfg).Allowed) 'caps: the ninth QA session of the day is refused'
Check ((Get-DailyCapDecision -Kind 'ux' -Counts (Get-DailyCounts -State $capS) -Config $cfg).Allowed) 'caps: the second UX session is allowed'
Check ((Add-DailyLaunch -State $capS -Kind 'ux').ux -eq 2) 'caps: a UX launch is counted'
Check ($script:DesignSkillKinds -contains 'qa' -and $script:DesignSkillKinds -contains 'ux') 'design skills: qa and ux may shoot and detect'
$q = [pscustomobject]@{ buildable = @(); slots = [pscustomobject]@{ free = 0; cap = 5; awaitingReview = @(1, 2, 3, 4, 5) } }
$idle = [pscustomobject]@{ PhaseB = $false }
Check (-not (Get-PrecheckDecision -Queue $q -Coordinator $idle).Launch) 'precheck: nothing to do -> no session'
Check ((Get-PrecheckDecision -Queue $q -Coordinator $idle -QaUx 1).Launch) 'precheck: a pending QA from an earlier run launches the run'
Check (-not (Get-PrecheckDecision -Queue $q -Coordinator $idle -QaUx 1 -Budget ([pscustomobject]@{ Verdict = 'hold'; Reason = 'hold' })).Launch) 'precheck: hold beats pending QA'

# ---- reporting: the QA line in the issue's Run data comment, or a comment of its own --------------------------------------
$rdDir = Join-Path $tmp 'logs'; New-Item -ItemType Directory -Path $rdDir -Force | Out-Null
$tp = Join-Path $rdDir 'run-r.qa-177.jsonl'
[IO.File]::WriteAllLines($tp, @('{"type":"result","subtype":"success","is_error":false,"num_turns":9,"total_cost_usd":0.31,"usage":{"input_tokens":10,"output_tokens":20}}'))
$n0 = Publish-LoopRunData -Sessions @([pscustomobject]@{ Path = $tp; Kind = 'qa'; Issue = 0; Model = 'claude-sonnet-5-5'; About = 177 }) -Status 'OK' -Repo 'o/r' -GhExe 'gh' -RunId 'r' -Mode 'FULL' -LoopHome $tmp -QaLines @{ 177 = $line } -NoPost
$qb = Join-Path $rdDir 'run-r.rundata-177.md'
Check ((Test-Path -LiteralPath $qb) -and ([IO.File]::ReadAllText($qb)) -match 'QA: \*\*fail\*\*' -and ([IO.File]::ReadAllText($qb)).StartsWith('<!-- innovation-loop -->')) 'reporting: an issue built earlier gets a QA comment of its own (marker first)'
$rdj = [IO.File]::ReadAllText((Join-Path $rdDir 'run-r.rundata.json')) | ConvertFrom-Json
Check (@($rdj.sessions | Where-Object { $_.Agent -eq 'qa' -and $_.Issue -eq 177 }).Count -eq 1 -and @($rdj.qa).Count -eq 1) 'reporting: run data records agent qa (about #177) and the QA line'
Check ((Format-RunDataSessions ([pscustomobject]@{ Sessions = @([pscustomobject]@{ Kind = 'ux'; Issue = 177; Model = 'm'; Turns = 3; HasCost = $true; Cost = 0.2; Status = 'OK'; HasResult = $true; Models = @() }) })) -match 'UX review #177') 'reporting: the sessions line names the UX review'

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($script:fail -gt 0) { Write-Host "TEST-PRODUCT-QA FAIL ($script:fail of $($script:pass + $script:fail) checks)"; exit 1 }
Write-Host "TEST-PRODUCT-QA PASS ($script:pass checks)"
exit 0

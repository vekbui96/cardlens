<#
.SYNOPSIS
  Unit tests for PR previews (preview-rules.ps1): slot allocation and reuse, cleanup by PR state, crashed builds and
  the 24 h TTL, the serve-config check (tailnet only, never Funnel, the right folders), preview URL / step-path
  validation (live site and API ports refused), the mock-only bundle scan, the QA-before-merge decisions (gate, next
  action, merge-pr's gate), the LOOP-PR-READY marker, the via-policy preview field and timing, and the prompt blocks.
  No network, no git, no claude.
    powershell -ExecutionPolicy Bypass -File innovation\test-preview.ps1
  -Integration also builds the CURRENT checkout as a preview bundle under the reduced-rights rules' env (no worktree,
  no serving) and scans it: proof that the real bundle names no live host or API port. Needs node_modules.
#>
param([switch]$Integration)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
. "$PSScriptRoot\product-intel.ps1"
. "$PSScriptRoot\product-qa.ps1"
. "$PSScriptRoot\preview-rules.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$now = [datetime]'2026-11-24T12:00:00Z'
$iso = { param([double]$H) $now.AddHours($H).ToString('o') }

# ---- slots ---------------------------------------------------------------------------------------------------------
$empty = @(Get-PreviewSlots $null)
Check ($empty.Count -eq 3 -and @($empty | Where-Object { $_.status -eq 'free' }).Count -eq 3) 'no state: three free slots'
Check ($empty[0].port -eq 8460 -and $empty[2].port -eq 8462 -and $empty[1].url -eq 'https://server-pc.tail0e4194.ts.net:8461/') 'slots map to 8460-8462 on the tailnet name'
$st = [pscustomobject]@{ slots = @(
        [pscustomobject]@{ port = 8460; status = 'up'; issue = 300; pr = 310; sha = 'a' * 40; createdAt = (& $iso -2); expiresAt = (& $iso 22) },
        [pscustomobject]@{ port = 8461; status = 'bogus'; pr = 999 },
        [pscustomobject]@{ port = 9999; status = 'up'; pr = 1 }) }
$sl = @(Get-PreviewSlots $st)
Check ($sl.Count -eq 3 -and $sl[0].status -eq 'up' -and $sl[0].pr -eq 310) 'a stored slot is read back'
Check ($sl[1].status -eq 'free' -and $sl[1].pr -eq 0) 'an unknown status is a free slot'
Check (@($sl | Where-Object { $_.port -eq 9999 }).Count -eq 0) 'a port outside the range is ignored'
$a = Select-PreviewSlot -Slots $sl -Pr 310 -NowUtc $now
Check ($a.Slot.port -eq 8460 -and -not $a.Evicts) 'the same PR reuses its own slot (new head replaces the old preview)'
$b = Select-PreviewSlot -Slots $sl -Pr 320 -NowUtc $now
Check ($b.Slot.port -eq 8461 -and -not $b.Evicts) 'a new PR takes the first free slot'
$full = @(0..2 | ForEach-Object { [pscustomobject]@{ slot = $_; port = 8460 + $_; status = 'up'; pr = 400 + $_; createdAt = (& $iso (-10 + $_)); expiresAt = (& $iso (14 + $_)) } })
$full[1].expiresAt = (& $iso -1)
$c = Select-PreviewSlot -Slots $full -Pr 500 -NowUtc $now
Check ($c.Slot.port -eq 8461 -and $c.Evicts.pr -eq 401) 'all busy: an expired preview is replaced first'
$full[1].expiresAt = (& $iso 5)
$d = Select-PreviewSlot -Slots $full -Pr 500 -NowUtc $now
Check ($d.Slot.port -eq 8460 -and $d.Evicts.pr -eq 400) 'all busy and live: the oldest is replaced (never more than 3 previews)'
$rec = New-PreviewSlotRecord -Slot $empty[2] -Issue 7 -Pr 8 -Sha ('b' * 40) -RunId 'r1' -NowUtc $now
Check ($rec.status -eq 'up' -and $rec.port -eq 8462 -and ([datetime]$rec.expiresAt).ToUniversalTime() -eq $now.ToUniversalTime().AddHours(24)) 'a new preview expires after the 24 h TTL'

# ---- cleanup -------------------------------------------------------------------------------------------------------
$cl = @(
    [pscustomobject]@{ slot = 0; port = 8460; status = 'up'; pr = 1; createdAt = (& $iso -30); expiresAt = (& $iso -6) },
    [pscustomobject]@{ slot = 1; port = 8461; status = 'up'; pr = 2; createdAt = (& $iso -1); expiresAt = (& $iso 23) },
    [pscustomobject]@{ slot = 2; port = 8462; status = 'building'; pr = 3; createdAt = (& $iso -2); expiresAt = (& $iso 22) })
$x = @(Select-PreviewCleanup -Slots $cl -PrStates @{ 2 = 'merged' } -NowUtc $now)
Check ($x.Count -eq 3) 'expired, merged-PR and crashed-build slots are all torn down'
Check ((@($x | Where-Object { $_.Slot.pr -eq 1 }).Why) -match 'expired') 'TTL expiry is named'
Check ((@($x | Where-Object { $_.Slot.pr -eq 2 }).Why) -match 'merged') 'a merged PR is named'
Check ((@($x | Where-Object { $_.Slot.pr -eq 3 }).Why) -match 'never finished') 'a build left half way is named'
$y = @(Select-PreviewCleanup -Slots $cl -PrStates @{ 2 = 'open' } -Keep @(1, 3) -NowUtc $now)
Check ($y.Count -eq 0) 'an open PR within its TTL stays; -Keep protects the build in progress'
$z = @(Select-PreviewCleanup -Slots @($cl[1]) -PrStates @{ 2 = 'closed' } -NowUtc $now)
Check ($z.Count -eq 1) 'a closed (rejected) PR is torn down'
$u = @(Select-PreviewCleanup -Slots @($cl[1]) -PrStates @{} -NowUtc $now)
Check ($u.Count -eq 0) 'an unknown PR state keeps the slot until the TTL'
$fresh = [pscustomobject]@{ slot = 2; port = 8462; status = 'building'; pr = 3; createdAt = (& $iso -0.2); expiresAt = (& $iso 23) }
Check (@(Select-PreviewCleanup -Slots @($fresh) -NowUtc $now).Count -eq 0) 'a build that just started is not torn down'

# ---- serve config (Ve's one-time step) -----------------------------------------------------------------------------
$dirs = @{ 8460 = 'C:\L\preview\slots\0'; 8461 = 'C:\L\preview\slots\1'; 8462 = 'C:\L\preview\slots\2' }
$cfg = '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true},"8460":{"HTTPS":true},"8461":{"HTTPS":true}},"Web":{' +
'"server-pc.tail0e4194.ts.net:443":{"Handlers":{"/":{"Proxy":"http://localhost:8080"}}},' +
'"server-pc.tail0e4194.ts.net:8460":{"Handlers":{"/":{"Path":"C:\\L\\preview\\slots\\0"}}},' +
'"server-pc.tail0e4194.ts.net:8461":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}},' +
'"AllowFunnel":{"server-pc.tail0e4194.ts.net:443":true}}' | ConvertFrom-Json
$sv = Test-PreviewServeConfig -Config $cfg -SlotDirs $dirs
Check ($sv.Ok -and @($sv.Ports).Count -eq 1 -and $sv.Ports[0] -eq 8460) 'only a port mapped to its slot folder counts'
Check ($sv.Why -match '8461 maps to .http://127\.0\.0\.1:8787|8461 maps to .a proxy') 'a preview port proxied anywhere (the live API) is refused'
$cfg.AllowFunnel | Add-Member -NotePropertyName 'server-pc.tail0e4194.ts.net:8460' -NotePropertyValue $true
$sv2 = Test-PreviewServeConfig -Config $cfg -SlotDirs $dirs
Check (-not $sv2.Ok -and $sv2.Why -match 'Funnel') 'a Funnel-enabled preview port is refused (tailnet only)'
Check (-not (Test-PreviewServeConfig -Config ([pscustomobject]@{}) -SlotDirs $dirs).Ok) 'no serve entries: previews off'

# ---- URLs and step paths (the browser's allowlist) -----------------------------------------------------------------
Check ((Test-PreviewUrl 'https://server-pc.tail0e4194.ts.net:8460/?v=2&seed=collection#/wantlist') -eq '') 'a preview URL is allowed'
Check ((Test-PreviewUrl 'https://server-pc.tail0e4194.ts.net:8461/' -Port 8461) -eq '') "this session's port is allowed"
foreach ($bad in @('https://server-pc.tail0e4194.ts.net:8461/' , 'https://server-pc.tail0e4194.ts.net/', 'https://server-pc.tail0e4194.ts.net:443/', 'https://server-pc.tail0e4194.ts.net:8443/api/health',
        'https://server-pc.tail0e4194.ts.net:8444/', 'http://127.0.0.1:8787/api/collection', 'http://localhost:8460/', 'https://vekbui96.github.io/cardlens/', 'http://server-pc.tail0e4194.ts.net:8460/',
        'https://server-pc.tail0e4194.ts.net:8460/api/sync', 'https://evil.example:8460/', 'https://user@server-pc.tail0e4194.ts.net:8460/')) {
    Check ((Test-PreviewUrl $bad -Port 8460) -ne '') "refused: $bad"
}
foreach ($ok in @('/', '/?v=2', '/?v=2&seed=binders#/binders', '#/set/sv1/Scarlet')) { Check ((Test-PreviewStepPath $ok) -eq '') "step path ok: $ok" }
foreach ($bad in @('https://server-pc.tail0e4194.ts.net:8443/', '//evil.example/', '/api/collection', '/wantlist', '/../x', 'javascript:alert(1)')) { Check ((Test-PreviewStepPath $bad) -ne '') "step path refused: $bad" }

# ---- the bundle scan (mock-only build) -----------------------------------------------------------------------------
$clean = @([pscustomobject]@{ Name = 'assets/index-abc.js'; Text = 'const b=("/api").replace(/\/$/,"");fetch(b+"/health");const img="https://wsrv.nl/?url="' })
Check (@(Find-PreviewBundleLeaks -Files $clean).Count -eq 0) 'a relative /api and public image hosts are fine'
foreach ($leak in @('https://server-pc.tail0e4194.ts.net:8443/api', 'http://127.0.0.1:8787', 'fetch("http://localhost:8200/api/recognize")', 'x=":8788"', 'D:\services\data', 'Bearer e2e-token', 'https://server-pc.example/')) {
    $hits = @(Find-PreviewBundleLeaks -Files @([pscustomobject]@{ Name = 'assets/x.js'; Text = "a;$leak;b" }))
    Check ($hits.Count -ge 1) "the scan catches: $leak"
}
Check ((Test-PreviewIndex '<script type="module" crossorigin src="/assets/index-AbC_12.js"></script>') -eq '') 'a base-/ index.html passes'
Check ((Test-PreviewIndex '<script type="module" src="/cardlens/assets/index-AbC.js"></script>') -ne '') 'a Pages build (base /cardlens/) is refused'
$be = Get-PreviewBuildEnv
Check ($be.VITE_USE_MOCKS -eq 'true' -and $be.VITE_COMPANION_API_BASE_URL -eq '/api' -and $be.VITE_API_BASE_URL -eq '' -and $be.VITE_BASE -eq '/' -and $be.VITE_ENABLE_DEV_PANEL -eq 'false') 'the build env forces mocks and names no server'
Check (@($be.Keys | Where-Object { $_ -match 'TOKEN|SECRET|KEY' }).Count -eq 0) 'no secret-looking VITE_ variable in the build env'
$pb = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'preview-build.ps1'))
Check ($pb -match "\^\(VITE_\|GH_\|GITHUB_\|ANTHROPIC_" -and $pb -match 'TOKEN\|SECRET\|PASSWORD\|API_KEY') 'preview-build.ps1 strips VITE_, tokens and secrets from the environment first'

# ---- QA before the merge -------------------------------------------------------------------------------------------
Check ((Get-PreviewQaGate 'pass').Merge -and (Get-PreviewQaGate 'pass').Gate -eq 'pass') 'pass merges'
Check ((Get-PreviewQaGate 'partial').Merge -and (Get-PreviewQaGate 'partial').Gate -eq 'pass') 'none failed, some unverified: merges'
Check ((Get-PreviewQaGate 'partial' -Passed 0).Gate -eq 'unverified' -and (Get-PreviewQaGate 'partial' -Passed 0).Merge) 'nothing verified at all is unverified, not a pass (live QA still runs after the deploy)'
Check ((Get-PreviewQaGate 'partial' -Passed 1).Gate -eq 'pass') 'one passed, none failed: pass'
Check (-not (Get-PreviewQaGate 'fail' -Failed 1).Merge) 'a failed criterion blocks the merge'
Check (-not (Get-PreviewQaGate 'fail' -Regressions 1).Merge) 'a regression blocks the merge'
foreach ($v in 'invalid', 'error', 'unavailable', '') { $g = Get-PreviewQaGate $v; Check ($g.Merge -and $g.Gate -eq 'unverified') "QA that could not judge ($v) never blocks (live QA after the deploy)" }
Check ((Get-PreviewQaGate 'skipped').Gate -eq 'skipped') 'no user-facing change: skipped'
Check ((Get-PreviewQaNext -Gate 'pass' -Round 1).Action -eq 'merge') 'gate pass -> merge session'
Check ((Get-PreviewQaNext -Gate 'unverified' -Round 1).Action -eq 'merge') 'gate unverified -> merge session'
Check ((Get-PreviewQaNext -Gate 'fail' -Round 1).Action -eq 'fix') 'first QA failure -> one fix round'
Check ((Get-PreviewQaNext -Gate 'fail' -Round 2).Action -eq 'fail') 'second QA failure -> loop:failed class qa'
Check ((Get-PreviewQaNext -Gate 'pass' -Round 2).Action -eq 'merge') 'a fix round that passes QA merges'
Check ((Get-PreviewQaNext -Gate 'pass' -Round 1 -Held $true).Action -eq 'held') 'a /hold after the preview stops the merge'
Check ((Get-PreviewQaNext -Gate 'fail' -Round 1 -Held $true).Action -eq 'held') 'held wins over a fix round'
Check ((Get-PreviewQaNext -Gate 'pass' -MinutesLeft 30).Action -eq 'out-of-time') 'under 45 min left: no merge (out-of-time, retried once)'
Check ((Get-PreviewQaNext -Gate 'fail' -Round 1 -MinutesLeft 60).Action -eq 'out-of-time') 'no time for a fix round and a merge'
Check ($script:ChangeFailures.Contains('qa') -and $script:ChangeFailures.Contains('held')) 'failure classes qa and held exist'
Check ((Format-FailureMarker -Class 'qa' -Outcome 'failed') -match 'class=qa outcome=failed') 'the qa failure marker is written as qa'
$rqa = Get-RetryDecision -Labels @('loop:failed') -Failures @([pscustomobject]@{ Class = 'qa'; Outcome = 'failed'; Model = 'claude-sonnet-5-5'; At = 'x'; Id = 1 })
Check (-not $rqa.Retry) 'a qa failure is never retried automatically'
$rho = Get-RetryDecision -Labels @('loop:failed') -Failures @([pscustomobject]@{ Class = 'held'; Outcome = 'skipped'; Model = 'claude-sonnet-5-5'; At = 'x'; Id = 1 })
Check (-not $rho.Retry) 'a held build is never retried automatically'

# merge-pr.ps1's gate
$H = 'c' * 40
$recP = [pscustomobject]@{ runId = 'r9'; required = $true; headSha = $H; gate = 'pass'; verdict = 'pass' }
Check (Get-PreviewMergeGate -Record $recP -RunId 'r9' -HeadSha $H).Ok 'a pass on the exact head merges'
Check (-not (Get-PreviewMergeGate -Record $recP -RunId 'r9' -HeadSha ('d' * 40)).Ok) 'a pass on an older head does not cover a new push'
$recF = [pscustomobject]@{ runId = 'r9'; required = $true; headSha = $H; gate = 'fail'; verdict = 'fail' }
Check (-not (Get-PreviewMergeGate -Record $recF -RunId 'r9' -HeadSha $H).Ok) 'a QA failure refuses the merge'
$recPend = [pscustomobject]@{ runId = 'r9'; required = $true; headSha = ''; gate = 'pending'; verdict = 'pending' }
$gp = Get-PreviewMergeGate -Record $recPend -RunId 'r9' -HeadSha $H
Check (-not $gp.Ok -and $gp.Why -match 'LOOP-PR-READY') 'no QA yet: refused, telling the session to print LOOP-PR-READY'
Check (Get-PreviewMergeGate -Record $recPend -RunId 'r9' -HeadSha $H -UserFacing $false).Ok 'a PR with no user-facing file merges without a preview'
Check (Get-PreviewMergeGate -Record $recPend -RunId 'r8' -HeadSha $H).Ok "another run's record is not this run's requirement (previews off now, Ve's manual merge)"
Check (Get-PreviewMergeGate -Record $null -RunId 'r9' -HeadSha $H).Ok 'no record: previews were off for this run'
$recU = [pscustomobject]@{ runId = 'r9'; required = $true; headSha = $H; gate = 'unverified'; verdict = 'invalid' }
Check (Get-PreviewMergeGate -Record $recU -RunId 'r9' -HeadSha $H).Ok 'unverified (QA could not judge) merges'
$mp = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'merge-pr.ps1'))
Check ($mp -match 'Get-PreviewMergeGate' -and $mp -match 'preview-qa-\$Issue' -and $mp -match 'INNOVATION_LOOP_RUN_ID') 'merge-pr.ps1 enforces the preview gate of this run'
Check ($mp.IndexOf('Get-PreviewMergeGate') -gt 0 -and $mp.IndexOf('Get-PreviewMergeGate') -lt $mp.IndexOf("@('pr', 'merge'")) 'the preview gate is checked before the merge command'

# the marker
$txt = "Gate passed.`nLOOP-PR-READY 286 289 $('e' * 40)`nLOOP-RESULT: OK pr-ready #286"
$m = Get-PrReadyMarker -Text $txt -Issue 286
Check ($m -and $m.Pr -eq 289 -and $m.Sha -eq ('e' * 40)) 'LOOP-PR-READY is parsed'
Check ($null -eq (Get-PrReadyMarker -Text $txt -Issue 287)) "another issue's marker is ignored"
Check ($null -eq (Get-PrReadyMarker -Text "I will print LOOP-PR-READY 286 289 $('e' * 40) later" -Issue 286)) 'the marker counts only at the start of a line'
Check ($null -eq (Get-PrReadyMarker -Text "LOOP-PR-READY 286 289 abc123" -Issue 286)) 'a short sha is not a marker'
$m2 = Get-PrReadyMarker -Text "LOOP-PR-READY 286 289 $('e' * 40)`nfix pushed`nLOOP-PR-READY 286 289 $('f' * 40)" -Issue 286
Check ($m2.Sha -eq ('f' * 40)) 'the last marker wins (the head after a fix round)'

# ---- via-policy timing and the preview field -------------------------------------------------------------------------
$pol = [pscustomobject]@{ Enabled = $true; VetoHours = 1; IncludeSpecs = $true; Reason = 'policy on'; SetBy = 'vekbui96'; SetOn = '2026-11-23' }
$vst = Get-ViaPolicyState -Exists $true -Text (@{ schema = 1; issues = @(@{ issue = 50; title = 'x'; status = 'due'; noticedAt = (& $iso -2); dueAt = (& $iso -1); commentId = 9 }) } | ConvertTo-Json -Depth 4)
$pvw = New-ViaPolicyPreview -Url 'https://server-pc.tail0e4194.ts.net:8460/' -Pr 60 -Sha ('a' * 40) -Status 'up' -Qa 'pass' -UpAt (& $iso 0) -ExpiresAt (& $iso 24) -NowUtc $now
$ent = @([pscustomobject]@{ issue = 50; title = 'x'; spec = $false; status = 'due'; noticedAt = (& $iso -2); dueAt = (& $iso -1); commentId = 9; reasons = @() })
$up = Update-ViaPolicyState -State $vst -Entries $ent -Previews @{ 50 = $pvw } -Policy $pol -NowUtc $now
$r50 = @($up.State.issues | Where-Object { $_.issue -eq 50 })[0]
Check ($r50.preview.url -eq 'https://server-pc.tail0e4194.ts.net:8460/' -and $r50.preview.status -eq 'up' -and $r50.preview.qa -eq 'pass') 'via-policy.json carries issues[].preview (url, status, qa) for the hub'
Check ($r50.status -eq 'due' -and $r50.dueAt -eq (& $iso -1)) 'a preview does not move the veto window (it ran before the build)'
$vst2 = Get-ViaPolicyState -Exists $true -Text ($up.State | ConvertTo-Json -Depth 6)
$up2 = Update-ViaPolicyState -State $vst2 -Entries $ent -Policy $pol -NowUtc $now.AddMinutes(5)
Check ((@($up2.State.issues | Where-Object { $_.issue -eq 50 })[0]).preview.url -eq $pvw.url) 'the preview survives a later state rewrite'
$gone = Update-ViaPolicyState -State $vst2 -Entries @() -Outcomes @{ 50 = 'deployed' } -Previews @{ 50 = (New-ViaPolicyPreview -Url $pvw.url -Pr 60 -Sha ('a' * 40) -Status 'down' -Qa 'pass') } -Policy $pol -NowUtc $now
$g50 = @($gone.State.issues | Where-Object { $_.issue -eq 50 })[0]
Check ($g50.status -eq 'deployed' -and $g50.preview.status -eq 'down') 'after the merge the preview is marked down on the record'
$waiting = Update-ViaPolicyState -State (Get-ViaPolicyState) -Entries @([pscustomobject]@{ issue = 51; title = 'y'; status = 'waiting'; noticedAt = (& $iso 0); dueAt = (& $iso 1); commentId = 10; reasons = @() }) `
    -Posted @{ 51 = @{ noticedAt = (& $iso 0); dueAt = (& $iso 1); commentId = 10 } } -Policy $pol -NowUtc $now
Check (($waiting.State.issues[0].Contains('preview')) -and $null -eq $waiting.State.issues[0].preview -and $waiting.State.nextDueAt) 'a waiting proposal has no preview yet (preview: null) and keeps its veto time'
# a /hold posted after the preview is still a final veto for check-approval (and so for merge-pr)
$issue = [pscustomobject]@{ number = 50; title = 'x'; state = 'open'; labels = @([pscustomobject]@{ name = 'loop:proposal' }, [pscustomobject]@{ name = 'loop:in-progress' }); body = "<!-- innovation-loop -->`nbody"; user = [pscustomobject]@{ login = 'vekbui96' }; created_at = (& $iso -3) }
$hold = [pscustomobject]@{ id = 11; user = [pscustomobject]@{ login = 'vekbui96' }; body = '/hold'; created_at = (& $iso 0.1) }
$vd = Get-ViaPolicyDecision -Issue $issue -Comments @($hold) -Policy $pol -Record ([pscustomobject]@{ noticedAt = (& $iso -2); commentId = 9 }) -Owner 'vekbui96' -NowUtc $now.AddHours(0.2)
Check ($vd.Status -eq 'held' -and -not $vd.Eligible) 'a /hold after the preview (veto window over) still stops the merge'

# ---- prompt blocks -------------------------------------------------------------------------------------------------
$crit = [pscustomobject]@{ Source = 'plan'; Criteria = @([pscustomobject]@{ Id = 'ac1'; Workflow = 'wantlist'; Path = '/wantlist'; Url = 'x'; Text = 'The Want list title reads Want list.' }, [pscustomobject]@{ Id = 'ac2'; Workflow = 'home'; Path = '/'; Url = 'x'; Text = 'The Home screen shows value buttons.' }) }
$pc = @(ConvertTo-PreviewCriteria -Criteria $crit.Criteria -BaseUrl 'https://server-pc.tail0e4194.ts.net:8460/')
Check ($pc[0].Url -eq 'https://server-pc.tail0e4194.ts.net:8460/?v=2#/wantlist' -and $pc[1].Url -eq 'https://server-pc.tail0e4194.ts.net:8460/?v=2') 'criteria URLs move to the preview (v2, hash routes)'
Check (@($pc | Where-Object { $_.Url -match 'github\.io|8443' }).Count -eq 0) 'no criterion URL points at the live site or the API'
$in = (Format-PreviewQaInput -Issue 286 -Title 't' -Pr 289 -Sha ('a' * 40) -Url 'https://server-pc.tail0e4194.ts.net:8460/' -Criteria ([pscustomobject]@{ Source = 'plan'; Criteria = $pc }) -Scope $null `
        -ShotsDir 'C:\L\artifacts\qa\r-286-p1' -ArtifactsDir 'C:\L\artifacts' -Work 'C:\L\work' -ScriptsDir 'D:\S') -join "`n"
Check ($in -match 'preview-browse\.ps1' -and $in -match 'seed=' -and $in -match 'artifact:qa/r-286-p1/ac1/390x844\.png' -and $in -match 'NOT merged') 'the QA input names the browser, the seeds and the evidence path'
$cfx = (Format-PreviewContinueLines -Issue 286 -Pr 289 -Sha ('a' * 40) -Next 'fix' -Url 'u' -Gate 'fail' -Why 'w' -Round 1) -join "`n"
Check ($cfx -match 'NEXT: fix' -and $cfx -match 'LOOP-PR-READY 286 289' -and $cfx -match 'LOOP-ISSUE-START 286') 'the fix-round header tells the session to print LOOP-PR-READY again'
$cmg = (Format-PreviewContinueLines -Issue 286 -Pr 289 -Sha ('a' * 40) -Next 'merge' -Gate 'pass' -Why 'w') -join "`n"
Check ($cmg -match 'NEXT: merge' -and $cmg -match 'merge-pr\.ps1 -Pr 289 -Issue 286') 'the merge header points at merge-pr'
Check ((Format-PreviewLine -Url 'https://server-pc.tail0e4194.ts.net:8460/' -Sha ('a' * 40)) -match '^Preview: https://server-pc\.tail0e4194\.ts\.net:8460/ \(tailnet only') 'the Preview line'

# ---- LOOP.md / sessions / runner wiring ------------------------------------------------------------------------------
$lm = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LOOP.md'))
Check ($lm -match '(?m)^## 14\. Preview QA' -and $lm -match '9a\. Preview and QA before the merge' -and $lm -match 'LOOP-PR-READY <ISSUE> <pr#> <sha>') 'LOOP.md has step 9a and section 14'
$rl = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'run-loop.ps1'))
Check ($rl -match "SettingsKind 'qapreview' -GuardModeOverride 'QA_PREVIEW' -PreviewPort" -and $rl -match "qapreview = @\('preview-browse'\)") 'the preview QA session runs with its own settings and guard mode'
Check ($rl -notmatch '\[string\]\$GuardMode\b' -and $rl -match 'if \(\$GuardModeOverride\) \{ \$guardMode = \$GuardModeOverride \}') 'the guard-mode override is not shadowed by the local $guardMode (PowerShell names are case-insensitive; proof run 20261124-101349)'
Check ($rl -match 'Remove-LoopPreview -Pr \$pvPr' -and $rl -match 'Invoke-PreviewHousekeeping') 'the runner tears previews down after each build and at the end of the run'
$sj = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sessions.json')) | ConvertFrom-Json
Check ((Get-LoopOptions $sj).previewQa -eq $true -and (Get-LoopOptions $null).previewQa -eq $false) 'options.previewQa: on in sessions.json, off by default'
Check ($script:PreviewPorts.Count -eq 3 -and -not (@($script:PreviewPorts) | Where-Object { $_ -in 443, 8443, 8444, 10000 })) 'the preview ports never overlap the Funnel / hub ports'

if ($Integration) {
    # Build THIS checkout the way preview-build.ps1 does (env only; not under the reduced token, no worktree), then scan.
    $root = Split-Path $PSScriptRoot -Parent
    $out = Join-Path ([IO.Path]::GetTempPath()) "preview-it-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    $saved = @{}; foreach ($k in @(Get-ChildItem env: | Where-Object { $_.Name -like 'VITE_*' } | ForEach-Object { $_.Name })) { $saved[$k] = (Get-Item "env:$k").Value; Remove-Item "env:$k" }
    $envs = Get-PreviewBuildEnv; foreach ($k in $envs.Keys) { Set-Item "env:$k" $envs[$k] }
    try {
        Push-Location $root
        & 'C:\Program Files\nodejs\node.exe' (Join-Path $root 'node_modules\vite\bin\vite.js') build --base / --outDir $out --emptyOutDir --logLevel error 2>&1 | Select-Object -Last 5 | ForEach-Object { "  $_" }
        Pop-Location
        Check (Test-Path (Join-Path $out 'index.html')) 'integration: the preview build produced index.html'
        Get-ChildItem $out -Recurse -Filter *.map | Remove-Item -Force
        $files = @(Get-ChildItem $out -Recurse -File | Where-Object { $_.Name -match $script:PreviewScanRx } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Text = [IO.File]::ReadAllText($_.FullName) } })
        $leaks = @(Find-PreviewBundleLeaks -Files $files)
        foreach ($l in $leaks) { Write-Host "  leak: $($l.What) in $($l.File): $($l.Sample)" }
        Check ($files.Count -gt 3 -and $leaks.Count -eq 0) "integration: the real preview bundle ($($files.Count) files) names no live host or API port"
        Check ((Test-PreviewIndex ([IO.File]::ReadAllText((Join-Path $out 'index.html')))) -eq '') 'integration: index.html is a base-/ preview build'
        $js = ($files | Where-Object { $_.Name -like '*.js' } | ForEach-Object { $_.Text }) -join "`n"
        Check ($js -notmatch 'api\.pokemontcg\.io/v2' -or $js -match 'MockPokemonProvider|mock') 'integration: mocks are compiled in'
    } finally {
        foreach ($k in $envs.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
        foreach ($k in $saved.Keys) { Set-Item "env:$k" $saved[$k] }
        Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }

<#
.SYNOPSIS
  Unit tests for via-policy approval (gate-rules.ps1: Get-AutonomyPolicy, Get-ViaPolicyScope, Get-ViaPolicyDecision,
  Format-ViaPolicyNotice, Get-ViaPolicyState / Update-ViaPolicyState, the drain on a veto window's end, a spec
  approved via policy and its slices) and Ve's policy file itself. No network, no git.
  powershell -ExecutionPolicy Bypass -File innovation\test-via-policy.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$mk = '<!-- innovation-loop -->'
$owner = 'vekbui96'

# ---- Ve's policy file ----------------------------------------------------------------------------------------
$good = '{"schema":1,"loop":"cardlens","approval":"via-policy","enabled":true,"vetoHours":6,"includeSpecs":true,"exclude":["server-deploy","stored-data","manual","protected"],"setBy":"vekbui96","setOn":"2026-11-23"}'
$p = Get-AutonomyPolicy -Text $good
Check ($p.Enabled -and $p.VetoHours -eq 6 -and $p.IncludeSpecs -and $p.SetOn -eq '2026-11-23') "a valid policy is on ($($p.Reason))"
function Pol { param([string]$Old, [string]$New) Get-AutonomyPolicy -Text ($good.Replace($Old, $New)) }
Check (-not (Get-AutonomyPolicy -Exists $false).Enabled) 'no AUTONOMY.json -> manual approval'
Check (-not (Get-AutonomyPolicy -Text $good -ReadError 'denied').Enabled) 'unreadable -> off (fail closed)'
Check (-not (Get-AutonomyPolicy -Text '').Enabled) 'empty -> off'
Check (-not (Get-AutonomyPolicy -Text '{"schema":1,').Enabled) 'invalid JSON -> off'
Check (-not (Get-AutonomyPolicy -Text '[1,2]').Enabled) 'not an object -> off'
$off = Pol '"enabled":true' '"enabled":false'
Check (-not $off.Enabled -and $off.Reason -match 'switched off by Ve') "the off switch: enabled false -> manual approval at once ($($off.Reason))"
Check (-not (Pol '"enabled":true' '"enabled":"true"').Enabled) 'enabled as a string -> off'
Check (-not (Pol '"enabled":true,' '').Enabled) 'enabled missing -> off'
Check (-not (Pol '"schema":1' '"schema":2').Enabled) 'schema 2 -> off'
Check (-not (Pol '"loop":"cardlens"' '"loop":"hub"').Enabled) 'another loop''s policy -> off'
Check (-not (Pol '"approval":"via-policy"' '"approval":"auto"').Enabled) 'approval not via-policy -> off'
Check (-not (Pol '"vetoHours":6' '"vetoHours":0').Enabled) 'veto window 0 h -> off'
Check (-not (Pol '"vetoHours":6' '"vetoHours":200').Enabled) 'veto window over a week -> off'
Check (-not (Pol '"vetoHours":6' '"vetoHours":"6"').Enabled) 'veto window as a string -> off'
Check ((Pol '"vetoHours":6' '"vetoHours":1.5').VetoHours -eq 1.5) 'a fractional veto window is allowed'
Check (-not (Pol '"includeSpecs":true,' '').Enabled) 'includeSpecs missing -> off'
Check (-not (Pol '"server-deploy",' '').Enabled) 'exclude without server-deploy -> off (the policy cannot be widened)'
Check (-not (Pol '"protected"]' '"protected","money"]').Enabled) 'an exclusion this loop does not implement -> off'
Check ((Pol '"includeSpecs":true' '"includeSpecs":false').IncludeSpecs -eq $false) 'includeSpecs false is read'

# the committed policy file: Ve's decision of 2026-11-23, valid for this loop
$file = Read-AutonomyPolicy -Path (Join-Path $PSScriptRoot $script:AutonomyFileName)
Check ($file.Enabled -and $file.VetoHours -eq 6 -and $file.IncludeSpecs -and $file.SetBy -eq 'vekbui96' -and $file.SetOn -eq '2026-11-23') "innovation/AUTONOMY.json is valid and on ($($file.Reason))"
$fj = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $script:AutonomyFileName)) | ConvertFrom-Json
Check ("$($fj.decision)" -match 'Everything but server/data' -and "$($fj.decision)" -match '2026-11-23') 'the policy file records Ve''s decision and its date'
Check (@($script:ProtectedPathPatterns | Where-Object { 'innovation/AUTONOMY.json' -match $_ }).Count -gt 0) 'innovation/AUTONOMY.json is a protected path (merge-pr refuses a PR that touches it)'

# ---- scope: what the policy covers ---------------------------------------------------------------------------
function PBody { param([string]$Deploys = 'Pages only.', [string]$Scope = 'In scope for the loop.', [string]$Risk = 'Front end only; no stored shape, merge rule or cache key changes.', [string]$What = 'A clearer empty state on Binders.')
    "$mk`n## What`n$What`n## Why`nx`n## Risk`n$Risk`n## What deploys`n$Deploys`n## Glasses vs web`nWeb only.`n## Scope`n$Scope`n" }
$s = Get-ViaPolicyScope -Title 'Binders: explain what a binder is' -Body (PBody)
Check ($s.InScope) "Pages only, in scope, negated data line -> covered ($($s.Reasons -join ' | '))"
Check (-not (Get-ViaPolicyScope -Body (PBody -Deploys 'Pages + server (files: server/index.ts).')).InScope) 'Pages + server -> not covered'
Check (-not (Get-ViaPolicyScope -Body (PBody -Deploys 'Pages only, then restart the service.')).InScope) '"What deploys" naming a restart -> not covered'
Check (-not (Get-ViaPolicyScope -Body "$mk`n## What`nx`n## Scope`nIn scope for the loop.").InScope) 'no "What deploys" section -> not covered (fail closed)'
Check (-not (Get-ViaPolicyScope -Body (PBody -Scope '**Manual / needs Ve**: touches the sync rules. The loop will not build this.')).InScope) 'Manual / needs Ve -> not covered'
Check (-not (Get-ViaPolicyScope -Body (PBody -Scope 'Probably fine.')).InScope) 'Scope not "In scope for the loop" -> not covered'
$cases = @(
    @('Changes the stored shape of binder slots.', 'stored data shapes'),
    @('Adds a migration for old rows.', 'stored data shapes'),
    @('Bumps the cache version for sets.', 'stored data shapes'),
    @('Writes tombstones for removed cards.', 'stored data shapes'),
    @('Changes how sync resolves two devices.', 'sync / merge rules'),
    @('Tweaks the merge rule for binders.', 'sync / merge rules'),
    @('Lowers MIN_MARGIN by one.', 'the scanner gate / card index'),
    @('Moves the accept gate threshold.', 'the scanner gate / card index'),
    @('Reads the API key from .env at build time.', 'secrets'),
    @('Adds a new origin to CORS.', 'CORS / CSP'),
    @('Edits innovation/LOOP.md to allow it.', 'innovation/, CI or the loop itself'),
    @('Adds a metrics event for the tile.', 'a metrics event (needs a server deploy)'),
    @('Refactors src/storage/caches.ts for speed.', 'protected path src/storage/caches.ts'),
    @('Touches .github/workflows/ci.yml.', 'innovation/, CI or the loop itself')
)
foreach ($c in $cases) {
    $sc = Get-ViaPolicyScope -Body (PBody -What $c[0])
    Check (-not $sc.InScope -and ($sc.Reasons -join ' ') -match [regex]::Escape($c[1])) "'$($c[0])' -> not covered: $($c[1]) (got $($sc.Reasons -join ' | '))"
}
Check ((Get-ViaPolicyScope -Body (PBody -What 'Copy only: no change to what the scanner decides, the card index or gate constants.')).InScope) 'a negated scanner clause (negation before the term) stays covered'
Check (-not (Get-ViaPolicyScope -Body (PBody -What 'Changes the merge rule, no server deploy.')).InScope) 'a negation AFTER the sensitive term does not excuse it'
Check (-not (Get-ViaPolicyScope -Title 'Sync status line on Home' -Body (PBody)).InScope) 'the title is checked too'
Check ((Get-ViaPolicyScope -Body ((PBody) + "<!-- loop-refs: sync-123 -->")).InScope) 'HTML comments (loop refs) are ignored'
# specs: every slice Pages only
$spec = "$mk`n## Problem and evidence`nx`n## Slices`n1. **Skeleton primitive**: Collection rows (Size S, Pages only).`n2. **Home skeleton**: value card (Size S, Pages only).`n"
Check ((Get-ViaPolicyScope -Body $spec -IsSpec $true).InScope) 'a spec whose slices are all Pages only -> covered'
Check (-not (Get-ViaPolicyScope -Body ($spec + "3. **Price alerts**: needs a new route (Size M, Pages + server).`n") -IsSpec $true).InScope) 'a spec with a Pages + server slice -> not covered'
Check (-not (Get-ViaPolicyScope -Body ($spec + "3. **Share page**: something (Size S).`n") -IsSpec $true).InScope) 'a slice that does not say Pages only -> not covered (fail closed)'
Check (-not (Get-ViaPolicyScope -Body "$mk`n## Problem and evidence`nx" -IsSpec $true).InScope) 'a spec without a Slices list -> not covered'

# ---- the decision -------------------------------------------------------------------------------------------
function PIss { param([int]$N = 248, [string[]]$L = @('loop:proposal'), [string]$Body = (PBody), [string]$State = 'open', [string]$By = 'vekbui96', [string]$Title = 'Binders: explain what a binder is', [string]$Created = '2026-11-23T10:00:00Z')
    [pscustomobject]@{ number = $N; title = $Title; state = $State; body = $Body; created_at = $Created; user = [pscustomobject]@{ login = $By }; labels = @($L | ForEach-Object { [pscustomobject]@{ name = $_ } }) } }
function PCmt { param([string]$Body, [string]$At = '2026-11-23T11:00:00Z', [string]$By = 'vekbui96', [long]$Id = 900) [pscustomobject]@{ id = $Id; body = $Body; created_at = $At; user = [pscustomobject]@{ login = $By } } }
$notice = PCmt (Format-ViaPolicyNotice -DueUtc ([datetime]'2026-11-23T18:00:00Z') -Marker $mk) '2026-11-23T12:00:00Z' -Id 777
$rec = [pscustomobject]@{ issue = 248; noticedAt = '2026-11-23T12:00:00Z'; commentId = 777 }
$before = [datetime]'2026-11-23T15:00:00Z'; $after = [datetime]'2026-11-23T18:30:00Z'
function D { param($Issue = (PIss), [string]$Edited = '', [object[]]$Comments = @($notice), [int]$Ev = 0, $Policy = $p, $Record = $rec, [string]$Budget = 'normal', [datetime]$Now = $after)
    Get-ViaPolicyDecision -Issue $Issue -EditedAt $Edited -Comments $Comments -ApprovalEvents $Ev -Policy $Policy -Record $Record -Budget $Budget -NowUtc $Now -Owner $owner -Marker $mk }
function W { param($X) "$($X.Status): $($X.Reasons -join ' | ')" }

$d = D
Check ($d.Eligible -and $d.Status -eq 'due' -and $d.DueAt -eq ([datetime]'2026-11-23T18:00:00Z').ToUniversalTime().ToString('o')) "noticed, window over, everything fine -> due (got $(W $d))"
$d = D -Now $before
Check (-not $d.Eligible -and $d.Status -eq 'waiting' -and ($d.Reasons -join ' ') -match 'auto-approves at .* unless vekbui96 comments /hold') "inside the veto window -> waiting, says when (got $(W $d))"
$d = D -Record $null -Comments @()
Check (-not $d.Eligible -and $d.Status -eq 'needs-notice') "eligible, no notice yet -> needs-notice (got $(W $d))"
# 0. policy
Check ((D -Policy $off).Status -eq 'off' -and -not (D -Policy $off).Eligible) 'policy switched off -> off, never eligible (the off switch works on a due issue)'
Check ((D -Policy $null).Status -eq 'off') 'no policy object -> off'
# 1. the loop's own proposal
Check ((D -Issue (PIss -L 'loop:proposal', 'approved')).Status -eq 'not-applicable') 'Ve''s approved label -> label approval, not this rule'
Check ((D -Issue (PIss -Body ("$mk`nPart of #243 (slice 1 of 4)`n" + (PBody).Substring($mk.Length + 1)))).Status -eq 'not-applicable') 'a slice -> via-spec decides'
Check ((D -Issue (PIss -Body ("$mk`nFrom request #170`n" + (PBody).Substring($mk.Length + 1)))).Status -eq 'not-applicable') 'a request''s issue -> via-request decides'
$d = D -Issue (PIss -By 'someone')
Check ($d.Status -eq 'ineligible' -and (W $d) -match 'opened by someone') 'opened by someone else -> ineligible'
$d = D -Issue (PIss -Body ((PBody).Replace($mk, 'Please build this')))
Check ($d.Status -eq 'ineligible' -and (W $d) -match 'loop marker') 'a Ve-written issue without the loop marker -> ineligible (Ve''s requests use via-request)'
Check ((D -Issue (PIss -L 'bug')).Status -eq 'ineligible') 'not a loop:proposal -> ineligible'
$sp = PIss -N 243 -L 'loop:proposal', 'loop:spec' -Body $spec -Title 'Spec: Loading and perceived speed'
Check ((D -Issue $sp -Record ([pscustomobject]@{ noticedAt = '2026-11-23T12:00:00Z'; commentId = 777 })).Status -eq 'due') 'a Pages-only spec with includeSpecs -> due'
Check ((D -Issue $sp -Policy (Pol '"includeSpecs":true' '"includeSpecs":false')).Status -eq 'ineligible') 'a spec with includeSpecs false -> ineligible'
# 2. manual / failed / deployed
Check ((D -Issue (PIss -L 'loop:proposal', 'loop:failed')).Status -eq 'ineligible') 'loop:failed -> ineligible (no automatic retry)'
Check ((D -Issue (PIss -L 'loop:proposal', 'loop:deployed')).Status -eq 'ineligible') 'loop:deployed -> ineligible'
Check ((D -Issue (PIss -Body (PBody -Scope '**Manual / needs Ve**: data. The loop will not build this.'))).Status -eq 'ineligible') 'Manual / needs Ve -> ineligible'
# 3. scope
Check ((D -Issue (PIss -Body (PBody -Deploys 'Pages + server (files: server/routes.ts).'))).Status -eq 'ineligible') 'server deploy -> ineligible'
Check ((D -Issue (PIss -Body (PBody -What 'Changes the stored shape of a binder.'))).Status -eq 'ineligible') 'stored data shape -> ineligible'
# 4. vetoes (final)
Check ((D -Issue (PIss -State 'closed')).Status -eq 'closed') 'Ve closed it -> closed (rejected)'
Check ((D -Ev 2).Status -eq 'voided') '`approved` added and removed by hand -> voided'
$hold = PCmt '/hold not yet' '2026-11-23T13:00:00Z' -Id 901
$d = D -Comments @($notice, $hold)
Check ($d.Status -eq 'held' -and -not $d.Eligible) "Ve's /hold after the notice -> held for good (got $(W $d))"
Check ((D -Comments @($notice, (PCmt 'Hold: want to look first' '2026-11-23T13:00:00Z' -Id 902))).Status -eq 'held') '"hold" without the slash also holds'
Check ((D -Comments @((PCmt '/hold' '2026-11-23T10:30:00Z' -Id 903)) -Record $null).Status -eq 'held') 'a /hold before the notice also holds (no notice is ever posted)'
Check ((D -Comments @($notice, (PCmt '/hold' '2026-11-23T13:00:00Z' -By 'stranger' -Id 904))).Status -eq 'due') 'someone else''s /hold is untrusted data: ignored'
Check ((D -Comments @($notice, (PCmt "$mk`n/hold" '2026-11-23T13:00:00Z' -Id 905))).Status -eq 'due') 'a loop-marked comment is never a hold'
Check ((D -Comments @($notice, (PCmt "<!-- claude-agent -->`n/hold" '2026-11-23T13:00:00Z' -Id 906))).Status -eq 'due') 'an agent''s comment (claude-agent marker first) is not Ve''s /hold'
Check ((D -Comments @($notice, (PCmt 'Looks good, but hold the color' '2026-11-23T13:00:00Z' -Id 907))).Status -eq 'due') 'a comment that only contains "hold" later is not a hold'
# 5. the notice
$d = D -Record $null
Check ($d.Status -eq 'voided' -and (W $d) -match 'no record') 'a notice comment without the runner''s record (e.g. a session posted it) -> voided (fail closed)'
$d = D -Comments @()
Check ($d.Status -eq 'voided' -and (W $d) -match 'no longer on the issue') 'the recorded notice comment was deleted -> voided'
Check ((D -Comments @((PCmt $notice.body '2026-11-23T12:00:00Z' -By 'stranger' -Id 777))).Status -eq 'voided') 'a notice not posted by the owner''s account does not count'
Check ((D -Comments @((PCmt ("<!-- claude-agent -->`n" + $notice.body) '2026-11-23T12:00:00Z' -Id 777))).Status -eq 'voided') 'an agent comment carrying the notice markers does not count'
$d = D -Edited '2026-11-23T14:00:00Z'
Check ($d.Status -eq 'voided' -and (W $d) -match 'edited') "body edited after the notice -> voided (got $(W $d))"
Check ((D -Edited '2026-11-23T11:00:00Z').Status -eq 'due') 'body edited before the notice: the notice covers the edited text -> still due'
Check ((D -Record ([pscustomobject]@{ noticedAt = 'soon'; commentId = 777 })).Status -eq 'voided') 'an unreadable notice time -> voided (fail closed)'
# 6. budget
$d = D -Budget 'hold'
Check ($d.Status -eq 'waiting' -and -not $d.Eligible -and (W $d) -match 'budget') 'plan budget hold after the window -> waits'
Check ((D -Budget 'no-opus').Eligible) 'plan budget no-opus does not stop the approval (the runner defers Opus builds as usual)'
# notice text
$nt = Format-ViaPolicyNotice -DueUtc ([datetime]'2026-11-24T00:00:00Z') -Marker $mk
Check ($nt.StartsWith("$mk`n$($script:ViaPolicyMarker)`n") -and $nt -match "Auto-approves via Ve's policy at \w{3} \d{4}-\d\d-\d\d \d{1,2}:\d\d [AP]M unless you comment ``/hold``\. Policy: innovation/AUTONOMY\.json") "notice text (got: $nt)"

# ---- state and log ----------------------------------------------------------------------------------------
Check ((Get-ViaPolicyState -Exists $false).Ok) 'no state file yet -> ok, empty'
Check (-not (Get-ViaPolicyState -Exists $true -Text '{oops').Ok) 'an unreadable state file -> not ok (check-approval turns the policy off: fail closed)'
Check (-not (Get-ViaPolicyState -Exists $true -Text '{"schema":2,"issues":[]}').Ok) 'unknown state schema -> not ok'
$e0 = @([pscustomobject]@{ issue = 248; title = 'Binders'; spec = $false; status = 'needs-notice'; noticedAt = ''; dueAt = ''; commentId = 0; reasons = @('eligible') },
    [pscustomobject]@{ issue = 260; title = 'Other'; spec = $false; status = 'ineligible'; noticedAt = ''; dueAt = ''; commentId = 0; reasons = @('names sync / merge rules') })
$u = Update-ViaPolicyState -State (Get-ViaPolicyState -Exists $false) -Entries $e0 -Posted @{ 248 = @{ noticedAt = '2026-11-23T12:00:00Z'; dueAt = '2026-11-23T18:00:00Z'; commentId = 777 } } -Policy $p -RunId 'r1' -Repo 'vekbui96/cardlens'
Check (@($u.State.issues).Count -eq 1 -and $u.State.issues[0].issue -eq 248 -and $u.State.issues[0].status -eq 'waiting' -and (ConvertTo-ViaPolicyUtc $u.State.nextDueAt) -eq (ConvertTo-ViaPolicyUtc '2026-11-23T18:00:00Z')) 'a posted notice -> waiting record with its due time; never-noticed issues are not kept'
Check (@($u.Events).Count -eq 1 -and $u.Events[0].event -eq 'noticed') 'the notice is logged'
Check ($u.State.policy.enabled -and $u.State.issues[0].url -eq 'https://github.com/vekbui96/cardlens/issues/248') 'the state names the policy and the issue url (for the hub)'
$st1 = Get-ViaPolicyState -Exists $true -Text ($u.State | ConvertTo-Json -Depth 6)
Check ($st1.Ok -and $st1.Issues.ContainsKey(248)) 'the state round-trips through JSON'
$e1 = @([pscustomobject]@{ issue = 248; title = 'Binders'; spec = $false; status = 'due'; noticedAt = '2026-11-23T12:00:00Z'; dueAt = '2026-11-23T18:00:00Z'; commentId = 777; reasons = @() })
$u2 = Update-ViaPolicyState -State $st1 -Entries $e1 -Policy $p -RunId 'r2'
Check ($u2.State.issues[0].status -eq 'due' -and $u2.State.issues[0].approvedAt -eq '2026-11-23T18:00:00Z' -and @($u2.Events).Count -eq 1 -and $u2.State.nextDueAt -eq '') 'due: approvedAt recorded, change logged, nothing else to wait for'
$st2 = Get-ViaPolicyState -Exists $true -Text ($u2.State | ConvertTo-Json -Depth 6)
$u3 = Update-ViaPolicyState -State $st2 -Entries @() -Outcomes @{ 248 = 'deployed' } -Policy $p -RunId 'r2'
Check ($u3.State.issues[0].status -eq 'deployed' -and $u3.State.issues[0].outcome -eq 'deployed' -and $u3.Events[0].event -eq 'built') 'a via-policy build''s outcome is recorded and logged (weekly safety summary)'
$st3 = Get-ViaPolicyState -Exists $true -Text ($u3.State | ConvertTo-Json -Depth 6)
$u4 = Update-ViaPolicyState -State $st3 -Entries @() -Policy $p -RunId 'r3'
Check ($u4.State.issues[0].status -eq 'deployed' -and @($u4.Events).Count -eq 0) 'a finished record stays as it is'
$u5 = Update-ViaPolicyState -State $st1 -Entries @() -Approvals @{ 248 = 'label' } -Policy $p
Check ($u5.State.issues[0].status -eq 'approved-by-hand') 'Ve added approved by hand during the window -> approved-by-hand'
$u6 = Update-ViaPolicyState -State $st1 -Entries @() -Policy $p
Check ($u6.State.issues[0].status -eq 'gone') 'a waiting issue that left the candidates (closed, ...) -> gone'
$u7 = Update-ViaPolicyState -State $st1 -Entries @() -Policy $off -PolicyEnabled $false
Check ($u7.State.issues[0].status -eq 'off' -and -not $u7.State.policy.enabled) 'Ve switched the policy off -> waiting records become off'
$e8 = @([pscustomobject]@{ issue = 248; title = 'Binders'; spec = $false; status = 'ineligible'; noticedAt = ''; dueAt = ''; commentId = 0; reasons = @('has label loop:failed') })
$st4 = Get-ViaPolicyState -Exists $true -Text ((Update-ViaPolicyState -State $st2 -Entries @() -Outcomes @{ 248 = 'failed' } -Policy $p).State | ConvertTo-Json -Depth 6)
Check ((Update-ViaPolicyState -State $st4 -Entries $e8 -Policy $p).State.issues[0].status -eq 'failed') 'a failed via-policy build stays failed (not ineligible) in the state'
$held = @([pscustomobject]@{ issue = 248; title = 'Binders'; spec = $false; status = 'held'; noticedAt = '2026-11-23T12:00:00Z'; dueAt = '2026-11-23T18:00:00Z'; commentId = 777; reasons = @('vekbui96 put it on hold') })
$u9 = Update-ViaPolicyState -State $st1 -Entries $held -Policy $p
Check ($u9.State.issues[0].status -eq 'held' -and $u9.Events[0].status -eq 'held') 'a hold is recorded and logged'
$line = Format-ViaPolicyLine -Entries @($e1[0], ([pscustomobject]@{ issue = 249; status = 'waiting'; dueAt = '2026-11-24T01:00:00Z' }))
Check ($line -match "approved via Ve's standing policy: #248" -and $line -match '#249 \(auto-approves') "summary line (got: $line)"

# ---- the drain: a veto window that ends starts a run ---------------------------------------------------------
$now = [datetime]'2026-11-23T19:00:00'
function Dr { param([int[]]$B = @(), [string]$Due = '', [int]$Ago = 60, [bool]$Ve = $false)
    $o = New-DrainState -RunId '20261123-150000' -EndedAt $now.AddMinutes(-$Ago) -Buildable $B -PolicyDueAt $Due -NeedsVe $Ve
    return ([pscustomobject]$o | ConvertTo-Json -Depth 5 | ConvertFrom-Json) }
$past = $now.ToUniversalTime().AddMinutes(-5).ToString('o'); $future = $now.ToUniversalTime().AddHours(2).ToString('o')
$dd = Get-DrainDecision -Drain (Dr -Due $past) -Now $now -Repo 'r'
Check ($dd.Start -and $dd.Reason -match 'via-policy veto window ended') "nothing buildable, a veto window ended -> start ($($dd.Reason))"
$dd = Get-DrainDecision -Drain (Dr -Due $future) -Now $now -Repo 'r'
Check (-not $dd.Start -and $dd.Reason -match 'next via-policy veto window ends') "window still running -> no, says when ($($dd.Reason))"
Check (-not (Get-DrainDecision -Drain (Dr) -Now $now).Start) 'no window at all -> no'
Check (-not (Get-DrainDecision -Drain (Dr -Due $past) -Now $now -Verdict 'hold').Start) 'a window ended but plan budget hold -> no'
Check (-not (Get-DrainDecision -Drain (Dr -Due $past -Ve $true) -Now $now).Start) 'a window ended but needs Ve -> no'
Check (-not (Get-DrainDecision -Drain (Dr -Due $past) -Now $now -Running $true).Start) 'a window ended but a run holds the lock -> no'
Check (-not (Get-DrainDecision -Drain (Dr -Due $past) -Now $now -Repo 'r' -Done @('drain:r:20261123-150000')).Start) 'one drain run per finished run, windows included'
Check ((Get-DrainDecision -Drain (Dr -Due $past) -Now $now -Verdict 'no-opus').Start) 'no-opus does not stop the re-check'
Check ((Get-DrainDecision -Drain (Dr -B @(5) -Due $future) -Now $now).Start) 'buildable work drains as before, whatever the window'
$legacy = [pscustomobject]@{ schema = 1; runId = 'x'; endedAt = $now.AddHours(-1).ToString('o'); buildable = @() }
Check (-not (Get-DrainDecision -Drain $legacy -Now $now).Start) 'an older drain.json without policyDueAt -> no'

# ---- slots: an issue due via policy is build queue, not review ------------------------------------------------
$sl = Get-ProposalSlots -Issues @((PIss -N 1), (PIss -N 2)) -ApprovedViaSpec @(1)
Check (($sl.AwaitingReview -join ',') -eq '2') 'a due via-policy issue holds no slot; a waiting one still does'

# ---- a spec approved via policy: each slice must itself be covered -------------------------------------------
$vsSpec = PIss -N 243 -L 'loop:proposal', 'loop:spec' -Body $spec -Title 'Spec: skeletons' -Created '2026-11-23T08:00:00Z'
$chk = [pscustomobject]@{ buildable = $true; approvedAt = '2026-11-23T14:00:00Z'; reasons = @(); approval = 'via-policy' }
function SlIss { param([string]$Deploys = 'Pages only.') [pscustomobject]@{ number = 250; title = 'Skeleton primitive'; state = 'open'; createdAt = '2026-11-23T15:00:00Z'; author = [pscustomobject]@{ login = $owner }
        labels = @([pscustomobject]@{ name = 'loop:proposal' }); body = "$mk`nPart of #243 (slice 1 of 2)`n## What`nx`n## What deploys`n$Deploys`n## Scope`nIn scope for the loop.`n" } }
$all = @($vsSpec, (SlIss))
$v1 = Get-ViaSpecDecision -Slice (SlIss) -Spec $vsSpec -SpecCheck $chk -Issues $all -Owner $owner -Marker $mk -PolicyScope $true
Check ($v1.Eligible) "a Pages-only slice of a spec approved via policy -> auto-approved ($($v1.Reasons -join ' | '))"
$bad = SlIss -Deploys 'Pages + server (files: server/x.ts).'
$v2 = Get-ViaSpecDecision -Slice $bad -Spec $vsSpec -SpecCheck $chk -Issues @($vsSpec, $bad) -Owner $owner -Marker $mk -PolicyScope $true
Check (-not $v2.Eligible -and ($v2.Reasons -join ' ') -match "approved via Ve's policy") 'a server slice of a spec approved via policy -> not auto-approved (Ve approves it by hand)'
$v3 = Get-ViaSpecDecision -Slice $bad -Spec $vsSpec -SpecCheck $chk -Issues @($vsSpec, $bad) -Owner $owner -Marker $mk
Check ($v3.Eligible) 'the same slice of a spec Ve approved by label follows the old via-spec rule'

# ---- the progress comment names the policy approval ----------------------------------------------------------
. "$PSScriptRoot\reporting.ps1"
$ps0 = New-ProgressState -Issue 248 -RunId 'r1' -Repo 'vekbui96/cardlens' -Stages @('approval', 'plan', 'done')
$ps0.approval = 'via-policy'
$pc = Format-ProgressComment -State (Update-ProgressState -State $ps0 -Stage 'approval' -Status 'ok')
Check ($pc -match "Approval: approved via Ve's standing policy") 'the progress comment says "approved via Ve''s standing policy"'
$ps1 = New-ProgressState -Issue 248 -RunId 'r1' -Repo 'vekbui96/cardlens' -Stages @('approval', 'done')
Check ((Format-ProgressComment -State $ps1) -notmatch 'Approval:') 'a label approval adds no approval line'

# ---- the watcher copy carries the via-policy drain ------------------------------------------------------------
$watchRef = 'C:\Users\Ve Bui\.claude\skills\loop-install\assets\watch-approvals.reference.ps1'
if (Test-Path -LiteralPath $watchRef) { Check ([IO.File]::ReadAllText($watchRef) -match 'policyDueAt') 'the approval watcher reference knows policyDueAt (test-queue-rules.ps1 checks the literal copy)' }

if ($script:fail -gt 0) { Write-Host "TEST-VIA-POLICY FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-VIA-POLICY PASS ($script:pass checks)"
exit 0

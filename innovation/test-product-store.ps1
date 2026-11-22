<#
.SYNOPSIS
  Unit tests for product-store.ps1 (Phase 1 of the product intelligence layer): the deterministic decision
  collector (gh stubbed: no network), cursors, the preferences validation that guards `confirmed`, Ve's
  confirm/no replies, the memory agent's trigger and output parsing. Writes only to a temp folder.
  powershell -ExecutionPolicy Bypass -File innovation\test-product-store.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
. "$PSScriptRoot\product-store.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$mk = '<!-- innovation-loop -->'
$O = 'vekbui96'
function U { param([string]$L) [pscustomobject]@{ login = $L } }
function Lb { param([string[]]$N) @($N | ForEach-Object { [pscustomobject]@{ name = $_ } }) }
function Ev { param([long]$Id, [string]$E, [string]$Label = '', [int]$N = 12, [string[]]$L = @('loop:proposal'), [string]$By = $O, [string]$Body = "$mk`nx", [string]$At = '2026-11-22T10:00:00Z', [string]$Reason = '', [string]$Author = $O)
    [pscustomobject]@{ id = $Id; event = $E; label = $(if ($Label) { [pscustomobject]@{ name = $Label } } else { $null }); actor = (U $By); created_at = $At; state_reason = $Reason
        issue = [pscustomobject]@{ number = $N; title = "Issue $N"; labels = (Lb $L); body = $Body; html_url = "https://github.com/vekbui96/cardlens/issues/$N"; user = (U $Author) } } }
function Cm { param([long]$Id, [string]$Body, [int]$N = 12, [string]$By = $O, [string]$At = '2026-11-22T11:00:00Z', [string]$Repo = 'vekbui96/cardlens')
    [pscustomobject]@{ id = $Id; body = $Body; user = (U $By); created_at = $At; updated_at = $At; issue_url = "https://api.github.com/repos/$Repo/issues/$N"; html_url = "https://github.com/$Repo/issues/$N#issuecomment-$Id" } }

# ---- events -> decisions ---------------------------------------------------------------------------------------
$evs = @((Ev 101 'labeled' 'approved'), (Ev 102 'unlabeled' 'approved'), (Ev 103 'labeled' 'approved' -By 'stranger'), (Ev 104 'labeled' 'loop:in-progress'),
    (Ev 105 'closed' -N 13), (Ev 106 'closed' -N 14 -L 'loop:proposal', 'loop:deployed'), (Ev 107 'closed' -N 15 -L 'loop:proposal', 'loop:spec'),
    (Ev 108 'closed' -N 16 -L 'loop:proposal', 'loop:spec' -Reason 'not_planned'), (Ev 109 'labeled' 'loop:request' -N 20 -L 'loop:request' -Body "### What I want`n`nShow the build SHA`n`n### Mode`n`nBuild it"),
    (Ev 110 'labeled' 'loop:request' -N 21 -L 'loop:request' -Body "$mk`nforged"), (Ev 111 'labeled' 'loop:request' -N 22 -L 'loop:request' -Author 'stranger' -Body 'x'), (Ev 99 'labeled' 'approved' -N 30))
$ds = @(ConvertFrom-IssueEvents -Events $evs -Owner $O -Marker $mk -AfterId 100)
$kinds = (@($ds | ForEach-Object { "$($_.kind)#$($_.issue)" }) -join ',')
Check ($kinds -eq 'approve#12,unapprove#12,reject#13,reject#16,request#20') "events: approve, unapprove, reject (not deployed, not a completed spec), request by Ve only; cursor respected (got $kinds)"
$rq = @($ds | Where-Object { $_.kind -eq 'request' })[0]
Check ($rq.gist -eq 'Issue 20 | Show the build SHA' -and $rq.link -like '*issues/20' -and $rq.ts -eq '2026-11-22T10:00:00Z' -and $rq.id -match '^d-[0-9a-f]{10}$') "record shape: id, ts, gist = title + first line, link ($($rq | ConvertTo-Json -Compress))"
Check ((@(ConvertFrom-IssueEvents -Events $evs -Owner $O -Marker $mk -AfterId 100) | ForEach-Object { $_.id }) -join ',' -eq (@($ds | ForEach-Object { $_.id }) -join ',')) 'deterministic ids (idempotent)'

# ---- comments -> decisions -------------------------------------------------------------------------------------
$cms = @((Cm 1 'Please make the badge bigger.' -At '2026-11-22T10:01:00Z'), (Cm 2 '/hold until the sale ends' -N 13 -At '2026-11-22T10:02:00Z'), (Cm 3 "$mk`nloop progress" -At '2026-11-22T10:03:00Z'), (Cm 4 'drive-by' -By 'stranger' -At '2026-11-22T10:04:00Z'),
    (Cm 5 "confirm p-abc123`nno p-def456" -N 40 -At '2026-11-22T10:05:00Z'), (Cm 6 "<!-- a note -->`n## Heading`nFirst real line" -At '2026-11-22T11:00:00Z'))
$cd = @(ConvertFrom-IssueComments -Comments $cms -Owner $O -Marker $mk -Titles @{ 12 = 'Bigger badge' } -LabelsOf @{ 12 = @('loop:proposal') })
$ck = (@($cd | ForEach-Object { "$($_.kind)#$($_.issue)" }) -join ',')
Check ($ck -eq 'comment#12,hold#13,preference-reply#40,preference-reply#40,comment#12') "comments: Ve's only, no loop comments, hold, preference replies (got $ck)"
Check ($cd[0].gist -eq 'Bigger badge | Please make the badge bigger.' -and @($cd[0].labels) -contains 'loop:proposal') 'comment gist = issue title + first line'
$pr = @($cd | Where-Object { $_.kind -eq 'preference-reply' })
Check ($pr[0].pref -eq 'p-abc123' -and $pr[0].verdict -eq 'confirm' -and $pr[1].pref -eq 'p-def456' -and $pr[1].verdict -eq 'no') 'confirm / no replies parsed'
Check ($cd[-1].gist -eq 'Bigger badge | Heading') "first line skips HTML comments and drops heading hashes ($($cd[-1].gist))"
$dg = @(ConvertFrom-IssueComments -Comments @((Cm 7 'Looks fine overall' -Repo 'vekbui96/ops-hub'), (Cm 8 'yes p-abc123' -Repo 'vekbui96/ops-hub')) -Owner $O -Marker $mk -PrefRepliesOnly -Source 'hub#')
Check ($dg.Count -eq 1 -and $dg[0].verdict -eq 'confirm') 'digest issues: only preference replies are recorded ("yes" = confirm)'

# ---- edits after approval ---------------------------------------------------------------------------------------
$tl = { param([string]$At, [string]$By = $O) [pscustomobject]@{ createdAt = $At; label = [pscustomobject]@{ name = 'approved' }; actor = (U $By) } }
$ed = @(ConvertFrom-EditedIssues -Owner $O -Issues @(
        [pscustomobject]@{ number = 50; title = 'A'; url = 'u50'; lastEditedAt = '2026-11-22T12:00:00Z'; labels = [pscustomobject]@{ nodes = (Lb 'approved') }; timelineItems = [pscustomobject]@{ nodes = @((& $tl '2026-11-22T11:00:00Z')) } },
        [pscustomobject]@{ number = 51; title = 'B'; url = 'u51'; lastEditedAt = '2026-11-22T10:00:00Z'; labels = [pscustomobject]@{ nodes = (Lb 'approved') }; timelineItems = [pscustomobject]@{ nodes = @((& $tl '2026-11-22T11:00:00Z')) } },
        [pscustomobject]@{ number = 52; title = 'C'; url = 'u52'; lastEditedAt = $null; labels = [pscustomobject]@{ nodes = @() }; timelineItems = [pscustomobject]@{ nodes = @() } }))
Check ($ed.Count -eq 1 -and $ed[0].issue -eq 50 -and $ed[0].kind -eq 'edit-after-approval') 'edited after approval -> one record; edited before -> none'

# ---- dedupe, cursors, staleness ---------------------------------------------------------------------------------
$nd = @(Select-NewDecisions -Candidates @($ds + $ds) -ExistingIds @($ds[0].id))
Check ($nd.Count -eq ($ds.Count - 1)) 'duplicates and already recorded ids dropped'
$c0 = ConvertTo-ProductCursors $null
Check ($c0.schema -eq 1 -and $c0.lastEventId -eq 0 -and $c0.Contains('lastObservedCommit') -and $c0.research.Contains('expiresUtc') -and $c0.memory.Contains('lastDecisionId')) 'cursor defaults (schema 1, Phase 2/4 fields present)'
Check ((ConvertTo-ProductCursors ([pscustomobject]@{ schema = 2; lastEventId = 5 })).lastEventId -eq 0) 'another schema -> defaults'
$now = [datetime]'2026-11-22T12:00:00Z'
Check (Test-CollectorDue -Cursors $c0 -NowUtc $now) 'never collected -> due'
Check (-not (Test-CollectorDue -Cursors ([pscustomobject]@{ lastCollectedUtc = '2026-11-22T11:55:00Z' }) -MinMinutes 10 -NowUtc $now.ToUniversalTime())) 'collected 5 min ago -> not due (10 min)'
Check (Test-CollectorDue -Cursors ([pscustomobject]@{ lastCollectedUtc = '2026-11-22T11:40:00Z' }) -MinMinutes 10 -NowUtc $now.ToUniversalTime()) 'collected 20 min ago -> due'

# ---- the collector, end to end against a stubbed gh, in a temp store ----------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ps-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$paths = Get-ProductStorePaths -Dir $tmp
$script:calls = @()
$stub = { param([string[]]$A)
    $script:calls += ($A -join ' ')
    $j = $A -join ' '
    if ($j -like 'api repos/vekbui96/cardlens/issues/events*') { if ($j -like '*page=1') { return @($evs) } else { return @() } }
    if ($j -like 'api repos/vekbui96/cardlens/issues/comments*') { return @($cms) }
    if ($j -like 'issue list -R vekbui96/cardlens*') { return @([pscustomobject]@{ number = 12; title = 'Bigger badge'; labels = (Lb 'loop:proposal') }) }
    if ($j -like 'api graphql*') { return [pscustomobject]@{ data = [pscustomobject]@{ repository = [pscustomobject]@{ issues = [pscustomobject]@{ nodes = @() } } } } }
    if ($j -like 'issue list -R vekbui96/ops-hub*') { return @([pscustomobject]@{ number = 7; title = 'Digest 2026-11-22' }) }
    if ($j -like 'api repos/vekbui96/ops-hub/issues/comments*') { return @((Cm 9 'confirm p-abc123' -N 7 -Repo 'vekbui96/ops-hub'), (Cm 10 'confirm p-zzz999' -N 8 -Repo 'vekbui96/ops-hub')) }
    throw "unexpected gh call: $j" }
try {
    $r = Invoke-DecisionCollector -Paths $paths -Owner $O -Marker $mk -GhJson $stub -NowUtc $now
    $all = @(Read-Decisions $paths)
    Check ($r.Ran -and @($r.Errors).Count -eq 0 -and $all.Count -eq $r.New.Count -and $all.Count -ge 10) "first pass records decisions ($($r.Reason); errors: $(@($r.Errors) -join ';'))"
    Check (@($all | Where-Object { $_.kind -eq 'preference-reply' -and $_.pref -eq 'p-abc123' }).Count -eq 2 -and @($all | Where-Object { $_.pref -eq 'p-zzz999' }).Count -eq 0) 'digest replies only from digest issues'
    $cur = Read-ProductCursors $paths
    Check ($cur.lastEventId -eq 111 -and $cur.lastCollectedUtc -eq '2026-11-22T12:00:00Z' -and $cur.commentsSince -eq '2026-11-22T11:00:00Z') "cursor moved on (lastEventId $($cur.lastEventId), since $($cur.commentsSince))"
    $n1 = $script:calls.Count
    $r2 = Invoke-DecisionCollector -Paths $paths -Owner $O -Marker $mk -GhJson $stub -NowUtc $now.AddMinutes(3)
    Check (-not $r2.Ran -and $script:calls.Count -eq $n1) 'a fresh cursor asks GitHub nothing'
    $r3 = Invoke-DecisionCollector -Paths $paths -Owner $O -Marker $mk -GhJson $stub -NowUtc $now.AddMinutes(30)
    Check ($r3.Ran -and @($r3.Errors).Count -eq 0 -and $r3.Reason -notmatch 'failed' -and $r3.New.Count -eq 0 -and @(Read-Decisions $paths).Count -eq $all.Count -and (Read-ProductCursors $paths).lastCollectedUtc -eq '2026-11-22T12:30:00Z') "a second pass over the same data adds nothing (idempotent: $($r3.Reason))"
    $bad = Invoke-DecisionCollector -Paths $paths -Owner $O -Marker $mk -GhJson { param($A) throw 'gh down' } -Force -NowUtc $now.AddMinutes(60)
    Check ($bad.Reason -match 'collector failed' -and @(Read-Decisions $paths).Count -eq $all.Count) 'gh failing: logged, nothing written, never throws'
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

# saving over existing files works (atomic replace)
$tmp2 = Join-Path ([IO.Path]::GetTempPath()) ("ps-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try { $p2 = Get-ProductStorePaths -Dir $tmp2; Save-Preferences $p2 (New-Preferences); $np = New-Preferences; $np.updatedUtc = 'x'; Save-Preferences $p2 $np
    Check ((Read-Preferences $p2).updatedUtc -eq 'x' -and -not (Test-Path "$($p2.Preferences).tmp")) 'preferences saved over an existing file (atomic replace, no temp left)' } finally { Remove-Item -LiteralPath $tmp2 -Recurse -Force -ErrorAction SilentlyContinue }

# ---- preferences: validation of the memory agent's changes --------------------------------------------------------
$dec = @{}
foreach ($d in @(
        [pscustomobject]@{ id = 'd-aaaaaaaaaa'; kind = 'approve' }, [pscustomobject]@{ id = 'd-bbbbbbbbbb'; kind = 'reject' },
        [pscustomobject]@{ id = 'd-cccccccccc'; kind = 'comment' }, [pscustomobject]@{ id = 'd-dddddddddd'; kind = 'request' })) { $dec[$d.id] = $d }
$files = @{ 'FOCUS.md' = @('# Focus', '', 'Prefer collection value features over scanner work.', '<!-- note -->'); 'PRODUCT.md' = @('# Product', 'Phone first.') }
$prefs = ConvertTo-Preferences ([pscustomobject]@{ schema = 1; items = @(
            [pscustomobject]@{ id = 'p-111111'; statement = 'Ve prefers phone layouts over desktop ones'; status = 'inferred'; evidence = @('d-aaaaaaaaaa'); confidence = 0.5 },
            [pscustomobject]@{ id = 'p-222222'; statement = 'Ve wants collection value front and centre'; status = 'confirmed'; evidence = @('FOCUS.md:3'); confidence = 0.9 })
        rejected = @([pscustomobject]@{ id = 'p-333333'; statement = 'Ve likes animations' }) })
function Ch { param($Obj) $Obj | ConvertTo-Json -Depth 4 | ConvertFrom-Json }
function V { param([object[]]$C) Test-PreferenceChanges -Changes @($C | ForEach-Object { Ch $_ }) -Prefs $prefs -DecisionsById $dec -FileLines $files }
$v = V @(@{ op = 'add'; statement = 'Ve rejects proposals that add new settings toggles'; status = 'inferred'; confidence = 0.6; evidence = @('d-bbbbbbbbbb') })
Check ($v.Accepted.Count -eq 1 -and $v.Accepted[0].Id -match '^p-[0-9a-f]{6}$' -and $v.Accepted[0].Status -eq 'inferred') 'an inferred add with a valid decision id is accepted (id assigned by the runner)'
# the confirmed guard
$v = V @(@{ op = 'add'; statement = 'Ve rejects proposals that add new settings toggles'; status = 'confirmed'; evidence = @('d-bbbbbbbbbb', 'd-aaaaaaaaaa') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'confirmed needs evidence Ve wrote') "confirmed from approvals/rejections only -> refused ($($v.Refused[0].Why))"
$v = V @(@{ op = 'add'; statement = 'Ve wants value features before scanner work'; status = 'confirmed'; evidence = @('FOCUS.md:3') })
Check ($v.Accepted.Count -eq 1 -and $v.Accepted[0].Status -eq 'confirmed') 'confirmed with a FOCUS.md line -> accepted'
$v = V @(@{ op = 'add'; statement = 'Ve wants bigger badges on cards'; status = 'confirmed'; evidence = @('d-cccccccccc') })
Check ($v.Accepted.Count -eq 1) 'confirmed with Ve''s own comment -> accepted'
$v = V @(@{ op = 'add'; statement = 'Ve wants bigger badges on cards'; status = 'confirmed'; evidence = @('FOCUS.md:2') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'blank') 'a blank FOCUS.md line is no evidence'
$v = V @(@{ op = 'add'; statement = 'Ve wants bigger badges on cards'; status = 'confirmed'; evidence = @('FOCUS.md:4') })
Check ($v.Accepted.Count -eq 0) 'an HTML comment line is no evidence'
$v = V @(@{ op = 'add'; statement = 'Ve wants bigger badges on cards'; status = 'confirmed'; evidence = @('FOCUS.md:99') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'outside') 'a line outside the file is no evidence'
$v = V @(@{ op = 'update'; id = 'p-111111'; status = 'confirmed'; evidence = @('d-aaaaaaaaaa') })
Check ($v.Accepted.Count -eq 0) 'upgrading an inferred item to confirmed without Ve-written evidence -> refused'
$v = V @(@{ op = 'update'; id = 'p-111111'; status = 'confirmed'; evidence = @('PRODUCT.md:2') })
Check ($v.Accepted.Count -eq 1 -and $v.Accepted[0].Status -eq 'confirmed') 'upgrading with a PRODUCT.md line -> accepted'
$v = V @(@{ op = 'update'; id = 'p-222222'; status = 'inferred' })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'cannot downgrade') 'the agent cannot downgrade a confirmed item'
$v = V @(@{ op = 'remove'; id = 'p-222222' })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'only Ve removes') 'the agent cannot remove a confirmed item'
$v = V @(@{ op = 'remove'; id = 'p-111111' })
Check ($v.Accepted.Count -eq 1) 'the agent may remove an inferred item'
# shape
$v = V @(@{ op = 'add'; statement = 'Ve likes animations'; status = 'inferred'; evidence = @('d-aaaaaaaaaa') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'rejected') 'a statement Ve rejected is never re-added'
$v = V @(@{ op = 'add'; statement = 've prefers PHONE layouts over desktop ones!'; status = 'inferred'; evidence = @('d-aaaaaaaaaa') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'repeats') 'a near-identical statement is refused (update instead)'
$v = V @(@{ op = 'add'; statement = 'Ve likes it'; status = 'inferred'; evidence = @('d-0123456789') })
Check ($v.Accepted.Count -eq 0 -and $v.Refused[0].Why -match 'unknown decision') 'unknown evidence id refused'
$v = V @(@{ op = 'add'; statement = "two`nlines here ok"; status = 'inferred'; evidence = @('d-aaaaaaaaaa') }, @{ op = 'add'; statement = 'mentions @someone in it'; status = 'inferred'; evidence = @('d-aaaaaaaaaa') },
    @{ op = 'add'; statement = 'short'; status = 'inferred'; evidence = @('d-aaaaaaaaaa') }, @{ op = 'add'; statement = 'a fine statement here'; status = 'maybe'; evidence = @('d-aaaaaaaaaa') },
    @{ op = 'add'; statement = 'a fine statement here'; status = 'inferred'; confidence = 3; evidence = @('d-aaaaaaaaaa') }, @{ op = 'add'; statement = 'a fine statement here'; status = 'inferred'; evidence = @() },
    @{ op = 'drop'; id = 'p-111111' }, @{ op = 'update'; id = 'p-999999'; statement = 'xxxxxxxxxx' }, @{ nothing = 1 })
Check ($v.Accepted.Count -eq 0 -and $v.Refused.Count -eq 9) "multi-line, mention, too short, bad status, bad confidence, no evidence, unknown op, unknown id, no op: all refused ($(@($v.Refused | ForEach-Object { $_.Why }) -join ' | '))"
$many = @(1..12 | ForEach-Object { @{ op = 'add'; statement = "Ve prefers option number $_ always"; status = 'inferred'; evidence = @('d-aaaaaaaaaa') } })
$v = V $many
Check ($v.Accepted.Count -eq 10 -and $v.Refused.Count -eq 2) 'at most 10 changes per pass'
# merge
$m = Merge-PreferenceChanges -Prefs $prefs -Accepted @((V @(@{ op = 'add'; statement = 'Ve rejects proposals that add new settings toggles'; status = 'inferred'; confidence = 0.6; evidence = @('d-bbbbbbbbbb') })).Accepted + (V @(@{ op = 'remove'; id = 'p-111111' })).Accepted) -Now '2026-11-22T12:00:00Z'
Check (@($m.items).Count -eq 2 -and @($m.items | Where-Object { $_.id -eq 'p-111111' }).Count -eq 0 -and @($m.items | Where-Object { $_.firstSeen -eq '2026-11-22T12:00:00Z' }).Count -eq 1 -and $m.updatedUtc -eq '2026-11-22T12:00:00Z') 'merge: add and remove applied, stamped'

# ---- Ve's replies -------------------------------------------------------------------------------------------------
$u = Use-PreferenceReplies -Prefs $prefs -Decisions @([pscustomobject]@{ id = 'd-eeeeeeeeee'; kind = 'preference-reply'; pref = 'p-111111'; verdict = 'confirm'; ts = '2026-11-22T12:00:00Z' },
    [pscustomobject]@{ id = 'd-ffffffffff'; kind = 'preference-reply'; pref = 'p-424242'; verdict = 'confirm'; ts = '2026-11-22T12:00:00Z' })
$it = @($u.Prefs.items | Where-Object { $_.id -eq 'p-111111' })[0]
Check ($it.status -eq 'confirmed' -and @($it.evidence) -contains 'd-eeeeeeeeee' -and $u.Applied.Count -eq 1) 'confirm p-xxxxxx -> confirmed with the reply as evidence; unknown ids ignored'
$u2 = Use-PreferenceReplies -Prefs $u.Prefs -Decisions @([pscustomobject]@{ id = 'd-eeeeeeeeee'; kind = 'preference-reply'; pref = 'p-111111'; verdict = 'confirm'; ts = '2026-11-22T12:00:00Z' })
Check ($u2.Applied.Count -eq 0) 'the same reply twice changes nothing (idempotent)'
$u3 = Use-PreferenceReplies -Prefs $prefs -Decisions @([pscustomobject]@{ id = 'd-gggggggggg'; kind = 'preference-reply'; pref = 'p-222222'; verdict = 'no'; ts = '2026-11-22T12:00:00Z' })
Check (@($u3.Prefs.items | Where-Object { $_.id -eq 'p-222222' }).Count -eq 0 -and @($u3.Prefs.rejected | Where-Object { $_.id -eq 'p-222222' -and $_.by -eq 'd-gggggggggg' }).Count -eq 1) 'no p-xxxxxx -> removed (even a confirmed one) and remembered as rejected'

# ---- prompt block, memory trigger and output ------------------------------------------------------------------------
$big = ConvertTo-Preferences ([pscustomobject]@{ schema = 1; items = @(1..60 | ForEach-Object { [pscustomobject]@{ id = ('p-{0:x6}' -f $_); statement = ('Ve has a fairly long preference statement number {0} that takes up room in the prompt block' -f $_); status = 'inferred'; evidence = @('d-aaaaaaaaaa'); confidence = ($_ / 100) } }) })
$fp = Format-PreferencesForPrompt $big
Check ((($fp.Items -join "`n").Length) -le 8100 -and $fp.Items[-1] -match 'more not shown' -and $fp.Items[0] -match 'p-00003c') "prompt block capped near 2k tokens, highest confidence first ($(($fp.Items -join "`n").Length) chars)"
Check ((Format-PreferencesForPrompt (New-Preferences)).Items[0] -match 'none') 'empty preferences -> (none yet)'
$dl = @(1..6 | ForEach-Object { [pscustomobject]@{ id = "d-00000000$('{0:00}' -f $_)" } })
Check (@(Select-DecisionsAfter -Decisions $dl -AfterId 'd-0000000004').Count -eq 2 -and @(Select-DecisionsAfter -Decisions $dl -AfterId '').Count -eq 6 -and @(Select-DecisionsAfter -Decisions $dl -AfterId 'd-0000000006').Count -eq 0 -and @(Select-DecisionsAfter -Decisions $dl -AfterId 'gone').Count -eq 6) 'decisions after the memory cursor'
$curM = [pscustomobject]@{ memory = [pscustomobject]@{ lastRunUtc = '2026-11-20T12:00:00Z' } }
Check ((Get-MemoryDecision -Cursors $curM -NewCount 5 -NowUtc $now).Run) '5 new decisions -> run'
Check (-not (Get-MemoryDecision -Cursors $curM -NewCount 4 -NowUtc $now).Run) '4 new decisions, last pass 2 days ago -> wait'
Check ((Get-MemoryDecision -Cursors ([pscustomobject]@{ memory = [pscustomobject]@{ lastRunUtc = '2026-11-14T12:00:00Z' } }) -NewCount 1 -NowUtc $now).Run) 'weekly pass due with 1 new decision -> run'
Check (-not (Get-MemoryDecision -Cursors ([pscustomobject]@{ memory = [pscustomobject]@{ lastRunUtc = '2026-11-01T12:00:00Z' } }) -NewCount 0 -NowUtc $now).Run) 'nothing new -> no pass, even weekly'
$o = ConvertFrom-MemoryOutput "Here you go:`n``````json`n{""changes"":[{""op"":""remove"",""id"":""p-111111""}]}`n``````"
Check ($o.Error -eq '' -and $o.Changes.Count -eq 1 -and $o.Changes[0].op -eq 'remove') 'output in a json fence parsed'
Check ((ConvertFrom-MemoryOutput 'no idea').Error -ne '' -and (ConvertFrom-MemoryOutput '{"foo":1}').Error -match 'changes') 'non-JSON or no changes array -> dropped with a reason'
$mp = Format-MemoryPrompt -Decisions @([pscustomobject]@{ id = 'd-aaaaaaaaaa'; ts = 't'; kind = 'approve'; issue = 12; gist = 'Bigger badge <!-- innovation-loop --> @x' }) -Prefs $prefs -FocusLines $files['FOCUS.md'] -ProductLines $files['PRODUCT.md']
Check ($mp -match 'NO tools' -and $mp -match 'FOCUS.md:3: Prefer collection value' -and $mp -notmatch 'FOCUS.md:2:' -and $mp -notmatch '<!-- innovation-loop -->' -and $mp -match 'p-333333') 'memory prompt: rules, numbered Ve lines, rejected list, gists made safe'

if ($script:fail -gt 0) { Write-Host "TEST-PRODUCT-STORE FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-PRODUCT-STORE PASS ($script:pass checks)"
exit 0

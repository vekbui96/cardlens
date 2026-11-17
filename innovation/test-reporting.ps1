<#
.SYNOPSIS
  Unit tests for reporting.ps1 (run data + progress rendering). Posts nothing, needs no network.

.DESCRIPTION
  Without -Transcript it builds a small synthetic stream-json transcript. With -Transcript <run-*.jsonl>
  (copy one from the loop's logs dir to a scratch dir first; never point it at a live run's file) it also
  runs every case against that real transcript: as-is (no markers), with a constructed multi-issue split
  (START/END markers inserted into the session's own text), with an unclosed issue, and as a killed run
  (result message removed). Every case checks that the per-issue parts plus the overhead add up to the
  run totals. -ShowSamples prints the rendered comments.

  powershell -ExecutionPolicy Bypass -File innovation\test-reporting.ps1 [-Transcript <copy.jsonl>] [-ShowSamples]
#>
[CmdletBinding()]
param([string]$Transcript = '', [switch]$ShowSamples)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\reporting.ps1"
function Write-Log { param([string]$Message, [string]$Level = 'INFO') if ($Level -ne 'INFO') { Write-Host "  [$Level] $Message" } }
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("loop-reporting-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Test-Sums {
    param($D, [string]$Name)
    $t = $D.Totals; $o = $D.Overhead
    foreach ($f in 'Input', 'CacheRead', 'CacheWrite', 'Turns') {
        $s = $o.$f; foreach ($p in $D.Parts) { $s += $p.$f }
        Check ($s -eq $t.$f) "$Name : parts + overhead $f = $s, total $($t.$f)"
    }
    if ($D.HasResult) {
        $s = $o.Output; $c = $o.Cost; foreach ($p in $D.Parts) { $s += $p.Output; $c += $p.Cost }
        Check ($s -eq $t.Output) "$Name : parts + overhead Output = $s, total $($t.Output)"
        Check ([math]::Abs($c - $t.Cost) -lt 0.0001) "$Name : parts + overhead Cost = $c, total $($t.Cost)"
        foreach ($p in $D.Parts) { Check ($p.Output -ge 0 -and $p.Cost -ge 0) "$Name : #$($p.Issue) output/cost not negative" }
    }
}

# ---- synthetic transcript ----------------------------------------------------------------------
function New-Line { param([hashtable]$H) return ($H | ConvertTo-Json -Depth 20 -Compress) }
$ts0 = [DateTime]::Parse('2026-11-16T22:00:00Z').ToUniversalTime()
$n = 0
function Msg { param([string]$Id, [string]$Text, [int]$Sec, [int]$In = 2, [int]$Cr = 1000, [int]$Cw = 100, [string]$Tool = '', [string]$ToolId = '')
    $content = @()
    if ($Text) { $content += @{ type = 'text'; text = $Text } }
    if ($Tool) { $content += @{ type = 'tool_use'; id = $ToolId; name = 'PowerShell'; input = @{ command = $Tool } } }
    $u = @{ input_tokens = $In; cache_read_input_tokens = $Cr; cache_creation_input_tokens = $Cw; output_tokens = 5; cache_creation = @{ ephemeral_5m_input_tokens = 0; ephemeral_1h_input_tokens = $Cw } }
    return New-Line @{ type = 'assistant'; message = @{ model = 'claude-test-1'; id = $Id; content = $content; usage = $u }; parent_tool_use_id = $null; timestamp = $ts0.AddSeconds($Sec).ToString('o') }
}
function Res { param([string]$ToolId, [string]$Text, [int]$Sec)
    return New-Line @{ type = 'user'; message = @{ role = 'user'; content = @(@{ tool_use_id = $ToolId; type = 'tool_result'; content = $Text }) }; parent_tool_use_id = $null; timestamp = $ts0.AddSeconds($Sec).ToString('o') }
}
$lines = @(
    (New-Line @{ type = 'system'; subtype = 'init'; model = 'claude-test-1' }),
    (Msg 'm1' 'Preflight.' 0 -Tool 'gh issue list -R o/r' -ToolId 't1'), (Res 't1' '[]' 5),
    (Msg 'm2' "Taking #4.`nLOOP-ISSUE-START 4" 10 -Tool 'C:\s\check-approval.ps1 -Issue 4' -ToolId 't2'), (Res 't2' 'ok' 20),
    (New-Line @{ type = 'system'; subtype = 'thinking_tokens'; estimated_tokens_delta = 400 }),
    (Msg 'm3' '' 30 -Tool 'gh issue comment 4 -R o/r --body-file C:\w\b.md' -ToolId 't3'), (Res 't3' 'https://github.com/o/r/issues/4#issuecomment-1' 40),
    (Msg 'm4' "Deployed.`nLOOP-ISSUE-END 4 deployed`nLOOP-ISSUE-START 5" 600 -Tool 'gh issue edit 5 -R o/r --add-label loop:in-progress' -ToolId 't4'), (Res 't4' 'ok' 610),
    (Msg 'm5' "Tests failed and main was reverted.`n**LOOP-ISSUE-END 5 rolled back**" 900 -Tool 'gh issue create -R o/r --title x --label loop:proposal --body-file C:\w\p.md' -ToolId 't5'), (Res 't5' 'https://github.com/o/r/issues/9' 905),
    (Msg 'm6' "Run summary`nLOOP-RESULT: FAILED deploy of #5 rolled back" 1000),
    (New-Line @{ type = 'result'; subtype = 'success'; is_error = $false; num_turns = 6; duration_ms = 1001000; total_cost_usd = 2.5; result = "Run summary`nLOOP-RESULT: FAILED deploy of #5 rolled back"
        usage = @{ input_tokens = 12; cache_read_input_tokens = 6000; cache_creation_input_tokens = 600; output_tokens = 9000 }
        modelUsage = @{ 'claude-test-1' = @{ outputTokens = 9000; costUSD = 2.5 } } })
)
$syn = Join-Path $tmp 'synthetic.jsonl'
[IO.File]::WriteAllLines($syn, $lines)
$d = Read-LoopTranscript -Path $syn
Check ($d.MarkersFound) 'synthetic: markers found'
Check ($d.Parts.Count -eq 2) "synthetic: two issues (got $($d.Parts.Count))"
Check ($d.Parts[0].Issue -eq 4 -and $d.Parts[0].Outcome -eq 'deployed') "synthetic: #4 deployed (got #$($d.Parts[0].Issue) $($d.Parts[0].Outcome))"
Check ($d.Parts[1].Issue -eq 5 -and $d.Parts[1].Outcome -eq 'rolled back') "synthetic: #5 rolled back (got $($d.Parts[1].Outcome))"
Check ($d.Parts[0].Turns -eq 2 -and $d.Parts[1].Turns -eq 1) "synthetic: turns 2/1 (got $($d.Parts[0].Turns)/$($d.Parts[1].Turns))"
Check ($d.Overhead.Turns -eq 3) "synthetic: overhead turns 3 (= 6 - 3) (got $($d.Overhead.Turns))"
Check ($d.Parts[0].Input -eq 6 -and $d.Overhead.Input -eq 4) "synthetic: input split m2+m3+m4 (the END message belongs to the issue) / m1+m6 (got $($d.Parts[0].Input)/$($d.Overhead.Input))"
Check (($d.Parts[0].End - $d.Parts[0].Start).TotalSeconds -eq 590) "synthetic: #4 duration 590 s (START message to END message) (got $(($d.Parts[0].End - $d.Parts[0].Start).TotalSeconds))"
Check ($d.CreatedIssues -contains 'o/r#9') "synthetic: created proposal o/r#9 detected ($($d.CreatedIssues -join ','))"
Check ($d.Status -eq 'FAILED') 'synthetic: LOOP-RESULT FAILED'
Check ($d.Parts[0].Output -gt $d.Parts[1].Output) 'synthetic: #4 (with thinking) gets more output than #5'
Test-Sums $d 'synthetic'
$c4 = Format-RunDataComment -Data $d -Issue 4 -Part $d.Parts[0] -RunId '20261116-140000' -Mode 'FULL' -Trigger 'daily schedule (14:00)'
Check ($c4.StartsWith("<!-- innovation-loop -->`r`n<!-- innovation-loop:run-data -->") -or $c4.StartsWith("<!-- innovation-loop -->`n<!-- innovation-loop:run-data -->")) 'comment starts with both markers'
Check ($c4 -match '## Run data' -and $c4 -match 'Issue #4' -and $c4 -match 'Other issues in this run: #5 rolled back') 'comment has heading, issue column, other issues'
Check ($c4 -match 'not billing') 'comment carries the cost note'

# no markers: fallback goes to touched issues, totals only
$noMark = Join-Path $tmp 'nomarkers.jsonl'
[IO.File]::WriteAllLines($noMark, @($lines | ForEach-Object { $_ -replace 'LOOP-ISSUE-(START|END)', 'LOOP-ISSUE-XX' }))
$d2 = Read-LoopTranscript -Path $noMark
Check (-not $d2.MarkersFound -and $d2.Parts.Count -eq 0) 'no markers: no parts'
Check (($d2.TouchedIssues -contains 'o/r#4') -and ($d2.TouchedIssues -contains 'o/r#5')) "no markers: touched o/r#4 and o/r#5 ($($d2.TouchedIssues -join ','))"
Check (@($d2.Notes | Where-Object { $_ -match 'no LOOP-ISSUE markers' }).Count -eq 1) 'no markers: note says so'
$c2 = Format-RunDataComment -Data $d2 -Issue 4 -Part $null -RunId 'r' -Mode 'FULL' -Trigger 'x'
Check ($c2 -match 'Whole run' -and $c2 -match 'run totals only') 'no markers: totals-only comment'
Test-Sums $d2 'no markers'
# publish dry: bodies written for touched issues + the proposal, nothing posted
$null = Publish-LoopRunData -TranscriptPath $noMark -Repo 'o/r' -GhExe 'gh-not-called' -RunId 'nm' -Mode 'FULL' -OutDir $tmp -NoPost
Check ((Test-Path (Join-Path $tmp 'run-nm.rundata-4.md')) -and (Test-Path (Join-Path $tmp 'run-nm.rundata-5.md')) -and (Test-Path (Join-Path $tmp 'run-nm.rundata-9.md'))) 'publish -NoPost wrote bodies for #4, #5 and proposal #9'
Check (Test-Path (Join-Path $tmp 'run-nm.rundata.json')) 'publish wrote the json summary'
Check (-not ([IO.File]::ReadAllText((Join-Path $tmp 'run-nm.rundata-4.md')) -match 'waiting on')) 'no -Waiting: no waiting line'

# "Failed, waiting on Ve" (failed issues no longer take a proposal slot, so every run-data comment lists them)
$wl = 'Failed, waiting on Ve: #33 (tests: tests or CI still failed after the fix rounds).'
$cw = Format-RunDataComment -Data $d -Issue 4 -Part $d.Parts[0] -RunId 'RW' -Mode 'FULL' -Trigger 'x' -Waiting $wl
Check ($cw.Contains($wl) -and $cw.IndexOf($wl) -lt $cw.IndexOf('<sub>Cost')) 'issue comment carries the waiting line above the cost note'
$cwp = Format-RunDataProposalComment -Data $d -RunId 'RW' -Mode 'FULL' -Trigger 'x' -Waiting $wl
Check ($cwp.Contains("<sub>$wl</sub>")) 'proposal footer carries the waiting line'
Check (-not (Format-RunDataProposalComment -Data $d -RunId 'RW' -Mode 'FULL' -Trigger 'x').Contains('waiting on')) 'proposal footer without -Waiting has no waiting line'
$null = Publish-LoopRunData -TranscriptPath $noMark -Repo 'o/r' -GhExe 'gh-not-called' -RunId 'nw' -Mode 'FULL' -OutDir $tmp -NoPost -Waiting $wl
Check (([IO.File]::ReadAllText((Join-Path $tmp 'run-nw.rundata-4.md'))).Contains($wl) -and ([IO.File]::ReadAllText((Join-Path $tmp 'run-nw.rundata-9.md'))).Contains($wl)) 'publish passes the waiting line to issue comments and proposal footers'
Check ((([IO.File]::ReadAllText((Join-Path $tmp 'run-nw.rundata.json'))) | ConvertFrom-Json).waitingOnVe -eq $wl) 'the run-data json records it too'

# killed run: no result line, #5 never ended
$killed = Join-Path $tmp 'killed.jsonl'
[IO.File]::WriteAllLines($killed, @($lines | Where-Object { $_ -notmatch '"type":"result"' } | ForEach-Object { $_ -replace '\*\*LOOP-ISSUE-END 5 rolled back\*\*', 'still going' }))
$d3 = Read-LoopTranscript -Path $killed
Check (-not $d3.HasResult) 'killed: no result'
Check ($d3.Parts[1].Outcome -like 'unknown*') "killed: #5 outcome unknown (got $($d3.Parts[1].Outcome))"
Check ($d3.Totals.Output -eq -1 -and -not $d3.Totals.HasCost) 'killed: output and cost n/a'
$c3 = Format-RunDataComment -Data $d3 -Issue 5 -Part $d3.Parts[1] -RunId 'k' -Mode 'FULL' -Trigger 'x'
Check ($c3 -match 'n/a' -and $c3 -match 'no result message') 'killed: comment shows n/a and the note'
Test-Sums $d3 'killed'

# empty / missing file never throws
$d4 = Read-LoopTranscript -Path (Join-Path $tmp 'missing.jsonl')
Check (-not $d4.HasResult -and $d4.Parts.Count -eq 0) 'missing transcript: empty data, no throw'

# outcomes
Check ((Get-RunDataOutcome 'rolled-back') -eq 'rolled back' -and (Get-RunDataOutcome 'Deployed') -eq 'deployed' -and (Get-RunDataOutcome 'skipped') -eq 'skipped' -and (Get-RunDataOutcome 'failed') -eq 'failed') 'outcome words normalised'

# ---- one session per job: a build session's whole cost is its issue's; the run adds the sessions up ------
function New-Result { param([int]$Turns, [int]$In, [int]$Cr, [int]$Cw, [int]$Out, [double]$Cost, [string]$Text, [string]$Model = 'claude-test-1')
    return New-Line @{ type = 'result'; subtype = 'success'; is_error = $false; num_turns = $Turns; duration_ms = 600000; total_cost_usd = $Cost; result = $Text
        usage = @{ input_tokens = $In; cache_read_input_tokens = $Cr; cache_creation_input_tokens = $Cw; output_tokens = $Out }
        modelUsage = @{ $Model = @{ outputTokens = $Out; costUSD = $Cost } } } }
$bLines = @(
    (Msg 'b1' 'Reading CLAUDE.md before taking the issue.' 0 -Tool 'gh issue view 12 -R o/r' -ToolId 'bt1'), (Res 'bt1' '{}' 5),
    (Msg 'b2' "LOOP-ISSUE-START 12" 10 -Tool 'C:\s\check-approval.ps1 -Issue 12' -ToolId 'bt2'), (Res 'bt2' 'ok' 20),
    (Msg 'b3' "Deployed.`nLOOP-ISSUE-END 12 deployed" 900 -Tool 'gh issue close 12 -R o/r' -ToolId 'bt3'), (Res 'bt3' 'ok' 905),
    (Msg 'b4' "Built #12.`nLOOP-RESULT: OK" 910),
    (New-Result -Turns 4 -In 8 -Cr 4000 -Cw 400 -Out 5000 -Cost 3.0 -Text "Built #12.`nLOOP-RESULT: OK"))
$pLines = @(
    (Msg 'p1' 'Counting slots.' 1000 -Tool 'C:\s\check-approval.ps1 -Slots' -ToolId 'pt1'), (Res 'pt1' '{}' 1005),
    (Msg 'p2' '' 1100 -Tool 'gh issue create -R o/r --title x --label loop:proposal --body-file C:\w\p.md' -ToolId 'pt2'), (Res 'pt2' 'https://github.com/o/r/issues/20' 1105),
    (Msg 'p3' "Opened #20.`nLOOP-RESULT: OK" 1200),
    (New-Result -Turns 3 -In 6 -Cr 3000 -Cw 300 -Out 1000 -Cost 0.5 -Text "Opened #20.`nLOOP-RESULT: OK" -Model 'claude-test-small'))
$bPath = Join-Path $tmp 'run-S.build-12.jsonl'; [IO.File]::WriteAllLines($bPath, $bLines)
$pPath = Join-Path $tmp 'run-S.propose.jsonl'; [IO.File]::WriteAllLines($pPath, @($pLines | ForEach-Object { $_ -replace '"model":"claude-test-1"', '"model":"claude-test-small"' }))
$db = Read-LoopTranscript -Path $bPath -SessionIssue 12
Check ($db.Parts.Count -eq 1 -and $db.Parts[0].Issue -eq 12 -and $db.Parts[0].Outcome -eq 'deployed') 'build session: one part, #12 deployed'
Check ($db.Parts[0].Input -eq 8 -and $db.Overhead.Input -eq 0 -and $db.Overhead.Turns -eq 0) "build session: everything, its preflight reading included, is #12's (got #12 in $($db.Parts[0].Input), overhead in $($db.Overhead.Input))"
Check ([math]::Abs($db.Parts[0].Cost - 3.0) -lt 0.0001 -and $db.Parts[0].Output -eq 5000) 'build session: #12 carries the session''s whole cost and output'
Test-Sums $db 'build session'
$dp = Read-LoopTranscript -Path $pPath
Check ($dp.Parts.Count -eq 0 -and $dp.Overhead.Turns -eq 3 -and ($dp.CreatedIssues -contains 'o/r#20')) 'proposal session: all overhead, proposal o/r#20 found'
$mg = Merge-LoopRunData -Sessions @([pscustomobject]@{ Kind = 'build'; Issue = 12; Model = 'claude-test-1'; Data = $db }, [pscustomobject]@{ Kind = 'propose'; Issue = 0; Model = 'claude-test-small'; Data = $dp }) -Status 'OK'
Check ($mg.Parts.Count -eq 1 -and $mg.Sessions.Count -eq 2 -and $mg.Status -eq 'OK' -and $mg.HasResult) 'merged: one issue part, two sessions, the run''s status'
Check ($mg.Totals.Turns -eq 7 -and $mg.Totals.Input -eq 14 -and $mg.Totals.CacheRead -eq 7000 -and $mg.Totals.Output -eq 6000 -and [math]::Abs($mg.Totals.Cost - 3.5) -lt 0.0001) "merged totals = the sum of the sessions (turns $($mg.Totals.Turns), cost $($mg.Totals.Cost))"
Check ($mg.Parts[0].Turns -eq 4 -and [math]::Abs($mg.Parts[0].Cost - 3.0) -lt 0.0001 -and $mg.Overhead.Turns -eq 3 -and [math]::Abs($mg.Overhead.Cost - 0.5) -lt 0.0001) 'merged: the per-issue column is the build session, the rest is the proposal session'
Check (($mg.Totals.Models -contains 'claude-test-1') -and ($mg.Totals.Models -contains 'claude-test-small')) "merged: both models listed ($($mg.Totals.Models -join ','))"
Check ($mg.CreatedIssues -contains 'o/r#20') 'merged: created proposals kept'
Test-Sums $mg 'merged sessions'
$cm = Format-RunDataComment -Data $mg -Issue 12 -Part $mg.Parts[0] -RunId 'S' -Mode 'FULL' -Trigger 'x'
Check ($cm -match 'Rest of run \(proposal / review session\)' -and $cm -match 'Sessions \(2, one per job\): build #12 \(claude-test-1, 4 turns, \$3\.00, OK\); proposals \(claude-test-small, 3 turns, \$0\.50, OK\)') "comment names every session ($cm)"
$pf = Format-RunDataProposalComment -Data $mg -RunId 'S' -Mode 'FULL' -Trigger 'x'
Check ($pf -match 'The proposal / review session, shared by every proposal it opened: 3 turns') "proposal footer: the proposal session's own figures ($pf)"
$null = Publish-LoopRunData -Sessions @([pscustomobject]@{ Path = $bPath; Kind = 'build'; Issue = 12; Model = 'claude-test-1' }, [pscustomobject]@{ Path = $pPath; Kind = 'propose'; Issue = 0; Model = 'claude-test-small' }) -Status 'OK' `
    -Repo 'o/r' -GhExe 'gh-not-called' -RunId 'S' -Mode 'FULL' -OutDir $tmp -NoPost
Check ((Test-Path (Join-Path $tmp 'run-S.rundata-12.md')) -and (Test-Path (Join-Path $tmp 'run-S.rundata-20.md'))) 'publish -Sessions: bodies for #12 and proposal #20'
$js = [IO.File]::ReadAllText((Join-Path $tmp 'run-S.rundata.json')) | ConvertFrom-Json
Check (@($js.sessions).Count -eq 2 -and $js.status -eq 'OK' -and [math]::Abs([double]$js.totals.Cost - 3.5) -lt 0.0001) 'run-data json: sessions listed, run status and summed cost'
# a killed build session: its cost is unknown, the run's output tokens are n/a, the note says so
$kPath = Join-Path $tmp 'run-K.build-14.jsonl'; [IO.File]::WriteAllLines($kPath, @($bLines | Where-Object { $_ -notmatch '"type":"result"' } | ForEach-Object { $_ -replace 'LOOP-ISSUE-(START|END) 12', 'LOOP-ISSUE-$1 14' }))
$dk = Read-LoopTranscript -Path $kPath -SessionIssue 14
$mk2 = Merge-LoopRunData -Sessions @([pscustomobject]@{ Kind = 'build'; Issue = 14; Data = $dk }, [pscustomobject]@{ Kind = 'propose'; Data = $dp }) -Status 'FAILED'
Check (-not $mk2.HasResult -and $mk2.Totals.Output -eq -1 -and [math]::Abs($mk2.Totals.Cost - 0.5) -lt 0.0001 -and (@($mk2.Notes | Where-Object { $_ -match 'no result message' }).Count -ge 1)) 'killed build session: output n/a, cost covers the sessions that reported, noted'
Check ((Format-RunDataSessions $mk2) -match 'build #14 \(claude-test-1, \d+ turns, cost n/a, no result') "killed session shown as such ($(Format-RunDataSessions $mk2))"

# ---- progress ---------------------------------------------------------------------------------
$stages = @('approval', 'plan', 'branch', 'test', 'pr', 'ci', 'merge', 'deploy', 'verify', 'done')
$st = New-ProgressState -Issue 11 -RunId '20261116-140000' -Repo 'o/r' -Stages $stages
$t = $ts0
$st = Update-ProgressState $st 'approval' 'ok' 'check-approval.ps1 exit 0' -Now $t
$st = Update-ProgressState $st 'plan' 'ok' 'plan comment posted' -Now $t.AddMinutes(1)
$st = Update-ProgressState $st 'branch' 'ok' 'loop/11-shop-mode' -Now $t.AddMinutes(2)
$st = Update-ProgressState $st 'test' 'running' 'npm ci + unit + e2e' -Now $t.AddMinutes(2)
$st = Update-ProgressState $st 'test' 'ok' '1,251 tests pass @someone <!-- innovation-loop -->' -Now $t.AddMinutes(9)
$st = Update-ProgressState $st 'pr' 'ok' 'PR #14' -Now $t.AddMinutes(10)
$st = Update-ProgressState $st 'ci' 'running' 'waiting for checks: build, e2e (run 123)' -Now $t.AddMinutes(10)
$mid = Format-ProgressComment -State $st -Now $t.AddMinutes(14)
Check ($mid.Contains('<!-- innovation-loop:progress -->') -and $mid -match '## Progress') 'progress: markers and heading'
Check ($mid -match 'Now: .* CI checks - waiting for checks' -and $mid -match '4m 00s so far') 'progress: current stage with elapsed time'
Check (-not $mid.Substring(60).Contains('<!-- innovation-loop -->') -and $mid -notmatch '@someone') 'progress: details cannot forge a marker or mention'
# heartbeat keeps the stage start
$st = Update-ProgressState $st 'ci' 'running' 'still waiting: e2e running' -Now $t.AddMinutes(15)
Check ((ConvertTo-RunDataTime $st.stages['ci'].start) -eq $t.AddMinutes(10)) 'progress: heartbeat keeps the stage start time'
# advancing closes the running stage
$st = Update-ProgressState $st 'merge' 'ok' 'merged as abc1234' -Now $t.AddMinutes(20)
Check ($st.stages['ci'].status -eq 'ok') 'progress: advancing closes the running stage as ok'
$st = Update-ProgressState $st 'deploy' 'running' 'server: snapshot taken, swapping' -Now $t.AddMinutes(21)
# save/load round trip
$sp = Join-Path $tmp 'state\progress\20261116-140000-11.json'
Save-ProgressState -Path $sp -State $st
$st2 = Read-ProgressState $sp
Check ($st2.current -eq 'deploy' -and $st2.stages['merge'].detail -eq 'merged as abc1234') 'progress: state round trip'
$deployMid = Format-ProgressComment -State $st2 -Now $t.AddMinutes(23)
$stF = Update-ProgressState $st2 'verify' 'running' 'health + GET smoke' -Now $t.AddMinutes(24)
$stF = Update-ProgressState $stF 'done' -Outcome 'deployed' -Detail 'live and verified' -Now $t.AddMinutes(26)
$final = Format-ProgressComment -State $stF -Now $t.AddMinutes(30)
Check ($final -match 'Done: deployed' -and $final -match 'total 26m 00s') 'progress: final state deployed with total time'
$stX = Update-ProgressState (Read-ProgressState $sp) 'done' -Outcome 'rolled-back' -Detail 'health check failed; snapshot restored' -Now $t.AddMinutes(25)
Check ($stX.stages['deploy'].status -eq 'stopped' -and $stX.stages['done'].status -eq 'failed' -and $stX.outcome -eq 'rolled back') 'progress: rollback ends failed; the stage still running shows as stopped, not failed'
$hour = [char]::ConvertFromUtf32(0x23F3); $cross = [char]::ConvertFromUtf32(0x274C)
# #22: CI merely pending (ci running) when merge-pr refused for another reason: CI must not get a red cross
$stC = New-ProgressState -Issue 22 -RunId 'R22' -Repo 'o/r' -Stages $stages
$stC = Update-ProgressState $stC 'pr' 'ok' 'PR #24' -Now $t
$stC = Update-ProgressState $stC 'ci' 'running' 'CI running on 725bbbf (e2e, visual)' -Now $t.AddMinutes(1)
$pend = Format-ProgressComment -State $stC -Now $t.AddMinutes(2)
Check ($pend.Contains("- $hour **CI checks**") -and -not $pend.Contains($cross)) 'progress: CI pending renders an hourglass, no cross'
$stC = Update-ProgressState $stC 'done' -Outcome 'failed' -Detail 'merge refused: protected path in a gap commit' -Now $t.AddMinutes(2)
$endC = Format-ProgressComment -State $stC -Now $t.AddMinutes(3)
Check ($stC.stages['ci'].status -eq 'stopped' -and $endC.Contains("- $hour CI checks (not finished)") -and -not $endC.Contains("$cross CI checks")) 'progress: CI pending when the build failed elsewhere stays an hourglass (the #22 bug)'
Check ($endC.Contains("**$cross Done: failed**")) 'progress: the failed end itself is the cross'
# marking the failing stage explicitly does not turn an earlier pending stage into ok or failed
$stM = New-ProgressState -Issue 22 -RunId 'R22b' -Repo 'o/r' -Stages $stages
$stM = Update-ProgressState $stM 'ci' 'running' 'CI running' -Now $t
$stM = Update-ProgressState $stM 'merge' 'failed' 'MERGE-PR REFUSED protected paths' -Now $t.AddMinutes(1)
Check ($stM.stages['ci'].status -eq 'stopped' -and $stM.stages['merge'].status -eq 'failed') 'progress: merge failed -> ci stopped (not ok, not failed), merge failed'
# a real CI failure is still a cross
$stR = New-ProgressState -Issue 22 -RunId 'R22c' -Repo 'o/r' -Stages $stages
$stR = Update-ProgressState $stR 'ci' 'failed' 'MERGE-PR CI-FAILED Playwright E2E: failure' -Now $t
Check ((Format-ProgressComment -State $stR -Now $t).Contains("- $cross CI checks")) 'progress: a real CI failure renders the cross'

# run data: the live-server gap merge-pr recorded for this issue in this run
$gh = Join-Path $tmp 'gaphome'; New-Item -ItemType Directory -Path (Join-Path $gh 'state') -Force | Out-Null
$gapRec = @{ issue = 22; runId = 'RG'; commits = @('c435202 Merge pull request #23', '6efec14 Innovation loop: PRODUCT.md'); inertProtected = @('.github/ISSUE_TEMPLATE/device-feedback.yml', 'innovation/PRODUCT.md')
    serverCommits = @('abc1234 server: faster prices @someone'); blocked = @(); refused = $false }
[IO.File]::WriteAllText((Join-Path $gh 'state\merge-gap-22.json'), ($gapRec | ConvertTo-Json -Depth 4))
$gl = Get-RunDataGapLine -LoopHome $gh -RunId 'RG' -Issue 22
Check ($gl -match '2 commit\(s\)' -and $gl -match 'device-feedback\.yml' -and $gl -match 'went live with this change' -and $gl -notmatch '@someone') "run data: gap line lists commits, inert files and server commits ($gl)"
Check ((Get-RunDataGapLine -LoopHome $gh -RunId 'OTHER' -Issue 22) -eq '') 'run data: a gap record from another run is ignored'
Check ((Get-RunDataGapLine -LoopHome $gh -RunId 'RG' -Issue 99) -eq '') 'run data: no gap record -> nothing'
$cg = Format-RunDataComment -Data $d -Issue 4 -Part $d.Parts[0] -RunId 'RG' -Mode 'FULL' -Trigger 'x' -Gap $gl
Check ($cg -match 'Live-server gap when merging') 'run data: the gap line is in the comment'
# runner finalisation text (no network: render only)
$stW = Read-ProgressState $sp; $stW.warning = 'Run ended during: Deploying. The session stopped before this issue finished; see the run log run-x.log.'; $stW.stages['deploy'].status = 'warn'
$warn = Format-ProgressComment -State $stW -Now $t.AddMinutes(40)
Check ($warn -match 'Run ended during: Deploying') 'progress: run-ended warning renders'

# ---- posting, against a stub gh (records calls; no network) ------------------------------------
$stubDir = Join-Path $tmp 'stub'; New-Item -ItemType Directory -Path $stubDir | Out-Null
$stub = Join-Path $stubDir 'gh.ps1'
[IO.File]::WriteAllText($stub, @'
$d = $PSScriptRoot; $a = $args -join ' '
Add-Content -LiteralPath (Join-Path $d 'calls.log') -Value $a
$bodyFile = Join-Path $d 'comment-body.txt'
if ($a -match '^api repos/o/r/issues/comments/(\d+)$') {
    $b = ''; if (Test-Path $bodyFile) { $b = [IO.File]::ReadAllText($bodyFile) }
    @{ issue_url = 'https://api.github.com/repos/o/r/issues/11'; body = $b } | ConvertTo-Json; exit 0 }
if ($a -match '^api repos/o/r/issues/comments/\d+ -X PATCH --input (.+)$') {
    [IO.File]::WriteAllText($bodyFile, ([IO.File]::ReadAllText($Matches[1]) | ConvertFrom-Json).body); '{}'; exit 0 }
if ($a -match '^api repos/o/r/issues/(\d+)/comments -X POST --input (.+)$') {
    [IO.File]::WriteAllText($bodyFile, ([IO.File]::ReadAllText($Matches[2]) | ConvertFrom-Json).body); '{"id":555}'; exit 0 }
if ($a -match '^api repos/o/r/issues/13$') { '{"labels":[{"name":"loop:proposal"}],"pull_request":{"url":"x"}}'; exit 0 }
if ($a -match '^api repos/o/r/issues/12$') { '{"labels":[{"name":"loop:proposal"}]}'; exit 0 }
if ($a -match '^api repos/o/r/issues/(\d+)$') { '{"labels":[{"name":"loop:proposal"},{"name":"approved"}]}'; exit 0 }
if ($a -match '^issue comment (\d+) -R o/r --body-file ') { "https://github.com/o/r/issues/$($Matches[1])#issuecomment-1"; exit 0 }
exit 1
'@)
$calls = Join-Path $stubDir 'calls.log'
$home2 = Join-Path $tmp 'home'
$okA = Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 11 -Stage approval -Status ok -Detail 'verified' -Stages $stages
$okB = Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 11 -Stage test -Detail 'running'
$log = @(Get-Content -LiteralPath $calls)
Check ($okA -and $okB) 'post: progress create + edit succeed'
Check (@($log | Where-Object { $_ -match 'issues/11/comments -X POST' }).Count -eq 1 -and @($log | Where-Object { $_ -match 'comments/555 -X PATCH' }).Count -eq 1) 'post: one POST, then PATCH of the stored id 555'
Check (((Read-ProgressState (Join-Path $home2 'state\progress\R1-11.json')).commentId) -eq 555) 'post: comment id kept in state'
# refuses issues it may not touch
Check (-not (Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 12 -Stage approval -Stages $stages)) 'post: no progress comment on an issue without approved'
Check (-not (Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 13 -Stage approval -Stages $stages)) 'post: no progress comment on a pull request'
# tampered comment (marker gone): never edited
[IO.File]::WriteAllText((Join-Path $stubDir 'comment-body.txt'), 'someone else''s text')
$before = @(Get-Content -LiteralPath $calls).Count
Check (-not (Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 11 -Stage pr -Detail 'PR #20')) 'post: refuses to edit a comment without its markers'
Check (@(Get-Content -LiteralPath $calls | Select-Object -Skip $before | Where-Object { $_ -match 'PATCH' }).Count -eq 0) 'post: no PATCH sent for the tampered comment'
# runner finalisation of a progress comment left mid-build
$okC = Invoke-LoopProgress -LoopHome $home2 -RunId 'R2' -Repo 'o/r' -GhExe $stub -Issue 11 -Stage deploy -Detail 'front end' -Stages $stages
$ended = @(Complete-LoopProgress -LoopHome $home2 -RunId 'R2' -GhExe $stub)
Check ($okC -and $ended.Count -eq 1 -and [IO.File]::ReadAllText((Join-Path $stubDir 'comment-body.txt')) -match 'Run ended during: Deploying') 'post: runner marks a progress comment left mid-build'
Check (-not (Invoke-LoopProgress -LoopHome $home2 -RunId 'R1' -Repo 'o/r' -GhExe $stub -Issue 11 -Stage done -Status ok)) 'post: done without -Outcome is refused'
# run data: comments on #4, #5 (markers) and the new proposal #9, nothing anywhere else
$synR = Join-Path $tmp 'synthetic-r.jsonl'
[IO.File]::WriteAllLines($synR, $lines)
$before = @(Get-Content -LiteralPath $calls).Count
$posted = Publish-LoopRunData -TranscriptPath $synR -Repo 'o/r' -GhExe $stub -RunId 'R3' -Mode 'FULL' -Trigger 'daily schedule (14:00)' -OutDir $tmp
$new = @(Get-Content -LiteralPath $calls | Select-Object -Skip $before | Where-Object { $_ -match '^issue comment' })
Check ($posted -eq 3 -and ($new -join ' ') -match 'comment 4 ' -and ($new -join ' ') -match 'comment 5 ' -and ($new -join ' ') -match 'comment 9 ') "run data: posted on #4, #5 and proposal #9 (posted $posted)"
# a marker naming a PR or a non-loop issue gets nothing
$bad = Join-Path $tmp 'bad.jsonl'
[IO.File]::WriteAllLines($bad, @($lines | ForEach-Object { $_ -replace 'LOOP-ISSUE-START 4', 'LOOP-ISSUE-START 13' -replace 'LOOP-ISSUE-END 4 ', 'LOOP-ISSUE-END 13 ' }))
$before = @(Get-Content -LiteralPath $calls).Count
$null = Publish-LoopRunData -TranscriptPath $bad -Repo 'o/r' -GhExe $stub -RunId 'R4' -Mode 'FULL' -OutDir $tmp
Check (@(Get-Content -LiteralPath $calls | Select-Object -Skip $before | Where-Object { $_ -match '^issue comment 13 ' }).Count -eq 0) 'run data: no comment on a pull request named by a marker'
# gh failing never throws
$posted = Publish-LoopRunData -TranscriptPath $synR -Repo 'o/r' -GhExe (Join-Path $stubDir 'missing-gh.exe') -RunId 'R5' -Mode 'FULL' -OutDir $tmp
Check ($posted -eq 0) 'run data: a missing gh posts nothing and does not throw'

if ($ShowSamples) {
    Write-Host "`n----- sample: run data (synthetic, issue #4) -----`n$c4"
    Write-Host "----- sample: progress mid-run -----`n$mid"
    Write-Host "----- sample: progress final -----`n$final"
    Write-Host "----- sample: progress run ended -----`n$warn"
}

# ---- a real transcript ------------------------------------------------------------------------
if ($Transcript) {
    $real = [IO.File]::ReadAllLines($Transcript)
    $dr = Read-LoopTranscript -Path $Transcript
    $res = ($real | Where-Object { $_ -match '"type":"result"' } | Select-Object -Last 1) | ConvertFrom-Json
    Check ($dr.HasResult) 'real: result found'
    Check ($dr.Totals.Turns -eq $res.num_turns -and $dr.Totals.Output -eq $res.usage.output_tokens) 'real: totals = result message'
    $sumIn = [long]0; foreach ($p in @($dr.Parts) + @($dr.Overhead)) { $sumIn += $p.CacheRead }
    Check ($sumIn -eq $res.usage.cache_read_input_tokens) "real: transcript cache-read sum $sumIn = result $($res.usage.cache_read_input_tokens)"
    Test-Sums $dr 'real as-is'
    # constructed multi-issue: markers into the session's own text events at ~20%, ~50%, ~55%, ~85%
    $textIdx = @(); for ($i = 0; $i -lt $real.Count; $i++) { if ($real[$i] -match '^\{"type":"assistant"' -and $real[$i].Contains('"type":"text","text":"')) { $textIdx += $i } }
    if ($textIdx.Count -ge 4) {
        $pos = @(); $prevPos = -1
        foreach ($f in 0.2, 0.5, 0.55, 0.85) { $q = [math]::Max($prevPos + 1, [int][math]::Floor($textIdx.Count * $f)); $pos += [math]::Min($q, $textIdx.Count - 1); $prevPos = $pos[-1] }
        $pick = @($pos | ForEach-Object { $textIdx[$_] })
        $ins = @('LOOP-ISSUE-START 101\n', 'LOOP-ISSUE-END 101 deployed\n', 'LOOP-ISSUE-START 102\n', 'LOOP-ISSUE-END 102 failed\n')
        $m = [string[]]$real.Clone()
        for ($k = 0; $k -lt $pick.Count; $k++) { $m[$pick[$k]] = ([regex]'"type":"text","text":"').Replace($m[$pick[$k]], '"type":"text","text":"' + $ins[$k], 1) }
        $mp = Join-Path $tmp 'real-multi.jsonl'; [IO.File]::WriteAllLines($mp, $m)
        $dm = Read-LoopTranscript -Path $mp
        Check ($dm.MarkersFound -and $dm.Parts.Count -eq 2) "real multi: two issues (got $($dm.Parts.Count))"
        if ($dm.Parts.Count -eq 2) {
            Check ($dm.Parts[0].Outcome -eq 'deployed' -and $dm.Parts[1].Outcome -eq 'failed') 'real multi: outcomes'
            Check ($dm.Parts[0].Turns -gt 0 -and $dm.Parts[0].Input -gt 0 -and $dm.Parts[0].Output -gt 0) 'real multi: #101 has turns, tokens'
        }
        Test-Sums $dm 'real multi'
        $script:realMulti = $dm
        # unclosed: drop the last END
        $u = [string[]]$m.Clone(); $u[$pick[-1]] = $u[$pick[-1]].Replace('LOOP-ISSUE-END 102 failed\n', '')
        $up = Join-Path $tmp 'real-unclosed.jsonl'; [IO.File]::WriteAllLines($up, $u)
        $du = Read-LoopTranscript -Path $up
        Check ($du.Parts.Count -eq 2 -and $du.Parts[1].Outcome -like 'unknown*') 'real unclosed: #102 outcome unknown'
        Test-Sums $du 'real unclosed'
        # killed: no result
        $kp = Join-Path $tmp 'real-killed.jsonl'; [IO.File]::WriteAllLines($kp, @($m | Where-Object { $_ -notmatch '"type":"result","subtype"' -and $_ -notmatch '^\{"duration_api_ms"' }))
        $dk = Read-LoopTranscript -Path $kp
        Check (-not $dk.HasResult -and $dk.Parts.Count -eq 2) 'real killed: parts without result'
        Test-Sums $dk 'real killed'
        if ($ShowSamples) {
            Write-Host "----- sample: run data (real transcript, constructed split, issue #101) -----"
            Write-Host (Format-RunDataComment -Data $dm -Issue 101 -Part $dm.Parts[0] -RunId ([IO.Path]::GetFileNameWithoutExtension($Transcript) -replace '^.*run-', '') -Mode 'FULL' -Trigger 'on demand (not at the daily 13:17 start): approval watcher or a manual start')
            Write-Host "----- sample: run data (real transcript as-is: no markers) -----"
            Write-Host (Format-RunDataComment -Data $dr -Issue 4 -Part $null -RunId 'real' -Mode 'FULL' -Trigger 'daily schedule (13:17)')
            Write-Host "----- sample: proposal footer -----"
            Write-Host (Format-RunDataProposalComment -Data $dm -RunId 'real' -Mode 'FULL' -Trigger 'daily schedule (13:17)')
        }
    } else { Write-Host 'real: fewer than 4 text events, multi-issue case skipped' }
}

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($script:fail -gt 0) { Write-Host "TEST-REPORTING FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-REPORTING PASS ($script:pass checks)"
exit 0

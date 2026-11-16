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
Check ($stX.stages['deploy'].status -eq 'failed' -and $stX.outcome -eq 'rolled back') 'progress: rollback marks the running stage failed'
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

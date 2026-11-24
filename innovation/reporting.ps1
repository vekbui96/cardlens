<#
.SYNOPSIS
  Issue reporting for the innovation loop. (1) Run data: parse the claude stream-json transcript after claude exits and post a
  "## Run data" comment on each issue the run worked on. (2) Progress: the live "## Progress" checklist comment
  that progress.ps1 creates and edits in place (functions below). Dot-sourced by run-loop.ps1 and progress.ps1;
  generic, no config.

.DESCRIPTION
  The session cannot know its own final token totals, so the RUNNER does this after claude has exited, with
  the same gh and the same (non-elevated, or reduced) rights it already uses; the claude session gets no new
  permission and the guard / allowlist are unchanged.

  Attribution. LOOP.md makes the session print two marker lines as plain assistant text:
    LOOP-ISSUE-START <n>              when it takes issue <n> in Phase A
    LOOP-ISSUE-END <n> <outcome>      when it is done with it (deployed | failed | rolled-back | skipped)
  Every model request (assistant message) between the markers is charged to that issue; everything outside
  them is "run overhead (preflight + research)". Without markers the comment carries run totals only and
  says so; it then goes to the hub issues the session edited/commented/closed.

  What the transcript gives (checked against real runs, 2026-11):
   - each assistant message is streamed as one event per content block, all with the same message.id and the
     same message.usage. input / cache read / cache creation tokens are exact per message (their sum equals
     the result message's usage exactly); usage.output_tokens is a snapshot taken when the message STARTED
     (single digits), so per-issue output tokens are NOT in the transcript.
   - the result message has the exact run totals: usage, modelUsage (per model, with costUSD), num_turns
     (= tool-result user events + 1), duration_ms, total_cost_usd.
  So: input / cache tokens per issue are exact; output tokens per issue are the run's exact output total
  split by each part's generated content (text + tool input chars / 4, plus the system/thinking_tokens
  estimates); cost per issue is each model's reported cost split by token mix with Anthropic's standard price
  ratios (input 1, output 5, cache read 0.1, cache write 1.25 for 5 min / 2 for 1 h). Split figures are shown
  with "~"; the parts always add up to the reported totals.

  Cost is the API-equivalent figure Claude Code reports; on a Max subscription it is usage, not billing.

  Posting never fails the run: every error is logged as a warning.
#>

$script:RunDataMarker = '<!-- innovation-loop:run-data -->'
$script:RunDataInv = [Globalization.CultureInfo]::InvariantCulture

function Write-RunDataLog {
    param([string]$Message, [string]$Level = 'INFO')
    if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log $Message $Level } else { Write-Host "[$Level] $Message" }
}

function ConvertTo-RunDataTime {
    param($Value)
    if ($null -eq $Value -or "$Value" -eq '') { return $null }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    $d = [DateTime]::MinValue
    $styles = [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal
    if ([DateTime]::TryParse("$Value", $script:RunDataInv, $styles, [ref]$d)) { return $d }
    return $null
}

function New-RunDataPart {
    param([string]$Kind, [int]$Issue = 0)
    return [pscustomobject]@{
        Kind = $Kind; Issue = $Issue; Outcome = ''; Start = $null; End = $null; Ended = $false
        Turns = 0; Requests = 0; Input = [long]0; CacheRead = [long]0; CacheWrite = [long]0; Output = [long]0
        Cost = [double]0; HasCost = $false; Models = New-Object System.Collections.ArrayList
        Est = @{}; Weight = @{}
    }
}

function Add-RunDataTime {
    param($Part, $Ts)
    if ($null -eq $Ts) { return }
    if ($null -eq $Part.Start -or $Ts -lt $Part.Start) { $Part.Start = $Ts }
    if ($null -eq $Part.End -or $Ts -gt $Part.End) { $Part.End = $Ts }
}

function Get-RunDataNum { param($Obj, [string]$Name) if ($null -ne $Obj -and $Obj.PSObject.Properties.Name -contains $Name -and $null -ne $Obj.$Name) { return [long]$Obj.$Name }; return [long]0 }

# Parse a stream-json transcript. Returns one object with Parts (issue parts in order), Overhead, Totals,
# MarkersFound, Notes, CreatedIssues (slug#n from `gh issue create` results), TouchedIssues (from gh issue
# edit/close/comment/reopen commands), Status (LOOP-RESULT word) and HasResult.
function Read-LoopTranscript {
    param([Parameter(Mandatory)][string]$Path, [int]$SessionIssue = 0)
    $markerRx = [regex]'(?m)^[ \t>*`_]*LOOP-ISSUE-(START|END)[ \t]+#?(\d+)(?:[ \t]+([A-Za-z][A-Za-z \-]*?))?[ \t*`_]*$'

    # ---- pass 1: events -> ordered items (a message is placed at its FIRST event) ----
    $items = New-Object System.Collections.ArrayList
    $msgs = @{}
    $toolCmd = @{}
    $result = $null
    $lastTs = $null; $firstTs = $null
    $lines = @()
    if (Test-Path -LiteralPath $Path) { $lines = [IO.File]::ReadAllLines($Path) }
    foreach ($line in $lines) {
        if (-not $line -or $line[0] -ne '{') { continue }
        # key order is not fixed (the result line starts with duration_api_ms), so filter loosely, then use .type
        if ($line -notmatch '"type":"(assistant|user|result|system)"') { continue }
        if ($line -match '^\{"type":"system"' -and $line -notmatch '"subtype":"thinking_tokens"') { continue }
        try { $o = $line | ConvertFrom-Json } catch { continue }
        $kind = "$($o.type)"
        if ($kind -notin @('assistant', 'user', 'result', 'system')) { continue }
        if ($kind -eq 'system' -and "$($o.subtype)" -ne 'thinking_tokens') { continue }
        $ts = $null
        if ($o.PSObject.Properties.Name -contains 'timestamp') { $ts = ConvertTo-RunDataTime $o.timestamp }
        if ($ts) { if (-not $firstTs) { $firstTs = $ts }; $lastTs = $ts }
        switch ($kind) {
            'assistant' {
                $m = $o.message; if (-not $m) { break }
                $id = "$($m.id)"; if (-not $id) { $id = "noid-$($items.Count)" }
                $msg = $msgs[$id]
                if (-not $msg) {
                    $msg = [pscustomobject]@{ Kind = 'msg'; Id = $id; Model = "$($m.model)"; Usage = $null; First = $ts; Last = $ts; Text = ''; Chars = 0 }
                    $msgs[$id] = $msg; [void]$items.Add($msg)
                }
                if ($m.usage) { $msg.Usage = $m.usage }
                if ($ts) { $msg.Last = $ts; if (-not $msg.First) { $msg.First = $ts } }
                foreach ($c in @($m.content)) {
                    if ($null -eq $c) { continue }
                    if ($c.type -eq 'text') { $msg.Text += "$($c.text)`n"; $msg.Chars += ("$($c.text)").Length }
                    elseif ($c.type -eq 'thinking') { $msg.Chars += ("$($c.thinking)").Length }
                    elseif ($c.type -eq 'tool_use') {
                        $inp = ''; try { $inp = ($c.input | ConvertTo-Json -Depth 6 -Compress) } catch { }
                        $msg.Chars += $inp.Length
                        if ($c.input -and $c.input.PSObject.Properties.Name -contains 'command') { $toolCmd["$($c.id)"] = "$($c.input.command)" }
                    }
                }
            }
            'user' {
                $isTurn = $false; $texts = @()
                $parent = $null; if ($o.PSObject.Properties.Name -contains 'parent_tool_use_id') { $parent = $o.parent_tool_use_id }
                foreach ($c in @($o.message.content)) {
                    if ($null -eq $c -or $c -is [string]) { continue }
                    if ($c.type -eq 'tool_result') {
                        $isTurn = $true
                        $t = ''
                        if ($c.content -is [string]) { $t = $c.content } else { $t = (@($c.content) | Where-Object { $_ -and $_.type -eq 'text' } | ForEach-Object { "$($_.text)" }) -join "`n" }
                        $texts += [pscustomobject]@{ ToolUseId = "$($c.tool_use_id)"; Text = $t }
                    }
                }
                [void]$items.Add([pscustomobject]@{ Kind = 'user'; Ts = $ts; Turn = ($isTurn -and -not $parent); Results = $texts })
            }
            'system' { [void]$items.Add([pscustomobject]@{ Kind = 'think'; Tokens = (Get-RunDataNum $o 'estimated_tokens_delta') }) }
            'result' { $result = $o }
        }
    }

    # ---- pass 2: walk the items, charging each to the open part ----
    $parts = New-Object System.Collections.ArrayList
    $byIssue = @{}
    $overhead = New-RunDataPart -Kind 'overhead'
    $cur = $overhead
    $lastModel = ''
    $created = New-Object System.Collections.ArrayList
    $touched = New-Object System.Collections.ArrayList
    $notes = New-Object System.Collections.ArrayList
    $markersFound = $false

    $charge = {
        param($part, $msg)
        $u = $msg.Usage
        $model = $msg.Model; if (-not $model) { $model = 'unknown' }
        $cw5 = [long]0; $cw1 = [long]0
        $in = Get-RunDataNum $u 'input_tokens'; $cr = Get-RunDataNum $u 'cache_read_input_tokens'; $cw = Get-RunDataNum $u 'cache_creation_input_tokens'
        if ($u -and $u.cache_creation) { $cw5 = Get-RunDataNum $u.cache_creation 'ephemeral_5m_input_tokens'; $cw1 = Get-RunDataNum $u.cache_creation 'ephemeral_1h_input_tokens' }
        if (($cw5 + $cw1) -ne $cw) { $cw5 = $cw - $cw1; if ($cw5 -lt 0) { $cw5 = 0; $cw1 = $cw } }
        if ($model -eq '<synthetic>' -and ($in + $cr + $cw) -eq 0) { return }
        $part.Requests++
        $part.Input += $in; $part.CacheRead += $cr; $part.CacheWrite += $cw
        if (-not $part.Models.Contains($model)) { [void]$part.Models.Add($model) }
        if (-not $part.Weight.ContainsKey($model)) { $part.Weight[$model] = [double]0; $part.Est[$model] = [double]0 }
        $part.Weight[$model] += [double]$in + 0.1 * $cr + 1.25 * $cw5 + 2.0 * $cw1
        $part.Est[$model] += [double]$msg.Chars / 4.0
        Add-RunDataTime $part $msg.First; Add-RunDataTime $part $msg.Last
    }
    $open = {
        param([int]$n)
        $p = $byIssue[$n]
        if (-not $p) { $p = New-RunDataPart -Kind 'issue' -Issue $n; $byIssue[$n] = $p; [void]$parts.Add($p) }
        elseif ($p.Ended) { $p.Ended = $false; $p.Outcome = '' }
        return $p
    }
    # A build session exists for ONE issue: everything in it (its preflight reading included) is that issue's
    # cost, and its LOOP-ISSUE-END marker only sets the outcome.
    if ($SessionIssue -gt 0) { $cur = & $open $SessionIssue; $markersFound = $true }

    foreach ($it in $items) {
        if ($it.Kind -eq 'think') {
            $m = $lastModel; if (-not $m) { $m = 'unknown' }
            if (-not $cur.Est.ContainsKey($m)) { $cur.Est[$m] = [double]0; $cur.Weight[$m] = [double]0 }
            $cur.Est[$m] += [double]$it.Tokens
            continue
        }
        if ($it.Kind -eq 'user') {
            if ($it.Turn) { $cur.Turns++ }
            Add-RunDataTime $cur $it.Ts
            foreach ($r in $it.Results) {
                $cmd = $toolCmd[$r.ToolUseId]
                if ($cmd -and $cmd -match '\bgh(\.exe)?"?\s+issue\s+create\b') {
                    foreach ($mm in [regex]::Matches("$($r.Text)", 'github\.com/([A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)/issues/(\d+)')) {
                        $key = "$($mm.Groups[1].Value)#$($mm.Groups[2].Value)"
                        if (-not $created.Contains($key)) { [void]$created.Add($key) }
                    }
                }
            }
            continue
        }
        # a model request
        if ($it.Model -and $it.Model -ne '<synthetic>') { $lastModel = $it.Model }
        $marks = @($markerRx.Matches($it.Text))
        $i = 0
        while ($i -lt $marks.Count -and $marks[$i].Groups[1].Value -eq 'START') {
            $markersFound = $true
            $n = [int]$marks[$i].Groups[2].Value
            if ($cur.Kind -eq 'issue' -and -not $cur.Ended -and $cur.Issue -ne $n) { $cur.Outcome = 'unknown (no end marker)'; $cur.Ended = $true }
            $cur = & $open $n
            $i++
        }
        & $charge $cur $it
        for (; $i -lt $marks.Count; $i++) {
            $markersFound = $true
            $n = [int]$marks[$i].Groups[2].Value
            if ($marks[$i].Groups[1].Value -eq 'START') {
                if ($cur.Kind -eq 'issue' -and -not $cur.Ended -and $cur.Issue -ne $n) { $cur.Outcome = 'unknown (no end marker)'; $cur.Ended = $true }
                $cur = & $open $n
                Add-RunDataTime $cur $it.Last
            } else {
                $p = $byIssue[$n]
                if (-not $p) { $p = & $open $n; Add-RunDataTime $p $it.Last; [void]$notes.Add("issue #$n had an end marker but no start marker") }
                $p.Outcome = (Get-RunDataOutcome $marks[$i].Groups[3].Value)
                $p.Ended = $true
                if ($cur -eq $p -and $p.Issue -ne $SessionIssue) { $cur = $overhead }
            }
        }
        # commands that touched hub issues (fallback attribution when there are no markers)
    }
    foreach ($cmd in $toolCmd.Values) {
        foreach ($mm in [regex]::Matches($cmd, '\bgh(?:\.exe)?"?\s+issue\s+(?:edit|close|comment|reopen)\s+#?(\d+)\b([^\r\n;|]*)')) {
            $slug = ''
            $rm = [regex]::Match($mm.Groups[2].Value, '(?:-R|--repo)[ =]+[''"]?([A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)')
            if ($rm.Success) { $slug = $rm.Groups[1].Value }
            $key = "$slug#$($mm.Groups[1].Value)"
            if (-not $touched.Contains($key)) { [void]$touched.Add($key) }
        }
    }
    foreach ($p in $parts) { if (-not $p.Ended) { $p.Outcome = 'unknown (no end marker)'; if ($lastTs -and ($null -eq $p.End -or $lastTs -gt $p.End)) { $p.End = $lastTs } } }

    # ---- totals and the split of output tokens / cost ----
    $all = @($parts) + @($overhead)
    $tot = New-RunDataPart -Kind 'total'
    foreach ($p in $all) {
        $tot.Turns += $p.Turns; $tot.Requests += $p.Requests; $tot.Input += $p.Input; $tot.CacheRead += $p.CacheRead; $tot.CacheWrite += $p.CacheWrite
        foreach ($m in $p.Models) { if (-not $tot.Models.Contains($m)) { [void]$tot.Models.Add($m) } }
    }
    $tot.Start = $firstTs; $tot.End = $lastTs
    $durationMs = $null; $status = ''; $isError = $null; $subtype = ''
    if ($result) {
        $ru = $result.usage
        $tot.Input = Get-RunDataNum $ru 'input_tokens'; $tot.CacheRead = Get-RunDataNum $ru 'cache_read_input_tokens'
        $tot.CacheWrite = Get-RunDataNum $ru 'cache_creation_input_tokens'; $tot.Output = Get-RunDataNum $ru 'output_tokens'
        $tot.Turns = [int](Get-RunDataNum $result 'num_turns')
        $tot.Cost = [double]$result.total_cost_usd; $tot.HasCost = ($null -ne $result.total_cost_usd)
        $durationMs = Get-RunDataNum $result 'duration_ms'
        $status = [regex]::Match("$($result.result)", 'LOOP-RESULT:\s*([A-Z\-]+)').Groups[1].Value
        $isError = $result.is_error; $subtype = "$($result.subtype)"
        # per model: split that model's output tokens and cost over the parts
        $mu = @{}
        if ($result.modelUsage) { foreach ($pr in $result.modelUsage.PSObject.Properties) { $mu[$pr.Name] = $pr.Value } }
        if ($mu.Count -eq 0) { $mu['*'] = [pscustomobject]@{ outputTokens = $tot.Output; costUSD = $tot.Cost } }
        foreach ($m in @($mu.Keys)) {
            $mOut = Get-RunDataNum $mu[$m] 'outputTokens'; $mCost = [double]0; if ($null -ne $mu[$m].costUSD) { $mCost = [double]$mu[$m].costUSD }
            if ($m -ne '*' -and -not $tot.Models.Contains($m) -and ($mOut -gt 0 -or $mCost -gt 0)) { [void]$tot.Models.Add($m) }
            $keyOf = { param($p) if ($m -eq '*') { @($p.Est.Keys) } else { @($m) } }
            $estSum = [double]0; $reqSum = 0
            foreach ($p in $all) { foreach ($k in (& $keyOf $p)) { if ($p.Est.ContainsKey($k)) { $estSum += $p.Est[$k] } }; $reqSum += $p.Requests }
            $outShare = @{}
            foreach ($p in $all) {
                $e = [double]0; foreach ($k in (& $keyOf $p)) { if ($p.Est.ContainsKey($k)) { $e += $p.Est[$k] } }
                if ($estSum -gt 0) { $outShare[$p] = $e / $estSum } elseif ($reqSum -gt 0) { $outShare[$p] = [double]$p.Requests / $reqSum } else { $outShare[$p] = 0 }
            }
            # cost: weight = input-side weight + 5 x the part's share of this model's output
            $wSum = [double]0; $w = @{}
            foreach ($p in $all) {
                $x = [double]0; foreach ($k in (& $keyOf $p)) { if ($p.Weight.ContainsKey($k)) { $x += $p.Weight[$k] } }
                $x += 5.0 * $mOut * $outShare[$p]
                $w[$p] = $x; $wSum += $x
            }
            foreach ($p in $parts) {
                $p.Output += [long][math]::Round($mOut * $outShare[$p])
                if ($wSum -gt 0) { $p.Cost += $mCost * $w[$p] / $wSum }
                $p.HasCost = $true
            }
        }
        # overhead takes the remainder, so the parts add up to the reported totals exactly
        $overhead.Output = $tot.Output; $overhead.Cost = $tot.Cost; $overhead.HasCost = $tot.HasCost
        foreach ($p in $parts) { $overhead.Output -= $p.Output; $overhead.Cost -= $p.Cost }
        if ($overhead.Output -lt 0) { $overhead.Output = 0 }
        if ($overhead.Cost -lt 0) { $overhead.Cost = 0 }
        $sumTurns = 0; foreach ($p in $parts) { $sumTurns += $p.Turns }
        $overhead.Turns = [math]::Max(0, $tot.Turns - $sumTurns)
        # a build session: the remainder (its final turn, rounding) is its issue's too
        if ($SessionIssue -gt 0 -and $byIssue.ContainsKey($SessionIssue)) {
            $own = $byIssue[$SessionIssue]
            $own.Turns += $overhead.Turns; $overhead.Turns = 0
            $own.Output += $overhead.Output; $overhead.Output = 0
            $own.Cost += $overhead.Cost; $overhead.Cost = 0
        }
    } else {
        [void]$notes.Add('the transcript has no result message (claude was killed or crashed), so output tokens and cost are unavailable')
        $tot.Output = -1; foreach ($p in $all) { $p.Output = -1 }
    }
    if (-not $markersFound) { [void]$notes.Add('no LOOP-ISSUE markers were found, so the run could not be split per issue: run totals only') }
    $wall = $null; if ($tot.Start -and $tot.End) { $wall = ($tot.End - $tot.Start) }
    return [pscustomobject]@{
        Parts = @($parts); Overhead = $overhead; Totals = $tot; MarkersFound = $markersFound; Notes = @($notes)
        CreatedIssues = @($created); TouchedIssues = @($touched); Status = $status; HasResult = ($null -ne $result)
        IsError = $isError; Subtype = $subtype; DurationMs = $durationMs; Wall = $wall
    }
}

# One run = several claude sessions (one per build, one for proposals; run-loop.ps1). Combine their parsed
# transcripts into the shape Read-LoopTranscript returns, so the comments and the json summary need no
# special case. $Sessions: {Kind (build | propose | review); Issue; Model; Data (Read-LoopTranscript)}.
#   Parts     every session's issue parts (a build session's whole cost is its issue's)
#   Overhead  the sum of the sessions' overheads (in practice: the proposal / review session)
#   Totals    the sum of the sessions' totals. If a session has no result message (killed), output tokens are
#             n/a for the run and the cost is the sum of the sessions that reported one (a note says so)
#   Sessions  one summary row per session (kind, issue, model, turns, tokens, cost, LOOP-RESULT)
# -Status: the run's LOOP-RESULT word (run-loop.ps1 Get-RunResult); each session's own is in Sessions.
function Merge-LoopRunData {
    param([object[]]$Sessions = @(), [string]$Status = '')
    $parts = New-Object System.Collections.ArrayList
    $byIssue = @{}
    $oh = New-RunDataPart -Kind 'overhead'; $tot = New-RunDataPart -Kind 'total'
    $notes = New-Object System.Collections.ArrayList; $created = New-Object System.Collections.ArrayList; $touched = New-Object System.Collections.ArrayList
    $rows = @(); $allResult = $true; $anyMarkers = $false; $dur = [long]0; $anyCost = $false
    $addModels = { param($to, $from) foreach ($m in @($from)) { if ($m -and -not $to.Models.Contains($m)) { [void]$to.Models.Add($m) } } }
    $sum = {
        param($to, $from)
        $to.Turns += $from.Turns; $to.Requests += $from.Requests; $to.Input += $from.Input; $to.CacheRead += $from.CacheRead; $to.CacheWrite += $from.CacheWrite
        if ($from.Output -lt 0 -or $to.Output -lt 0) { $to.Output = -1 } else { $to.Output += $from.Output }
        if ($from.HasCost) { $to.Cost += $from.Cost; $to.HasCost = $true }
        & $addModels $to $from.Models
        Add-RunDataTime $to $from.Start; Add-RunDataTime $to $from.End
    }
    foreach ($s in @($Sessions | Where-Object { $_ -and $_.Data })) {
        $d = $s.Data
        $label = "$($s.Kind)"; if ($s.Issue) { $label += " #$($s.Issue)" }
        foreach ($p in $d.Parts) {
            $q = $byIssue[[int]$p.Issue]
            if (-not $q) { $q = New-RunDataPart -Kind 'issue' -Issue $p.Issue; $q.Ended = $p.Ended; $q.Outcome = $p.Outcome; $byIssue[[int]$p.Issue] = $q; [void]$parts.Add($q) }
            elseif ($p.Ended) { $q.Outcome = $p.Outcome; $q.Ended = $true }
            & $sum $q $p
        }
        & $sum $oh $d.Overhead
        & $sum $tot $d.Totals
        if (-not $d.HasResult) { $allResult = $false }
        if ($d.Totals.HasCost) { $anyCost = $true }
        if ($d.MarkersFound) { $anyMarkers = $true }
        if ($d.DurationMs) { $dur += [long]$d.DurationMs }
        foreach ($n in $d.Notes) { [void]$notes.Add("$label session: $n") }
        foreach ($c in $d.CreatedIssues) { if (-not $created.Contains($c)) { [void]$created.Add($c) } }
        foreach ($c in $d.TouchedIssues) { if (-not $touched.Contains($c)) { [void]$touched.Add($c) } }
        # Agent: which agent the session was (build | propose | review | intake | observe | pm | qa | ux); the hub ledger
        # reads it. About: the issue a QA / UX session looked at (its cost stays out of that issue's build part)
        $about = 0; if ($s.PSObject.Properties.Name -contains 'About' -and $s.About) { $about = [int]$s.About }
        $rows += [pscustomobject]@{ Kind = "$($s.Kind)"; Agent = "$($s.Kind)"; Issue = $(if ($about) { $about } else { [int]$s.Issue }); Model = "$($s.Model)"; Status = $d.Status; HasResult = $d.HasResult
            Turns = $d.Totals.Turns; Input = $d.Totals.Input; Output = $d.Totals.Output; CacheRead = $d.Totals.CacheRead; CacheWrite = $d.Totals.CacheWrite
            Cost = $d.Totals.Cost; HasCost = $d.Totals.HasCost; Start = $d.Totals.Start; End = $d.Totals.End; Models = @($d.Totals.Models) }
    }
    if (-not $allResult -and $rows.Count -gt 0) {
        [void]$notes.Add('a session has no result message (killed or crashed): the run''s output tokens are n/a and its cost covers only the sessions that reported one')
        $tot.Output = -1; $oh.Output = -1
    }
    $wall = $null; if ($tot.Start -and $tot.End) { $wall = $tot.End - $tot.Start }
    return [pscustomobject]@{
        Parts = @($parts); Overhead = $oh; Totals = $tot; MarkersFound = $anyMarkers; Notes = @($notes)
        CreatedIssues = @($created); TouchedIssues = @($touched); Status = $Status; HasResult = ($allResult -and $rows.Count -gt 0)
        IsError = $null; Subtype = ''; DurationMs = $dur; Wall = $wall; Sessions = @($rows)
    }
}

# "Sessions: build #12 (claude-opus-5-5, 96 turns, $3.10, deployed); proposals (claude-sonnet-5-5, 41 turns, $0.62)"
function Format-RunDataSessions {
    param($Data)
    $rows = @(); if ($Data.PSObject.Properties.Name -contains 'Sessions') { $rows = @($Data.Sessions) }
    if ($rows.Count -eq 0) { return '' }
    $names = @{ build = 'build'; propose = 'proposals'; review = 'product review'; observe = 'observer'; pm = 'product manager'; intake = 'intake'; qa = 'QA'; ux = 'UX review' }
    $txt = @($rows | ForEach-Object {
            $n = $names["$($_.Kind)"]; if (-not $n) { $n = "$($_.Kind)" }; if ($_.Issue) { $n += " #$($_.Issue)" }
            $c = 'cost n/a'; if ($_.HasCost) { $c = '$' + ([double]$_.Cost).ToString('0.00', $script:RunDataInv) }
            $m = "$($_.Model)"; if (-not $m) { $m = (@($_.Models) -join '+') }; if (-not $m) { $m = 'model n/a' }
            $st = ''; if ($_.Status) { $st = ", $($_.Status)" } elseif (-not $_.HasResult) { $st = ', no result (killed?)' }
            "$n ($m, $($_.Turns) turns, $c$st)" })
    return "Sessions ($($rows.Count), one per job): $($txt -join '; ')."
}

function Get-RunDataOutcome {
    param([string]$Word)
    $w = ("$Word").Trim().ToLowerInvariant() -replace '[\s_]+', '-'
    switch -regex ($w) {
        '^deployed' { return 'deployed' }
        '^rolled-?back|^rollback' { return 'rolled back' }
        '^fail' { return 'failed' }
        '^skip' { return 'skipped' }
        default { if ($w) { return "other ($w)" } else { return 'unknown' } }
    }
}

# Whether this run was started by the task's daily trigger (start time within 10 minutes after a
# CalendarTrigger's time of day) or on demand (the approval watcher's Start-ScheduledTask, or by hand).
# Read-only (schtasks /query /xml works from a non-elevated or reduced token). Never throws.
function Get-LoopRunTrigger {
    param([string]$TaskName, [DateTime]$RunStart)
    try {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $xmlText = (& "$env:SystemRoot\System32\schtasks.exe" /query /tn $TaskName /xml 2>$null) -join "`n"
        $code = $LASTEXITCODE; $ErrorActionPreference = $prev
        if ($code -ne 0 -or -not $xmlText) { return 'unknown (task definition not readable)' }
        $times = @([regex]::Matches($xmlText, '(?s)<CalendarTrigger>.*?<StartBoundary>([^<]+)</StartBoundary>') | ForEach-Object { $_.Groups[1].Value })
        if ($times.Count -eq 0) { return 'on demand (the task has no daily trigger): approval watcher or a manual start' }
        foreach ($t in $times) {
            $d = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse($t, $script:RunDataInv, [Globalization.DateTimeStyles]::None, [ref]$d)) { continue }
            $sched = $RunStart.Date.Add($d.LocalDateTime.TimeOfDay)
            $diff = ($RunStart - $sched).TotalMinutes
            if ($diff -ge -1 -and $diff -le 10) { return "daily schedule ($($sched.ToString('HH:mm')))" }
        }
        $at = @($times | ForEach-Object { $d = [DateTimeOffset]::MinValue; if ([DateTimeOffset]::TryParse($_, $script:RunDataInv, [Globalization.DateTimeStyles]::None, [ref]$d)) { $d.LocalDateTime.ToString('HH:mm') } }) -join ', '
        return "on demand (not at the daily $at start): approval watcher or a manual start"
    } catch { return 'unknown' }
}

# ---- formatting ---------------------------------------------------------------------------------
function Format-RunDataNum { param([long]$N) if ($N -lt 0) { return 'n/a' }; return $N.ToString('N0', $script:RunDataInv) }
function Format-RunDataCost { param($Part, [switch]$Approx) if (-not $Part.HasCost) { return 'n/a' }; $s = '$' + $Part.Cost.ToString('0.00', $script:RunDataInv); if ($Approx) { return "~$s" }; return $s }
function Format-RunDataDur {
    param($Span)
    if ($null -eq $Span) { return 'n/a' }
    $s = [int][math]::Round($Span.TotalSeconds); if ($s -lt 0) { $s = 0 }
    if ($s -ge 3600) { return ('{0}h {1:00}m {2:00}s' -f [int][math]::Floor($s / 3600), [int][math]::Floor(($s % 3600) / 60), ($s % 60)) }
    return ('{0}m {1:00}s' -f [int][math]::Floor($s / 60), ($s % 60))
}
function Format-RunDataTs { param($Utc) if ($null -eq $Utc) { return 'n/a' }; return $Utc.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss', $script:RunDataInv) }
function Format-RunDataTokens {
    param($Part, [switch]$Approx)
    $o = Format-RunDataNum $Part.Output; if ($Approx -and $Part.Output -ge 0) { $o = "~$o" }
    return "in $(Format-RunDataNum $Part.Input) / out $o / cache read $(Format-RunDataNum $Part.CacheRead) / cache write $(Format-RunDataNum $Part.CacheWrite)"
}
function Get-RunDataCostNote {
    return '<sub>Cost is the API-equivalent figure Claude Code reports; on the Max subscription it is usage against the plan, not billing. Input and cache tokens are exact per issue; per-issue output tokens and cost (marked ~) are the run''s reported totals split by generated content and by Anthropic''s standard price ratios, so the columns add up to the run totals.</sub>'
}

function Get-RunDataContextLine {
    param($Data, [string]$RunId, [string]$Mode, [string]$Trigger)
    $st = $Data.Status; if (-not $st) { $st = 'none' }
    return "Run ``$RunId`` | mode $Mode | started by: $Trigger | LOOP-RESULT: $st"
}

# The "## Run data" comment for one issue. -Part $null = no per-issue split (markers missing).
function Format-RunDataComment {
    param([Parameter(Mandatory)]$Data, [int]$Issue, $Part, [string]$RunId, [string]$Mode, [string]$Trigger, [string]$Marker = '<!-- innovation-loop -->', [string]$Gap = '', [string]$Waiting = '', [string]$NeedsVe = '')
    $t = $Data.Totals; $oh = $Data.Overhead
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:RunDataMarker)
    [void]$sb.AppendLine('## Run data'); [void]$sb.AppendLine()
    [void]$sb.AppendLine((Get-RunDataContextLine $Data $RunId $Mode $Trigger)); [void]$sb.AppendLine()
    # the needs-Ve flag (run-loop.ps1): loud, right under the context line, before the numbers
    if ($NeedsVe) { [void]$sb.AppendLine("> **NEEDS VE: the loop is stopped.** $NeedsVe"); [void]$sb.AppendLine() }
    $sessionDur = $null; if ($Data.DurationMs) { $sessionDur = [TimeSpan]::FromMilliseconds($Data.DurationMs) } else { $sessionDur = $Data.Wall }
    $tCost = Format-RunDataCost $t
    if ($Part) {
        $models = ($Part.Models -join ', '); if (-not $models) { $models = 'n/a' }
        $ohLabel = 'Run overhead (preflight + research)'
        if ($Data.PSObject.Properties.Name -contains 'Sessions' -and @($Data.Sessions).Count -gt 0) { $ohLabel = 'Rest of run (proposal / review session)' }
        [void]$sb.AppendLine("| | Issue #$Issue | $ohLabel | Whole run |")
        [void]$sb.AppendLine('| --- | --- | --- | --- |')
        [void]$sb.AppendLine("| Outcome | **$($Part.Outcome)** | | LOOP-RESULT: $(if ($Data.Status) { $Data.Status } else { 'none' }) |")
        [void]$sb.AppendLine("| Start | $(Format-RunDataTs $Part.Start) | | $(Format-RunDataTs $t.Start) |")
        [void]$sb.AppendLine("| End | $(Format-RunDataTs $Part.End) | | $(Format-RunDataTs $t.End) |")
        $pd = $null; if ($Part.Start -and $Part.End) { $pd = $Part.End - $Part.Start }
        [void]$sb.AppendLine("| Duration | $(Format-RunDataDur $pd) | | $(Format-RunDataDur $sessionDur) |")
        [void]$sb.AppendLine("| Turns | $($Part.Turns) | $($oh.Turns) | $($t.Turns) |")
        [void]$sb.AppendLine("| Input tokens | $(Format-RunDataNum $Part.Input) | $(Format-RunDataNum $oh.Input) | $(Format-RunDataNum $t.Input) |")
        $po = Format-RunDataNum $Part.Output; $oo = Format-RunDataNum $oh.Output; if ($Part.Output -ge 0) { $po = "~$po"; $oo = "~$oo" }
        [void]$sb.AppendLine("| Output tokens | $po | $oo | $(Format-RunDataNum $t.Output) |")
        [void]$sb.AppendLine("| Cache read tokens | $(Format-RunDataNum $Part.CacheRead) | $(Format-RunDataNum $oh.CacheRead) | $(Format-RunDataNum $t.CacheRead) |")
        [void]$sb.AppendLine("| Cache creation tokens | $(Format-RunDataNum $Part.CacheWrite) | $(Format-RunDataNum $oh.CacheWrite) | $(Format-RunDataNum $t.CacheWrite) |")
        [void]$sb.AppendLine("| Cost (API equivalent) | $(Format-RunDataCost $Part -Approx) | $(Format-RunDataCost $oh -Approx) | $tCost |")
        [void]$sb.AppendLine("| Model(s) | $models | $(($oh.Models -join ', ')) | $(($t.Models -join ', ')) |")
        $others = @($Data.Parts | Where-Object { $_.Issue -ne $Issue })
        if ($others.Count -gt 0) {
            [void]$sb.AppendLine()
            $o = @($others | ForEach-Object { "#$($_.Issue) $($_.Outcome) ($(Format-RunDataDur ($_.End - $_.Start)), $($_.Turns) turns, $(Format-RunDataCost $_ -Approx))" }) -join '; '
            [void]$sb.AppendLine("Other issues in this run: $o.")
        }
    } else {
        [void]$sb.AppendLine('| Whole run | |'); [void]$sb.AppendLine('| --- | --- |')
        [void]$sb.AppendLine("| Start / end | $(Format-RunDataTs $t.Start) / $(Format-RunDataTs $t.End) |")
        [void]$sb.AppendLine("| Duration | $(Format-RunDataDur $sessionDur) |")
        [void]$sb.AppendLine("| Turns | $($t.Turns) |")
        [void]$sb.AppendLine("| Tokens | $(Format-RunDataTokens $t) |")
        [void]$sb.AppendLine("| Cost (API equivalent) | $tCost |")
        [void]$sb.AppendLine("| Model(s) | $(($t.Models -join ', ')) |")
    }
    $sl = Format-RunDataSessions $Data
    if ($sl) { [void]$sb.AppendLine(); [void]$sb.AppendLine($sl) }
    if ($Gap) { [void]$sb.AppendLine(); [void]$sb.AppendLine($Gap) }
    if ($Waiting) { [void]$sb.AppendLine(); [void]$sb.AppendLine($Waiting) }
    if ($Data.Notes.Count -gt 0) { [void]$sb.AppendLine(); foreach ($n in $Data.Notes) { [void]$sb.AppendLine("Note: $n.") } }
    [void]$sb.AppendLine(); [void]$sb.AppendLine((Get-RunDataCostNote))
    return $sb.ToString()
}

# One paragraph on the live-server gap merge-pr.ps1 saw for this issue in THIS run (state\merge-gap-<n>.json,
# written by merge-pr only; ignored when it belongs to another run). '' when there was no gap.
function Get-RunDataGapLine {
    param([string]$LoopHome, [string]$RunId, [int]$Issue)
    try {
        if (-not $LoopHome -or -not $RunId) { return '' }
        $p = Join-Path $LoopHome "state\merge-gap-$Issue.json"
        if (-not (Test-Path -LiteralPath $p)) { return '' }
        $g = [IO.File]::ReadAllText($p) | ConvertFrom-Json
        if ("$($g.runId)" -ne $RunId) { return '' }
        $commits = @($g.commits | Where-Object { $_ })
        if ($commits.Count -eq 0) { return '' }
        $clean = { param($s) ConvertTo-ProgressText "$s" 120 }
        $t = "Live-server gap when merging: $($commits.Count) commit(s) already on main were not yet on the live server: $((@($commits | ForEach-Object { & $clean $_ })) -join '; ')."
        $inert = @($g.inertProtected | Where-Object { $_ })
        if ($inert.Count -gt 0) { $t += " Protected but inert on server-pc (ignored): $((@($inert | Select-Object -First 12 | ForEach-Object { & $clean $_ })) -join ', ')$(if ($inert.Count -gt 12) { ', ...' })." }
        $srv = @($g.serverCommits | Where-Object { $_ })
        if ($srv.Count -gt 0) { $t += " Server changes that went live with this change's deploy: $((@($srv | ForEach-Object { & $clean $_ })) -join '; ')." }
        if ($g.refused) { $t += " The merge was refused: protected paths the server runs ($((@($g.blocked) | ForEach-Object { & $clean $_ }) -join ', '))." }
        return $t
    } catch { return '' }
}

# One-line footer for a proposal opened by this run.
function Format-RunDataProposalComment {
    param([Parameter(Mandatory)]$Data, [string]$RunId, [string]$Mode, [string]$Trigger, [string]$Marker = '<!-- innovation-loop -->', [string]$Waiting = '')
    $oh = $Data.Overhead; $label = 'Run overhead (preflight + research)'
    if ($Data.PSObject.Properties.Name -contains 'Sessions' -and @($Data.Sessions).Count -gt 0) { $label = 'The proposal / review session' }
    if (-not $Data.MarkersFound -and $Data.Parts.Count -eq 0) { $label = 'Whole run' ; $oh = $Data.Totals }
    $approx = ($Data.Parts.Count -gt 0)
    $line = "<sub>Run data: proposed by run ``$RunId`` ($Mode, started by: $Trigger). $label, shared by every proposal it opened: $($oh.Turns) turns, tokens $(Format-RunDataTokens $oh -Approx:$approx), $(Format-RunDataCost $oh -Approx:$approx) API-equivalent (usage on the Max plan, not billing).</sub>"
    if ($Waiting) { $line += "`n`n<sub>$Waiting</sub>" }
    return "$Marker`n$($script:RunDataMarker)`n$line`n"
}

# The QA / UX comment on an issue deployed by an earlier run (Phase 3): the loop marker, the run-data marker, the line.
function Format-RunDataQaComment {
    param([string]$Line, [string]$RunId, [string]$Mode, [string]$Trigger, [string]$Marker = '<!-- innovation-loop -->')
    return "$Marker`n$($script:RunDataMarker)`n## Run data: QA`n`nRun ``$RunId`` ($Mode, started by: $Trigger) checked this deployed change on the live site.`n`n$Line`n"
}

# ---- posting -------------------------------------------------------------------------------------
function Invoke-RunDataGh {
    param([string]$GhExe, [string[]]$GhArgs)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & $GhExe @GhArgs 2>&1 | ForEach-Object { "$_" }
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($out -join "`n") }
    } finally { $ErrorActionPreference = $prev }
}

# Post the run-data comments. Only on issues (not PRs) of -Repo that carry loop:proposal; at most
# -MaxIssues issue comments and -MaxProposals proposal footers. Writes the bodies and a JSON summary next to
# the transcript. Returns the number of comments posted. Never throws.
function Publish-LoopRunData {
    param(
        [string]$TranscriptPath = '',
        # one run = several sessions: {Path; Kind (build | propose | review); Issue (build sessions); Model}
        [object[]]$Sessions = @(),
        [string]$Status = '',    # the run's LOOP-RESULT word when -Sessions is used
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$GhExe,
        [string]$RunId, [string]$Mode, [string]$Trigger = 'unknown',
        [string]$Marker = '<!-- innovation-loop -->',
        [string]$OutDir = '',
        [string]$LoopHome = '',
        [string]$Waiting = '',   # 'Failed, waiting on Ve: #n (reason)' line (run-loop.ps1), appended to every comment
        [string]$NeedsVe = '',   # the needs-Ve flag this run set (run-loop.ps1): a loud line at the top of every issue's comment
        [hashtable]$Approvals = @{},   # build issue -> 'label' | 'via-spec #<spec>' (run-loop.ps1); via-spec is noted
        [object[]]$WaitingOnSlice = @(),   # slices skipped as waiting-on-slice (run-loop.ps1 Get-SliceWaitRunData), recorded in run data
        [hashtable]$QaLines = @{},   # Phase 3: issue -> QA verdict / UX review line(s) (product-qa.ps1); appended to its comment, or posted alone
        [int]$MaxIssues = 6, [int]$MaxProposals = 5,
        [switch]$NoPost
    )
    $posted = 0
    try {
        if (@($Sessions).Count -gt 0) {
            $parsed = @($Sessions | Where-Object { $_ -and $_.Path -and (Test-Path -LiteralPath $_.Path) } | ForEach-Object {
                    [pscustomobject]@{ Kind = $_.Kind; Issue = [int]$_.Issue; Model = $_.Model; About = $(if ($_.PSObject.Properties.Name -contains 'About') { [int]$_.About } else { 0 }); Data = (Read-LoopTranscript -Path $_.Path -SessionIssue ([int]$_.Issue)) } })
            $data = Merge-LoopRunData -Sessions $parsed -Status $Status
            if (-not $OutDir) { $OutDir = Split-Path -Parent (@($Sessions)[0].Path) }
        } else {
            $data = Read-LoopTranscript -Path $TranscriptPath
            if (-not $OutDir) { $OutDir = Split-Path -Parent $TranscriptPath }
        }
        $base = Join-Path $OutDir "run-$RunId.rundata"
        $t = $data.Totals
        Write-RunDataLog ("run data: issues=[{0}] markers={1} turns={2} tokens(in/out/cr/cw)={3}/{4}/{5}/{6} cost={7} proposals=[{8}] trigger={9}" -f `
            (@($data.Parts | ForEach-Object { "#$($_.Issue):$($_.Outcome)" }) -join ' '), $data.MarkersFound, $t.Turns, $t.Input, $t.Output, $t.CacheRead, $t.CacheWrite,
            (Format-RunDataCost $t), ($data.CreatedIssues -join ' '), $Trigger)
        try {
            $summary = [ordered]@{ runId = $RunId; mode = $Mode; trigger = $Trigger; status = $data.Status; markersFound = $data.MarkersFound; notes = $data.Notes
                totals = $t | Select-Object Turns, Requests, Input, Output, CacheRead, CacheWrite, Cost, Models
                overhead = $data.Overhead | Select-Object Turns, Requests, Input, Output, CacheRead, CacheWrite, Cost, Models
                issues = @($data.Parts | Select-Object Issue, Outcome, Start, End, Turns, Requests, Input, Output, CacheRead, CacheWrite, Cost, Models)
                createdIssues = $data.CreatedIssues; touchedIssues = $data.TouchedIssues; waitingOnVe = $Waiting; needsVe = $NeedsVe; waitingOnSlice = @($WaitingOnSlice | Where-Object { $_ })
                approvals = @(if ($Approvals) { @($Approvals.Keys | Sort-Object | ForEach-Object { [ordered]@{ issue = [int]$_; approval = "$($Approvals[$_])" } }) })
                qa = @(if ($QaLines) { @($QaLines.Keys | Sort-Object | ForEach-Object { [ordered]@{ issue = [int]$_; line = "$($QaLines[$_])" } }) })
                sessions = @(if ($data.PSObject.Properties.Name -contains 'Sessions') { @($data.Sessions | Select-Object Kind, Agent, Issue, Model, Status, HasResult, Turns, Input, Output, CacheRead, CacheWrite, Cost, Start, End, Models) }) }
            [IO.File]::WriteAllText("$base.json", ($summary | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
        } catch { Write-RunDataLog "run data: could not write $base.json: $_" 'WARN' }

        # which issues get which comment
        $targets = New-Object System.Collections.ArrayList
        if ($data.MarkersFound) {
            foreach ($p in $data.Parts) { [void]$targets.Add([pscustomobject]@{ Issue = $p.Issue; Part = $p }) }
        } else {
            foreach ($k in $data.TouchedIssues) {
                $slug, $num = $k -split '#', 2
                if ($slug -and $slug -ne $Repo) { continue }
                if ($data.CreatedIssues -contains "$Repo#$num") { continue }
                if (-not (@($targets | Where-Object { $_.Issue -eq [int]$num }).Count)) { [void]$targets.Add([pscustomobject]@{ Issue = [int]$num; Part = $null }) }
            }
        }
        $proposals = @($data.CreatedIssues | Where-Object { $_ -like "$Repo#*" } | ForEach-Object { [int](($_ -split '#', 2)[1]) } | Select-Object -Unique)
        if ($targets.Count -gt $MaxIssues) { Write-RunDataLog "run data: $($targets.Count) issues, posting on the first $MaxIssues only" 'WARN'; $targets = @($targets | Select-Object -First $MaxIssues) }
        if ($proposals.Count -gt $MaxProposals) { $proposals = @($proposals | Select-Object -First $MaxProposals) }

        $jobs = New-Object System.Collections.ArrayList
        foreach ($tg in $targets) {
            $gapLine = Get-RunDataGapLine -LoopHome $LoopHome -RunId $RunId -Issue $tg.Issue
            $cb = Format-RunDataComment -Data $data -Issue $tg.Issue -Part $tg.Part -RunId $RunId -Mode $Mode -Trigger $Trigger -Marker $Marker -Gap $gapLine -Waiting $Waiting -NeedsVe $NeedsVe
            if ($Approvals -and $Approvals.ContainsKey([int]$tg.Issue) -and "$($Approvals[[int]$tg.Issue])" -like 'via-spec*') { $cb = $cb.TrimEnd() + "`n`nApproval: $($Approvals[[int]$tg.Issue]) (auto-approved by the spec's approval; no ``approved`` label of its own)`n" }
            if ($QaLines -and $QaLines.ContainsKey([int]$tg.Issue)) { $cb = $cb.TrimEnd() + "`n`n$($QaLines[[int]$tg.Issue])`n" }
            [void]$jobs.Add([pscustomobject]@{ Issue = $tg.Issue; Body = $cb })
        }
        # a QA / UX verdict for an issue built in an earlier run: a short comment of its own
        foreach ($k in @(if ($QaLines) { @($QaLines.Keys | Sort-Object) })) {
            if (@($jobs | Where-Object { [int]$_.Issue -eq [int]$k }).Count) { continue }
            [void]$jobs.Add([pscustomobject]@{ Issue = [int]$k; Body = (Format-RunDataQaComment -Line "$($QaLines[$k])" -RunId $RunId -Mode $Mode -Trigger $Trigger -Marker $Marker) })
        }
        foreach ($n in $proposals) { [void]$jobs.Add([pscustomobject]@{ Issue = $n; Body = (Format-RunDataProposalComment -Data $data -RunId $RunId -Mode $Mode -Trigger $Trigger -Marker $Marker -Waiting $Waiting) }) }
        if ($jobs.Count -eq 0) { Write-RunDataLog 'run data: no issue to post on'; return 0 }
        foreach ($j in $jobs) {
            $bodyPath = "$base-$($j.Issue).md"
            try { [IO.File]::WriteAllText($bodyPath, $j.Body, (New-Object Text.UTF8Encoding $false)) } catch { Write-RunDataLog "run data: could not write $bodyPath : $_" 'WARN'; continue }
            if ($NoPost) { continue }
            try {
                # only real issues of the hub repo that the loop proposed (a marker line is plain text and must
                # not be able to send a comment anywhere else)
                $v = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$($j.Issue)")
                if ($v.Code -ne 0) { Write-RunDataLog "run data: cannot read $Repo#$($j.Issue); not posting" 'WARN'; continue }
                $iss = $v.Output | ConvertFrom-Json
                $isPr = ($iss.PSObject.Properties.Name -contains 'pull_request' -and $iss.pull_request)
                $labels = @($iss.labels | ForEach-Object { $_.name })
                if ($isPr -or ($labels -notcontains 'loop:proposal')) { Write-RunDataLog "run data: $Repo#$($j.Issue) is not a loop:proposal issue; not posting" 'WARN'; continue }
                $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('issue', 'comment', "$($j.Issue)", '-R', $Repo, '--body-file', $bodyPath)
                if ($r.Code -eq 0) { $posted++; Write-RunDataLog "run data: posted on $Repo#$($j.Issue) $($r.Output)" }
                else { Write-RunDataLog "run data: posting on $Repo#$($j.Issue) failed (exit $($r.Code)): $($r.Output)" 'WARN' }
            } catch { Write-RunDataLog "run data: posting on $Repo#$($j.Issue) failed: $_" 'WARN' }
        }
    } catch {
        Write-RunDataLog "run data: skipped after an error (the run's result is unaffected): $_" 'WARN'
    }
    return $posted
}

# ==================================================================================================
# Progress: ONE "## Progress" comment per issue per run, created on first use and edited in place
# (PATCH) at each stage, so Ve gets one notification for it instead of one per stage. State (comment id,
# stage times) lives in <LoopHome>\state\progress\<RunId>-<issue>.json, written only by progress.ps1 and the
# runner, never by the session. Before every edit the comment is re-read and must be on the hub repo, on
# that issue, and carry both the loop marker and the progress marker: the loop can only ever edit its own
# progress comment.
# ==================================================================================================
$script:ProgressMarker = '<!-- innovation-loop:progress -->'
$script:ProgressStages = [ordered]@{
    approval = 'Approval verified'; plan = 'Plan posted'; branch = 'Branch created'; test = 'Local build + tests'
    pr = 'PR opened'; ci = 'CI checks'; merge = 'Merged'; deploy = 'Deploying'; verify = 'Verifying live'; done = 'Done'
}
function Get-ProgressIcon {
    param([string]$Status)
    switch ($Status) {
        'ok' { return [char]::ConvertFromUtf32(0x2705) }        # white heavy check mark
        'running' { return [char]::ConvertFromUtf32(0x23F3) }   # hourglass
        'stopped' { return [char]::ConvertFromUtf32(0x23F3) }   # hourglass: was still running when the build stopped
        'failed' { return [char]::ConvertFromUtf32(0x274C) }    # cross mark
        'skipped' { return [char]::ConvertFromUtf32(0x23ED) }   # next track (skipped)
        'warn' { return [char]::ConvertFromUtf32(0x26A0) }      # warning sign
        default { return [char]::ConvertFromUtf32(0x25AB) }     # white small square (pending)
    }
}
function ConvertTo-ProgressText {
    # one line, no HTML comments (cannot forge a marker), no @mentions, bounded length
    param([string]$Text, [int]$Max = 300)
    $t = ("$Text" -replace '[\r\n\t]+', ' ').Trim()
    $t = $t -replace '<!--', '&lt;!--' -replace '-->', '--&gt;' -replace '@', '&#64;'
    if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max - 3) + '...' }
    return $t
}
function Format-ProgressClock { param($Utc) if ($null -eq $Utc) { return '' }; return $Utc.ToLocalTime().ToString('h:mm tt', $script:RunDataInv) }

function New-ProgressState {
    param([int]$Issue, [string]$RunId, [string]$Repo, [string[]]$Stages)
    $st = [ordered]@{}
    foreach ($s in $Stages) { $st[$s] = [ordered]@{ status = 'pending'; start = $null; end = $null; detail = '' } }
    return [ordered]@{ issue = $Issue; runId = $RunId; repo = $Repo; commentId = [long]0; created = [DateTime]::UtcNow.ToString('o'); updated = $null
        current = ''; outcome = ''; warning = ''; stages = $st }
}
function Read-ProgressState {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $o = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    # back to ordered hashtables (PS 5.1 ConvertFrom-Json gives PSCustomObject)
    $st = [ordered]@{}
    foreach ($p in $o.stages.PSObject.Properties) { $st[$p.Name] = [ordered]@{ status = "$($p.Value.status)"; start = $p.Value.start; end = $p.Value.end; detail = "$($p.Value.detail)" } }
    return [ordered]@{ issue = [int]$o.issue; runId = "$($o.runId)"; repo = "$($o.repo)"; commentId = [long]$o.commentId; created = $o.created; updated = $o.updated
        current = "$($o.current)"; outcome = "$($o.outcome)"; warning = "$($o.warning)"; stages = $st }
}
function Save-ProgressState {
    param([string]$Path, $State)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($Path, ($State | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
}

# Apply one update. -Status: running (default) | ok | failed | skipped. -Stage done needs -Outcome.
# Advancing to a stage closes every earlier stage still running: ok normally, 'stopped' on a failure.
function Update-ProgressState {
    param($State, [string]$Stage, [string]$Status = 'running', [string]$Detail = '', [string]$Outcome = '', [DateTime]$Now = [DateTime]::UtcNow)
    $stages = $State.stages
    if (-not $stages.Contains($Stage)) { throw "unknown stage '$Stage' (known: $(@($stages.Keys) -join ', '))" }
    $nowS = $Now.ToUniversalTime().ToString('o')
    $keys = @($stages.Keys); $idx = [array]::IndexOf($keys, $Stage)
    # Advancing closes earlier stages still running: as ok on the normal path. On a failure (a stage marked
    # failed, or a failed/rolled-back end) they become 'stopped' (still an hourglass, "not finished"): a stage
    # that was still running proves nothing about itself. On #22 a merge-pr refusal ended the build while CI
    # was merely pending, and the old close-as-failed rule showed a red cross on CI. Only a stage explicitly
    # marked -Status failed, or the done line of a failed end, shows the cross.
    $closeAs = 'ok'
    if ($Stage -eq 'done' -and (Get-RunDataOutcome $Outcome) -notin @('deployed', 'skipped')) { $closeAs = 'stopped' }
    if ($Stage -ne 'done' -and $Status -eq 'failed') { $closeAs = 'stopped' }
    for ($i = 0; $i -lt $idx; $i++) {
        $e = $stages[$keys[$i]]
        if ($e.status -eq 'running') { $e.status = $closeAs; $e.end = $nowS }
    }
    $e = $stages[$Stage]
    if ($Detail) { $e.detail = (ConvertTo-ProgressText $Detail) }
    if ($Stage -eq 'done') {
        $o = Get-RunDataOutcome $Outcome
        $State.outcome = $o
        if ($o -eq 'deployed') { $e.status = 'ok' } elseif ($o -eq 'skipped') { $e.status = 'skipped' } else { $e.status = 'failed' }
        if (-not $e.start) { $e.start = $nowS }; $e.end = $nowS
        $State.current = 'done'
    } else {
        if (-not $e.start) { $e.start = $nowS }
        $e.status = $Status
        if ($Status -ne 'running') { $e.end = $nowS } else { $e.end = $null }
        $State.current = $Stage
    }
    $State.updated = $nowS
    return $State
}

function Format-ProgressComment {
    param($State, [string]$Marker = '<!-- innovation-loop -->', [DateTime]$Now = [DateTime]::UtcNow)
    $Now = $Now.ToUniversalTime()
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:ProgressMarker)
    [void]$sb.AppendLine('## Progress'); [void]$sb.AppendLine()
    $stages = $State.stages
    $first = $null
    foreach ($k in $stages.Keys) { $s = ConvertTo-RunDataTime $stages[$k].start; if ($s -and (-not $first -or $s -lt $first)) { $first = $s } }
    $endAll = $Now; if ($State.current -eq 'done' -or $State.warning) { $u = ConvertTo-RunDataTime $State.updated; if ($u) { $endAll = $u } }
    $elapsed = ''; if ($first) { $elapsed = Format-RunDataDur ($endAll - $first) }
    $label = $script:ProgressStages
    if ($State.warning) {
        [void]$sb.AppendLine("**$(Get-ProgressIcon 'warn') $(ConvertTo-ProgressText $State.warning 400)**")
    } elseif ($State.current -eq 'done') {
        $icon = Get-ProgressIcon $stages['done'].status
        [void]$sb.AppendLine("**$icon Done: $($State.outcome)** (total $elapsed)")
    } elseif ($State.current) {
        $c = $stages[$State.current]; $cs = ConvertTo-RunDataTime $c.start
        $what = $label[$State.current]; if ($c.detail) { $what = "$what - $($c.detail)" }
        $run = ''; if ($cs) { $run = " (started $(Format-ProgressClock $cs), $(Format-RunDataDur ($Now - $cs)) so far)" }
        [void]$sb.AppendLine("**Now: $(Get-ProgressIcon $c.status) $what$run**")
    }
    [void]$sb.AppendLine()
    foreach ($k in $stages.Keys) {
        $e = $stages[$k]; $s = ConvertTo-RunDataTime $e.start; $en = ConvertTo-RunDataTime $e.end
        $txt = $label[$k]; if (-not $txt) { $txt = $k }
        if ($k -eq 'done' -and $State.outcome) { $txt = "Done: $($State.outcome)" }
        $when = ''
        if ($s -and $en -and ($en - $s).TotalSeconds -ge 60) { $when = "$(Format-ProgressClock $s) - $(Format-ProgressClock $en) ($(Format-RunDataDur ($en - $s)))" }
        elseif ($en) { $when = Format-ProgressClock $en }
        elseif ($s) { $when = "since $(Format-ProgressClock $s)" }
        $line = "- $(Get-ProgressIcon $e.status) "
        if ($e.status -eq 'running') { $line += "**$txt**" } elseif ($e.status -eq 'stopped') { $line += "$txt (not finished)" } else { $line += $txt }
        if ($when) { $line += " | $when" }
        if ($e.detail) { $line += " | $($e.detail)" }
        [void]$sb.AppendLine($line)
    }
    [void]$sb.AppendLine()
    $upd = ConvertTo-RunDataTime $State.updated
    $el = ''; if ($elapsed) { $el = " | elapsed $elapsed" }
    [void]$sb.AppendLine("<sub>Run ``$($State.runId)``$el | last update $(Format-ProgressClock $upd). This comment is edited in place as the build moves on; the loop posts separate comments only when the PR opens, on a failure or rollback, and at the end.</sub>")
    return $sb.ToString()
}

# Create or edit the progress comment for $State. Returns $true on success. Never throws.
function Send-ProgressComment {
    param($State, [string]$GhExe, [string]$Body, [string]$WorkDir, [string]$Marker = '<!-- innovation-loop -->')
    try {
        $repo = $State.repo; $n = $State.issue
        if (-not (Test-Path -LiteralPath $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null }
        $tmp = Join-Path $WorkDir ("progress-{0}-{1}.body.json" -f $State.runId, $n)
        [IO.File]::WriteAllText($tmp, (@{ body = $Body } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
        if ($State.commentId -gt 0) {
            $g = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$repo/issues/comments/$($State.commentId)")
            if ($g.Code -ne 0) { Write-RunDataLog "progress: cannot read comment $($State.commentId): $($g.Output)" 'WARN'; return $false }
            $c = $g.Output | ConvertFrom-Json
            $own = ("$($c.issue_url)" -like "*/repos/$repo/issues/$n") -and "$($c.body)".Contains($Marker) -and "$($c.body)".Contains($script:ProgressMarker)
            if (-not $own) { Write-RunDataLog "progress: comment $($State.commentId) is not this loop's progress comment on $repo#$n; not editing it" 'WARN'; return $false }
            $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$repo/issues/comments/$($State.commentId)", '-X', 'PATCH', '--input', $tmp)
            if ($r.Code -ne 0) { Write-RunDataLog "progress: edit failed (exit $($r.Code)): $($r.Output)" 'WARN'; return $false }
            return $true
        }
        $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$repo/issues/$n/comments", '-X', 'POST', '--input', $tmp)
        if ($r.Code -ne 0) { Write-RunDataLog "progress: create failed (exit $($r.Code)): $($r.Output)" 'WARN'; return $false }
        $State.commentId = [long](($r.Output | ConvertFrom-Json).id)
        return $true
    } catch { Write-RunDataLog "progress: $_" 'WARN'; return $false }
}

# '' when $Repo#$Issue is an issue (not a PR) carrying loop:proposal and approved, else the reason.
# Checked once, when the progress comment is first created.
function Test-ProgressIssue {
    param([string]$GhExe, [string]$Repo, [int]$Issue)
    $v = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$Issue")
    if ($v.Code -ne 0) { return "cannot read $Repo#$Issue" }
    $i = $v.Output | ConvertFrom-Json
    if ($i.PSObject.Properties.Name -contains 'pull_request' -and $i.pull_request) { return "$Repo#$Issue is a pull request" }
    $labels = @($i.labels | ForEach-Object { $_.name })
    foreach ($need in 'loop:proposal', 'approved') { if ($labels -notcontains $need) { return "$Repo#$Issue has no $need label" } }
    return ''
}

# The whole progress.ps1 action: load or create the state, apply the update, render, create/edit the comment,
# save. Returns $true when the comment was written. Never throws (progress must never fail a build).
function Invoke-LoopProgress {
    param([string]$LoopHome, [string]$RunId, [string]$Repo, [string]$GhExe, [int]$Issue, [string]$Stage, [string]$Status = 'running',
        [string]$Detail = '', [string]$Outcome = '', [string[]]$Stages, [string]$Marker = '<!-- innovation-loop -->')
    try {
        if (-not $RunId) { Write-RunDataLog 'progress: no run id (not inside a loop run); nothing posted' 'WARN'; return $false }
        if ($Stage -eq 'done' -and -not $Outcome) { Write-RunDataLog 'progress: -Stage done needs -Outcome deployed|failed|rolled-back|skipped' 'WARN'; return $false }
        $dir = Join-Path $LoopHome 'state\progress'
        $path = Join-Path $dir "$RunId-$Issue.json"
        $st = Read-ProgressState $path
        if (-not $st) {
            $why = Test-ProgressIssue -GhExe $GhExe -Repo $Repo -Issue $Issue
            if ($why) { Write-RunDataLog "progress: $why; not posting" 'WARN'; return $false }
            $st = New-ProgressState -Issue $Issue -RunId $RunId -Repo $Repo -Stages $Stages
        }
        if ($st.current -eq 'done') { Write-RunDataLog "progress: #$Issue is already done in this run; not changing it" 'WARN'; return $false }
        $st = Update-ProgressState -State $st -Stage $Stage -Status $Status -Detail $Detail -Outcome $Outcome
        $body = Format-ProgressComment -State $st -Marker $Marker
        $ok = Send-ProgressComment -State $st -GhExe $GhExe -Body $body -WorkDir $dir -Marker $Marker
        Save-ProgressState -Path $path -State $st
        return $ok
    } catch { Write-RunDataLog "progress: $_" 'WARN'; return $false }
}

# Runner side, after claude exited: any progress comment of this run that never reached "done" gets a
# warning naming the stage it stopped in. Returns the issues it marked. Never throws.
function Complete-LoopProgress {
    param([string]$LoopHome, [string]$RunId, [string]$GhExe, [string]$Marker = '<!-- innovation-loop -->', [string]$LogName = '', [int]$Issue = 0)
    $marked = @()
    try {
        $dir = Join-Path $LoopHome 'state\progress'
        if (-not (Test-Path -LiteralPath $dir)) { return @() }
        $filter = "$RunId-*.json"; if ($Issue -gt 0) { $filter = "$RunId-$Issue.json" }   # -Issue: only that build session's issue
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter $filter -File)) {
            try {
                $st = Read-ProgressState $f.FullName
                if (-not $st -or $st.current -eq 'done' -or $st.commentId -le 0) { continue }
                $label = $script:ProgressStages[$st.current]; if (-not $label) { $label = 'before the first stage' }
                $log = $LogName; if (-not $log) { $log = "run-$RunId.log" }
                $st.warning = "Run ended during: $label. The session stopped before this issue finished; see the run log $log and the Run data comment below."
                $now = [DateTime]::UtcNow.ToString('o')
                foreach ($k in @($st.stages.Keys)) { if ($st.stages[$k].status -eq 'running') { $st.stages[$k].status = 'warn'; $st.stages[$k].end = $now } }
                $st.updated = $now
                $body = Format-ProgressComment -State $st -Marker $Marker
                if (Send-ProgressComment -State $st -GhExe $GhExe -Body $body -WorkDir $dir -Marker $Marker) { $marked += $st.issue; Write-RunDataLog "progress: marked #$($st.issue) as ended during '$label'" }
                Save-ProgressState -Path $f.FullName -State $st
            } catch { Write-RunDataLog "progress: could not finalize $($f.Name): $_" 'WARN' }
        }
    } catch { Write-RunDataLog "progress: finalize skipped: $_" 'WARN' }
    return $marked
}

# ==================================================================================================
# Spec progress (runner side, after the sessions): ONE "## Spec progress" checklist comment per approved
# spec, created and then edited in place, and the spec closed once every slice is done. $Specs: the `specs`
# array of check-approval.ps1 -List (approval already verified there; only approved ones are touched).
# Needs gate-rules.ps1 (Format-SpecProgress) dot-sourced. Never throws; returns the issues it updated.
# ==================================================================================================
function Publish-SpecProgress {
    param([string]$LoopHome, [string]$RunId, [string]$Repo, [string]$GhExe, [object[]]$Specs = @(), [string]$Marker = '<!-- innovation-loop -->',
        [string]$Who = 'the owner', [switch]$NoPost)
    $done = @()
    foreach ($s in @($Specs | Where-Object { $_ -and $_.approved })) {
        try {
            $n = [int]$s.issue
            $plan = [pscustomobject]@{ Issue = $n; Of = [int]$s.of; Valid = [bool]$s.valid; Problem = "$($s.problem)"; Complete = [bool]$s.complete; Duplicates = @()
                Slices = @(@($s.slices) | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ K = [int]$_.k; Title = "$($_.title)"; Issue = [int]$_.issue; Status = "$($_.status)"; Done = [bool]$_.done } }) }
            $body = Format-SpecProgress -Plan $plan -RunId $RunId -Marker $Marker -Who $Who
            $dir = Join-Path $LoopHome 'state\spec'
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $sp = Join-Path $dir "spec-$n.json"
            $st = $null; if (Test-Path -LiteralPath $sp) { $st = [IO.File]::ReadAllText($sp) | ConvertFrom-Json }
            # the checklist without its "updated after run" footer decides whether anything changed
            $key = (($body -split "`n") | Where-Object { $_ -notmatch '^<sub>Updated by the runner' }) -join "`n"
            $hash = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($key))) -replace '-', ''
            $cid = [long]0; if ($st) { $cid = [long]$st.commentId }
            if ($NoPost) { [IO.File]::WriteAllText((Join-Path $dir "spec-$n.md"), $body, (New-Object Text.UTF8Encoding $false)); $done += $n; continue }
            if ($st -and "$($st.hash)" -eq $hash -and -not $plan.Complete) { continue }
            $v = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$n")
            if ($v.Code -ne 0) { Write-RunDataLog "spec progress: cannot read $Repo#$n" 'WARN'; continue }
            $iss = $v.Output | ConvertFrom-Json
            $labels = @($iss.labels | ForEach-Object { $_.name })
            if ($iss.state -ne 'open' -or $labels -notcontains 'loop:spec' -or $labels -notcontains 'loop:proposal' -or ($iss.PSObject.Properties.Name -contains 'pull_request' -and $iss.pull_request)) {
                Write-RunDataLog "spec progress: $Repo#$n is not an open loop:spec issue; not touching it" 'WARN'; continue
            }
            $tmp = Join-Path $dir "spec-$n.body.json"
            [IO.File]::WriteAllText($tmp, (@{ body = $body } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
            $ok = $false
            if ($cid -gt 0) {
                $g = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/comments/$cid")
                $own = $false
                if ($g.Code -eq 0) { $c = $g.Output | ConvertFrom-Json; $own = ("$($c.issue_url)" -like "*/repos/$Repo/issues/$n") -and "$($c.body)".Contains($Marker) -and "$($c.body)".Contains($script:SpecProgressMarker) }
                if ($own) { $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/comments/$cid", '-X', 'PATCH', '--input', $tmp); $ok = ($r.Code -eq 0) }
                else { Write-RunDataLog "spec progress: comment $cid is not this loop's checklist on #$n; posting a new one" 'WARN'; $cid = 0 }
            }
            if ($cid -le 0) {
                $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$n/comments", '-X', 'POST', '--input', $tmp)
                if ($r.Code -eq 0) { $cid = [long](($r.Output | ConvertFrom-Json).id); $ok = $true }
            }
            if (-not $ok) { Write-RunDataLog "spec progress: could not write the checklist on #$n" 'WARN'; continue }
            [IO.File]::WriteAllText($sp, (@{ issue = $n; commentId = $cid; hash = $hash; runId = $RunId } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
            Write-RunDataLog "spec progress: #$n checklist updated ($(@($plan.Slices | Where-Object { $_.Done }).Count) of $($plan.Slices.Count) slices done)"
            if ($plan.Complete) {
                $cl = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('issue', 'close', "$n", '-R', $Repo, '--reason', 'completed')
                if ($cl.Code -eq 0) { Write-RunDataLog "spec progress: every slice of #$n is done; closed the spec" } else { Write-RunDataLog "spec progress: closing #$n failed: $($cl.Output)" 'WARN' }
            }
            $done += $n
        } catch { Write-RunDataLog "spec progress: #$($s.issue): $_" 'WARN' }
    }
    return @($done)
}

# ==================================================================================================
# Ve's requests (loop:request): the runner's ONE plan comment per request (created after the intake session,
# then edited in place as the progress checklist), loop:planned, and the closing synopsis. Needs gate-rules.ps1
# (Format-RequestPlan, Format-RequestSynopsis, Get-RequestProblems) dot-sourced. Never throws.
# ==================================================================================================
# Create (CommentId 0) or edit the plan comment on request $Request. $Children: Get-RequestChildState objects.
# Returns the comment id, or 0 when nothing was written. A comment id that is not this loop's plan comment on
# this request is never edited.
function Publish-RequestPlan {
    param([string]$LoopHome, [string]$RunId, [string]$Repo, [string]$GhExe, [int]$Request, [object[]]$Children = @(), [string]$Mode = '',
        [long]$CommentId = 0, [string]$Marker = '<!-- innovation-loop -->', [string]$Who = 'Ve', [switch]$NoPost)
    try {
        $body = Format-RequestPlan -Request $Request -Children $Children -Mode $Mode -RunId $RunId -Marker $Marker -Who $Who
        $dir = Join-Path $LoopHome 'state\request'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        if ($NoPost) { [IO.File]::WriteAllText((Join-Path $dir "request-$Request.md"), $body, (New-Object Text.UTF8Encoding $false)); return [long]0 }
        $key = (($body -split "`n") | Where-Object { $_ -notmatch '^<sub>Updated by the runner' }) -join "`n"
        $hash = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($key))) -replace '-', ''
        $sp = Join-Path $dir "request-$Request.json"
        $st = $null; if (Test-Path -LiteralPath $sp) { try { $st = [IO.File]::ReadAllText($sp) | ConvertFrom-Json } catch { } }
        if ($CommentId -gt 0 -and $st -and [long]$st.commentId -eq $CommentId -and "$($st.hash)" -eq $hash) { return $CommentId }
        $tmp = Join-Path $dir "request-$Request.body.json"
        [IO.File]::WriteAllText($tmp, (@{ body = $body } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
        $cid = $CommentId; $ok = $false
        if ($cid -gt 0) {
            $g = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/comments/$cid")
            $own = $false
            if ($g.Code -eq 0) { $c = $g.Output | ConvertFrom-Json; $own = ("$($c.issue_url)" -like "*/repos/$Repo/issues/$Request") -and "$($c.body)".Contains($Marker) -and "$($c.body)".Contains($script:RequestPlanMarker) }
            if (-not $own) { Write-RunDataLog "request plan: comment $cid is not this loop's plan on #$Request; not touching it" 'WARN'; return [long]0 }
            $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/comments/$cid", '-X', 'PATCH', '--input', $tmp); $ok = ($r.Code -eq 0)
        } else {
            $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$Request/comments", '-X', 'POST', '--input', $tmp)
            if ($r.Code -eq 0) { $cid = [long](($r.Output | ConvertFrom-Json).id); $ok = $true }
        }
        if (-not $ok) { Write-RunDataLog "request plan: could not write the plan on #$Request" 'WARN'; return [long]0 }
        [IO.File]::WriteAllText($sp, (@{ request = $Request; commentId = $cid; hash = $hash; runId = $RunId } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
        return $cid
    } catch { Write-RunDataLog "request plan #${Request}: $_" 'WARN'; return [long]0 }
}

# Every run: refresh each planned request's checklist; when every listed issue is closed (deployed or closed by
# Ve), post the synopsis and close the request. $Plans: check-approval.ps1 -List `requestPlans`. Returns the
# requests it closed.
function Publish-RequestProgress {
    param([string]$LoopHome, [string]$RunId, [string]$Repo, [string]$GhExe, [object[]]$Plans = @(), [string]$Marker = '<!-- innovation-loop -->',
        [string]$Who = 'Ve', [switch]$NoPost)
    $closed = @()
    foreach ($p in @($Plans | Where-Object { $_ })) {
        try {
            $n = [int]$p.request
            $kids = @(@($p.children) | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Number = [int]$_.number; Title = "$($_.title)"; Status = "$($_.status)"; Done = [bool]$_.done; Deployed = [bool]$_.deployed; Failed = [bool]$_.failed; Manual = [bool]$_.manual } })
            [void](Publish-RequestPlan -LoopHome $LoopHome -RunId $RunId -Repo $Repo -GhExe $GhExe -Request $n -Children $kids -Mode "$($p.mode)" -CommentId ([long]$p.planCommentId) -Marker $Marker -Who $Who -NoPost:$NoPost)
            if ($kids.Count -eq 0 -or @($kids | Where-Object { -not $_.Done }).Count -gt 0) { continue }
            $syn = Format-RequestSynopsis -Request $n -Children $kids -What "$($p.what)" -Marker $Marker
            if ($NoPost) { Write-RunDataLog "request progress: #$n is complete (dry run: synopsis not posted)"; continue }
            $v = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$n")
            if ($v.Code -ne 0) { continue }
            $iss = $v.Output | ConvertFrom-Json
            if (@(Get-RequestProblems -Issue $iss -Owner $script:Owner -Marker $Marker).Count -gt 0) { Write-RunDataLog "request progress: #$n is no longer an open request of $($script:Owner); not closing it" 'WARN'; continue }
            $tmp = Join-Path $LoopHome "state\request\request-$n.synopsis.json"
            [IO.File]::WriteAllText($tmp, (@{ body = $syn } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
            $r = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('api', "repos/$Repo/issues/$n/comments", '-X', 'POST', '--input', $tmp)
            if ($r.Code -ne 0) { Write-RunDataLog "request progress: could not post the synopsis on #$n" 'WARN'; continue }
            $cl = Invoke-RunDataGh -GhExe $GhExe -GhArgs @('issue', 'close', "$n", '-R', $Repo, '--reason', 'completed')
            if ($cl.Code -eq 0) { Write-RunDataLog "request progress: every issue of request #$n is done; synopsis posted and the request closed"; $closed += $n }
            else { Write-RunDataLog "request progress: closing #$n failed: $($cl.Output)" 'WARN' }
        } catch { Write-RunDataLog "request progress: #$($p.request): $_" 'WARN' }
    }
    return @($closed)
}

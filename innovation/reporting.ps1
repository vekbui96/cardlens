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
    param([Parameter(Mandatory)][string]$Path)
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
                if ($cur -eq $p) { $cur = $overhead }
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
    param([Parameter(Mandatory)]$Data, [int]$Issue, $Part, [string]$RunId, [string]$Mode, [string]$Trigger, [string]$Marker = '<!-- innovation-loop -->')
    $t = $Data.Totals; $oh = $Data.Overhead
    $sb = New-Object Text.StringBuilder
    [void]$sb.AppendLine($Marker); [void]$sb.AppendLine($script:RunDataMarker)
    [void]$sb.AppendLine('## Run data'); [void]$sb.AppendLine()
    [void]$sb.AppendLine((Get-RunDataContextLine $Data $RunId $Mode $Trigger)); [void]$sb.AppendLine()
    $sessionDur = $null; if ($Data.DurationMs) { $sessionDur = [TimeSpan]::FromMilliseconds($Data.DurationMs) } else { $sessionDur = $Data.Wall }
    $tCost = Format-RunDataCost $t
    if ($Part) {
        $models = ($Part.Models -join ', '); if (-not $models) { $models = 'n/a' }
        [void]$sb.AppendLine("| | Issue #$Issue | Run overhead (preflight + research) | Whole run |")
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
    if ($Data.Notes.Count -gt 0) { [void]$sb.AppendLine(); foreach ($n in $Data.Notes) { [void]$sb.AppendLine("Note: $n.") } }
    [void]$sb.AppendLine(); [void]$sb.AppendLine((Get-RunDataCostNote))
    return $sb.ToString()
}

# One-line footer for a proposal opened by this run.
function Format-RunDataProposalComment {
    param([Parameter(Mandatory)]$Data, [string]$RunId, [string]$Mode, [string]$Trigger, [string]$Marker = '<!-- innovation-loop -->')
    $oh = $Data.Overhead; $label = 'Run overhead (preflight + research)'
    if (-not $Data.MarkersFound -and $Data.Parts.Count -eq 0) { $label = 'Whole run' ; $oh = $Data.Totals }
    $approx = ($Data.Parts.Count -gt 0)
    $line = "<sub>Run data: proposed by run ``$RunId`` ($Mode, started by: $Trigger). $label, shared by every proposal it opened: $($oh.Turns) turns, tokens $(Format-RunDataTokens $oh -Approx:$approx), $(Format-RunDataCost $oh -Approx:$approx) API-equivalent (usage on the Max plan, not billing).</sub>"
    return "$Marker`n$($script:RunDataMarker)`n$line`n"
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
        [Parameter(Mandatory)][string]$TranscriptPath,
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$GhExe,
        [string]$RunId, [string]$Mode, [string]$Trigger = 'unknown',
        [string]$Marker = '<!-- innovation-loop -->',
        [string]$OutDir = '',
        [int]$MaxIssues = 6, [int]$MaxProposals = 5,
        [switch]$NoPost
    )
    $posted = 0
    try {
        $data = Read-LoopTranscript -Path $TranscriptPath
        if (-not $OutDir) { $OutDir = Split-Path -Parent $TranscriptPath }
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
                createdIssues = $data.CreatedIssues; touchedIssues = $data.TouchedIssues }
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
        foreach ($tg in $targets) { [void]$jobs.Add([pscustomobject]@{ Issue = $tg.Issue; Body = (Format-RunDataComment -Data $data -Issue $tg.Issue -Part $tg.Part -RunId $RunId -Mode $Mode -Trigger $Trigger -Marker $Marker) }) }
        foreach ($n in $proposals) { [void]$jobs.Add([pscustomobject]@{ Issue = $n; Body = (Format-RunDataProposalComment -Data $data -RunId $RunId -Mode $Mode -Trigger $Trigger -Marker $Marker) }) }
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
# Advancing to a stage closes every earlier stage still running as ok.
function Update-ProgressState {
    param($State, [string]$Stage, [string]$Status = 'running', [string]$Detail = '', [string]$Outcome = '', [DateTime]$Now = [DateTime]::UtcNow)
    $stages = $State.stages
    if (-not $stages.Contains($Stage)) { throw "unknown stage '$Stage' (known: $(@($stages.Keys) -join ', '))" }
    $nowS = $Now.ToUniversalTime().ToString('o')
    $keys = @($stages.Keys); $idx = [array]::IndexOf($keys, $Stage)
    # advancing closes earlier stages still running: as ok, or as failed when this is a failed/rolled-back end
    $closeAs = 'ok'
    if ($Stage -eq 'done' -and (Get-RunDataOutcome $Outcome) -notin @('deployed', 'skipped')) { $closeAs = 'failed' }
    if ($Stage -ne 'done' -and $Status -eq 'failed') { $closeAs = 'ok' }
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
        if ($e.status -eq 'running') { $line += "**$txt**" } else { $line += $txt }
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
    param([string]$LoopHome, [string]$RunId, [string]$GhExe, [string]$Marker = '<!-- innovation-loop -->', [string]$LogName = '')
    $marked = @()
    try {
        $dir = Join-Path $LoopHome 'state\progress'
        if (-not (Test-Path -LiteralPath $dir)) { return @() }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "$RunId-*.json" -File)) {
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

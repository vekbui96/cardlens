<#
.SYNOPSIS
  Ephemeral PR previews, runner side: build a PR head into a preview slot, tear slots down, housekeeping.
  Dot-sourced by run-loop.ps1 (needs lib.ps1 and preview-rules.ps1, which it loads). Run directly for status:

    powershell -ExecutionPolicy Bypass -File innovation\preview.ps1 -ShowSlots     # slots, serve entries (read-only)
    powershell -ExecutionPolicy Bypass -File innovation\preview.ps1 -CleanupSlots  # tear down expired / closed-PR slots

.DESCRIPTION
  Serving needs no process: Tailscale Serve maps https://server-pc.tail0e4194.ts.net:8460-8462 (tailnet only) to the
  folders <LOOP_HOME>\preview\slots\0..2 permanently (preview-serve-setup.ps1, Ve's one-time step). The loop only
  swaps the files in a slot folder. Never `tailscale serve reset`, never a serve change from here: this file only
  READS the serve config to check the slots are mapped.

  A preview is built in a fresh git worktree of the PR head under <LOOP_HOME>\preview\work (node_modules linked from
  the loop clone when the lockfile matches, else `npm ci`), by preview-build.ps1 under the REDUCED token (the PR's
  code runs there), with mocks forced on. The runner then deletes source maps, scans the bundle for any live host or
  API port (preview-rules.ps1 Find-PreviewBundleLeaks: one hit and the preview is refused), copies it into the slot,
  removes the worktree and checks the served preview.json names the head. Slots: state\previews.json.
#>
[CmdletBinding()]
param([switch]$ShowSlots, [switch]$CleanupSlots)

if (-not (Get-Command Write-Log -ErrorAction SilentlyContinue)) { . "$PSScriptRoot\lib.ps1" }
. "$PSScriptRoot\preview-rules.ps1"

$script:PreviewDir = Join-Path $script:LoopHome 'preview'
$script:PreviewStatePath = Join-Path $script:LoopHome 'state\previews.json'
$script:TailscaleExe = 'C:\Program Files\Tailscale\tailscale.exe'

# This box resolves its own tailnet name to the public Funnel addresses, where only 443 / 8443 answer; tailnet-only
# ports answer on the tailnet IP. So the box reaches a preview through the tailnet IP with the real name (TLS / SNI
# intact): curl --resolve here, Chromium --host-resolver-rules in preview-browse.mjs. Other tailnet devices use MagicDNS.
function Get-PreviewTailnetIp {
    try { $ip = "$(@(& $script:TailscaleExe ip -4 2>$null) | Select-Object -First 1)".Trim(); if ($ip -match '^100\.\d+\.\d+\.\d+$') { return $ip } } catch { }
    return ''
}
# GET a preview URL from this box; the body, or '' when it did not answer 200.
function Get-PreviewServed {
    param([string]$Url)
    $ip = Get-PreviewTailnetIp
    $a = @('-s', '-m', '15', '-w', "`n%{http_code}")
    if ($ip -and $Url -match '^https://([^/:]+):(\d+)/') { $a += @('--resolve', "$($Matches[1]):$($Matches[2]):$ip") }
    $out = @(& "$env:SystemRoot\System32\curl.exe" @a $Url 2>$null)
    if ($out.Count -lt 1 -or "$($out[-1])".Trim() -ne '200') { return '' }
    return (@($out | Select-Object -First ($out.Count - 1)) -join "`n")
}
function Get-PreviewSlotDir { param([int]$Slot) return (Join-Path $script:PreviewDir "slots\$Slot") }

function Read-PreviewState {
    try { if (Test-Path -LiteralPath $script:PreviewStatePath) { return ([IO.File]::ReadAllText($script:PreviewStatePath).TrimStart([char]0xFEFF) | ConvertFrom-Json) } } catch { Write-Log "previews: state unreadable ($_); treating every slot as free" 'WARN' }
    return $null
}
function Save-PreviewState {
    param([object[]]$Slots)
    $o = [ordered]@{ schema = 1; host = $script:PreviewHost; ports = $script:PreviewPorts; ttlHours = $script:PreviewTtlHours; updatedAt = [datetime]::UtcNow.ToString('o'); slots = @($Slots) }
    Save-JsonFile -Path $script:PreviewStatePath -Object $o
}
function Set-PreviewSlot {
    param($Record)
    $slots = @(Get-PreviewSlots (Read-PreviewState))
    $out = @($slots | ForEach-Object { if ([int]$_.port -eq [int]$Record.port) { $Record } else { $_ } })
    Save-PreviewState $out
}

# The serve config, read-only: which preview ports map to their slot folder (tailnet only).
function Get-PreviewServeStatus {
    try {
        $out = & $script:TailscaleExe serve status --json 2>$null
        if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Ok = $false; Ports = @(); Why = "tailscale serve status exited $LASTEXITCODE" } }
        $cfg = ($out -join "`n") | ConvertFrom-Json
    } catch { return [pscustomobject]@{ Ok = $false; Ports = @(); Why = "cannot read the serve config: $_" } }
    $dirs = @{}; for ($i = 0; $i -lt $script:PreviewPorts.Count; $i++) { $dirs[[int]$script:PreviewPorts[$i]] = Get-PreviewSlotDir $i }
    return (Test-PreviewServeConfig -Config $cfg -SlotDirs $dirs)
}

function Write-PreviewPlaceholder {
    param([int]$Slot)
    $d = Get-PreviewSlotDir $Slot
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    foreach ($c in @(Get-ChildItem -LiteralPath $d -Force)) { Remove-Item -LiteralPath $c.FullName -Recurse -Force }
    $html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No preview</title>' +
        '<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#111;color:#ddd}main{max-width:560px;margin:auto}</style></head>' +
        "<body><main><h1>No preview in this slot</h1><p>CardLens loop preview slot $Slot is empty. A preview lives here only while a loop PR is being checked (at most $($script:PreviewTtlHours) hours).</p></main></body></html>"
    $u = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Join-Path $d 'index.html'), $html, $u)
    [IO.File]::WriteAllText((Join-Path $d 'preview.json'), (@{ status = 'free'; slot = $Slot } | ConvertTo-Json -Compress), $u)
}

# Tear one slot down: placeholder files, state free. -Why goes to the log.
function Reset-PreviewSlot {
    param($Slot, [string]$Why)
    try {
        Write-PreviewPlaceholder -Slot ([int]$Slot.slot)
        $free = [pscustomobject][ordered]@{ slot = [int]$Slot.slot; port = [int]$Slot.port; status = 'free'; issue = 0; pr = 0; sha = ''; url = (Get-PreviewUrl ([int]$Slot.port)); createdAt = ''; expiresAt = ''; runId = '' }
        Set-PreviewSlot $free
        Write-Log "preview: slot $($Slot.slot) (port $($Slot.port)) torn down$(if ($Slot.pr) { " (PR #$($Slot.pr))" }): $Why"
        return $true
    } catch { Write-Log "preview: could not tear down slot $($Slot.slot): $_" 'WARN'; return $false }
}

# Delete a worktree folder without following the node_modules junction into the loop clone.
function Remove-PreviewWorktree {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return }
    $nm = Join-Path $Path 'node_modules'
    try {
        $it = Get-Item -LiteralPath $nm -Force -ErrorAction SilentlyContinue
        if ($it -and ($it.Attributes -band [IO.FileAttributes]::ReparsePoint)) { [IO.Directory]::Delete($nm, $false) }   # the link only, never its target
    } catch { Write-Log "preview: could not unlink $nm ($_)" 'WARN' }
    Invoke-Git -Repo $script:Clone -Arguments @('worktree', 'remove', '--force', $Path) -AllowFail -Quiet | Out-Null
    if (Test-Path -LiteralPath $Path) { & cmd.exe /d /c "rmdir /s /q `"$Path`"" 2>&1 | Out-Null }   # rmdir removes junctions as links
    Invoke-Git -Repo $script:Clone -Arguments @('worktree', 'prune') -AllowFail -Quiet | Out-Null
}

# Build PR -Pr at -Sha into a slot and check it is served. Returns Ok, Url, Port, Slot, Why, ExpiresAt, Seconds.
function New-LoopPreview {
    param([int]$Issue, [int]$Pr, [string]$Sha, [string]$RunId)
    $t0 = Get-Date
    $r = [pscustomobject]@{ Ok = $false; Url = ''; Port = 0; Slot = -1; Why = ''; ExpiresAt = ''; Seconds = 0; Log = '' }
    $sha7 = $Sha.Substring(0, [math]::Min(7, $Sha.Length))
    $serve = Get-PreviewServeStatus
    if (-not $serve.Ok) { $r.Why = "preview serving is not set up ($($serve.Why)); Ve runs preview-serve-setup.ps1 once"; return $r }
    $slots = @(Get-PreviewSlots (Read-PreviewState) | Where-Object { @($serve.Ports) -contains [int]$_.port })
    $parkedPrs = @(); try { $parkedPrs = @(Get-ParkedMerges (Read-State $script:MergeParkedName) | ForEach-Object { [int]$_.pr }) } catch { }   # look window: Ve may be looking at them
    $sel = Select-PreviewSlot -Slots $slots -Pr $Pr -Protect $parkedPrs
    if (-not $sel.Slot) { $r.Why = $sel.Reason; return $r }
    Write-Log "preview #${Issue}: PR #$Pr at $sha7 -> $($sel.Reason)"
    if ($sel.Evicts) { [void](Reset-PreviewSlot -Slot $sel.Evicts -Why 'slot needed for a new preview') }
    $slot = $sel.Slot; $r.Slot = [int]$slot.slot; $r.Port = [int]$slot.port
    Set-PreviewSlot (New-PreviewSlotRecord -Slot $slot -Issue $Issue -Pr $Pr -Sha $Sha -RunId $RunId -Status 'building')
    $wt = Join-Path $script:PreviewDir "work\pr$Pr-$sha7"
    $logPath = Join-Path $script:LoopHome "logs\preview-$RunId-$Issue-$sha7.log"; $r.Log = $logPath
    $fail = { param([string]$W) $r.Why = $W; Write-Log "preview #${Issue}: $W" 'WARN'; Remove-PreviewWorktree $wt; [void](Reset-PreviewSlot -Slot $slot -Why "preview failed: $W"); $r.Seconds = [int]((Get-Date) - $t0).TotalSeconds; return $r }
    try {
        Remove-PreviewWorktree $wt
        New-Item -ItemType Directory -Path (Split-Path $wt) -Force | Out-Null
        Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', "pull/$Pr/head") -AllowFail -Quiet | Out-Null
        $has = Invoke-Git -Repo $script:Clone -Arguments @('cat-file', '-e', "$Sha^{commit}") -AllowFail -Quiet
        if ($has.Code -ne 0) { return (& $fail "head $sha7 is not in the loop clone") }
        $add = Invoke-Git -Repo $script:Clone -Arguments @('worktree', 'add', '--detach', '--force', $wt, $Sha) -AllowFail -Quiet
        if ($add.Code -ne 0) { return (& $fail "git worktree add failed: $(@($add.Output) | Select-Object -Last 1)") }
        # node_modules: link the clone's when its lockfile is the PR's (the build session ran npm ci on this head)
        $install = $true
        $cl = Join-Path $script:Clone 'package-lock.json'; $wl = Join-Path $wt 'package-lock.json'; $cnm = Join-Path $script:Clone 'node_modules'
        if ((Test-Path -LiteralPath $cl) -and (Test-Path -LiteralPath $wl) -and (Test-Path -LiteralPath (Join-Path $cnm 'vite\bin\vite.js')) -and
            (Get-FileHash -LiteralPath $cl).Hash -eq (Get-FileHash -LiteralPath $wl).Hash) {
            New-Item -ItemType Junction -Path (Join-Path $wt 'node_modules') -Target $cnm | Out-Null; $install = $false
        }
        $a = "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\preview-build.ps1`" -Dir `"$wt`""; if ($install) { $a += ' -Install' }
        Write-Log "preview #${Issue}: building under the reduced token ($(if ($install) { 'npm ci + ' })vite build, mocks on); log $logPath"
        $run = Start-ReducedAndWait -File "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentString $a -WorkDir $wt -StdOut $logPath -StdErr "$logPath.err" -TimeoutMinutes $(if ($install) { 20 } else { 10 })
        $last = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }) | Select-Object -Last 1
        if ($run.TimedOut) { return (& $fail 'the preview build timed out') }
        if ($run.ExitCode -ne 0 -or "$last" -notmatch '^PREVIEW-BUILD OK') { return (& $fail "the preview build failed: $last") }
        $dist = Join-Path $wt 'dist-preview'
        Get-ChildItem -LiteralPath $dist -Recurse -File -Filter '*.map' | Remove-Item -Force
        $why = Test-PreviewIndex ([IO.File]::ReadAllText((Join-Path $dist 'index.html')))
        if ($why) { return (& $fail $why) }
        $files = @(Get-ChildItem -LiteralPath $dist -Recurse -File | Where-Object { $_.Name -match $script:PreviewScanRx } | ForEach-Object { [pscustomobject]@{ Name = $_.FullName.Substring($dist.Length + 1); Text = [IO.File]::ReadAllText($_.FullName) } })
        $leaks = @(Find-PreviewBundleLeaks -Files $files)
        if ($leaks.Count) { return (& $fail "the bundle names a live host or API port ($(@($leaks | Select-Object -First 3 | ForEach-Object { "$($_.What) in $($_.File)" }) -join '; ')): refused") }
        Write-Log "preview #${Issue}: bundle scanned ($($files.Count) files, no live host or API port)"
        $rec = New-PreviewSlotRecord -Slot $slot -Issue $Issue -Pr $Pr -Sha $Sha -RunId $RunId -Status 'up'
        $sd = Get-PreviewSlotDir ([int]$slot.slot)
        Write-PreviewPlaceholder -Slot ([int]$slot.slot)
        Remove-Item -LiteralPath (Join-Path $sd 'index.html') -Force
        & robocopy.exe $dist $sd /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { return (& $fail "copying the bundle into slot $($slot.slot) failed (robocopy $LASTEXITCODE)") }
        [IO.File]::WriteAllText((Join-Path $sd 'preview.json'), ([ordered]@{ status = 'up'; slot = [int]$slot.slot; issue = $Issue; pr = $Pr; sha = $Sha; builtAt = $rec.createdAt; expiresAt = $rec.expiresAt; mocks = $true } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
        Remove-PreviewWorktree $wt
        $url = Get-PreviewUrl ([int]$slot.port); $seen = ''
        for ($i = 0; $i -lt 6; $i++) {
            try { $h = Get-PreviewServed -Url (Get-CacheBustedUrl "${url}preview.json"); if ($h) { $seen = "$(($h | ConvertFrom-Json).sha)" } } catch { }
            if ($seen -eq $Sha) { break }
            Start-Sleep -Seconds 3
        }
        if ($seen -ne $Sha) { return (& $fail "the tailnet URL $url does not serve this head (saw '$seen')") }
        Set-PreviewSlot $rec
        $r.Ok = $true; $r.Url = $url; $r.ExpiresAt = $rec.expiresAt; $r.Seconds = [int]((Get-Date) - $t0).TotalSeconds
        Write-Log "preview #${Issue}: up at $url (PR #$Pr $sha7, $($r.Seconds) s, until $($rec.expiresAt))"
        return $r
    } catch { return (& $fail "$_") }
}

# Tear down the preview(s) of -Pr (any slot). Returns how many slots were reset.
function Remove-LoopPreview {
    param([int]$Pr, [string]$Why)
    $n = 0
    foreach ($s in @(Get-PreviewSlots (Read-PreviewState) | Where-Object { $_.status -ne 'free' -and [int]$_.pr -eq $Pr })) { if (Reset-PreviewSlot -Slot $s -Why $Why) { $n++ } }
    return $n
}

# Expired slots, slots whose PR is no longer open, crashed builds, leftover worktrees. -Keep: PRs in progress.
function Invoke-PreviewHousekeeping {
    param([int[]]$Keep = @())
    $done = @()
    try {
        $slots = @(Get-PreviewSlots (Read-PreviewState))
        $states = @{}
        foreach ($s in @($slots | Where-Object { $_.status -ne 'free' -and [int]$_.pr -gt 0 })) {
            try { $p = Get-GhJson @('api', "repos/$($script:Repo)/pulls/$([int]$s.pr)"); $states[[int]$s.pr] = $(if ($p.merged_at) { 'merged' } else { "$($p.state)" }) } catch { }
        }
        foreach ($c in @(Select-PreviewCleanup -Slots $slots -PrStates $states -Keep $Keep)) { if (Reset-PreviewSlot -Slot $c.Slot -Why $c.Why) { $done += "slot $($c.Slot.slot) (PR #$($c.Slot.pr)): $($c.Why)" } }
        # placeholders for free slots that lost their files; leftover worktrees of crashed builds
        foreach ($s in @(Get-PreviewSlots (Read-PreviewState) | Where-Object { $_.status -eq 'free' })) { if (-not (Test-Path -LiteralPath (Join-Path (Get-PreviewSlotDir ([int]$s.slot)) 'index.html'))) { Write-PreviewPlaceholder -Slot ([int]$s.slot) } }
        $wd = Join-Path $script:PreviewDir 'work'
        if (Test-Path -LiteralPath $wd) { foreach ($d in @(Get-ChildItem -LiteralPath $wd -Directory)) { if (-not (@($Keep | Where-Object { $d.Name -like "pr$_-*" }).Count)) { Remove-PreviewWorktree $d.FullName; $done += "worktree $($d.Name) removed" } } }
    } catch { Write-Log "preview housekeeping: $_" 'WARN' }
    foreach ($x in $done) { Write-Log "preview housekeeping: $x" }
    return @($done)
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($ShowSlots -or -not $CleanupSlots) {
        $sv = Get-PreviewServeStatus
        Write-Output "serve: $(if ($sv.Ok) { 'ok' } else { 'NOT READY' }) ($($sv.Why))"
        foreach ($s in @(Get-PreviewSlots (Read-PreviewState))) { Write-Output ("slot {0} port {1}: {2}{3}" -f $s.slot, $s.port, $s.status, $(if ($s.status -ne 'free') { " #$($s.issue) PR #$($s.pr) $($s.sha.Substring(0, [math]::Min(7, $s.sha.Length))) until $($s.expiresAt) $($s.url)" })) }
    }
    if ($CleanupSlots) {
        if (Test-Path -LiteralPath (Join-Path $script:LoopHome 'lock\run.lock')) { Write-Output 'a loop run holds the lock; not cleaning up now (the run cleans up itself)'; exit 1 }
        $d = @(Invoke-PreviewHousekeeping)
        Write-Output "cleanup: $($d.Count) change(s)$(if ($d.Count) { ': ' + ($d -join '; ') })"
    }
}

<#
.SYNOPSIS
  Resource limits for the loop's heavy local work (Ve, 2026-11-24, item B "preview resource limits"). Self-contained
  (no lib.ps1), dot-sourced by test-gate.ps1, preview-build.ps1, update-snapshots.ps1 and run-loop.ps1; tested by
  test-resource-rules.ps1.

.DESCRIPTION
  server-pc (i5-10500T, 16 GB) also runs the CardLens API, recognition, the contact API, the hub and the Target stock
  checker (Playwright too), so the loops keep out of their way:
  - Priority: the gate (npm ci, format, verify, vite build), the preview build and every loop browser run at
    BelowNormal. Set on the script's own process; Windows starts the children of a BelowNormal process BelowNormal, so
    npm, node, vite and Chromium inherit it. Not Idle: an Idle browser starved by a busy CPU times out and QA would
    read the timeout as a failure. The docker baselines run in Docker's VM, whose priority is not set from here.
  - One test browser at a time across all loops: browser-lock.mjs (the lock file under
    %USERPROFILE%\.innovation-loop-shared; smoke.mjs, preview-browse.mjs and update-snapshots.ps1 take it).
  - Memory: under 2 GB free RAM, browser work is skipped (fail-open, "unverified (busy)"): the preview QA session is
    not started at all (Get-PreviewQaResourceGate, run-loop.ps1) and smoke.mjs / preview-browse.mjs refuse themselves.
  - Target stock checker: NOT gated. Its only state is GET 127.0.0.1:8788/api/target/state behind the bot's token
    (D:\services\target-stock-checker\.env, which the loops must never read), and no file shows an active buy;
    BelowNormal keeps loop browsers behind the bot's Normal-priority Playwright instead.
#>

$script:MinFreeMemoryBytes = [int64]2 * 1024 * 1024 * 1024

# BelowNormal for a process (default: this one). $true when set.
function Set-LowPriority {
    param([int]$ProcessId = $PID)
    try { (Get-Process -Id $ProcessId -ErrorAction Stop).PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal; return $true } catch { return $false }
}

# Free physical memory in bytes, or -1 when it cannot be read.
function Get-FreeMemoryBytes {
    try { return [int64](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).FreePhysicalMemory * 1024 } catch { return [int64]-1 }
}

# Pure: may browser work start with -FreeBytes free? Unknown (-1) is not gated. Ok, Why. Same rule as
# browser-lock.mjs memoryGate.
function Get-MemoryGate {
    param([int64]$FreeBytes, [int64]$MinBytes = $script:MinFreeMemoryBytes)
    $mb = { param([int64]$b) [int][math]::Round($b / 1MB) }
    if ($FreeBytes -lt 0) { return [pscustomobject]@{ Ok = $true; Why = 'free memory unknown: not gated' } }
    if ($FreeBytes -lt $MinBytes) { return [pscustomobject]@{ Ok = $false; Why = "free memory $(& $mb $FreeBytes) MB is under $(& $mb $MinBytes) MB" } }
    return [pscustomobject]@{ Ok = $true; Why = "free memory $(& $mb $FreeBytes) MB" }
}

# Pure: before the preview QA session (run-loop.ps1 Invoke-PreviewRound). Ok = start it; otherwise the gate is
# unverified (busy): the merge goes on and QA runs on the live site after the deploy, as for any preview problem.
function Get-PreviewQaResourceGate {
    param([int64]$FreeBytes = (Get-FreeMemoryBytes), [int64]$MinBytes = $script:MinFreeMemoryBytes)
    $m = Get-MemoryGate -FreeBytes $FreeBytes -MinBytes $MinBytes
    if (-not $m.Ok) { return [pscustomobject]@{ Ok = $false; Why = "unverified (busy): $($m.Why); preview QA skipped" } }
    return [pscustomobject]@{ Ok = $true; Why = $m.Why }
}

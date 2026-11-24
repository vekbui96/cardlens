<#
  Tests for resource-rules.ps1 and the browser-lock wiring (item B, 2026-11-24): priority, memory gate, the preview QA
  resource gate, and that every browser launcher takes the shared slot. Runs test-browser-lock.mjs too (the lock
  itself). No network, no real loop state.
    powershell -ExecutionPolicy Bypass -File innovation\test-resource-rules.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\resource-rules.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
$node = 'C:\Program Files\nodejs\node.exe'
$GB = [int64]1GB

# ---- memory gate ----
Check ((Get-MemoryGate -FreeBytes (3 * $GB)).Ok) '3 GB free passes'
$m = Get-MemoryGate -FreeBytes (1.5 * $GB)
Check (-not $m.Ok -and $m.Why -match 'under 2048 MB') "1.5 GB free fails ($($m.Why))"
Check ((Get-MemoryGate -FreeBytes -1).Ok) 'unknown free memory is not gated'
Check ($script:MinFreeMemoryBytes -eq 2 * $GB) 'the floor is 2 GB'
$g = Get-PreviewQaResourceGate -FreeBytes (1 * $GB)
Check (-not $g.Ok -and $g.Why -match '^unverified \(busy\): .*preview QA skipped') "low memory: the preview QA session is skipped as unverified (busy) ($($g.Why))"
Check ((Get-PreviewQaResourceGate -FreeBytes (6 * $GB)).Ok) 'enough memory: preview QA runs'
$fm = Get-FreeMemoryBytes
Check ($fm -gt 0) "Get-FreeMemoryBytes reads this box ($([int]($fm / 1MB)) MB)"

# ---- priority: BelowNormal on a process, inherited by what it starts ----
$p = Start-Process -FilePath $node -ArgumentList '-e', 'setTimeout(()=>{},4000)' -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 300
Check ((Set-LowPriority -ProcessId $p.Id) -and (Get-Process -Id $p.Id).PriorityClass -eq 'BelowNormal') 'Set-LowPriority sets BelowNormal'
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Check (-not (Set-LowPriority -ProcessId 999999)) 'a missing process returns $false, never throws'
# a PowerShell that lowers itself (as test-gate.ps1 / preview-build.ps1 do) starts node at BelowNormal
$child = "& { . '$PSScriptRoot\resource-rules.ps1'; [void](Set-LowPriority); & '$node' -e 'console.log(require(''os'').getPriority())' }"
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $child
$bn = 10   # os.constants.priority.PRIORITY_BELOW_NORMAL
Check ("$out".Trim() -eq "$bn") "a child of a script that called Set-LowPriority runs BelowNormal (got '$("$out".Trim())')"

# ---- wiring: every browser launcher takes the slot; heavy steps lower their priority ----
$rd = { param([string]$f) [IO.File]::ReadAllText((Join-Path $PSScriptRoot $f)) }
Check ((& $rd 'smoke.mjs') -match 'acquireBrowserSlot\(' -and (& $rd 'smoke.mjs') -match 'setLowPriority\(\)' -and (& $rd 'smoke.mjs') -match 'process\.exit\(2\)') 'smoke.mjs takes the slot, lowers priority and exits 2 (could not run) when busy'
Check ((& $rd 'smoke.mjs') -match '300000\)') 'smoke.mjs has a 5-minute hard cap'
Check ((& $rd 'preview-browse.mjs') -match 'acquireBrowserSlot\(' -and (& $rd 'preview-browse.mjs') -match 'PREVIEW-BROWSE BUSY unverified \(busy\)') 'preview-browse.mjs takes the slot and says BUSY'
Check ((& $rd 'preview-browse.mjs') -match '150000\)') 'preview-browse.mjs keeps its 150 s cap (under 5 minutes)'
Check ((& $rd 'update-snapshots.ps1') -match "browser-lock\.mjs"", 'acquire'" -and (& $rd 'update-snapshots.ps1') -match "'release'") 'update-snapshots.ps1 takes and releases the slot'
Check ((& $rd 'test-gate.ps1') -match 'Set-LowPriority') 'test-gate.ps1 runs BelowNormal'
Check ((& $rd 'preview-build.ps1') -match 'Set-LowPriority') 'preview-build.ps1 runs BelowNormal'
Check ((& $rd 'run-loop.ps1') -match 'Get-PreviewQaResourceGate') 'run-loop.ps1 checks memory before the preview QA session'
Check ((& $rd 'preview.ps1') -match 'resource-rules\.ps1') 'preview.ps1 loads resource-rules.ps1'

# ---- the lock itself (node) ----
$o = & $node (Join-Path $PSScriptRoot 'test-browser-lock.mjs') 2>&1 | ForEach-Object { "$_" }
Check ($LASTEXITCODE -eq 0 -and ($o | Select-Object -Last 1) -match '^TEST-BROWSER-LOCK PASS') "test-browser-lock.mjs: $(($o | Select-Object -Last 1))"

if ($script:fail -gt 0) { Write-Host "TEST-RESOURCE-RULES FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-RESOURCE-RULES PASS ($script:pass checks)"
exit 0

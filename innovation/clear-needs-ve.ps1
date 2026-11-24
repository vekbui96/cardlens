<#
.SYNOPSIS
  Show or clear this loop's needs-Ve flag (<LOOP_HOME>\state\needs-ve.json). For the OWNER only, from a normal PowerShell.

.DESCRIPTION
  run-loop.ps1 sets the flag the moment a build merged something whose deploy it could not verify (DEPLOY STATE
  UNCERTAIN). While it is set:
    - every run of the loop stops before any claude session: LOOP-RESULT: FAILED NEEDS VE, no cost, nothing built,
      merged, deployed or proposed (the daily task, Start-ScheduledTask and -ProposeOnly alike);
    - the approval watcher starts the loop for nothing (approvals, requests, refill, queue drain) and logs why.
  Nothing clears it automatically: not a later run, not drain.json, not a label. Check production first
  (README "Needs Ve: an uncertain deploy"), then:

    clear-needs-ve.ps1                                         # show the flag (default; changes nothing)
    clear-needs-ve.ps1 -Clear -Note "live site OK, #39 reverted by hand"

  -Clear moves the file to state\needs-ve-cleared-<yyyyMMdd-HHmmss>.json with clearedAt / clearedBy / note added (the
  record of what happened) and appends a line to logs\needs-ve.log. The next daily run or watcher poll (within ~10 min)
  starts the loop again: an approval made while it was stopped then triggers a run as usual.

  The loop's own sessions cannot run this script (it is not a session script; guard.mjs blocks it) and cannot write
  state\ (the guard confines their writes to the clones and WORK). It also refuses to run inside a loop run.
#>
[CmdletBinding()]
param(
    [switch]$Clear,
    [string]$Note = ''
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"

if ($env:INNOVATION_LOOP_CARDLENS_MODE -or $env:INNOVATION_LOOP_RUN_ID) {
    Write-Output 'NEEDS-VE REFUSED: this runs inside a loop run; only the owner clears the flag, from a normal PowerShell'
    exit 2
}
$path = Join-Path $script:LoopHome "state\$($script:NeedsVeFileName)"
$st = Get-NeedsVeState -Path $path -Kind 'this loop'
if (-not $st.Blocked) { Write-Output "NEEDS-VE NOT SET ($path): the loop runs normally"; exit 0 }

Write-Output "NEEDS-VE SET: $($st.Reason -replace '^this loop skipped: ', '')"
Write-Output "flag file: $path"
if (Test-Path -LiteralPath $path) { try { Write-Output ([IO.File]::ReadAllText($path)) } catch { } }
if (-not $Clear) {
    Write-Output 'Every automatic run of this loop is skipped. Check production, then clear it with: clear-needs-ve.ps1 -Clear -Note "<what you checked>"'
    exit 1
}
if (-not $Note.Trim()) { Write-Output 'NEEDS-VE NOT CLEARED: -Clear needs -Note "<what you checked>" (it is kept with the cleared record)'; exit 2 }

$stamp = Get-Date
$dest = Join-Path $script:LoopHome ("state\needs-ve-cleared-{0}.json" -f $stamp.ToString('yyyyMMdd-HHmmss'))
$rec = [ordered]@{}
try { $j = [IO.File]::ReadAllText($path) | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $rec[$p.Name] = $p.Value } } catch { $rec.unreadable = "$($_.Exception.Message)" }
$rec.clearedAt = $stamp.ToString('o'); $rec.clearedBy = "$env:USERDOMAIN\$env:USERNAME"; $rec.note = $Note.Trim()
[IO.File]::WriteAllText($dest, ($rec | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
Remove-Item -LiteralPath $path -Force
$logDir = Join-Path $script:LoopHome 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Add-Content -LiteralPath (Join-Path $logDir 'needs-ve.log') -Encoding UTF8 -Value ('{0} cleared {1} by {2}: {3} (record {4})' -f $stamp.ToString('yyyy-MM-dd HH:mm:ss'), $st.Key, $rec.clearedBy, $rec.note, $dest)
Write-Output "NEEDS-VE CLEARED: record kept as $dest; the next daily run or watcher poll starts the loop again"
exit 0

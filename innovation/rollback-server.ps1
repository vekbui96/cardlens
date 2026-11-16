<#
.SYNOPSIS
  ELEVATED. Put the live cardlens checkout back to the PREV commit recorded by the last deploy-server.ps1
  run, restore node_modules.prev if that deploy replaced node_modules, restart, re-verify.

.DESCRIPTION
  Takes no target from its caller: PREV comes only from C:\ProgramData\innovation-loop-cardlens\state\
  server-last-deploy.json, which only the elevated side can write. Refuses if the live HEAD is neither the
  recorded target nor PREV (someone else moved it). Idempotent: if the live HEAD is already PREV it only
  makes sure the right node_modules is in place, restarts if needed and verifies.
  Data is never restored automatically: the pre-deploy snapshot zip is named in the log for Ve.
  The git revert on main is done by the non-elevated side (deploy.ps1 / rollback.ps1).

.EXIT CODES
  0 rolled back and verified | 1 precondition failed | 3 rollback or verification failed (human needed)
#>
[CmdletBinding()]
param([switch]$DryRun)
. "$PSScriptRoot\lib.ps1"
Start-ScriptLog 'rollback-server' -Dir (Join-Path $script:ElevHome 'logs')
$stateFile = Join-Path $script:ElevHome 'state\server-last-deploy.json'
$live = $script:LiveDir

try {
    if (-not (Test-IsElevated) -and -not $DryRun) { throw 'must run elevated' }
    $st = Read-JsonFile -Path $stateFile
    if (-not $st) { throw "no $stateFile" }
    if ("$($st.prevSha)" -notmatch '^[0-9a-f]{40}$' -or "$($st.targetSha)" -notmatch '^[0-9a-f]{40}$') { throw 'state file has no valid prevSha/targetSha' }
    if ($st.status -eq 'rolled-back') { Write-Log 'state says this deploy was already rolled back; re-verifying only' }
    $head = Get-GitValue -Repo $live -Arguments @('rev-parse', 'HEAD')
    if ($head -ne $st.targetSha -and $head -ne $st.prevSha) { throw "live HEAD $head is neither the recorded target $($st.targetSha) nor prev $($st.prevSha); refusing" }
    Write-Log "rollback: live=$head -> prev=$($st.prevSha) (issue $($st.issue), lockChanged=$($st.lockChanged), snapshot=$($st.snapshot))"
} catch {
    Write-Log "precondition failed: $_" 'ERROR'
    Write-Output "ROLLBACK-SERVER PRECONDITION $_"
    exit $script:EXIT_PRECONDITION
}
if ($DryRun) { Write-Output 'ROLLBACK-SERVER DRYRUN OK'; exit $script:EXIT_OK }

$nm = Join-Path $live 'node_modules'
$nmPrev = Join-Path $live 'node_modules.prev'
try {
    $restoreModules = ($st.lockChanged -and (Test-Path -LiteralPath $nmPrev))
    if ($restoreModules -or $head -ne $st.prevSha) {
        Stop-Service -Name $script:ServiceName -Force
        if (-not (Wait-ServiceState -Name $script:ServiceName -State 'Stopped' -TimeoutSec 90)) { throw 'service did not stop' }
        Start-Sleep -Seconds 2
        Invoke-Git -Repo $live -Arguments @('reset', '--hard', $st.prevSha) | Out-Null
        if ($restoreModules) {
            $failed = Join-Path $live ("node_modules.failed-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
            if (Test-Path -LiteralPath $nm) { Rename-Item -LiteralPath $nm -NewName (Split-Path $failed -Leaf) }
            Rename-Item -LiteralPath $nmPrev -NewName 'node_modules'
            Write-Log "restored node_modules.prev (the failed install is at $failed)"
        }
        Start-Service -Name $script:ServiceName
    } elseif ((Get-Service -Name $script:ServiceName).Status -ne 'Running') {
        Start-Service -Name $script:ServiceName
    }
    if (-not (Wait-ServiceState -Name $script:ServiceName -State 'Running' -TimeoutSec 90)) { throw 'service did not reach Running' }
    Start-Sleep -Seconds 5
    if (-not (Test-Server)) { throw 'restored server failed verification' }
    foreach ($d in @(Get-ChildItem -LiteralPath $live -Directory -Filter 'node_modules.failed-*' -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Log "ROLLBACK FAILED: $_ (data snapshot: $($st.snapshot))" 'ERROR'
    $st | Add-Member -NotePropertyName status -NotePropertyValue 'rollback-failed' -Force
    Save-JsonFile -Path $stateFile -Object $st
    Write-Output "ROLLBACK-SERVER FAILED $_"
    exit $script:EXIT_ROLLBACK_FAILED
}
$st | Add-Member -NotePropertyName status -NotePropertyValue 'rolled-back' -Force
$st | Add-Member -NotePropertyName rolledBackUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
Save-JsonFile -Path $stateFile -Object $st
Write-Log "ROLLBACK complete: live at $($st.prevSha)"
Write-Output "ROLLBACK-SERVER OK $($st.prevSha)"
exit $script:EXIT_OK

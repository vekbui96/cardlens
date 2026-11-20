<#
.SYNOPSIS
  Undo a loop deploy. NON-elevated; the server part goes through the elevated task.
  Last output line: ROLLBACK OK | ROLLBACK FAILED <why> | ROLLBACK PRECONDITION <why>

.DESCRIPTION
  Default: if the loop's last recorded deploy for -Issue deployed the server, ask the elevated task to roll
  the server back (to the PREV it recorded itself), then git revert -MergeSha on main (Pages redeploys the
  previous build) and verify the live page no longer carries -AbsentString and still renders.

  -RevertOnly: only the git revert on main + Pages verification (for a merge whose server part never went
  live, or a front-end-only change). Needs no elevation.

  deploy.ps1 already calls the same logic on its own failures; this script is for a rollback decided later
  (by the loop after a failed check, or by Ve by hand from a normal PowerShell).

.EXIT CODES
  0 rolled back and verified | 1 precondition failed, nothing changed | 3 rollback failed (human needed)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Issue,
    [Parameter(Mandatory)][string]$MergeSha,
    [string]$AbsentString = '',
    [switch]$RevertOnly
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\live-check.ps1"   # Test-LiveSite (whole chunk graph); replaces the lib.ps1 copy
Start-ScriptLog "rollback-$Issue"
Add-GhToPath
$null = Clear-SecretEnv
$art = Join-Path $script:LoopHome "artifacts\$Issue"
if (-not (Test-Path -LiteralPath $art)) { New-Item -ItemType Directory -Path $art | Out-Null }

try {
    if ($MergeSha -notmatch '^[0-9a-f]{40}$') { throw 'MergeSha must be the full 40-char sha' }
    # Only revert what the loop itself merged (merge-pr.ps1's record); Ve reverts anything else by hand.
    $rec = Read-State "merge-$Issue"
    if (-not $rec -or "$($rec.mergeSha)" -ne $MergeSha) { throw "$MergeSha is not the merge merge-pr.ps1 recorded for issue #$Issue" }
    if (-not (Test-Path -LiteralPath (Join-Path $script:Clone '.git'))) { throw "no clone at $($script:Clone)" }
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', '--prune') | Out-Null
    $anc = Invoke-Git -Repo $script:Clone -Arguments @('merge-base', '--is-ancestor', $MergeSha, 'origin/main') -AllowFail -Quiet
    if ($anc.Code -ne 0) { throw "$MergeSha is not on origin/main" }
} catch {
    Write-Log "precondition failed: $_" 'ERROR'; Write-Output "ROLLBACK PRECONDITION $_"; exit 1
}

$ok = $true
if (-not $RevertOnly) {
    $st = Read-State "deploy-$Issue"
    if ($st -and $st.serverDeployed -and $st.serverTarget -eq $MergeSha) {
        $r = Invoke-ElevatedRequest -Mode rollback -Issue $Issue -Sha $MergeSha
        Write-Log "server rollback: $($r.status) $($r.message)"
        if ($r.status -ne 'ok') { $ok = $false }
    } else {
        Write-Log 'no server deploy recorded for this issue and merge; server untouched'
    }
}
try {
    if (-not (Invoke-FrontendRevert -MergeSha $MergeSha -AbsentString $AbsentString -ShotPath (Join-Path $art 'rollback.png'))) { $ok = $false }
} catch { Write-Log "revert failed: $_" 'ERROR'; $ok = $false }

# the runner reads this record (gate-rules.ps1 Get-DeployCertainty) to decide whether the next build may start
$status = 'ROLLBACK OK'; if (-not $ok) { $status = 'ROLLBACK FAILED' }
try { Save-State "rollback-$Issue" @{ issue = $Issue; mergeSha = $MergeSha; revertOnly = [bool]$RevertOnly; status = $status; utc = [DateTime]::UtcNow.ToString('o') } } catch { Write-Log "could not save the rollback record: $_" 'WARN' }
if ($ok) { Write-Output 'ROLLBACK OK'; exit 0 }
Write-Output "ROLLBACK FAILED (PRODUCTION NEEDS VE: see $($script:LogFile))"
exit 3

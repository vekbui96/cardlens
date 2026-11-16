<#
.SYNOPSIS
  Ship a merged loop change and verify it; roll back by itself on failure. NON-elevated: the server part
  goes through the pre-registered elevated task. Run it in the BACKGROUND and poll (it can take 30+ min).
  Last output line: DEPLOY OK | DEPLOY ROLLED-BACK <why> | DEPLOY ROLLBACK-FAILED <why> | DEPLOY PRECONDITION <why>

.DESCRIPTION
  Merging to main already started the Pages deploy (deploy-pages.yml runs on every push). So:
  1. preconditions: -MergeSha is on origin/main; the merge itself touches no protected path and the commits
     between the live server and it touch none that changes what the server runs (gate-rules.ps1
     Get-GapDecision; inert ones such as .github/** are listed only). Server changes already on main from
     other commits go live with this deploy and are logged; if the server needs deploying, the elevated
     task must be installed (a precondition failure AFTER the merge still reverts main, see 4)
  2. server (only if server/, a tsconfig.node.json shared file, package.json or the lockfile changed):
     elevated request mode=deploy -> deploy-server.ps1 (data snapshot, reset, npm ci if needed, restart,
     repeated health checks, auto-rollback)
  3. front end: wait for the deploy-pages run of THIS sha (cancelling an older run stuck in `waiting` for
     30+ min), then the served index.html must reference a /cardlens/assets/index-*.js, every chunk it
     names must load, -ExpectString must be in one of them, and headless Edge must render #root
  4. on any failure: server rollback (elevated, if the server was deployed) + git revert of the merge on
     main (Pages then redeploys the old build) + verify the string is gone and the page renders

.EXIT CODES
  0 deployed and verified | 1 precondition failed BEFORE anything changed (nothing to undo)
  2 failed and rolled back (main reverted) | 3 failed AND rollback failed: PRODUCTION NEEDS VE
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Issue,
    [Parameter(Mandatory)][string]$MergeSha,
    # A string that exists only in the new front-end build (new UI copy). Required when the merge changes
    # anything that ships in the bundle; omit only for server-only changes.
    [string]$ExpectString = ''
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
Start-ScriptLog "deploy-$Issue"
Add-GhToPath
$null = Clear-SecretEnv
$art = Join-Path $script:LoopHome "artifacts\$Issue"
if (-not (Test-Path -LiteralPath $art)) { New-Item -ItemType Directory -Path $art | Out-Null }
$state = [ordered]@{ issue = $Issue; mergeSha = $MergeSha; expectString = $ExpectString; startedUtc = [DateTime]::UtcNow.ToString('o'); serverDeployed = $false; status = 'started' }

function Finish([int]$code, [string]$line) {
    $state.status = $line; $state.finishedUtc = [DateTime]::UtcNow.ToString('o'); Save-State "deploy-$Issue" $state
    Write-Log $line; Write-Output $line; exit $code
}

function Undo([string]$why) {
    Write-Log "rolling back: $why" 'ERROR'
    $ok = $true
    if ($state.serverDeployed) {
        $r = Invoke-ElevatedRequest -Mode rollback -Issue $Issue -Sha $state.serverTarget
        Write-Log "server rollback: $($r.status) $($r.message)"
        if ($r.status -ne 'ok') { $ok = $false }
    }
    try {
        $back = Invoke-FrontendRevert -MergeSha $MergeSha -AbsentString $ExpectString -ShotPath (Join-Path $art 'rolled-back.png')
        if (-not $back) { $ok = $false }
    } catch { Write-Log "revert on main failed: $_" 'ERROR'; $ok = $false }
    if ($ok) { Finish 2 "DEPLOY ROLLED-BACK $why" }
    Finish 3 "DEPLOY ROLLBACK-FAILED $why (PRODUCTION NEEDS VE: see $($script:LogFile))"
}

# ---- 1. preconditions -------------------------------------------------------------------------
$plan = $null
try {
    if ($MergeSha -notmatch '^[0-9a-f]{40}$') { throw 'MergeSha must be the full 40-char merge commit sha' }
    # Only a merge made by merge-pr.ps1 for this issue can be deployed (its record lives in state\, which the
    # session cannot write). Not a loop merge = not ours to deploy OR to revert, so this exits 1 untouched.
    $rec = Read-State "merge-$Issue"
    if (-not $rec -or "$($rec.mergeSha)" -ne $MergeSha) { Finish 1 "DEPLOY PRECONDITION $MergeSha is not the merge merge-pr.ps1 recorded for issue #$Issue (nothing changed)" }
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', '--prune') | Out-Null
    $anc = Invoke-Git -Repo $script:Clone -Arguments @('merge-base', '--is-ancestor', $MergeSha, 'origin/main') -AllowFail -Quiet
    if ($anc.Code -ne 0) { Finish 1 "DEPLOY PRECONDITION $MergeSha is not on origin/main (nothing merged, nothing to undo)" }
    $parent = Get-GitValue -Repo $script:Clone -Arguments @('rev-parse', "$MergeSha^1")
    $mergeFiles = Get-ChangedFiles -Repo $script:Clone -From $parent -To $MergeSha
    $frontFiles = @($mergeFiles | Where-Object { $_ -match '^(src/|public/|index\.html$|vite\.config\.ts$)' -and $_ -notmatch '\.test\.tsx?$|/__tests__/|/test/' })
    $state.prevSignature = Get-LiveSignature
    Write-Log "merge $MergeSha changes $($mergeFiles.Count) file(s); front-end relevant: $($frontFiles.Count); live build now $($state.prevSignature)"
    if ($frontFiles.Count -gt 0 -and -not $ExpectString) { throw 'the merge changes the front end: pass -ExpectString <string only the new build contains>' }
    $plan = Get-ServerPlan -Repo $script:Clone -Target $MergeSha -OwnCommitsFrom $parent
    $state.liveHeadBefore = $plan.LiveHead
    Write-Log "server plan: liveHead=$($plan.LiveHead) needed=$($plan.ServerNeeded) files=$($plan.ServerFiles -join ',') protected=$($plan.Protected -join ',') foreign=$($plan.Foreign -join ',')"
    # Same rule as merge-pr (gate-rules.ps1 Get-GapDecision): a protected path in the merge itself, or one in
    # the gap that changes what the server runs, stops the deploy; inert protected paths in the gap are listed.
    # Non-protected server changes Ve already merged ride along (the live checkout is reset to the merge).
    $gap = Get-GapDecision -Protected $plan.Protected -OwnFiles $mergeFiles -ServerPaths $plan.ServerPaths
    if ($gap.Ignored.Count -gt 0) { Write-Log "protected but inert on server-pc, between the live server and the merge (ignored): $($gap.Ignored -join ', ')" }
    foreach ($c in @((Invoke-Git -Repo $script:Clone -Arguments @('log', '--format=%h %s', "$($plan.LiveHead)..$parent") -AllowFail -Quiet).Output | Where-Object { $_ })) { Write-Log "also carried to the live checkout (already on main, merged before this change): $c" }
    if ($plan.Foreign.Count -gt 0) {
        $state.gapServerCommits = @($plan.Foreign | ForEach-Object { "$_".Substring(0, 7) })
        Write-Log "server changes already on main that go live with this deploy (listed on the issue by merge-pr): $($state.gapServerCommits -join ', ')"
    }
    if ($gap.Refuse.Count -gt 0) { throw "protected paths between live and the merge (manual / needs Ve): $($gap.Refuse -join ', ')" }
} catch {
    Undo "precondition failed after the merge: $_"
}

# ---- 2. server -----------------------------------------------------------------------------------
if ($plan.ServerNeeded) {
    $state.serverTarget = $MergeSha
    $r = Invoke-ElevatedRequest -Mode deploy -Issue $Issue -Sha $MergeSha
    $state.serverResult = "$($r.status): $($r.message)"
    Write-Log "server deploy: $($r.status) (exit $($r.exitCode)) $($r.message)"
    switch ("$($r.status)") {
        'ok' { $state.serverDeployed = $true }
        'rolled-back' { Undo 'server deploy failed verification (server already rolled back by deploy-server.ps1)' }
        'rollback-failed' { $state.serverDeployed = $false; Write-Log 'SERVER ROLLBACK FAILED' 'ERROR'; try { $null = Invoke-FrontendRevert -MergeSha $MergeSha -AbsentString $ExpectString } catch { }; Finish 3 'DEPLOY ROLLBACK-FAILED server deploy and its rollback both failed (PRODUCTION NEEDS VE)' }
        default { Undo "server deploy did not run: $($r.status) $($r.message)" }   # rejected / not-started / failed precondition: server untouched
    }
} else {
    Write-Log 'no server-relevant change: server not touched'
}

# ---- 3. front end ------------------------------------------------------------------------------------
if (-not (Wait-PagesRun -Sha $MergeSha)) { Undo "the deploy-pages run for $MergeSha did not succeed" }
$notSig = ''; if ($frontFiles.Count -gt 0) { $notSig = $state.prevSignature }
$v = Test-LiveSite -ExpectString $ExpectString -NotSignature $notSig -RepoForSmoke $script:Clone -ShotPath (Join-Path $art 'live.png') -TimeoutSec 600
if (-not $v.Ok) { Undo 'live front-end verification failed (string / chunks / render)' }
$state.newAsset = $v.Asset

if ($state.serverDeployed) {
    # re-check the server after the front end went live, cheaply (GET only)
    $h = Invoke-Http -Url "$($script:ApiFunnel)/api/health" -TimeoutSec 20
    if (-not ($h.Status -eq 200 -and $h.Body -match '"ok"\s*:\s*true')) { Start-Sleep -Seconds 20; $h = Invoke-Http -Url "$($script:ApiFunnel)/api/health" -TimeoutSec 20 }
    if (-not ($h.Status -eq 200 -and $h.Body -match '"ok"\s*:\s*true')) { Undo 'server health failed after the front end went live' }
}
Finish 0 "DEPLOY OK merge=$MergeSha asset=$($v.Asset) server=$(if ($state.serverDeployed) { 'deployed' } else { 'unchanged' })"

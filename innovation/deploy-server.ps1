<#
.SYNOPSIS
  ELEVATED. Move the live cardlens checkout (D:\services\cardlens) to a commit on origin/main, restart the
  service, verify, and roll back on failure. Normally started only by elevated-task.ps1 (the
  innovation-loop-cardlens-deploy task); Ve may run it by hand from an elevated PowerShell.

.DESCRIPTION
  1. preconditions: elevated; live dir is a clean git checkout; after a fresh `git fetch origin main`,
     -TargetSha is on origin/main and the live HEAD is an ancestor of it (never moves backwards); no
     protected path that the server runs (card index, shared merge/validation rules, Target bot, .env, ...)
     changes between them (protected paths nothing on server-pc executes, e.g. innovation/**, .github/**,
     are logged, not refused)
  2. snapshot ALL of D:\services\data to D:\services\backups\predeploy-<stamp>.zip (read-only on data;
     the zip is verified by entry count; the newest 10 predeploy zips are kept, nothing else is touched)
  3. record PREV (live HEAD) in C:\ProgramData\innovation-loop-cardlens\state\server-last-deploy.json
  4. if package.json / package-lock.json changed: Stop-Service, node_modules -> node_modules.prev,
     git reset --hard <target>, npm.cmd ci (never --omit=dev: tsx is a devDependency), Start-Service.
     Otherwise: git reset --hard <target>, Restart-Service.
  5. verify (lib.ps1 Test-Server): health on repeated checks with a stable node pid (NSSM's 5s auto-restart
     can hide a crash loop), catalog + printings GETs with retries (pokemontcg.io fails ~25%), Funnel
  6. on failure: rollback-server.ps1 (reset to PREV, restore node_modules.prev, restart, re-verify)

  Never writes into D:\services\data, never touches .env / NSSM settings / recognition / Funnel.
  The git revert on main (so Pages rolls back too) is done by the non-elevated deploy.ps1 / rollback.ps1.

.EXIT CODES
  0 deployed and verified (or already at target) | 1 precondition failed, nothing changed
  2 verification failed, rolled back | 3 verification failed AND rollback failed (human needed)
  4 install failed before the service was restarted on new code (rolled back)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TargetSha,
    [int]$Issue = 0,
    [switch]$DryRun
)
. "$PSScriptRoot\lib.ps1"
Start-ScriptLog 'deploy-server' -Dir (Join-Path $script:ElevHome 'logs')
$stateFile = Join-Path $script:ElevHome 'state\server-last-deploy.json'
$live = $script:LiveDir

try {
    if (-not (Test-IsElevated) -and -not $DryRun) { throw 'must run elevated (Restart-Service on a LocalSystem service)' }
    if ($TargetSha -notmatch '^[0-9a-f]{40}$') { throw "TargetSha must be a full 40-char sha" }
    if (-not (Test-Path -LiteralPath (Join-Path $live '.git'))) { throw "$live is not a git checkout" }
    $null = Get-Service -Name $script:ServiceName
    $dirty = @((Invoke-Git -Repo $live -Arguments @('status', '--porcelain', '--untracked-files=no') -Quiet).Output | Where-Object { $_.Trim() })
    if ($dirty.Count -gt 0) { throw "live checkout has local changes: $($dirty -join '; ')" }
    Invoke-Git -Repo $live -Arguments @('fetch', 'origin', 'main', '--quiet') | Out-Null
    $originMain = Get-GitValue -Repo $live -Arguments @('rev-parse', 'FETCH_HEAD')
    $exists = Invoke-Git -Repo $live -Arguments @('cat-file', '-e', "$TargetSha^{commit}") -AllowFail -Quiet
    if ($exists.Code -ne 0) { throw "$TargetSha is not a known commit after fetching origin/main" }
    $anc = Invoke-Git -Repo $live -Arguments @('merge-base', '--is-ancestor', $TargetSha, $originMain) -AllowFail -Quiet
    if ($anc.Code -ne 0) { throw "$TargetSha is not on origin/main ($originMain)" }
    $prev = Get-GitValue -Repo $live -Arguments @('rev-parse', 'HEAD')
    if ($prev -eq $TargetSha) { Write-Log "live checkout already at $TargetSha; nothing to deploy"; Write-Output 'DEPLOY-SERVER OK (already at target)'; exit $script:EXIT_OK }
    $fwd = Invoke-Git -Repo $live -Arguments @('merge-base', '--is-ancestor', $prev, $TargetSha) -AllowFail -Quiet
    if ($fwd.Code -ne 0) { throw "live HEAD $prev is not an ancestor of $TargetSha; refusing to move the server sideways/backwards" }
    $changed = Get-ChangedFiles -Repo $live -From $prev -To $TargetSha
    # Only protected paths that change what this server RUNS refuse (lib.ps1 Split-ProtectedByLiveImpact: card
    # index, shared sync rules, Target bot, .env). Protected paths that nothing on server-pc executes
    # (innovation/**: the loop runs from D:\projects\cardlens\innovation and this task from its admin-only
    # copy; .github/**, playwright config, client-only src, scripts) are inert in the live dir: logged only.
    # A loop change's OWN files never touch any protected path (merge-pr.ps1 refuses that before merging).
    $serverPaths = Get-ServerPaths -Repo $live -Ref $TargetSha
    $split = Split-ProtectedByLiveImpact -Protected @($changed | Where-Object { Test-ProtectedPath $_ }) -ServerPaths $serverPaths
    if ($split.Inert.Count -gt 0) { Write-Log "protected but inert on this server (not refused): $($split.Inert -join ', ')" }
    if ($split.Block.Count -gt 0) { throw "changes protected paths that the server runs (manual / needs Ve): $($split.Block -join ', ')" }
    $lockChanged = @($changed | Where-Object { $_ -in @('package.json', 'package-lock.json') }).Count -gt 0
    Write-Log "prev=$prev target=$TargetSha files=$($changed.Count) lockChanged=$lockChanged issue=$Issue"
    foreach ($c in $changed) { Write-Log "  changed: $c" }
} catch {
    Write-Log "precondition failed: $_" 'ERROR'
    Write-Output "DEPLOY-SERVER PRECONDITION $_"
    exit $script:EXIT_PRECONDITION
}

if ($DryRun) { Write-Log 'DRY RUN: would snapshot data, reset, install if needed, restart and verify'; Write-Output 'DEPLOY-SERVER DRYRUN OK'; exit $script:EXIT_OK }

# ---- snapshot data (read-only on D:\services\data) ---------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zip = Join-Path $script:BackupDir "predeploy-$stamp.zip"
try {
    if (-not (Test-Path -LiteralPath $script:BackupDir)) { New-Item -ItemType Directory -Path $script:BackupDir | Out-Null }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fileCount = @(Get-ChildItem -LiteralPath $script:DataDir -Recurse -File).Count
    [IO.Compression.ZipFile]::CreateFromDirectory($script:DataDir, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { $entries = @($z.Entries | Where-Object { $_.Name }).Count } finally { $z.Dispose() }
    if ($entries -lt $fileCount) { throw "snapshot has $entries files, data dir has $fileCount" }
    Write-Log "data snapshot: $zip ($entries files, $([int]((Get-Item -LiteralPath $zip).Length / 1KB)) KB)"
    Get-ChildItem -LiteralPath $script:BackupDir -Filter 'predeploy-*.zip' | Sort-Object Name -Descending | Select-Object -Skip 10 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
} catch {
    Write-Log "data snapshot failed, nothing changed: $_" 'ERROR'
    Write-Output "DEPLOY-SERVER PRECONDITION snapshot failed: $_"
    exit $script:EXIT_PRECONDITION
}

$record = [ordered]@{ issue = $Issue; prevSha = $prev; targetSha = $TargetSha; lockChanged = $lockChanged; snapshot = $zip; startedUtc = [DateTime]::UtcNow.ToString('o'); status = 'started' }
Save-JsonFile -Path $stateFile -Object $record

# ---- swap ------------------------------------------------------------------------------------
$nm = Join-Path $live 'node_modules'
$nmPrev = Join-Path $live 'node_modules.prev'
$swapOk = $true
$installFailed = $false
try {
    if ($lockChanged) {
        if (Test-Path -LiteralPath $nmPrev) { Write-Log 'removing the node_modules.prev left by an earlier deploy'; Remove-Item -LiteralPath $nmPrev -Recurse -Force }
        Write-Log 'dependencies changed: stopping the service for the install'
        Stop-Service -Name $script:ServiceName -Force
        if (-not (Wait-ServiceState -Name $script:ServiceName -State 'Stopped' -TimeoutSec 90)) { throw 'service did not stop' }
        Start-Sleep -Seconds 2   # let node/esbuild release file handles
        Rename-Item -LiteralPath $nm -NewName 'node_modules.prev'
        $record.nodeModulesPrev = $true; Save-JsonFile -Path $stateFile -Object $record
        Invoke-Git -Repo $live -Arguments @('reset', '--hard', $TargetSha) | Out-Null
        $r = Invoke-Native -File $script:NpmCmd -Arguments @('ci', '--no-audit', '--no-fund') -WorkDir $live -AllowFail -Quiet
        if ($r.Code -ne 0) { $installFailed = $true; throw "npm ci failed (exit $($r.Code))" }
        if (-not (Test-Path -LiteralPath (Join-Path $nm 'tsx\dist\cli.mjs'))) { $installFailed = $true; throw 'tsx missing after npm ci' }
        Start-Service -Name $script:ServiceName
    } else {
        Invoke-Git -Repo $live -Arguments @('reset', '--hard', $TargetSha) | Out-Null
        Restart-Service -Name $script:ServiceName -Force
    }
    if (-not (Wait-ServiceState -Name $script:ServiceName -State 'Running' -TimeoutSec 90)) { throw 'service did not reach Running' }
} catch {
    Write-Log "swap/restart failed: $_" 'ERROR'
    $swapOk = $false
}

$verified = $false
if ($swapOk) { Start-Sleep -Seconds 5; $verified = Test-Server }

if ($verified) {
    $record.status = 'deployed'; $record.finishedUtc = [DateTime]::UtcNow.ToString('o'); Save-JsonFile -Path $stateFile -Object $record
    Write-Log "DEPLOYED and verified cardlens server at $TargetSha (prev $prev)"
    Write-Output "DEPLOY-SERVER OK $TargetSha"
    exit $script:EXIT_OK
}

$record.status = 'failed'; Save-JsonFile -Path $stateFile -Object $record
Write-Log 'deploy FAILED; rolling back' 'ERROR'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\rollback-server.ps1"
$rb = $LASTEXITCODE
if ($rb -eq 0) {
    Write-Log 'rolled back successfully'
    Write-Output 'DEPLOY-SERVER ROLLED-BACK'
    if ($installFailed) { exit $script:EXIT_BUILD_FAILED }
    exit $script:EXIT_ROLLED_BACK
}
Write-Log "ROLLBACK FAILED (exit $rb). Production needs a human." 'ERROR'
Write-Output 'DEPLOY-SERVER ROLLBACK-FAILED'
exit $script:EXIT_ROLLBACK_FAILED

<#
.SYNOPSIS
  Entry point for the cardlens innovation loop's daily scheduled task (NON-elevated). Runs one headless
  `claude -p` session that follows LOOP.md.

.DESCRIPTION
  - single-instance lock with stale-lock handling (~\.innovation-loop-cardlens\lock\run.lock)
  - all state outside any repo: ~\.innovation-loop-cardlens\{logs,clones,work,artifacts,state,elevated,scratch,lock}
  - refreshes the loop's own clone (git@github-cardlens:vekbui96/cardlens.git); never touches
    D:\projects\cardlens (Ve's checkout) or D:\services\cardlens (the live checkout)
  - checks the elevated deploy task: installed, its admin-only script copy matches this checkout, and a
    selftest round trip works. If not, the session is told SERVER_DEPLOY=unavailable and builds only
    front-end-only issues
  - strips secret-looking env vars; generates the permission settings (dontAsk + allowlist + guard hook)
  - logs the full stream-json transcript; exits 0 only when claude exited 0 and reported OK/NOTHING-TO-DO

  The scripts and LOOP.md are read from THIS directory ($PSScriptRoot), Ve's checkout
  (D:\projects\cardlens\innovation). The guard forbids the session from editing them.

.PARAMETER ProposeOnly
  Phase B only (observe + propose). Nothing is built, merged or deployed. Use for the first supervised run.
.PARAMETER DryRun
  Do everything up to the claude call (lock, dirs, clone, task check without triggering it, settings,
  prompt), print the command, then stop.
#>
[CmdletBinding()]
param(
    [switch]$ProposeOnly,
    [switch]$DryRun,
    # Only check the elevated deploy task: installed, copy current, and a selftest round trip from THIS (non-elevated) process.
    [switch]$SelfTest,
    [int]$MaxTurns = 300,
    [int]$TimeoutMinutes = 240,
    [string]$Model = '',
    [string]$ClaudeExe = (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
)
. "$PSScriptRoot\lib.ps1"
$ScriptsDir = (Resolve-Path $PSScriptRoot).Path
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
Initialize-LoopDirs
$script:LogFile = Join-Path $script:LoopHome "logs\run-$RunId.log"
$mode = 'FULL'; if ($ProposeOnly) { $mode = 'PROPOSE_ONLY' }
Write-Log "cardlens innovation loop run $RunId mode=$mode dryRun=$DryRun scripts=$ScriptsDir"

if ($SelfTest) {
    Write-Log "selftest: elevated=$(Test-IsElevated) (run this from a NORMAL PowerShell to prove the non-elevated trigger)"
    $stale = @()
    foreach ($f in $script:ElevatedFiles) {
        $a = Join-Path $ScriptsDir $f; $b = Join-Path $script:ElevHome "bin\$f"
        if (-not (Test-Path -LiteralPath $b) -or (Get-FileHash -LiteralPath $a).Hash -ne (Get-FileHash -LiteralPath $b).Hash) { $stale += $f }
    }
    if ($stale.Count -gt 0) { Write-Log "elevated copy differs from this checkout: $($stale -join ', ')" 'WARN' }
    $self = Invoke-ElevatedRequest -Mode selftest -TimeoutMinutes 3
    Write-Log "selftest result: $($self.status) $($self.message)"
    if ($self.status -eq 'ok' -and $stale.Count -eq 0) { Write-Output 'SELFTEST OK'; exit 0 }
    Write-Output "SELFTEST FAILED $($self.status) $($self.message)"; exit 1
}

# ---- lock ---------------------------------------------------------------------------------
$lockPath = Join-Path $script:LoopHome 'lock\run.lock'
$staleAfter = [TimeSpan]::FromMinutes($TimeoutMinutes + 30)
function Get-Lock {
    try {
        $fs = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $bytes = [Text.Encoding]::UTF8.GetBytes(("{0}`n{1}`n{2}" -f $PID, [DateTime]::UtcNow.ToString('o'), $RunId))
        $fs.Write($bytes, 0, $bytes.Length); $fs.Close()
        return $true
    } catch [IO.IOException] { return $false }
}
if (-not (Get-Lock)) {
    $lines = @(Get-Content -LiteralPath $lockPath -ErrorAction SilentlyContinue)
    $lockPid = 0; $lockTime = [DateTime]::MinValue
    if ($lines.Count -ge 2) { [void][int]::TryParse($lines[0], [ref]$lockPid); [void][DateTime]::TryParse($lines[1], [ref]$lockTime) }
    $alive = $false
    if ($lockPid -gt 0) { $p = Get-Process -Id $lockPid -ErrorAction SilentlyContinue; $alive = ($p -and $p.ProcessName -match 'powershell') }
    $age = [DateTime]::UtcNow - $lockTime.ToUniversalTime()
    if ($alive -and $age -lt $staleAfter) { Write-Log "another run (pid $lockPid, started $lockTime) holds the lock; exiting" 'WARN'; exit 0 }
    Write-Log "removing stale lock (pid $lockPid alive=$alive age=$age)" 'WARN'
    Remove-Item -LiteralPath $lockPath -Force
    if (-not (Get-Lock)) { Write-Log 'could not take the lock after clearing it' 'ERROR'; exit 1 }
}

$exitCode = 1
try {
    # ---- environment ------------------------------------------------------------------------
    Add-GhToPath
    foreach ($n in (Clear-SecretEnv)) { Write-Log "unset env var $n for this run" }
    $env:INNOVATION_LOOP_CARDLENS_HOME = $script:LoopHome
    $env:INNOVATION_LOOP_CARDLENS_SCRIPTS = $ScriptsDir
    $env:INNOVATION_LOOP_RUN_ID = $RunId
    $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (Test-Path -LiteralPath $edge) { $env:CHROME_PATH = $edge }

    # ---- preflight ----------------------------------------------------------------------------
    foreach ($t in @($ClaudeExe, $script:GhExe, $script:NpmCmd, $script:NodeExe)) { if (-not (Test-Path -LiteralPath $t)) { throw "missing $t" } }
    if ($ScriptsDir -match '\s') { throw "scripts dir '$ScriptsDir' contains whitespace; the permission rules need a path without spaces" }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git not on PATH' }
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $script:GhExe auth status *> $null; $ghOk = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    if (-not $ghOk) { throw 'gh is not authenticated' }
    $elevated = Test-IsElevated
    Write-Log "elevated=$elevated"
    if ($elevated) { Write-Log 'run-loop itself holds an admin token (normal for a scheduled task on this box); the claude session will be started with a reduced token' }

    # ---- the loop's clone (never Ve's checkout, never the live one) ------------------------------
    if (-not (Test-Path -LiteralPath (Join-Path $script:Clone '.git'))) {
        Invoke-Native -File 'git' -Arguments @('clone', $script:CloneUrl, $script:Clone) | Out-Null
    }
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', '--prune') | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('checkout', '-f', '-B', 'main', 'origin/main') | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('reset', '--hard', 'origin/main') | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('clean', '-fdx', '-e', 'node_modules', '-e', '.cache') | Out-Null
    $mainSha = Get-GitValue -Repo $script:Clone -Arguments @('rev-parse', 'origin/main')

    # ---- server deploy availability ------------------------------------------------------------
    $serverDeploy = 'unavailable'
    $serverWhy = ''
    $liveHead = ''
    try { $liveHead = Get-LiveHead } catch { $serverWhy = "cannot read the live checkout's HEAD: $_" }
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & schtasks.exe /query /tn $script:DeployTaskName *> $null; $taskExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    if (-not $taskExists) { $serverWhy = "scheduled task $($script:DeployTaskName) is not installed (install-task.ps1)" }
    else {
        $stale = @()
        foreach ($f in $script:ElevatedFiles) {
            $a = Join-Path $ScriptsDir $f; $b = Join-Path $script:ElevHome "bin\$f"
            if (-not (Test-Path -LiteralPath $b) -or (Get-FileHash -LiteralPath $a).Hash -ne (Get-FileHash -LiteralPath $b).Hash) { $stale += $f }
        }
        if ($stale.Count -gt 0) { $serverWhy = "the elevated copy differs from this checkout ($($stale -join ', ')); re-run install-task.ps1 elevated" }
        elseif ($DryRun) { $serverDeploy = 'available (not selftested: dry run)' }
        else {
            $self = Invoke-ElevatedRequest -Mode selftest -TimeoutMinutes 3
            if ($self.status -eq 'ok') { $serverDeploy = 'available' } else { $serverWhy = "elevated selftest: $($self.status) $($self.message)" }
        }
    }
    Write-Log "SERVER_DEPLOY=$serverDeploy $serverWhy liveHead=$liveHead main=$mainSha"

    # ---- permission settings -------------------------------------------------------------------
    # dontAsk: anything not allowlisted is denied (nobody is there to answer a prompt).
    # guard.mjs then enforces the repo/secret/never-touch/one-command rules on every call.
    $readOnly = 'Get-ChildItem', 'Get-Content', 'Get-Item', 'Test-Path', 'Select-String', 'Get-Date', 'Start-Sleep', 'ConvertFrom-Json',
        'ConvertTo-Json', 'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object', 'Format-List', 'Format-Table', 'Out-String',
        'Write-Output', 'Join-Path', 'Split-Path', 'Resolve-Path', 'Get-Service', 'Get-FileHash', 'Invoke-WebRequest', 'Invoke-RestMethod',
        'New-Item', 'Remove-Item'
    $allow = @('Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite',
        'WebFetch(domain:vekbui96.github.io)', 'WebFetch(domain:server-pc.tail0e4194.ts.net)',
        'WebFetch(domain:api.pokemontcg.io)', 'WebFetch(domain:api.tcgdex.net)',
        'PowerShell(git *)', 'PowerShell(gh *)')
    # Exactly these scripts, called by bare full path (no `&`, no quotes). The elevated deploy task is
    # triggered ONLY from inside deploy.ps1 / rollback.ps1 / merge-pr.ps1 (fixed task name); the session
    # itself has no schtasks / ScheduledTask rule and the guard blocks those words.
    foreach ($n in 'check-approval', 'test-gate', 'update-snapshots', 'merge-pr', 'deploy', 'rollback') {
        $allow += "PowerShell($ScriptsDir\$n.ps1)"; $allow += "PowerShell($ScriptsDir\$n.ps1 *)"
    }
    foreach ($r in $readOnly) { $allow += "PowerShell($r)"; $allow += "PowerShell($r *)" }
    $deny = @('Bash', 'Agent', 'Task', 'NotebookEdit', 'WebSearch', 'Skill',
        'PowerShell(npm *)', 'PowerShell(npm.cmd *)', 'PowerShell(npx *)', 'PowerShell(node *)', 'PowerShell(cmd *)',
        'PowerShell(powershell *)', 'PowerShell(pwsh *)', 'PowerShell(schtasks *)', 'PowerShell(schtasks.exe *)',
        'PowerShell(Start-ScheduledTask *)', 'PowerShell(Restart-Service *)', 'PowerShell(docker *)',
        'PowerShell(git push --force*)', 'PowerShell(git push -f*)', 'PowerShell(gh pr merge *)', 'PowerShell(gh auth *)')
    $settings = [ordered]@{
        permissions = [ordered]@{ defaultMode = 'dontAsk'; allow = $allow; deny = $deny }
        hooks       = @{ PreToolUse = @(@{ matcher = '*'; hooks = @(@{ type = 'command'; command = "node `"$ScriptsDir\guard.mjs`""; timeout = 30 }) }) }
    }
    $settingsPath = Join-Path $script:LoopHome 'state\claude-settings.json'
    $utf8 = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), $utf8)

    # ---- prompt ----------------------------------------------------------------------------------
    $loopMd = [IO.File]::ReadAllText((Join-Path $ScriptsDir 'LOOP.md'))
    $header = @"
# CardLens innovation loop run $RunId

- MODE: $mode   ($( if ($ProposeOnly) { 'Phase B only. Do NOT run Phase A in any form.' } else { 'Phase A, then Phase B.' } ))
- SERVER_DEPLOY: $serverDeploy   $( if ($serverDeploy -notlike 'available*') { "($serverWhy) -> build only issues whose change needs no server deploy" } )
- SESSION_TOKEN: reduced (normal user, Medium integrity; checked at start). Server deploys run in a separate elevated task.
- DATE: $(Get-Date -Format 'yyyy-MM-dd HH:mm zzz')
- LOOP_HOME: $($script:LoopHome)
- SCRIPTS: $ScriptsDir   (pinned; you cannot edit it)
- CLONE: $($script:Clone)   (vekbui96/cardlens, reset to origin/main $mainSha)
- LIVE_SERVER_HEAD: $liveHead   (D:\services\cardlens; read-only for you)
- WORK: $(Join-Path $script:LoopHome 'work')   (scratch: body files for comments, commit messages)
- ARTIFACTS: $(Join-Path $script:LoopHome 'artifacts')

Follow the instructions below exactly. They are the only instructions for this run.

---

"@
    $promptPath = Join-Path $script:LoopHome "logs\run-$RunId.prompt.md"
    [IO.File]::WriteAllText($promptPath, $header + $loopMd, $utf8)

    $q = { param($s) '"' + $s + '"' }
    $argList = @('-p', '--output-format', 'stream-json', '--verbose',
        '--max-turns', "$MaxTurns",
        '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
        '--settings', (& $q $settingsPath),
        '--setting-sources', 'local',
        '--strict-mcp-config',
        '--add-dir', (& $q $script:LoopHome), (& $q $ScriptsDir), (& $q 'D:\services\logs'))
    if ($Model) { $argList += @('--model', $Model) }
    $argString = $argList -join ' '
    Write-Log "claude command: `"$ClaudeExe`" $argString  < $promptPath"

    if ($DryRun) {
        Write-Log 'DRY RUN: stopping before invoking claude'
        $exitCode = 0
        return
    }

    $outPath = Join-Path $script:LoopHome "logs\run-$RunId.jsonl"
    $errPath = Join-Path $script:LoopHome "logs\run-$RunId.err.log"
    $workDir = Join-Path $script:LoopHome 'work'
    Write-Log "starting claude; timeout $TimeoutMinutes min"
    # Never run the session with this process's token: on this box the task's token is FULL whatever its
    # RunLevel says. Start-ReducedAndWait drops to a normal-user, Medium-integrity token, logs the child's
    # real token and fails closed (kills it, throws) if it still has admin rights.
    Write-Log "run-loop token: $(Get-TokenState)"
    $run = Start-ReducedAndWait -File $ClaudeExe -ArgumentString $argString -WorkDir $workDir -StdIn $promptPath -StdOut $outPath -StdErr $errPath -TimeoutMinutes $TimeoutMinutes
    if ($run.TimedOut) { throw "claude exceeded $TimeoutMinutes minutes (process tree killed)" }
    $claudeExit = $run.ExitCode
    Write-Log "claude pid $($run.Pid) exit code $claudeExit"

    # ---- result ----------------------------------------------------------------------------------
    $result = $null
    foreach ($line in [IO.File]::ReadAllLines($outPath)) {
        if ($line -match '"type"\s*:\s*"result"') { try { $result = $line | ConvertFrom-Json } catch { } }
    }
    $summaryPath = Join-Path $script:LoopHome "logs\run-$RunId.summary.txt"
    if ($result) {
        $text = "$($result.result)"
        [IO.File]::WriteAllText($summaryPath, $text, $utf8)
        Write-Log ("result: subtype={0} is_error={1} turns={2} cost={3}" -f $result.subtype, $result.is_error, $result.num_turns, $result.total_cost_usd)
        $status = [regex]::Match($text, 'LOOP-RESULT:\s*([A-Z\-]+)').Groups[1].Value
        Write-Log "LOOP-RESULT: $status"
        if ($claudeExit -eq 0 -and -not $result.is_error -and $status -in @('OK', 'NOTHING-TO-DO')) { $exitCode = 0 } else { $exitCode = 1 }
    } else {
        Write-Log 'no result message in the transcript' 'ERROR'
        $exitCode = 1
    }
} catch {
    Write-Log "run failed: $_" 'ERROR'
    $exitCode = 1
} finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem (Join-Path $script:LoopHome 'logs') -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Log "exit $exitCode"
}
exit $exitCode

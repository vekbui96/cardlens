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
  - precheck before claude: check-approval.ps1 -List; if nothing is buildable (FULL mode) and no proposal
    slot is free (gate-rules.ps1 Get-ProposalSlots), it logs why, writes a NOTHING-TO-DO summary and run data
    with no claude session, and exits 0. If the check fails, claude is launched as before
  - after claude: an issue this run left with loop:in-progress (killed at the time limit, max turns, or the
    session just stopped) is marked loop:failed with a failure marker (timeout / max-turns get the one
    automatic retry unless something was merged); "Failed, waiting on Ve" goes into the run-data comments
  - strips secret-looking env vars; generates the permission settings (dontAsk + allowlist + guard hook)
  - logs the full stream-json transcript; exits 0 only when claude exited 0 and reported OK/NOTHING-TO-DO

  The scripts and LOOP.md are read from THIS directory ($PSScriptRoot), Ve's checkout
  (D:\projects\cardlens\innovation). The guard forbids the session from editing them.

.PARAMETER ProposeOnly
  Phase B only (observe + propose). Nothing is built, merged or deployed. Use for the first supervised run.
.PARAMETER DryRun
  Do everything up to the claude call (lock, dirs, clone, task check without triggering it, settings,
  prompt), print the command, then stop.
.PARAMETER MaxBuilds
  Phase A builds at most this many approved issues per run, strictly one after another (default 2; 1 = one
  issue per run). A second build starts only after the first ended `loop:deployed`, with at least
  -SecondBuildMinMinutes left before the run's deadline, and at most one server deploy per run.
.PARAMETER SecondBuildMinMinutes
  Minutes that must remain before the deadline (start + TimeoutMinutes) for a second build to start
  (default 120: one full cycle has taken ~60-75 min and can reach ~110 with a CI fix round, and Phase B
  still needs ~20-30 min after it).
.PARAMETER MaxTurns
  claude's turn limit. Default 150 + 150 x MaxBuilds (300 for one build, as before; 450 for two), because
  hitting it ends the session, and with it any merge or deploy it is waiting on.

  FOCUS.md (next to this script, Ve's steering for Phase B) is optional: missing, empty or only headings and
  comments means the header says FOCUS: none and the loop proposes as it always has.
  PRODUCT.md (next to this script, Ve's product picture: users, jobs, metrics with baselines, principles,
  bets) is read the same way and named in the header as PRODUCT; read-only for the session.
.PARAMETER ProductReview
  The weekly product review (LOOP.md section 7): read-only research, no Phase A, no builds, merges or
  deploys; the session may only run read-only commands and open ONE loop:product-review issue plus
  proposals within the usual cap. The build/merge/deploy scripts are not allowlisted in this mode, and the
  guard (told the mode via INNOVATION_LOOP_CARDLENS_MODE) refuses them and every push. Default MaxTurns 150.
  Registered weekly (disabled) by install-task.ps1 -WithProductReview.
#>
[CmdletBinding()]
param(
    [switch]$ProposeOnly,
    [switch]$ProductReview,
    [switch]$DryRun,
    # Only check the elevated deploy task: installed, copy current, and a selftest round trip from THIS (non-elevated) process.
    [switch]$SelfTest,
    [ValidateRange(1, 2)]
    [int]$MaxBuilds = 2,
    [int]$SecondBuildMinMinutes = 120,
    [int]$MaxTurns = 0,
    [int]$TimeoutMinutes = 240,
    [string]$Model = '',
    [string]$ClaudeExe = (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\reporting.ps1"   # run data + progress comments (functions only; used after claude exits)
. "$PSScriptRoot\gate-rules.ps1"  # proposal slots, retry rule, the precheck (pure functions)
$ScriptsDir = (Resolve-Path $PSScriptRoot).Path
$RunStart = Get-Date
$RunId = $RunStart.ToString('yyyyMMdd-HHmmss')
$Deadline = $RunStart.AddMinutes($TimeoutMinutes)
if ($ProductReview -and $MaxTurns -le 0) { $MaxTurns = 150 }
if ($MaxTurns -le 0) { $MaxTurns = 150 + 150 * $MaxBuilds }
Initialize-LoopDirs
$script:LogFile = Join-Path $script:LoopHome "logs\run-$RunId.log"
$mode = 'FULL'; if ($ProposeOnly) { $mode = 'PROPOSE_ONLY' }
if ($ProductReview) { $mode = 'PRODUCT_REVIEW'; $ProposeOnly = $true }   # no Phase A in any form
Write-Log "cardlens innovation loop run $RunId mode=$mode dryRun=$DryRun maxBuilds=$MaxBuilds maxTurns=$MaxTurns scripts=$ScriptsDir"

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

# The queue as check-approval.ps1 -List sees it (buildable, retry, slots, waitingOnVe), or $null when that
# failed. Runs it as its own process, exactly like merge-pr.ps1 does; read-only gh calls.
function Get-LoopQueue {
    try {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $out = & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir 'check-approval.ps1') -List 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE; $ErrorActionPreference = $prev
        $json = @($out | Where-Object { "$_".TrimStart().StartsWith('{') }) | Select-Object -Last 1
        if ($code -gt 1 -or -not $json) { Write-Log "queue check failed (check-approval exit $code): $((@($out) | Select-Object -Last 3) -join ' ')" 'WARN'; return $null }
        $q = $json | ConvertFrom-Json
        if ($q.PSObject.Properties.Name -contains 'error' -or -not ($q.PSObject.Properties.Name -contains 'slots')) { Write-Log "queue check failed: $json" 'WARN'; return $null }
        return $q
    } catch { Write-Log "queue check failed: $_" 'WARN'; return $null }
}
function Format-QueueLine {
    param($Q)
    if ($null -eq $Q) { return 'unknown (queue check failed)' }
    $b = @($Q.buildable | Where-Object { $null -ne $_ }); $r = @($Q.retry | Where-Object { $null -ne $_ })
    $s = "buildable [$(@($b | ForEach-Object { "#$_" }) -join ' ')]"
    if ($r.Count -gt 0) { $s += " (automatic retry: $(@($r | ForEach-Object { "#$_" }) -join ' '))" }
    $s += "; proposal slots free $($Q.slots.free) of $($Q.slots.cap) (awaiting review: $(@($Q.slots.awaitingReview | ForEach-Object { "#$_" }) -join ' '))"
    $w = Format-WaitingOnOwner -Waiting @($Q.waitingOnVe) -Who 'Ve'
    if ($w) { $s += "; $w" }
    return $s
}

# After claude exited: an issue this run took that still carries loop:in-progress was left mid-build (the
# run was killed at its time limit, the session hit max turns, or it just stopped). Mark it loop:failed with
# a failure marker (gate-rules.ps1 Get-UnfinishedFailure: timeout / max-turns are retried once; anything
# merged in this run is not). Never throws.
function Close-UnfinishedIssues {
    param([int[]]$Issues, [string]$EndClass)
    $closed = @()
    foreach ($n in @($Issues | Where-Object { $_ -gt 0 } | Sort-Object -Unique)) {
        try {
            $i = Get-GhJson @('api', "repos/$($script:Repo)/issues/$n")
            $labels = @($i.labels | ForEach-Object { $_.name })
            if ($i.state -ne 'open' -or $labels -notcontains 'loop:proposal' -or $labels -notcontains 'loop:in-progress') { continue }
            $mergeSha = ''
            $rec = Read-State "merge-$n"
            if ($rec -and $rec.mergedUtc -and ([datetime]$rec.mergedUtc).ToUniversalTime() -ge $RunStart.ToUniversalTime()) { $mergeSha = "$($rec.mergeSha)" }
            $f = Get-UnfinishedFailure -EndClass $EndClass -MergeSha $mergeSha -TimeoutMinutes $TimeoutMinutes -Who 'Ve'
            $body = "$($script:Marker)`n$(Format-FailureMarker -Class $f.Class -Outcome 'failed')`n## Synopsis`n`n$($f.Synopsis)`n`n## Details`n`n" +
                "Run ``$RunId`` ended with ``$EndClass`` while this issue still carried loop:in-progress. Failure class ``$($f.Class)``: $(Get-FailureDescription $f.Class). " +
                "Posted by run-loop.ps1 after the session stopped; see logs\run-$RunId.log and the transcript.`n"
            $bp = Join-Path $script:LoopHome "work\unfinished-$RunId-$n.md"
            [IO.File]::WriteAllText($bp, $body, (New-Object Text.UTF8Encoding $false))
            Invoke-Gh -Arguments @('issue', 'comment', "$n", '-R', $script:Repo, '--body-file', $bp) -Quiet | Out-Null
            Invoke-Gh -Arguments @('issue', 'edit', "$n", '-R', $script:Repo, '--add-label', 'loop:failed', '--remove-label', 'loop:in-progress') -Quiet | Out-Null
            Write-Log "unfinished #${n}: marked loop:failed, class $($f.Class)$(if ($mergeSha) { " (merged as $mergeSha, not verified: NEEDS VE)" })" 'WARN'
            $closed += $n
        } catch { Write-Log "unfinished #${n}: could not mark it failed: $_" 'WARN' }
    }
    return $closed
}

$exitCode = 1
$outPath = $null
$endClass = 'session-ended'   # how the session ended, for issues it left mid-build: timeout | max-turns | session-ended
$queue = $null
try {
    # ---- environment ------------------------------------------------------------------------
    Add-GhToPath
    foreach ($n in (Clear-SecretEnv)) { Write-Log "unset env var $n for this run" }
    $env:INNOVATION_LOOP_CARDLENS_HOME = $script:LoopHome
    $env:INNOVATION_LOOP_CARDLENS_SCRIPTS = $ScriptsDir
    $env:INNOVATION_LOOP_RUN_ID = $RunId
    $env:INNOVATION_LOOP_CARDLENS_MODE = $mode   # the guard narrows what the session may do in PRODUCT_REVIEW
    $edge ='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
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

    # ---- precheck: anything to do at all? (no claude session, so it costs nothing) -------------------
    # Phase A needs a buildable approved issue (check-approval's rules, retries included); Phase B a free
    # proposal slot (gate-rules.ps1 Get-ProposalSlots: the same rule as the approval watcher's refill). If
    # neither, end NOTHING-TO-DO here instead of starting claude to find that out (~$0.36 a time). If the
    # check fails, claude is launched as before.
    $queue = Get-LoopQueue
    $pre = Get-PrecheckDecision -Queue $queue -Mode $mode
    Write-Log "queue: $(Format-QueueLine $queue)"
    Write-Log "precheck: launch=$($pre.Launch) ($($pre.Reason))"
    if (-not $pre.Launch) {
        $waitLine = Format-WaitingOnOwner -Waiting @($queue.waitingOnVe) -Who 'Ve'
        $sumLines = @("Precheck (no claude session started): nothing to do.",
            "- Phase A: $(if ($mode -eq 'FULL') { 'no buildable approved issue' } else { "not run ($mode)" }).",
            "- Phase B: no free proposal slot ($(@($queue.slots.awaitingReview).Count) proposals awaiting review, cap $($queue.slots.cap); approved and failed proposals do not count).")
        if ($waitLine) { $sumLines += "- $waitLine" }
        $sumLines += 'LOOP-RESULT: NOTHING-TO-DO'
        if ($DryRun) {
            Write-Log 'precheck: a real run would end here with NOTHING-TO-DO and no claude session (dry run: carrying on to show the command)'
        } else {
            $utf8 = New-Object Text.UTF8Encoding $false
            [IO.File]::WriteAllText((Join-Path $script:LoopHome "logs\run-$RunId.summary.txt"), ($sumLines -join "`r`n"), $utf8)
            $triggerTask = 'innovation-loop-cardlens'
            $rd = [ordered]@{ runId = $RunId; mode = $mode; trigger = (Get-LoopRunTrigger -TaskName $triggerTask -RunStart $RunStart); status = 'NOTHING-TO-DO'
                precheck = $pre.Reason; claudeStarted = $false; totals = [ordered]@{ Turns = 0; Requests = 0; Input = 0; Output = 0; CacheRead = 0; CacheWrite = 0; Cost = 0; Models = @() }
                issues = @(); createdIssues = @(); waitingOnVe = $waitLine }
            [IO.File]::WriteAllText((Join-Path $script:LoopHome "logs\run-$RunId.rundata.json"), ($rd | ConvertTo-Json -Depth 5), $utf8)
            Write-Log 'result: subtype=precheck is_error=False turns=0 cost=0 (no claude session)'
            Write-Log 'LOOP-RESULT: NOTHING-TO-DO'
            $exitCode = 0
            return
        }
    }

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
        elseif ($ProductReview) { $serverDeploy = 'not needed'; $serverWhy = 'PRODUCT_REVIEW builds nothing' }
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
    foreach ($n in 'check-approval', 'test-gate', 'update-snapshots', 'merge-pr', 'deploy', 'rollback', 'ci-rerun', 'progress') {
        $allow += "PowerShell($ScriptsDir\$n.ps1)"; $allow += "PowerShell($ScriptsDir\$n.ps1 *)"
    }
    foreach ($r in $readOnly) { $allow += "PowerShell($r)"; $allow += "PowerShell($r *)" }
    if ($ProductReview) {
        # read-only research: no build, snapshot, merge, deploy, rollback or CI-rerun script in this mode
        $allow = @($allow | Where-Object { $_ -notmatch '\\(test-gate|update-snapshots|merge-pr|deploy|rollback|ci-rerun|progress)\.ps1' })
    }
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
    # FOCUS.md: Ve's steering for Phase B. The session only reads it (the guard blocks writes outside the
    # clone and the clone's innovation/ is protected). Counts as present only if something is left after
    # removing HTML comments, headings and blank lines.
    $focusPath = Join-Path $ScriptsDir 'FOCUS.md'
    $focus = "none (no FOCUS.md, or it is empty) -> propose as usual"
    if (Test-Path -LiteralPath $focusPath -PathType Leaf) {
        $ft = [regex]::Replace([IO.File]::ReadAllText($focusPath), '(?s)<!--.*?-->', '')
        $left = @($ft -split "`r?`n" | Where-Object { $_.Trim() -and $_.Trim() -notmatch '^#' })
        if ($left.Count -gt 0) { $focus = "$focusPath   (Ve's priorities and things to avoid; read it first in section 5)" }
    }
    Write-Log "FOCUS: $focus"
    # PRODUCT.md: Ve's product picture (users, jobs, metrics + baselines, principles, bets). Same rules as FOCUS.
    $productPath = Join-Path $ScriptsDir 'PRODUCT.md'
    $product = 'none (no PRODUCT.md, or it is empty)'
    if (Test-Path -LiteralPath $productPath -PathType Leaf) {
        $pt = [regex]::Replace([IO.File]::ReadAllText($productPath), '(?s)<!--.*?-->', '')
        $pleft = @($pt -split "`r?`n" | Where-Object { $_.Trim() -and $_.Trim() -notmatch '^#' })
        if ($pleft.Count -gt 0) { $product = "$productPath   (Ve's product picture; read it in section 5 step 0 / section 7; read-only)" }
    }
    Write-Log "PRODUCT: $product"
    $modeNote = 'Phase A, then Phase B.'
    if ($ProposeOnly) { $modeNote = 'Phase B only. Do NOT run Phase A in any form.' }
    if ($ProductReview) { $modeNote = 'Weekly product review: section 7 only. Read-only; build, merge and deploy nothing.' }
    $builds = $MaxBuilds; if ($ProposeOnly) { $builds = 0 }
    $header = @"
# CardLens innovation loop run $RunId

- MODE: $mode   ($modeNote)
- SERVER_DEPLOY: $serverDeploy   $( if ($serverDeploy -notlike 'available*') { "($serverWhy) -> build only issues whose change needs no server deploy" } )
- MAX_BUILDS: $builds   (Phase A builds at most this many issues, one after another; see section 3)
- DEADLINE: $($Deadline.ToString('yyyy-MM-dd HH:mm zzz'))   (the run is killed by then; check the time with Get-Date)
- SECOND_BUILD_MIN_MINUTES: $SecondBuildMinMinutes   (minutes that must remain before DEADLINE to start another build)
- MAX_TURNS: $MaxTurns   (the session ends when it is reached, even mid-deploy)
- FOCUS: $focus
- PRODUCT: $product
- QUEUE (at run start, for your summary; check-approval.ps1 stays the authority): $(Format-QueueLine $queue)
- SESSION_TOKEN: reduced (normal user, Medium integrity; checked at start). Server deploys run in a separate elevated task.
- DATE: $($RunStart.ToString('yyyy-MM-dd HH:mm zzz'))
- LOOP_HOME: $($script:LoopHome)
- SCRIPTS: $ScriptsDir   (pinned; you cannot edit it)
- CLONE: $($script:Clone)   (vekbui96/cardlens, reset to origin/main $mainSha)
- LIVE_SERVER_HEAD: $liveHead   (D:\services\cardlens at run start; read-only for you)
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
    if ($run.TimedOut) { $endClass = 'timeout'; throw "claude exceeded $TimeoutMinutes minutes (process tree killed)" }
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
        if ("$($result.subtype)" -eq 'error_max_turns') { $endClass = 'max-turns' }
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
    # ---- reporting (after the reduced claude child exited; never changes the exit code) -------------
    # Same process, same gh and rights as the preflight above; the session gets no new permission (it only
    # printed the LOOP-ISSUE-START/END marker lines, LOOP.md section 3). Posting failures are warnings.
    if ($outPath -and (Test-Path -LiteralPath $outPath)) {
        try {
            $triggerTask = 'innovation-loop-cardlens'; if ($ProductReview) { $triggerTask = 'innovation-loop-cardlens-review' }
            $trigger = Get-LoopRunTrigger -TaskName $triggerTask -RunStart $RunStart
            $ended = @(Complete-LoopProgress -LoopHome $script:LoopHome -RunId $RunId -GhExe $script:GhExe)
            if ($ended.Count -gt 0) { Write-Log "progress comments left mid-build, marked as ended: #$($ended -join ', #')" 'WARN' }
            # issues THIS run took (progress state or transcript markers) and left with loop:in-progress
            $took = @($ended)
            $pdir = Join-Path $script:LoopHome 'state\progress'
            if (Test-Path -LiteralPath $pdir) { $took += @(Get-ChildItem -LiteralPath $pdir -Filter "$RunId-*.json" -File | ForEach-Object { [int](($_.BaseName -split '-')[-1]) }) }
            try { $took += @((Read-LoopTranscript -Path $outPath).Parts | ForEach-Object { $_.Issue }) } catch { }
            $closed = @(Close-UnfinishedIssues -Issues $took -EndClass $endClass)
            if ($closed.Count -gt 0) { Write-Log "left mid-build ($endClass), marked loop:failed: #$($closed -join ', #')" 'WARN' }
            $waitLine = Format-WaitingOnOwner -Waiting @((Get-LoopQueue).waitingOnVe) -Who 'Ve'
            if ($waitLine) { Write-Log $waitLine }
            $posted = Publish-LoopRunData -TranscriptPath $outPath -Repo $script:Repo -GhExe $script:GhExe -RunId $RunId -Mode $mode -Trigger $trigger -LoopHome $script:LoopHome -Waiting $waitLine
            Write-Log "run data: $posted comment(s) posted"
        } catch { Write-Log "run data / progress reporting skipped: $_" 'WARN' }
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem (Join-Path $script:LoopHome 'logs') -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Log "exit $exitCode"
}
exit $exitCode

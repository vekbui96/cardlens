<#
.SYNOPSIS
  Entry point for the cardlens innovation loop's daily scheduled task (NON-elevated). Runs one headless
  `claude -p` session PER JOB: one for each approved issue it builds (up to MaxBuilds, strictly one after
  another), then one for Phase B proposals (or one for the weekly product review), each following LOOP.md.

.DESCRIPTION
  Shared run setup happens ONCE, here in PowerShell (no tokens):
  - single-instance lock with stale-lock handling (~\.innovation-loop-cardlens\lock\run.lock)
  - all state outside any repo: ~\.innovation-loop-cardlens\{logs,clones,work,artifacts,state,elevated,scratch,lock}
  - preflight (claude, gh + auth, npm, node, git), and the elevated deploy task: installed, its admin-only
    script copy matches this checkout, and a selftest round trip works. If not, build sessions are told
    SERVER_DEPLOY=unavailable and build only front-end-only issues
  - precheck: check-approval.ps1 -List; if nothing is buildable (FULL mode) and no proposal slot is free
    (gate-rules.ps1 Get-ProposalSlots), it writes a NOTHING-TO-DO summary and run data with no session
  - strips secret-looking env vars; generates the permission settings per session kind (dontAsk +
    allowlist + guard hook; proposal and review sessions get no build/merge/deploy script)

  Then one session per job, each with its own prompt (a header naming its one job + only the LOOP.md
  sections it needs), model, turn cap and time limit (innovation\sessions.json, gate-rules.ps1
  Get-SessionConfig):
  - build sessions (FULL): the loop's clone is reset to origin/main before each. The next build starts only
    when the previous one ended loop:deployed (or was skipped, e.g. by the one-server-deploy rule), fewer
    than MaxBuilds were built, and enough time is left (gate-rules.ps1 Get-NextBuildDecision). After each
    build session its issue is finalised here: a progress comment left mid-build is marked, an issue left
    loop:in-progress becomes loop:failed with a failure marker, and if the session merged something whose
    deploy was not verified or rolled back (Get-DeployCertainty) the RUN STOPS there: no further build,
    no proposals, LOOP-RESULT FAILED, and the issue waits for Ve.
  - one proposal session (FULL and PROPOSE_ONLY), only when a proposal slot is free and enough time is left;
    approved specs' slices go first (check-approval.ps1 -List `slicesToOpen`)
  - one product-review session (PRODUCT_REVIEW)
  After the sessions: one combined summary (the last line is the run's LOOP-RESULT, gate-rules.ps1
  Get-RunResult), run data aggregated over every session (reporting.ps1 Merge-LoopRunData), and the spec
  checklists (reporting.ps1 Publish-SpecProgress: an approved spec whose slices are all done is closed).
  Exits 0 only when every session exited 0 and the run's LOOP-RESULT is OK or NOTHING-TO-DO.

  The scripts and LOOP.md are read from THIS directory ($PSScriptRoot), Ve's checkout
  (D:\projects\cardlens\innovation). The guard forbids the session from editing them.

.PARAMETER ProposeOnly
  Phase B only (observe + propose). Nothing is built, merged or deployed. Use for the first supervised run.
.PARAMETER DryRun
  Do everything up to the first claude call (lock, dirs, clone, task check without triggering it, settings),
  then print the sessions the run would start (each build assumed deployed, for planning) with their
  prompts, models, turn caps and time limits, and stop. -QueueFile <json> (dry run only) plans from a saved
  check-approval.ps1 -List output instead of the live queue.
.PARAMETER MaxBuilds
  At most this many approved issues are built per run, one session each, strictly one after another
  (default 2; 1 = one issue per run). At most one server deploy per run.
.PARAMETER SecondBuildMinMinutes
  Minutes that must remain before the run's deadline (start + TimeoutMinutes) to start a second build
  session (default 120: one build has taken ~60-75 min and can reach ~110 with a CI fix round).
.PARAMETER MaxTurns
  Overrides every session's turn cap (sessions.json: build 150, propose 80, review 120). 0 = use sessions.json.
.PARAMETER TimeoutMinutes
  The whole run's time limit; every session's own limit (sessions.json timeoutMinutes) is cut to what is
  left of it.
.PARAMETER Model
  Overrides every session's model (sessions.json). Empty = use sessions.json.
.PARAMETER IgnoreBudget
  Do not consult the ops hub's plan budget (D:\hub\state\plan-budget.json) this run: for Ve's supervised
  runs. Without it the runner reads the verdict before every session: normal = as always; no-opus = no
  session on an Opus model (Opus builds wait, approved and untouched, for a later run); hold = no session at
  all (NOTHING-TO-DO, like the precheck). A missing, unreadable, unknown or stale file counts as normal (WARN).
.PARAMETER BudgetFile
  Where the plan budget is read from (default gate-rules.ps1 $PlanBudgetPath); for dry runs and tests.

  FOCUS.md (next to this script, Ve's steering for Phase B) is optional: missing, empty or only headings and
  comments means the header says FOCUS: none and the loop proposes as it always has.
  PRODUCT.md (next to this script, Ve's product picture: users, jobs, metrics with baselines, principles,
  bets) is read the same way and named in the header as PRODUCT; read-only for the session.
  sessions.json (next to this script, Ve's) sets each session kind's model, turn cap and time limit.
.PARAMETER ProductReview
  The weekly product review (LOOP.md section 7): read-only research, no builds, merges or deploys; the
  session may only run read-only commands and open ONE loop:product-review issue plus proposals (or one
  spec) within the usual cap. Registered weekly (disabled) by install-task.ps1 -WithProductReview.
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
    # with -DryRun only: plan from this saved check-approval.ps1 -List output instead of GitHub's live queue
    [string]$QueueFile = '',
    # the ops hub's plan budget (gate-rules.ps1 Get-PlanBudgetVerdict): -IgnoreBudget for supervised runs
    [switch]$IgnoreBudget,
    [string]$BudgetFile = '',
    [string]$ClaudeExe = (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\reporting.ps1"   # run data, progress and spec checklists (functions only; used after each session)
. "$PSScriptRoot\gate-rules.ps1"  # slots, specs, retry rule, precheck, session planning (pure functions)
$ScriptsDir = (Resolve-Path $PSScriptRoot).Path
$RunStart = Get-Date
$RunId = $RunStart.ToString('yyyyMMdd-HHmmss')
$Deadline = $RunStart.AddMinutes($TimeoutMinutes)
Initialize-LoopDirs
$script:LogFile = Join-Path $script:LoopHome "logs\run-$RunId.log"
$mode = 'FULL'; if ($ProposeOnly) { $mode = 'PROPOSE_ONLY' }
if ($ProductReview) { $mode = 'PRODUCT_REVIEW'; $ProposeOnly = $true }   # no Phase A in any form

# sessions.json: Ve's models, turn caps and time limits per session kind (defaults in gate-rules.ps1)
$sessionsJson = $null
$sessionsPath = Join-Path $ScriptsDir 'sessions.json'
if (Test-Path -LiteralPath $sessionsPath -PathType Leaf) {
    try { $sessionsJson = [IO.File]::ReadAllText($sessionsPath) | ConvertFrom-Json } catch { Write-Log "sessions.json is not valid JSON, using the defaults: $_" 'WARN' }
}
$Cfg = Get-SessionConfig $sessionsJson
foreach ($k in 'build', 'propose', 'review') { if ($MaxTurns -gt 0) { $Cfg[$k].maxTurns = $MaxTurns } }
$cfgLine = @('build', 'propose', 'review' | ForEach-Object { $c = $Cfg[$_]; $m = "$($c.model)"; if ($_ -eq 'build') { $m += " (small: $($c.smallModel) for $(@($c.smallLabels) -join '/'))" }; "$_=$m turns=$($c.maxTurns) timeout=$($c.timeoutMinutes)m" }) -join '; '
Write-Log "cardlens innovation loop run $RunId mode=$mode dryRun=$DryRun maxBuilds=$MaxBuilds scripts=$ScriptsDir"
Write-Log "sessions: $cfgLine$(if ($Model) { "; -Model $Model overrides all" })"

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

# The queue as check-approval.ps1 -List sees it (buildable, retry, labels, slots, specs, slicesToOpen,
# waitingOnVe), or $null when that failed. Runs it as its own process, exactly like merge-pr.ps1 does;
# read-only gh calls.
function Get-LoopQueue {
    if ($DryRun -and $QueueFile) { Write-Log "dry run: queue read from $QueueFile"; return ([IO.File]::ReadAllText($QueueFile) | ConvertFrom-Json) }
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
    $sp = @($Q.specs | Where-Object { $_ -and $_.approved })
    if ($sp.Count -gt 0) { $s += "; approved specs: $(@($sp | ForEach-Object { "#$($_.issue) ($(@($_.toOpen).Count) of $($_.of) slices still to open)" }) -join ', ')" }
    $w = Format-WaitingOnOwner -Waiting @($Q.waitingOnVe) -Who 'Ve'
    if ($w) { $s += "; $w" }
    return $s
}
function Get-QueueLabels {
    param($Q, [int]$Issue)
    if ($null -eq $Q -or $null -eq $Q.labels) { return @() }
    $p = $Q.labels.PSObject.Properties | Where-Object { $_.Name -eq "$Issue" } | Select-Object -First 1
    if ($p) { return @($p.Value) }
    return @()
}

# The ops hub's plan-budget verdict, read now (the runner reads it, never claude; before every session, so a
# verdict that changes mid-run is respected). Fails open: see gate-rules.ps1 Get-PlanBudgetVerdict.
function Get-PlanBudget {
    $path = $BudgetFile; if (-not $path) { $path = $script:PlanBudgetPath }
    $text = $null; $err = ''
    if (-not $IgnoreBudget) {
        try { if (Test-Path -LiteralPath $path -PathType Leaf) { $text = [IO.File]::ReadAllText($path) } } catch { $err = "$($_.Exception.Message)" }
    }
    $b = Get-PlanBudgetVerdict -Text $text -ReadError $err -Ignore:$IgnoreBudget
    if ($b.Warn) { Write-Log "budget: $($b.Reason) [$path]" 'WARN' } else { Write-Log "budget: $($b.Reason)" }
    return $b
}
# Phase A's buildable issues split by the budget verdict (Allowed / Deferred), from a queue.
function Split-QueueByBudget {
    param($Q, [string]$Verdict)
    $b = @($Q.buildable | Where-Object { $null -ne $_ })
    $lo = @{}; foreach ($n in $b) { $lo[[int]$n] = @(Get-QueueLabels $Q ([int]$n)) }
    return (Split-BuildableByBudget -Buildable $b -LabelsOf $lo -Config $Cfg -Override $Model -Verdict $Verdict)
}
function Format-Deferred {
    param([object[]]$Deferred, [string]$Verdict)
    return "plan budget ${Verdict}: deferred $(@($Deferred | ForEach-Object { "#$($_.Issue) ($($_.Model))" }) -join ', '); still approved, built by a later run once the verdict allows"
}

# After a build session: an issue it took that still carries loop:in-progress was left mid-build (the
# session was killed at its time limit, hit max turns, or just stopped). Mark it loop:failed with a failure
# marker (gate-rules.ps1 Get-UnfinishedFailure: timeout / max-turns are retried once; anything merged in
# that session is not). Never throws.
function Close-UnfinishedIssues {
    param([int[]]$Issues, [string]$EndClass, [datetime]$Since, [int]$LimitMinutes)
    $closed = @()
    foreach ($n in @($Issues | Where-Object { $_ -gt 0 } | Sort-Object -Unique)) {
        try {
            $i = Get-GhJson @('api', "repos/$($script:Repo)/issues/$n")
            $labels = @($i.labels | ForEach-Object { $_.name })
            if ($i.state -ne 'open' -or $labels -notcontains 'loop:proposal' -or $labels -notcontains 'loop:in-progress') { continue }
            $mergeSha = ''
            $rec = Read-State "merge-$n"
            if ($rec -and $rec.mergedUtc -and ([datetime]$rec.mergedUtc).ToUniversalTime() -ge $Since.ToUniversalTime()) { $mergeSha = "$($rec.mergeSha)" }
            $f = Get-UnfinishedFailure -EndClass $EndClass -MergeSha $mergeSha -TimeoutMinutes $LimitMinutes -Who 'Ve'
            $body = "$($script:Marker)`n$(Format-FailureMarker -Class $f.Class -Outcome 'failed')`n## Synopsis`n`n$($f.Synopsis)`n`n## Details`n`n" +
                "Run ``$RunId`` ended its build session with ``$EndClass`` while this issue still carried loop:in-progress. Failure class ``$($f.Class)``: $(Get-FailureDescription $f.Class). " +
                "Posted by run-loop.ps1 after the session stopped; see logs\run-$RunId.log and the session transcript.`n"
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

# The loop's clone (never Ve's checkout, never the live one), reset to origin/main before each session.
function Reset-Clone {
    if (-not (Test-Path -LiteralPath (Join-Path $script:Clone '.git'))) {
        Invoke-Native -File 'git' -Arguments @('clone', $script:CloneUrl, $script:Clone) | Out-Null
    }
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', '--prune') -Quiet | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('checkout', '-f', '-B', 'main', 'origin/main') -Quiet | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('reset', '--hard', 'origin/main') -Quiet | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('clean', '-fdx', '-e', 'node_modules', '-e', '.cache') -Quiet | Out-Null
    return (Get-GitValue -Repo $script:Clone -Arguments @('rev-parse', 'origin/main'))
}

# The run header + the LOOP.md sections one session needs. Returns the prompt path.
function New-SessionPrompt {
    param([string]$Kind, [int]$Issue = 0, [string]$SessionModel, [int]$Turns, [datetime]$SessionDeadline, $Q, [string]$MainSha, [string]$LiveHead,
        [string]$ServerUsed = '', [string]$BuiltLine = '')
    $loopMd = [IO.File]::ReadAllText((Join-Path $ScriptsDir 'LOOP.md'))
    $name = $Kind; if ($Issue -gt 0) { $name = "$Kind-$Issue" }
    $lines = @()
    switch ($Kind) {
        'build' {
            $sections = @(0, 1, 2, 3, 4, 6)
            $retry = 'no'; if (@($Q.retry) -contains $Issue) { $retry = 'yes: the ONE automatic retry (section 3 steps 4 and 6)' }
            $lines += "# CardLens innovation loop run ${RunId}: build session for issue #$Issue"
            $lines += ''
            $lines += "- JOB: build issue #$Issue, and only it (section 3). Then end (section 6). This session opens no proposals: a separate session does that."
            $lines += "- ISSUE: $Issue   (retry: $retry)"
            $lines += "- SERVER_DEPLOY: $serverDeploy   $( if ($serverDeploy -notlike 'available*') { "($serverWhy) -> if this change needs a server deploy, skip it (section 3 step 3)" } )"
            $su = 'no'; if ($ServerUsed) { $su = "yes ($ServerUsed): at most one server deploy per run, so if this change needs one, skip it (section 3 step 3)" }
            $lines += "- SERVER_DEPLOYED_THIS_RUN: $su"
            if ($BuiltLine) { $lines += "- EARLIER_THIS_RUN: $BuiltLine" }
        }
        'propose' {
            $sections = @(0, 1, 2, 5, 6)
            $lines += "# CardLens innovation loop run ${RunId}: proposal session (Phase B)"
            $lines += ''
            $lines += '- JOB: Phase B only (section 5): open the approved specs'' next slices, then new proposals, within the slots. Build, merge and deploy nothing. Then end (section 6).'
            if ($BuiltLine) { $lines += "- BUILT_THIS_RUN: $BuiltLine   (separate build sessions; mention them in your summary)" }
            $lines += "- FOCUS: $focus"
            $lines += "- PRODUCT: $product"
        }
        'review' {
            $sections = @(0, 1, 2, 5, 6, 7)
            $lines += "# CardLens innovation loop run ${RunId}: weekly product review session"
            $lines += ''
            $lines += '- JOB: the weekly product review (section 7). Read-only; build, merge and deploy nothing. Then end (section 6).'
            $lines += "- FOCUS: $focus"
            $lines += "- PRODUCT: $product"
        }
    }
    if ($Kind -ne 'build') {
        $sl = @($Q.slicesToOpen | Where-Object { $_ })
        $slot = 'unknown (queue check failed): run check-approval.ps1 -Slots'
        if ($Q) { $slot = "newThisRun $($Q.slots.newThisRun) (free $($Q.slots.free) of $($Q.slots.cap)); a new spec allowed: $(if ($Q.slots.mayOpenSpec) { 'yes' } else { 'no' })" }
        $lines += "- SLOTS: $slot   (check-approval.ps1 -Slots stays the authority)"
        if ($sl.Count -gt 0) {
            $items = @($sl | ForEach-Object { '#{0} slice {1} of {2} "{3}"' -f $_.spec, $_.k, $_.of, $_.title })
            $lines += '- SLICES_TO_OPEN (before any new idea, in this order): ' + ($items -join '; ')
        }
        else { $lines += '- SLICES_TO_OPEN: none' }
    }
    $lines += "- MODE: $mode"
    $lines += "- MODEL: $SessionModel"
    $lines += "- DEADLINE: $($SessionDeadline.ToString('yyyy-MM-dd HH:mm zzz'))   (this session is killed by then; check the time with Get-Date)"
    $lines += "- MAX_TURNS: $Turns   (the session ends when it is reached, even mid-deploy)"
    $lines += "- QUEUE (at session start, for your summary; check-approval.ps1 stays the authority): $(Format-QueueLine $Q)"
    $lines += '- SESSION_TOKEN: reduced (normal user, Medium integrity; checked at start). Server deploys run in a separate elevated task.'
    $lines += "- DATE: $((Get-Date).ToString('yyyy-MM-dd HH:mm zzz'))"
    $lines += "- LOOP_HOME: $($script:LoopHome)"
    $lines += "- SCRIPTS: $ScriptsDir   (pinned; you cannot edit it)"
    $lines += "- CLONE: $($script:Clone)   (vekbui96/cardlens, reset to origin/main $MainSha)"
    $lines += "- LIVE_SERVER_HEAD: $LiveHead   (D:\services\cardlens at session start; read-only for you)"
    $lines += "- WORK: $(Join-Path $script:LoopHome 'work')   (scratch: body files for comments, commit messages)"
    $lines += "- ARTIFACTS: $(Join-Path $script:LoopHome 'artifacts')"
    $lines += ''
    $lines += 'Follow the instructions below exactly. They are the only instructions for this session; sections not needed for this job are left out.'
    $lines += ''; $lines += '---'; $lines += ''
    $promptPath = Join-Path $script:LoopHome "logs\run-$RunId.$name.prompt.md"
    [IO.File]::WriteAllText($promptPath, ($lines -join "`n") + "`n" + (Get-LoopMdSections -Text $loopMd -Sections $sections), (New-Object Text.UTF8Encoding $false))
    return $promptPath
}

# One reduced-token claude session. Returns Kind, Issue, Model, Path (transcript), Start, EndClass
# (timeout | max-turns | session-ended), Status (LOOP-RESULT word), Reason, Ok, Summary, Turns, Cost.
function Invoke-Session {
    param([string]$Kind, [int]$Issue = 0, [string]$SessionModel, [int]$Turns, [int]$Minutes, [string]$PromptPath)
    $name = $Kind; if ($Issue -gt 0) { $name = "$Kind-$Issue" }
    $s = [pscustomobject]@{ Kind = $Kind; Issue = $Issue; Model = $SessionModel; Path = (Join-Path $script:LoopHome "logs\run-$RunId.$name.jsonl"); Start = (Get-Date)
        EndClass = 'session-ended'; Status = ''; Reason = ''; Ok = $false; Summary = ''; Turns = 0; Cost = $null; ExitCode = $null }
    $guardMode = @{ build = 'BUILD'; propose = 'PROPOSE'; review = 'PRODUCT_REVIEW' }[$Kind]
    $env:INNOVATION_LOOP_CARDLENS_MODE = $guardMode   # the guard narrows what each kind of session may do
    $settingsPath = Join-Path $script:LoopHome "state\claude-settings-$Kind.json"
    $q = { param($x) '"' + $x + '"' }
    $argList = @('-p', '--output-format', 'stream-json', '--verbose', '--model', $SessionModel, '--max-turns', "$Turns",
        '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--settings', (& $q $settingsPath), '--setting-sources', 'local',
        '--strict-mcp-config', '--add-dir', (& $q $script:LoopHome), (& $q $ScriptsDir), (& $q 'D:\services\logs'))
    $argString = $argList -join ' '
    Write-Log "session $name start: model=$SessionModel maxTurns=$Turns timeout=${Minutes}m guardMode=$guardMode"
    Write-Log "claude command: `"$ClaudeExe`" $argString  < $PromptPath"
    $errPath = Join-Path $script:LoopHome "logs\run-$RunId.$name.err.log"
    try {
        # Never run the session with this process's token: on this box the task's token is FULL whatever its
        # RunLevel says. Start-ReducedAndWait drops to a normal-user, Medium-integrity token, logs the child's
        # real token and fails closed (kills it, throws) if it still has admin rights.
        $run = Start-ReducedAndWait -File $ClaudeExe -ArgumentString $argString -WorkDir (Join-Path $script:LoopHome 'work') -StdIn $PromptPath -StdOut $s.Path -StdErr $errPath -TimeoutMinutes $Minutes
        $s.ExitCode = $run.ExitCode
        if ($run.TimedOut) { $s.EndClass = 'timeout'; Write-Log "session $name exceeded $Minutes minutes (process tree killed)" 'ERROR' }
        else { Write-Log "session $name claude pid $($run.Pid) exit code $($run.ExitCode)" }
    } catch { Write-Log "session ${name}: $_" 'ERROR'; $s.Reason = "could not run: $_"; $s.EndClass = 'not-started' }
    $result = $null
    if (Test-Path -LiteralPath $s.Path) { foreach ($line in [IO.File]::ReadAllLines($s.Path)) { if ($line -match '"type"\s*:\s*"result"') { try { $result = $line | ConvertFrom-Json } catch { } } } }
    if ($result) {
        $s.Summary = "$($result.result)"; $s.Turns = $result.num_turns; $s.Cost = $result.total_cost_usd
        Write-Log ("result: session={0} subtype={1} is_error={2} turns={3} cost={4}" -f $name, $result.subtype, $result.is_error, $result.num_turns, $result.total_cost_usd)
        if ("$($result.subtype)" -eq 'error_max_turns') { $s.EndClass = 'max-turns' }
        $m = [regex]::Match($s.Summary, 'LOOP-RESULT:\s*([A-Z\-]+)[ \t]*([^\r\n]*)')
        $s.Status = $m.Groups[1].Value; $s.Reason = $m.Groups[2].Value.Trim()
        $s.Ok = ($s.ExitCode -eq 0 -and -not $result.is_error)
    } elseif (-not $s.Reason) {
        $s.Reason = "no result message in the transcript ($($s.EndClass))"; Write-Log "session ${name}: no result message in the transcript" 'ERROR'
    }
    Write-Log "session $name end: LOOP-RESULT $($s.Status) $($s.Reason)"
    return $s
}

$exitCode = 1
$queue = $null; $finalQueue = $null; $res = $null
$sessions = New-Object System.Collections.ArrayList
$problems = New-Object System.Collections.ArrayList
$runNotes = New-Object System.Collections.ArrayList
$serverDeploy = 'unavailable'; $serverWhy = ''
$focus = ''; $product = ''
try {
    # ---- environment ------------------------------------------------------------------------
    Add-GhToPath
    foreach ($n in (Clear-SecretEnv)) { Write-Log "unset env var $n for this run" }
    $env:INNOVATION_LOOP_CARDLENS_HOME = $script:LoopHome
    $env:INNOVATION_LOOP_CARDLENS_SCRIPTS = $ScriptsDir
    $env:INNOVATION_LOOP_RUN_ID = $RunId
    $env:INNOVATION_LOOP_CARDLENS_MODE = $mode
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
    if ($elevated) { Write-Log 'run-loop itself holds an admin token (normal for a scheduled task on this box); every claude session is started with a reduced token' }

    # ---- precheck: anything to do at all? (no session, so it costs nothing) -----------------------
    $queue = Get-LoopQueue
    # plan budget (the ops hub): which sessions may start at all
    $budget = Get-PlanBudget
    $deferred = @()
    if ($mode -eq 'FULL' -and $null -ne $queue -and $budget.Verdict -ne 'hold') { $deferred = @((Split-QueueByBudget $queue $budget.Verdict).Deferred) }
    $pbKind = 'propose'; if ($ProductReview) { $pbKind = 'review' }
    $pbOk = Test-BudgetAllowsModel -Verdict $budget.Verdict -Model (Get-SessionModel -Kind $pbKind -Config $Cfg -Override $Model)
    $pre = Get-PrecheckDecision -Queue $queue -Mode $mode -Budget $budget -Deferred @($deferred | ForEach-Object { $_.Issue }) -PhaseBAllowed $pbOk
    Write-Log "queue: $(Format-QueueLine $queue)"
    if ($deferred.Count -gt 0) { Write-Log "Phase A: $(Format-Deferred $deferred $budget.Verdict)"; [void]$runNotes.Add("Phase A: $(Format-Deferred $deferred $budget.Verdict)") }
    Write-Log "precheck: launch=$($pre.Launch) ($($pre.Reason))"
    if (-not $pre.Launch) {
        $waitLine = Format-WaitingOnOwner -Waiting @($queue.waitingOnVe) -Who 'Ve'
        if ($pre.Hold) {
            $sumLines = @("Precheck (no claude session started): plan budget hold.",
                "- $($budget.Reason). Approved issues stay approved and proposals are not refilled until the verdict is normal or no-opus again.",
                "- Queue: $(Format-QueueLine $queue).")
        } else {
            $sumLines = @("Precheck (no claude session started): nothing to do.",
                "- Phase A: $(if ($mode -ne 'FULL') { "not run ($mode)" } elseif ($deferred.Count -gt 0) { Format-Deferred $deferred $budget.Verdict } else { 'no buildable approved issue' }).",
                "- Phase B: $(if (-not $pbOk) { "the $pbKind model is not allowed by the $($budget.Reason)" } else { "no free proposal slot ($(@($queue.slots.awaitingReview).Count) proposals awaiting review, cap $($queue.slots.cap); approved and failed proposals do not count)" }).")
        }
        if ($waitLine) { $sumLines += "- $waitLine" }
        $resLine = 'LOOP-RESULT: NOTHING-TO-DO'
        if ($pre.Hold) { $resLine += ' plan budget hold (no claude session)' }
        elseif ($deferred.Count -gt 0 -or -not $pbOk) { $resLine += " plan budget $($budget.Verdict) (Opus sessions deferred)" }
        $sumLines += $resLine
        if ($DryRun) {
            Write-Log 'precheck: a real run would end here with NOTHING-TO-DO and no claude session (dry run: carrying on to show the plan)'
        } else {
            $utf8 = New-Object Text.UTF8Encoding $false
            [IO.File]::WriteAllText((Join-Path $script:LoopHome "logs\run-$RunId.summary.txt"), ($sumLines -join "`r`n"), $utf8)
            $rd = [ordered]@{ runId = $RunId; mode = $mode; trigger = (Get-LoopRunTrigger -TaskName 'innovation-loop-cardlens' -RunStart $RunStart); status = 'NOTHING-TO-DO'
                precheck = $pre.Reason; claudeStarted = $false; totals = [ordered]@{ Turns = 0; Requests = 0; Input = 0; Output = 0; CacheRead = 0; CacheWrite = 0; Cost = 0; Models = @() }
                issues = @(); createdIssues = @(); sessions = @(); waitingOnVe = $waitLine
                budget = [ordered]@{ verdict = $budget.Verdict; reason = $budget.Reason; failedOpen = $budget.Warn; deferred = @($deferred | ForEach-Object { $_.Issue }) } }
            [IO.File]::WriteAllText((Join-Path $script:LoopHome "logs\run-$RunId.rundata.json"), ($rd | ConvertTo-Json -Depth 5), $utf8)
            Write-Log 'result: subtype=precheck is_error=False turns=0 cost=0 (no claude session)'
            Write-Log $resLine
            $exitCode = 0
            return
        }
    }

    # ---- the loop's clone (never Ve's checkout, never the live one) ------------------------------
    $mainSha = Reset-Clone

    # ---- server deploy availability ------------------------------------------------------------
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
        elseif ($ProposeOnly) { $serverDeploy = 'not needed'; $serverWhy = "$mode builds nothing" }
        else {
            $self = Invoke-ElevatedRequest -Mode selftest -TimeoutMinutes 3
            if ($self.status -eq 'ok') { $serverDeploy = 'available' } else { $serverWhy = "elevated selftest: $($self.status) $($self.message)" }
        }
    }
    Write-Log "SERVER_DEPLOY=$serverDeploy $serverWhy liveHead=$liveHead main=$mainSha"

    # ---- permission settings, one file per session kind ----------------------------------------
    # dontAsk: anything not allowlisted is denied (nobody is there to answer a prompt).
    # guard.mjs then enforces the repo/secret/never-touch/one-command rules on every call, narrowed by the
    # session kind (INNOVATION_LOOP_CARDLENS_MODE = BUILD | PROPOSE | PRODUCT_REVIEW).
    $readOnly = 'Get-ChildItem', 'Get-Content', 'Get-Item', 'Test-Path', 'Select-String', 'Get-Date', 'Start-Sleep', 'ConvertFrom-Json',
        'ConvertTo-Json', 'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object', 'Format-List', 'Format-Table', 'Out-String',
        'Write-Output', 'Join-Path', 'Split-Path', 'Resolve-Path', 'Get-Service', 'Get-FileHash', 'Invoke-WebRequest', 'Invoke-RestMethod',
        'New-Item', 'Remove-Item'
    $baseAllow = @('Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite',
        'WebFetch(domain:vekbui96.github.io)', 'WebFetch(domain:server-pc.tail0e4194.ts.net)',
        'WebFetch(domain:api.pokemontcg.io)', 'WebFetch(domain:api.tcgdex.net)',
        'PowerShell(git *)', 'PowerShell(gh *)')
    foreach ($r in $readOnly) { $baseAllow += "PowerShell($r)"; $baseAllow += "PowerShell($r *)" }
    $deny = @('Bash', 'Agent', 'Task', 'NotebookEdit', 'WebSearch', 'Skill',
        'PowerShell(npm *)', 'PowerShell(npm.cmd *)', 'PowerShell(npx *)', 'PowerShell(node *)', 'PowerShell(cmd *)',
        'PowerShell(powershell *)', 'PowerShell(pwsh *)', 'PowerShell(schtasks *)', 'PowerShell(schtasks.exe *)',
        'PowerShell(Start-ScheduledTask *)', 'PowerShell(Restart-Service *)', 'PowerShell(docker *)',
        'PowerShell(git push --force*)', 'PowerShell(git push -f*)', 'PowerShell(gh pr merge *)', 'PowerShell(gh auth *)')
    # Exactly these scripts, called by bare full path (no `&`, no quotes). The elevated deploy task is
    # triggered ONLY from inside deploy.ps1 / rollback.ps1 / merge-pr.ps1 (fixed task name); the session
    # itself has no schtasks / ScheduledTask rule and the guard blocks those words. Proposal and review
    # sessions get check-approval.ps1 only.
    $scriptsFor = @{
        build   = @('check-approval', 'test-gate', 'update-snapshots', 'wait-ci', 'merge-pr', 'deploy', 'rollback', 'ci-rerun', 'progress')
        propose = @('check-approval')
        review  = @('check-approval')
    }
    $utf8 = New-Object Text.UTF8Encoding $false
    foreach ($kind in $scriptsFor.Keys) {
        $allow = @($baseAllow)
        foreach ($n in $scriptsFor[$kind]) { $allow += "PowerShell($ScriptsDir\$n.ps1)"; $allow += "PowerShell($ScriptsDir\$n.ps1 *)" }
        $settings = [ordered]@{
            permissions = [ordered]@{ defaultMode = 'dontAsk'; allow = $allow; deny = $deny }
            hooks       = @{ PreToolUse = @(@{ matcher = '*'; hooks = @(@{ type = 'command'; command = "node `"$ScriptsDir\guard.mjs`""; timeout = 30 }) }) }
        }
        [IO.File]::WriteAllText((Join-Path $script:LoopHome "state\claude-settings-$kind.json"), ($settings | ConvertTo-Json -Depth 10), $utf8)
    }

    # ---- FOCUS / PRODUCT (Ve's, read-only): present only if something is left after removing HTML
    # comments, headings and blank lines --------------------------------------------------------------
    $focusPath = Join-Path $ScriptsDir 'FOCUS.md'
    $focus = "none (no FOCUS.md, or it is empty) -> propose as usual"
    if (Test-Path -LiteralPath $focusPath -PathType Leaf) {
        $ft = [regex]::Replace([IO.File]::ReadAllText($focusPath), '(?s)<!--.*?-->', '')
        $left = @($ft -split "`r?`n" | Where-Object { $_.Trim() -and $_.Trim() -notmatch '^#' })
        if ($left.Count -gt 0) { $focus = "$focusPath   (Ve's priorities and things to avoid; read it first in section 5)" }
    }
    Write-Log "FOCUS: $focus"
    $productPath = Join-Path $ScriptsDir 'PRODUCT.md'
    $product = 'none (no PRODUCT.md, or it is empty)'
    if (Test-Path -LiteralPath $productPath -PathType Leaf) {
        $pt = [regex]::Replace([IO.File]::ReadAllText($productPath), '(?s)<!--.*?-->', '')
        $pleft = @($pt -split "`r?`n" | Where-Object { $_.Trim() -and $_.Trim() -notmatch '^#' })
        if ($pleft.Count -gt 0) { $product = "$productPath   (Ve's product picture; read it in section 5 step 0 / section 7; read-only)" }
    }
    Write-Log "PRODUCT: $product"

    $stopRun = $false
    $built = @()            # {Issue; Outcome} per build session
    $serverUsed = ''
    $simMinutes = 0         # dry run: minutes a build is assumed to take, for planning the next one
    $minutesLeft = { ($Deadline - (Get-Date)).TotalMinutes - $simMinutes }

    # ---- Phase A: one session per approved issue ------------------------------------------------
    if ($mode -eq 'FULL') {
        $q = $queue
        while ($true) {
            if ($built.Count -gt 0 -and -not $DryRun) { $q = Get-LoopQueue }
            if ($null -eq $q) { Write-Log 'Phase A: the queue check failed; no build session' 'WARN'; [void]$runNotes.Add('Phase A: queue check failed, nothing built'); break }
            # the plan budget, re-read before every build session (a verdict that changes mid-run counts)
            if ($built.Count -gt 0) { $budget = Get-PlanBudget }
            if ($budget.Verdict -eq 'hold') { Write-Log "Phase A: stop: $($budget.Reason)"; [void]$runNotes.Add("Phase A stopped: $($budget.Reason)"); break }
            $split = Split-QueueByBudget $q $budget.Verdict
            if (@($split.Deferred).Count -gt 0) {
                $dl = "Phase A: $(Format-Deferred @($split.Deferred) $budget.Verdict)"
                if ($runNotes -notcontains $dl) { Write-Log $dl; [void]$runNotes.Add($dl) }
            }
            $dec = Get-NextBuildDecision -Buildable @($split.Allowed) -Done $built -MaxBuilds $MaxBuilds -RemainingMinutes (& $minutesLeft) -SecondBuildMinMinutes $SecondBuildMinMinutes
            Write-Log "Phase A: $(if ($dec.Start) { 'starting' } else { 'stop:' }) $($dec.Reason)"
            if (-not $dec.Start) { [void]$runNotes.Add("Phase A stopped: $($dec.Reason)"); break }
            $n = $dec.Issue
            $labels = Get-QueueLabels $q $n
            $sm = Get-SessionModel -Kind 'build' -Labels $labels -Config $Cfg -Override $Model
            $minutes = [int][math]::Floor([math]::Min([double]$Cfg.build.timeoutMinutes, (& $minutesLeft)))
            $sessDeadline = (Get-Date).AddMinutes($minutes)
            $sha = $mainSha; if ($built.Count -gt 0 -and -not $DryRun) { $sha = Reset-Clone; try { $liveHead = Get-LiveHead } catch { } }
            $builtLine = @($built | ForEach-Object { "#$($_.Issue) $($_.Outcome)" }) -join ', '
            $pp = New-SessionPrompt -Kind 'build' -Issue $n -SessionModel $sm -Turns ([int]$Cfg.build.maxTurns) -SessionDeadline $sessDeadline -Q $q -MainSha $sha -LiveHead $liveHead -ServerUsed $serverUsed -BuiltLine $builtLine
            if ($DryRun) {
                Write-Log "DRY RUN plan: build session #$n model=$sm (labels: $($labels -join ',')) maxTurns=$($Cfg.build.maxTurns) timeout=${minutes}m prompt=$pp"
                $built += [pscustomobject]@{ Issue = $n; Outcome = 'deployed' }; $simMinutes += 75   # assume it deploys in ~75 min, to show the plan
                continue
            }
            $s = Invoke-Session -Kind 'build' -Issue $n -SessionModel $sm -Turns ([int]$Cfg.build.maxTurns) -Minutes $minutes -PromptPath $pp
            [void]$sessions.Add($s)
            if ($s.EndClass -eq 'not-started') {
                # e.g. the reduced token could not be verified (fail closed): nothing else may run either
                [void]$problems.Add("build #${n}: the session could not be started ($($s.Reason)); the run stopped"); $stopRun = $true; break
            }
            # finalise this issue: a progress comment left mid-build, an issue left loop:in-progress
            try { $ended = @(Complete-LoopProgress -LoopHome $script:LoopHome -RunId $RunId -GhExe $script:GhExe -Issue $n); if ($ended.Count -gt 0) { Write-Log "progress comment of #$n left mid-build, marked as ended" 'WARN' } } catch { Write-Log "progress finalisation of #${n}: $_" 'WARN' }
            $closed = @(Close-UnfinishedIssues -Issues @($n) -EndClass $s.EndClass -Since $s.Start -LimitMinutes $minutes)
            $markerOutcome = ''
            try { $part = @((Read-LoopTranscript -Path $s.Path -SessionIssue $n).Parts | Where-Object { $_.Issue -eq $n }); if ($part.Count -gt 0) { $markerOutcome = "$($part[0].Outcome)" } } catch { }
            $lbl = @(); try { $lbl = @((Get-GhJson @('api', "repos/$($script:Repo)/issues/$n")).labels | ForEach-Object { $_.name }) } catch { Write-Log "cannot read #$n labels: $_" 'WARN' }
            $outcome = Get-BuildOutcome -Labels $lbl -MarkerOutcome $markerOutcome
            $built += [pscustomobject]@{ Issue = $n; Outcome = $outcome }
            $cert = Get-DeployCertainty -SessionStart $s.Start -MergeRec (Read-State "merge-$n") -DeployRec (Read-State "deploy-$n") -RollbackRec (Read-State "rollback-$n")
            Write-Log "build #$n ended: outcome=$outcome (marker: $markerOutcome) deploy=$($cert.State) ($($cert.Reason))$(if ($closed.Count) { '; marked loop:failed by the runner' })"
            $dr = Read-State "deploy-$n"
            if ($dr -and $dr.serverDeployed -and $dr.startedUtc -and ([datetime]$dr.startedUtc).ToUniversalTime() -ge $s.Start.ToUniversalTime()) { $serverUsed = "#$n" }
            if (-not $cert.Certain) {
                [void]$problems.Add("#${n}: $($cert.Reason). DEPLOY STATE UNCERTAIN, NEEDS VE: the run stopped here (no further build, no proposals)")
                Write-Log "build #${n}: deploy state uncertain ($($cert.Reason)); stopping the run" 'ERROR'
                $stopRun = $true; break
            }

        }
    }

    # ---- Phase B: one proposal session (or the weekly review) -------------------------------------
    if (-not $stopRun) {
        $kind = 'propose'; if ($ProductReview) { $kind = 'review' }
        $qb = $queue; if ($built.Count -gt 0 -and -not $DryRun) { $qb = Get-LoopQueue }
        $builtLine = @($built | ForEach-Object { "#$($_.Issue) $($_.Outcome)" }) -join ', '
        $left = & $minutesLeft
        $why = ''
        if ($built.Count -gt 0) { $budget = Get-PlanBudget }   # re-read: a build may have moved the verdict
        if ($kind -eq 'propose') {
            if ($null -ne $qb -and [int]$qb.slots.newThisRun -le 0) { $why = "no free proposal slot ($(@($qb.slots.awaitingReview).Count) awaiting review, cap $($qb.slots.cap))" }
            elseif ($left -lt [double]$Cfg.propose.minMinutes) { $why = "$([int]$left) min left before the deadline (a proposal session needs $($Cfg.propose.minMinutes))" }
        }
        if (-not $why) {
            $pm = Get-SessionModel -Kind $kind -Config $Cfg -Override $Model
            if (-not (Test-BudgetAllowsModel -Verdict $budget.Verdict -Model $pm)) { $why = "$($budget.Reason) does not allow a $kind session on $pm" }
        }
        if ($why) {
            Write-Log "Phase B: no proposal session: $why"; [void]$runNotes.Add("Phase B: no proposal session ($why)")
        } else {
            $c = $Cfg[$kind]
            $sm = Get-SessionModel -Kind $kind -Config $Cfg -Override $Model
            $minutes = [int][math]::Floor([math]::Min([double]$c.timeoutMinutes, $left))
            $sha = $mainSha; if ($built.Count -gt 0 -and -not $DryRun) { $sha = Reset-Clone; try { $liveHead = Get-LiveHead } catch { } }
            $pp = New-SessionPrompt -Kind $kind -SessionModel $sm -Turns ([int]$c.maxTurns) -SessionDeadline ((Get-Date).AddMinutes($minutes)) -Q $qb -MainSha $sha -LiveHead $liveHead -BuiltLine $builtLine
            if ($DryRun) {
                Write-Log "DRY RUN plan: $kind session model=$sm maxTurns=$($c.maxTurns) timeout=${minutes}m slots newThisRun=$($qb.slots.newThisRun) slicesToOpen=$(@($qb.slicesToOpen).Count) prompt=$pp"
            } else {
                [void]$sessions.Add((Invoke-Session -Kind $kind -SessionModel $sm -Turns ([int]$c.maxTurns) -Minutes $minutes -PromptPath $pp))
            }
        }
    }

    if ($DryRun) {
        Write-Log "DRY RUN: $(@($built).Count) build session(s) and $(if (@($runNotes | Where-Object { $_ -like 'Phase B: no*' }).Count) { 'no' } else { 'one' }) Phase B session planned; stopping before invoking claude"
        $exitCode = 0
        return
    }

    # ---- the run's result and summary ------------------------------------------------------------
    $res = Get-RunResult -Sessions @($sessions) -Problems @($problems)
    $sum = New-Object System.Collections.ArrayList
    [void]$sum.Add("Run $RunId ($mode): $($sessions.Count) session(s), one per job.")
    foreach ($s in $sessions) {
        $nm = $s.Kind; if ($s.Issue) { $nm += " #$($s.Issue)" }
        $c = 'n/a'; if ($null -ne $s.Cost) { $c = '$' + ([double]$s.Cost).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture) }
        [void]$sum.Add("- $nm ($($s.Model), $($s.Turns) turns, $c, ended: $($s.EndClass)): LOOP-RESULT $($s.Status) $($s.Reason)".TrimEnd())
    }
    foreach ($b in $built) { [void]$sum.Add("- build #$($b.Issue): $($b.Outcome)") }
    foreach ($r in $runNotes) { [void]$sum.Add("- $r") }
    foreach ($p in $problems) { [void]$sum.Add("- RUNNER: $p") }
    foreach ($s in $sessions) {
        $nm = $s.Kind; if ($s.Issue) { $nm += " #$($s.Issue)" }
        [void]$sum.Add(''); [void]$sum.Add("=== $nm session summary ===")
        $txt = ($s.Summary -replace '(?m)^\s*LOOP-RESULT:.*$', '').Trim(); if (-not $txt) { $txt = '(none)' }
        [void]$sum.Add($txt)
    }
    $finalQueue = Get-LoopQueue
    $waitLine = Format-WaitingOnOwner -Waiting @($finalQueue.waitingOnVe) -Who 'Ve'
    [void]$sum.Add(''); if ($waitLine) { [void]$sum.Add($waitLine) } else { [void]$sum.Add('Failed, waiting on Ve: none') }
    [void]$sum.Add($res.Line)
    [IO.File]::WriteAllText((Join-Path $script:LoopHome "logs\run-$RunId.summary.txt"), ($sum -join "`r`n"), $utf8)
    $tc = [double]0; $tt = 0; foreach ($s in $sessions) { if ($null -ne $s.Cost) { $tc += [double]$s.Cost }; $tt += [int]$s.Turns }
    Write-Log ("run total: sessions={0} turns={1} usd={2}" -f $sessions.Count, $tt, $tc.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture))
    Write-Log $res.Line
    $allOk = (@($sessions | Where-Object { -not $_.Ok }).Count -eq 0)
    if ($allOk -and $res.Status -in @('OK', 'NOTHING-TO-DO')) { $exitCode = 0 } else { $exitCode = 1 }
} catch {
    Write-Log "run failed: $_" 'ERROR'
    $exitCode = 1
} finally {
    # ---- reporting (after the reduced claude children exited; never changes the exit code) ----------
    # Same process, same gh and rights as the preflight above; the sessions get no new permission (they only
    # printed the LOOP-ISSUE-START/END marker lines, LOOP.md section 3). Posting failures are warnings.
    $ran = @($sessions | Where-Object { Test-Path -LiteralPath $_.Path })
    if ($ran.Count -gt 0) {
        try {
            $triggerTask = 'innovation-loop-cardlens'; if ($ProductReview) { $triggerTask = 'innovation-loop-cardlens-review' }
            $trigger = Get-LoopRunTrigger -TaskName $triggerTask -RunStart $RunStart
            if (-not $finalQueue) { $finalQueue = Get-LoopQueue }
            $waitLine = Format-WaitingOnOwner -Waiting @($finalQueue.waitingOnVe) -Who 'Ve'
            if ($waitLine) { Write-Log $waitLine }
            $st = ''; if ($res) { $st = $res.Status }
            $posted = Publish-LoopRunData -Sessions @($ran | ForEach-Object { [pscustomobject]@{ Path = $_.Path; Kind = $_.Kind; Issue = $_.Issue; Model = $_.Model } }) -Status $st `
                -Repo $script:Repo -GhExe $script:GhExe -RunId $RunId -Mode $mode -Trigger $trigger -LoopHome $script:LoopHome -Waiting $waitLine
            Write-Log "run data: $posted comment(s) posted"
        } catch { Write-Log "run data / progress reporting skipped: $_" 'WARN' }
    }
    # spec checklists: every run (also NOTHING-TO-DO), so a slice deployed or closed by hand is ticked off
    try {
        $sq = $finalQueue; if (-not $sq) { $sq = $queue }
        if ($sq -and @($sq.specs).Count -gt 0) {
            $upd = @(Publish-SpecProgress -LoopHome $script:LoopHome -RunId $RunId -Repo $script:Repo -GhExe $script:GhExe -Specs @($sq.specs) -Marker $script:Marker -Who 'Ve' -NoPost:$DryRun)
            if ($upd.Count -gt 0) { Write-Log "spec progress: $(if ($DryRun) { 'would update (dry run, written to state\spec only)' } else { 'updated' }) #$($upd -join ', #')" }
        }
    } catch { Write-Log "spec progress skipped: $_" 'WARN' }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem (Join-Path $script:LoopHome 'logs') -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Log "exit $exitCode"
}
exit $exitCode

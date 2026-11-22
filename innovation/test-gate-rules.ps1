<#
.SYNOPSIS
  Unit tests for gate-rules.ps1: the CI verdict merge-pr.ps1 merges on (and wait-ci.ps1 reports), the
  one-rerun rule for known-flaky e2e specs, the live-server gap rule, and whether a build session left the
  deploy state certain, and the plan-budget gate (verdict x session kind x model, stale / missing file,
  -IgnoreBudget, the precheck under it). The queue and session rules are in test-queue-rules.ps1. No network, no git.
  powershell -ExecutionPolicy Bypass -File innovation\test-gate-rules.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"          # the gap rule's path classifier is shared with the elevated deploy-server.ps1
. "$PSScriptRoot\gate-rules.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }
function Job { param([string]$Name, [string]$Status = 'completed', [string]$Conclusion = 'success', [string]$Started = '2026-11-16T22:00:00Z')
    [pscustomobject]@{ name = $Name; status = $Status; conclusion = $Conclusion; started_at = $Started; html_url = "https://github.com/x/runs/$Name" } }
$verify = 'Typecheck ' + [char]0x00B7 + ' Lint ' + [char]0x00B7 + ' Unit ' + [char]0x00B7 + ' Build'   # the real job name has middle dots
function Ci { param([object[]]$Runs, [double]$Min = 1) return (Get-CiVerdict -CheckRuns $Runs -MissingMinutes $Min) }

# ---- CI verdict ------------------------------------------------------------------------------------
$all = @((Job $verify), (Job 'Playwright E2E'), (Job 'v2 Visual Regression'))
Check ((Ci $all).State -eq 'ok') 'all three completed + success -> ok'
Check ((Ci (@($all) + @(Job 'Deploy (Pages)' 'completed' 'skipped'))).State -eq 'ok') 'an unrelated skipped job does not matter'
Check ((Ci @((Job $verify), (Job 'Playwright E2E' 'in_progress' ''), (Job 'v2 Visual Regression'))).State -eq 'pending') 'e2e in progress -> pending'
Check ((Ci @((Job $verify), (Job 'Playwright E2E' 'queued' ''), (Job 'v2 Visual Regression'))).State -eq 'pending') 'e2e queued -> pending'
$v = Ci @((Job $verify), (Job 'Playwright E2E' 'completed' 'failure'), (Job 'v2 Visual Regression'))
Check ($v.State -eq 'failed' -and $v.Failed[0] -match 'Playwright E2E') 'e2e failure -> failed (fix round)'
Check ((Ci @((Job $verify 'completed' 'timed_out'), (Job 'Playwright E2E'), (Job 'v2 Visual Regression'))).State -eq 'failed') 'timed_out -> failed'
foreach ($bad in 'skipped', 'cancelled', 'neutral', 'stale', 'action_required') {
    $v = Ci @((Job $verify), (Job 'Playwright E2E' 'completed' $bad), (Job 'v2 Visual Regression'))
    Check ($v.State -eq 'refuse') "e2e $bad -> refuse"
}
Check ((Ci @((Job $verify), (Job 'Playwright E2E'), (Job 'v2 Visual Regression' 'completed' 'skipped'))).State -eq 'refuse') 'visual skipped -> refuse'
Check ((Ci @((Job $verify 'completed' 'cancelled'), (Job 'Playwright E2E'), (Job 'v2 Visual Regression'))).State -eq 'refuse') 'verify cancelled -> refuse'
# missing jobs: pending within the grace period, refuse after it
Check ((Ci @((Job $verify), (Job 'v2 Visual Regression')) 3).State -eq 'pending') 'e2e missing at 3 min -> pending'
$v = Ci @((Job $verify), (Job 'v2 Visual Regression')) 11
Check ($v.State -eq 'refuse' -and ($v.Refuse -join ' ') -match 'Playwright E2E never appeared') 'e2e missing at 11 min -> refuse'
Check ((Ci @() 11).State -eq 'refuse') 'no checks at all after 11 min -> refuse'
Check ((Ci @() 0).State -eq 'pending') 'no checks yet -> pending'
# a failure and a refusal together: refuse wins (never merge, never "fix" a skipped job by retrying)
Check ((Ci @((Job $verify 'completed' 'failure'), (Job 'Playwright E2E' 'completed' 'skipped'), (Job 'v2 Visual Regression'))).State -eq 'refuse') 'failure + skipped -> refuse'
# re-run attempt: the newest run of a job decides
$v = Ci @((Job 'Playwright E2E' 'completed' 'failure' '2026-11-16T22:00:00Z'), (Job 'Playwright E2E' 'completed' 'success' '2026-11-16T22:20:00Z'), (Job $verify), (Job 'v2 Visual Regression'))
Check ($v.State -eq 'ok') 'newest attempt of a job decides (rerun passed -> ok)'
# a similarly named job does not satisfy the requirement
Check ((Ci @((Job $verify), (Job 'Playwright E2E (shard 1)'), (Job 'v2 Visual Regression')) 11).State -eq 'refuse') 'exact job name required for e2e'

# ---- one rerun for known-flaky specs -------------------------------------------------------------
$logBulk = "Playwright E2E`tRun E2E`t  1) [chromium] > e2e/bulk-mark.spec.ts:42:3 > bulk mark marks a range`n  1 failed"
$v = Get-FlakyRerunVerdict -FailedLog $logBulk -RunAttempt 1 -FailedJobs @('Playwright E2E')
Check ($v.Allowed) "bulk-mark only, first attempt -> rerun allowed ($($v.Reason))"
$v = Get-FlakyRerunVerdict -FailedLog "  [chromium] > v2/target-sealed.spec.ts:10:1 > sealed" -RunAttempt 1 -FailedJobs @('Playwright E2E')
Check ($v.Allowed) 'Target spec (path without e2e/) -> rerun allowed'
$v = Get-FlakyRerunVerdict -FailedLog $logBulk -RunAttempt 2 -FailedJobs @('Playwright E2E')
Check (-not $v.Allowed -and $v.Reason -match 'already re-run') 'second attempt -> refused'
$v = Get-FlakyRerunVerdict -FailedLog ($logBulk + "`n  2) [chromium] > e2e/binders.spec.ts:7:1 > binder") -RunAttempt 1 -FailedJobs @('Playwright E2E')
Check (-not $v.Allowed -and $v.Reason -match 'binders\.spec\.ts') 'a non-flaky spec also failed -> refused'
$v = Get-FlakyRerunVerdict -FailedLog $logBulk -RunAttempt 1 -FailedJobs @('Playwright E2E', 'v2 Visual Regression')
Check (-not $v.Allowed) 'visual also failed -> refused'
$v = Get-FlakyRerunVerdict -FailedLog 'Error: something else' -RunAttempt 1 -FailedJobs @('Playwright E2E')
Check (-not $v.Allowed -and $v.Reason -match 'no failing spec') 'no spec in the log -> refused'

# ---- gap rule --------------------------------------------------------------------------------------
# the real Get-ServerPaths result for this repo (tsconfig.node.json include + server + package files)
$sp = @('vite.config.ts', 'playwright.config.ts', 'server', 'src/storage/printings.ts', 'src/storage/binders.ts', 'src/models/binderLayout.ts',
    'src/models/binderParse.ts', 'src/models/cards.ts', 'src/integrations/pricing/normalize.ts', 'package.json', 'package-lock.json')
function Gap { param([string[]]$Protected, [string[]]$Own = @('src/web/home/Home.tsx')) return (Get-GapDecision -Protected $Protected -OwnFiles $Own -ServerPaths $sp) }

# inert gap -> allow (listed in Ignored, never refused)
$g = Gap @('innovation/LOOP.md', 'innovation/run-loop.ps1')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 2) 'gap: innovation/** only (the PRs #10/#13 case behind #11/#15) -> allowed, listed'
$g = Gap @('.github/ISSUE_TEMPLATE/device-feedback.yml', 'innovation/PRODUCT.md')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 2 -and $g.Block.Count -eq 0) 'gap: .github/ + innovation/ (PR #23, the #22 refusal) -> allowed, listed'
$g = Gap @('.github/workflows/ci.yml', 'playwright.config.ts', 'src/storage/caches.ts', 'scripts/build-card-index.mjs', 'render.yaml', '.claude/settings.json')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 6) "gap: CI, e2e config, client-only cache versions, scripts, deploy config -> inert, allowed (refused: $($g.Refuse -join '; '))"
$g = Gap @('innovation\README.md')
Check ($g.Ignored.Count -eq 1 -and $g.Ignored[0] -eq 'innovation/README.md') 'gap: backslash path normalised'
$g = Gap @()
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 0) 'nothing protected -> nothing to say'

# protected paths in the gap that change what the live server runs -> refuse (Block), named
$g = Gap @('server/collectionStore.ts', '.github/workflows/ci.yml')
Check ($g.Refuse.Count -eq 1 -and $g.Block -contains 'server/collectionStore.ts' -and $g.Refuse[0] -match 'changes what the live server runs' -and $g.Ignored -contains '.github/workflows/ci.yml') 'gap: protected server file (sync store) -> refuse, .github still only listed'
$g = Gap @('src/storage/printings.ts')
Check ($g.Refuse.Count -eq 1 -and $g.Block -contains 'src/storage/printings.ts') 'gap: shared merge rule (tsconfig.node.json include) -> refuse'
$g = Gap @('public/card-index/latest.json')
Check ($g.Refuse.Count -eq 1) 'gap: card index (recognition reads it from the live checkout) -> refuse'
$g = Gap @('server/targetBot.ts')
Check ($g.Refuse.Count -eq 1) 'gap: Target bot route -> refuse'
$g = Gap @('.env.production')
Check ($g.Refuse.Count -eq 1) 'gap: .env file -> refuse'
$g = Gap @('src/scan/phash.ts')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored -contains 'src/scan/phash.ts') 'gap: client-only scanner gate (not in tsconfig.node.json) -> inert for the live server'

# the PR's OWN diff stays strict
$g = Gap @('innovation/LOOP.md') -Own @('innovation/LOOP.md')
Check ($g.Refuse.Count -eq 1 -and $g.Refuse[0] -match 'changed by this PR') 'own diff touching innovation/ -> refuse'
$g = Gap @('.github/workflows/ci.yml') -Own @('src/a.ts', '.github/workflows/ci.yml')
Check ($g.Refuse.Count -eq 1 -and $g.Refuse[0] -match 'changed by this PR') 'own diff touching .github/ -> refuse'
$g = Gap @('public/card-index/index.json') -Own @('public/card-index/index.json')
Check ($g.Refuse.Count -eq 1 -and $g.Refuse[0] -match 'changed by this PR') 'own diff touching a protected path -> refuse (once, as its own)'

# the shared classifier (lib.ps1), used by the elevated deploy-server.ps1 on live HEAD..target
Check (Test-LiveAffectingPath 'server/routes/catalog.ts' $sp) 'live-affecting: server/'
Check (Test-LiveAffectingPath 'package-lock.json' $sp) 'live-affecting: lockfile'
Check (Test-LiveAffectingPath 'src/models/cards.ts' $sp) 'live-affecting: shared src'
Check (-not (Test-LiveAffectingPath 'src/web/home/Home.tsx' $sp)) 'not live-affecting: client-only src'
Check (-not (Test-LiveAffectingPath 'vite.config.ts' $sp)) 'not live-affecting: vite config (typecheck-only include)'
Check (-not (Test-LiveAffectingPath 'e2e/v2/home.spec.ts' $sp)) 'not live-affecting: e2e'
Check (-not (Test-LiveAffectingPath 'serverless/x.ts' $sp)) 'not live-affecting: prefix match is per path segment'
$s = Split-ProtectedByLiveImpact -Protected @('innovation/lib.ps1', '.github/workflows/ci.yml', 'server/binderStore.ts') -ServerPaths $sp
Check ($s.Block.Count -eq 1 -and $s.Block[0] -eq 'server/binderStore.ts' -and $s.Inert.Count -eq 2) 'elevated split: only the server-run protected path blocks'

# (proposal slots, specs, failure markers / retry, the precheck and the session planning: test-queue-rules.ps1)

# ---- wait-ci.ps1: one result line, failed job names, the log tail -----------------------------------
$sha = '0123456789abcdef0123456789abcdef01234567'
$ok = Ci $all
Check ((Format-WaitCiLine -Verdict $ok -Sha $sha -WaitedMinutes 6) -match '^WAIT-CI PASS 0123456 after 6 min') 'wait-ci: PASS line'
$v = Ci @((Job $verify), (Job 'Playwright E2E' 'completed' 'failure'), (Job 'v2 Visual Regression' 'completed' 'failure'))
$l = Format-WaitCiLine -Verdict $v -Sha $sha -WaitedMinutes 7
Check ($l -match '^WAIT-CI FAIL 0123456' -and $l -match 'failed jobs: Playwright E2E, v2 Visual Regression') "wait-ci: FAIL line names every failed job ($l)"
$v = Ci @((Job $verify), (Job 'Playwright E2E' 'completed' 'cancelled'), (Job 'v2 Visual Regression'))
Check ((Format-WaitCiLine -Verdict $v -Sha $sha) -match '^WAIT-CI REFUSED .*not a test failure') 'wait-ci: a cancelled job is REFUSED, not FAIL (failure class ci-infra)'
$v = Ci @((Job $verify), (Job 'Playwright E2E' 'in_progress' ''), (Job 'v2 Visual Regression'))
Check ((Format-WaitCiLine -Verdict $v -Sha $sha -WaitedMinutes 9 -TimeoutMinutes 45) -match '^WAIT-CI PENDING .*call wait-ci.ps1 again') 'wait-ci: still running within the cap -> PENDING'
Check ((Format-WaitCiLine -Verdict $v -Sha $sha -WaitedMinutes 46 -TimeoutMinutes 45) -match '^WAIT-CI TIMEOUT') 'wait-ci: past the cap -> TIMEOUT (failure class ci-timeout)'
$log = (@(1..60 | ForEach-Object { "Playwright E2E`tRun E2E`t2026-11-17T10:00:$('{0:00}' -f ($_ % 60)).1234567Z line $_" }) + @("Playwright E2E`tRun E2E`t2026-11-17T10:01:00.0000000Z $([char]27)[31m  1) e2e/binders.spec.ts:12 failed$([char]27)[0m")) -join "`n"
$tail = @(Get-CiLogTail -Log $log -Lines 10)
Check ($tail.Count -eq 11 -and $tail[0] -match 'Playwright E2E \(last 10 of 61' -and $tail[-1] -eq '  1) e2e/binders.spec.ts:12 failed') "log tail: per job, last N lines, timestamps and colour codes stripped ($($tail[-1]))"
Check (@(Get-CiLogTail -Log '').Count -eq 0) 'log tail: empty log -> nothing'

# ---- may the next build start? (a merge whose deploy was not verified stops the run) ------------------
$t0 = [datetime]'2026-11-17T10:00:00Z'
$m = [pscustomobject]@{ mergeSha = $sha; mergedUtc = '2026-11-17T11:00:00Z' }
Check ((Get-DeployCertainty -SessionStart $t0 -MergeRec $null).Certain) 'nothing merged -> certain'
Check ((Get-DeployCertainty -SessionStart $t0 -MergeRec ([pscustomobject]@{ mergeSha = $sha; mergedUtc = '2026-11-16T11:00:00Z' })).State -eq 'none') 'a merge from an earlier session does not count'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = $sha; status = "DEPLOY OK merge=$sha" })
Check ($c.Certain -and $c.State -eq 'deployed') 'DEPLOY OK -> certain (deployed)'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = $sha; status = 'DEPLOY ROLLED-BACK health failed' })
Check ($c.Certain -and $c.State -eq 'rolled-back') 'DEPLOY ROLLED-BACK -> certain (rolled back)'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = $sha; status = 'DEPLOY PRECONDITION x' }) -RollbackRec ([pscustomobject]@{ mergeSha = $sha; status = 'ROLLBACK OK' })
Check ($c.Certain -and $c.State -eq 'rolled-back') 'precondition after the merge, then rollback.ps1 -RevertOnly OK -> certain'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m
Check (-not $c.Certain -and $c.Reason -match 'no deploy record') 'merged, never deployed (session killed) -> UNCERTAIN'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = $sha; status = 'started' })
Check (-not $c.Certain -and $c.Reason -match 'deploy: started') 'deploy killed half way -> UNCERTAIN'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = $sha; status = 'DEPLOY ROLLBACK-FAILED x' })
Check (-not $c.Certain) 'deploy and its rollback failed -> UNCERTAIN'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -RollbackRec ([pscustomobject]@{ mergeSha = $sha; status = 'ROLLBACK FAILED' })
Check (-not $c.Certain -and $c.Reason -match 'rollback: ROLLBACK FAILED') 'rollback failed -> UNCERTAIN'
$c = Get-DeployCertainty -SessionStart $t0 -MergeRec $m -DeployRec ([pscustomobject]@{ mergeSha = 'ffffffffffffffffffffffffffffffffffffffff'; status = 'DEPLOY OK' })
Check (-not $c.Certain) 'a DEPLOY OK for another merge does not count'

# ---- plan budget (the ops hub's D:\hub\state\plan-budget.json; fails open) ------------------------------
$now = [datetime]::Parse('2026-11-20T18:00:00Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AssumeUniversal,AdjustToUniversal')
function Bj { param([string]$V = 'normal', [string]$Gen = '2026-11-20T17:50:00Z', $Schema = 1, $Stale = 30, [string[]]$Reasons = @('5h 91% >= 85'))
    ([ordered]@{ schema = $Schema; generatedAt = $Gen; verdict = $V; reasons = @($Reasons); fiveHour = [ordered]@{ pct = 91; resetsAt = '2026-11-20T20:00:00Z'; observedAt = $Gen }; weekly = $null; thresholds = @{}; staleAfterMinutes = $Stale } | ConvertTo-Json -Depth 5) }
foreach ($v in 'normal', 'no-opus', 'hold') {
    $b = Get-PlanBudgetVerdict -Text (Bj $v) -NowUtc $now
    Check ($b.Verdict -eq $v -and -not $b.Warn -and $b.Reason -match "plan budget $v" -and $b.Reason -match '5h 91%' -and $b.Reason -match '10 min ago') "fresh $v -> $v ($($b.Reason))"
}
$b = Get-PlanBudgetVerdict -Text (Bj 'NO-OPUS ') -NowUtc $now
Check ($b.Verdict -eq 'no-opus') 'verdict is case/space tolerant'
foreach ($c in @(
        @{ T = $null; W = 'missing' }, @{ T = ''; W = 'missing' }, @{ T = '{not json'; W = 'not valid JSON' },
        @{ T = (Bj 'hold' -Schema 2); W = 'schema' }, @{ T = '{"verdict":"hold","generatedAt":"2026-11-20T17:59:00Z"}'; W = 'schema' },
        @{ T = (Bj 'pause'); W = 'unknown' }, @{ T = (Bj 'hold' -Gen 'yesterday'); W = 'generatedAt' },
        @{ T = (Bj 'hold' -Gen '2026-11-20T17:29:00Z'); W = 'stale' })) {
    $b = Get-PlanBudgetVerdict -Text $c.T -NowUtc $now
    Check ($b.Verdict -eq 'normal' -and $b.Warn -and $b.Reason -match $c.W -and $b.Reason -match 'fail open') "fails open: $($c.W) -> normal + WARN ($($b.Reason))"
}
$b = Get-PlanBudgetVerdict -Text (Bj 'hold' -Gen '2026-11-20T17:31:00Z') -NowUtc $now
Check ($b.Verdict -eq 'hold') '29 min old with staleAfterMinutes 30 -> still used'
$b = Get-PlanBudgetVerdict -Text (Bj 'hold' -Gen '2026-11-20T17:00:00Z' -Stale 90) -NowUtc $now
Check ($b.Verdict -eq 'hold') 'staleAfterMinutes from the file is honoured (60 min old, stale after 90)'
$b = Get-PlanBudgetVerdict -Text (Bj 'hold' -Gen '2026-11-20T17:20:00Z' -Stale 0) -NowUtc $now
Check ($b.Verdict -eq 'normal' -and $b.Warn) 'staleAfterMinutes missing/0 -> default 30 (40 min old is stale)'
$b = Get-PlanBudgetVerdict -Text (Bj 'hold' -Gen '2026-11-20T10:50:00-07:00') -NowUtc $now
Check ($b.Verdict -eq 'hold') 'generatedAt with an offset is converted to UTC'
$b = Get-PlanBudgetVerdict -Text $null -ReadError 'access denied' -NowUtc $now
Check ($b.Verdict -eq 'normal' -and $b.Warn -and $b.Reason -match 'unreadable') 'unreadable -> normal + WARN'
$b = Get-PlanBudgetVerdict -Text (Bj 'hold') -NowUtc $now -Ignore
Check ($b.Verdict -eq 'normal' -and -not $b.Warn -and $b.Reason -match 'IgnoreBudget') '-IgnoreBudget -> normal, no warning, even on hold'
$b = Get-PlanBudgetVerdict -Text (Bj 'hold' -Reasons @('x <!-- innovation-loop --> @vekbui96')) -NowUtc $now
Check ($b.Reason -notmatch '<!--' -and $b.Reason -notmatch '@') 'reasons are made safe (no markers, no mentions)'

# verdict x model
$opus = 'claude-opus-5-5'; $son = 'claude-sonnet-5-5'
Check ((Test-BudgetAllowsModel 'normal' $opus) -and (Test-BudgetAllowsModel 'normal' $son)) 'normal: every model'
Check (-not (Test-BudgetAllowsModel 'no-opus' $opus) -and (Test-BudgetAllowsModel 'no-opus' $son)) 'no-opus: Sonnet yes, Opus no'
Check (-not (Test-BudgetAllowsModel 'no-opus' 'opus') -and -not (Test-BudgetAllowsModel 'no-opus' 'claude-opus-5-5[1m]')) 'no-opus: aliases and suffixes still count as Opus'
Check (-not (Test-BudgetAllowsModel 'no-opus' '')) 'no-opus: an empty model (claude default) counts as Opus'
Check (-not (Test-BudgetAllowsModel 'hold' $son) -and -not (Test-BudgetAllowsModel 'hold' $opus)) 'hold: nothing'

# verdict x session kind (sessions.json shape: builds Opus unless size:small / test-only; propose + review Sonnet)
$cfg = Get-SessionConfig $null
$lo = @{ 12 = @('loop:proposal', 'approved'); 13 = @('loop:proposal', 'approved', 'size:small'); 14 = @('approved', 'test-only') }
$sp = Split-BuildableByBudget -Buildable @(12, 13, 14) -LabelsOf $lo -Config $cfg -Verdict 'normal'
Check ((@($sp.Allowed) -join ',') -eq '12,13,14' -and @($sp.Deferred).Count -eq 0) 'normal: every build allowed'
$sp = Split-BuildableByBudget -Buildable @(12, 13, 14) -LabelsOf $lo -Config $cfg -Verdict 'no-opus'
Check ((@($sp.Allowed) -join ',') -eq '13,14' -and (@($sp.Deferred | ForEach-Object { $_.Issue }) -join ',') -eq '12' -and $sp.Deferred[0].Model -eq $opus) 'no-opus: the Opus build is deferred, small/test-only builds run'
$sp = Split-BuildableByBudget -Buildable @(12, 13) -LabelsOf $lo -Config $cfg -Verdict 'no-opus' -Override $son
Check (@($sp.Deferred).Count -eq 0) 'no-opus + run-loop -Model sonnet: every build runs on Sonnet, nothing deferred'
$sp = Split-BuildableByBudget -Buildable @(13) -LabelsOf $lo -Config $cfg -Verdict 'no-opus' -Override $opus
Check (@($sp.Allowed).Count -eq 0) 'no-opus + run-loop -Model opus: even a small build is deferred'
$sp = Split-BuildableByBudget -Buildable @(12, 13) -LabelsOf $lo -Config $cfg -Verdict 'hold'
Check (@($sp.Allowed).Count -eq 0 -and @($sp.Deferred).Count -eq 2) 'hold: no build'
Check ((Test-BudgetAllowsModel 'no-opus' (Get-SessionModel -Kind 'propose' -Config $cfg)) -and (Test-BudgetAllowsModel 'no-opus' (Get-SessionModel -Kind 'review' -Config $cfg))) 'no-opus: proposal and review sessions (Sonnet) may run'

# the precheck under the budget
function Qb { param([int[]]$B, [int]$Free) [pscustomobject]@{ buildable = @($B); retry = @(); slots = [pscustomobject]@{ free = $Free; cap = 5; awaitingReview = @() }; waitingOnVe = @() } }
$hold = [pscustomobject]@{ Verdict = 'hold'; Reason = 'plan budget hold (5h 97%)'; Warn = $false }
$noop = [pscustomobject]@{ Verdict = 'no-opus'; Reason = 'plan budget no-opus (5h 88%)'; Warn = $false }
$p = Get-PrecheckDecision -Queue (Qb @(12) 3) -Mode 'FULL' -Budget $hold
Check (-not $p.Launch -and $p.Hold -and $p.Reason -match 'hold') "hold: no launch even with work queued ($($p.Reason))"
Check (-not (Get-PrecheckDecision -Queue $null -Mode 'FULL' -Budget $hold).Launch) 'hold: no launch even when the queue check failed'
Check (-not (Get-PrecheckDecision -Queue (Qb @() 0) -Mode 'PRODUCT_REVIEW' -Budget $hold).Launch) 'hold: not even the product review'
$p = Get-PrecheckDecision -Queue (Qb @(12) 0) -Mode 'FULL' -Budget $noop -Deferred @(12)
Check (-not $p.Launch -and -not $p.Hold -and $p.Reason -match '0 buildable' -and $p.Reason -match 'deferred by the plan budget \(#12\)') "no-opus, only an Opus build, no slot -> no launch ($($p.Reason))"
Check ((Get-PrecheckDecision -Queue (Qb @(12, 13) 0) -Mode 'FULL' -Budget $noop -Deferred @(12)).Launch) 'no-opus + a small build -> launch'
Check ((Get-PrecheckDecision -Queue (Qb @(12) 2) -Mode 'FULL' -Budget $noop -Deferred @(12)).Launch) 'no-opus + a free slot -> launch for proposals'
Check (-not (Get-PrecheckDecision -Queue (Qb @() 2) -Mode 'FULL' -Budget $noop -PhaseBAllowed $false).Launch) 'no-opus + proposals configured on Opus -> no launch'
Check (-not (Get-PrecheckDecision -Queue (Qb @() 0) -Mode 'PRODUCT_REVIEW' -Budget $noop -PhaseBAllowed $false).Launch) 'no-opus + review on Opus -> no launch'
$p = Get-PrecheckDecision -Queue (Qb @(12) 0) -Mode 'FULL'
Check ($p.Launch -and -not $p.Hold) 'no budget given -> behaves as before'
$fo = Get-PlanBudgetVerdict -Text $null -NowUtc $now
Check ((Get-PrecheckDecision -Queue (Qb @(12) 0) -Mode 'FULL' -Budget $fo).Launch) 'missing file -> normal -> launch as before'
# ---- design skills (options.designSkills) ----------------------------------------------------------
Check (-not (Get-LoopOptions $null).designSkills) 'designSkills defaults to off'
Check ((Get-LoopOptions ('{"options":{"designSkills":true}}' | ConvertFrom-Json)).designSkills) 'designSkills on from sessions.json'
$d = Get-DesignSkillsSetup -Enabled $false
Check (-not $d.Ok -and @($d.Allow).Count -eq 0 -and $d.Env['INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS'] -eq '') 'off -> no rules, guard flag cleared'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("dsk-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $tmp 'imp\reference'), (Join-Path $tmp 'py') | Out-Null
foreach ($f in 'engine.exe', 'search.py', 'imp\reference\craft-floor.md', 'py\python.exe') { [IO.File]::WriteAllText((Join-Path $tmp $f), 'x') }
$tp = @{ Engine = (Join-Path $tmp 'engine.exe'); EngineSha256 = 'AB12'; Impeccable = (Join-Path $tmp 'imp'); Search = (Join-Path $tmp 'search.py'); PythonDir = (Join-Path $tmp 'py') }
$d = Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ab12'
$rules = @($d.Allow) -join ' | '
Check ($d.Ok -and $d.Env['INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS'] -eq '1' -and $d.Env['IMPECCABLE_BIN'] -eq $tp.Engine) "on -> guard flag and IMPECCABLE_BIN set ($($d.Reason))"
Check ($d.Env['IMPECCABLE_NO_TELEMETRY'] -eq '1' -and $d.Env['IMPECCABLE_NO_UPDATE_CHECK'] -eq '1' -and $d.Env['IMPECCABLE_HOOK_DISABLED'] -eq '1') 'on -> engine kept off the network, hook disabled'
Check ($rules -match ' context\)' -and $rules -match ' shot \*' -and $rules -match ' detect \*' -and $rules -match 'python .*search\.py \*') "on -> context/shot/detect/search rules ($rules)"
Check ($rules -notmatch 'hooks|pin|live|doctor|foundations|persist|\(python \*\)') 'no rule for hooks/pin/live/doctor/foundations or bare python'
Check (-not (Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ffff').Ok) 'engine hash mismatch -> off'
Check ((Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ffff').Reason -match 'mismatch') 'mismatch is named in the reason'
Check ((Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ab12').PathPrepend -eq $tp.PythonDir) 'on -> python folder goes in front of PATH'
Remove-Item -LiteralPath (Join-Path $tmp 'py\python.exe')
Check (-not (Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ab12').Ok) 'missing python.exe -> off'
Remove-Item -LiteralPath (Join-Path $tmp 'search.py')
Check (-not (Get-DesignSkillsSetup -Enabled $true -Paths $tp -EngineHash 'ab12').Ok) 'missing search.py -> off'
Remove-Item -LiteralPath $tmp -Recurse -Force
Check ((Add-DesignSkillsSection -Sections @(0, 1, 2, 3, 4, 6) -Kind 'build' -On $true) -contains 9) 'build + on -> section 9'
Check ((Add-DesignSkillsSection -Sections @(0, 1, 2, 5, 6) -Kind 'propose' -On $true) -contains 9) 'propose + on -> section 9'
Check (-not ((Add-DesignSkillsSection -Sections @(0, 1, 2, 5, 6, 8) -Kind 'intake' -On $true) -contains 9)) 'intake never gets section 9'
Check (-not ((Add-DesignSkillsSection -Sections @(0, 1, 2, 5, 6) -Kind 'propose' -On $false) -contains 9)) 'off -> no section 9'
$lm = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LOOP.md'))
Check ((Get-LoopMdSections -Text $lm -Sections @(0, 9) -Kind 'build') -match '## 9\. Design skills') 'LOOP.md has section 9'
Check ((Get-LoopMdSections -Text $lm -Sections @(0, 1, 2, 5, 6) -Kind 'propose') -notmatch 'impeccable') 'a prompt without section 9 never mentions the skills'
$gm = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'guard.mjs'))
foreach ($k in 'Engine', 'Search') {
    $lit = $script:DesignSkillPaths[$k].ToLowerInvariant().Replace('\', '\\')
    Check ($gm.Contains("""$lit""")) "guard.mjs pins the same $k path as gate-rules.ps1"
}
Check ((Get-Content (Join-Path $PSScriptRoot 'LOOP.md') -Raw).Contains($script:DesignSkillPaths.Engine)) 'LOOP.md names the pinned engine path'

if ($script:fail -gt 0) { Write-Host "TEST-GATE-RULES FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-GATE-RULES PASS ($script:pass checks)"
exit 0

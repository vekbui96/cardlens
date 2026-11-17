<#
.SYNOPSIS
  Unit tests for gate-rules.ps1: the CI verdict merge-pr.ps1 merges on, the one-rerun rule for known-flaky
  e2e specs, and the live-server gap rule. No network, no git.
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

if ($script:fail -gt 0) { Write-Host "TEST-GATE-RULES FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-GATE-RULES PASS ($script:pass checks)"
exit 0

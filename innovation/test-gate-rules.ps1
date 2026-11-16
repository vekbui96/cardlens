<#
.SYNOPSIS
  Unit tests for gate-rules.ps1: the CI verdict merge-pr.ps1 merges on, the one-rerun rule for known-flaky
  e2e specs, and the live-server gap rule. No network, no git.
  powershell -ExecutionPolicy Bypass -File innovation\test-gate-rules.ps1
#>
$ErrorActionPreference = 'Stop'
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
$g = Get-GapDecision -Protected @('innovation/LOOP.md', 'innovation/run-loop.ps1') -OwnFiles @('server/routes/catalog.ts')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 2) 'gap: innovation/** only (the PRs #10/#13 case behind #15) -> ignored, no refusal'
$g = Get-GapDecision -Protected @('innovation/LOOP.md', '.github/workflows/ci.yml') -OwnFiles @('server/routes/catalog.ts')
Check ($g.Refuse.Count -eq 1 -and $g.Refuse[0] -match '^\.github/workflows/ci\.yml \(in commits between') 'gap: another protected path -> refuse'
$g = Get-GapDecision -Protected @('innovation/LOOP.md') -OwnFiles @('innovation/LOOP.md')
Check ($g.Refuse.Count -eq 1 -and $g.Refuse[0] -match 'changed by this PR') 'own diff touching innovation/ -> refuse'
$g = Get-GapDecision -Protected @('public/card-index/index.json') -OwnFiles @('public/card-index/index.json')
Check ($g.Refuse.Count -eq 1) 'own diff touching a protected path -> refuse'
$g = Get-GapDecision -Protected @() -OwnFiles @('src/a.ts')
Check ($g.Refuse.Count -eq 0 -and $g.Ignored.Count -eq 0) 'nothing protected -> nothing to say'
$g = Get-GapDecision -Protected @('innovation\README.md')
Check ($g.Ignored.Count -eq 1) 'gap: backslash innovation path normalised'

if ($script:fail -gt 0) { Write-Host "TEST-GATE-RULES FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-GATE-RULES PASS ($script:pass checks)"
exit 0

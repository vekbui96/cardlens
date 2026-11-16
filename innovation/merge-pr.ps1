<#
.SYNOPSIS
  The ONLY way the loop merges to main (merging == a GitHub Pages deploy). Checks everything in code,
  waits for CI on the PR's exact head commit, then merges with --match-head-commit.
  Last output line: MERGE-PR OK <mergeSha> | MERGE-PR REFUSED <why> | MERGE-PR CI-FAILED <why> |
  MERGE-PR CI-PENDING <state> | MERGE-PR CI-TIMEOUT <state>

.DESCRIPTION
  1. check-approval.ps1 -Issue <n> must pass (approved by vekbui96, not edited since, not flagged manual)
  2. the PR is open, base main, from a branch of this repo named loop/<issue>-<slug>, opened by vekbui96,
     and not a draft
  3. no changed file matches a protected path (lib.ps1 ProtectedPathPatterns: card index, scanner gate,
     merge/validation rules, cache versions, Target, CI, .claude, innovation, .env, deploy config, the e2e
     config) and no added line mentions D:\services, a token in a VITE_ variable, CORS origins or the
     Target routes; between the live server and the PR only innovation/** is tolerated (MERGE-PR GAP lines
     list those commits)
  4. CI for the head sha (CI is the e2e gate for every change; nothing runs Playwright locally): Typecheck /
     Lint / Unit / Build, Playwright E2E and v2 Visual Regression must ALL be completed + success
     (gate-rules.ps1 Get-CiVerdict). Skipped, cancelled, neutral or never-created jobs refuse; failure
     exits 3 for a CI fix round. Blocks at most -WaitMinutes per call, then exits 5 (call again); the total
     wait per head sha is capped at -TimeoutMinutes. A newer push changes the sha and restarts the wait.
  4b. if the PR needs a server deploy: the elevated task's selftest
  5. gh pr merge --merge --match-head-commit <sha> --delete-branch; prints the merge commit sha

.EXIT CODES
  0 merged | 1 refused (nothing merged) | 3 CI failed on the head sha | 4 CI did not finish in time |
  5 CI still running: call again
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Pr,
    [Parameter(Mandatory)][int]$Issue,
    [int]$TimeoutMinutes = 50,
    [ValidateRange(1, 9)][int]$WaitMinutes = 9
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
Start-ScriptLog "merge-pr-$Issue-$Pr"
Add-GhToPath
$Repo = $script:Repo

function Refuse([string]$why) { Write-Log "refused: $why" 'ERROR'; Write-Output "MERGE-PR REFUSED $why"; exit 1 }

try {
    # ---- 1. approval ---------------------------------------------------------------
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $ap = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\check-approval.ps1" -Issue $Issue -InProgress 2>&1 | ForEach-Object { "$_" }
    $apCode = $LASTEXITCODE; $ErrorActionPreference = $prevEap
    Write-Log "check-approval: exit $apCode $($ap -join ' ')"
    if ($apCode -ne 0) { Refuse "issue #$Issue is not buildable: $($ap -join ' ')" }

    # ---- 2. the PR itself ------------------------------------------------------------
    $p = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
    if ($p.state -ne 'open') { Refuse "PR #$Pr is $($p.state)" }
    if ($p.draft) { Refuse "PR #$Pr is a draft" }
    if ($p.base.ref -ne 'main') { Refuse "PR base is $($p.base.ref), not main" }
    if ($p.head.repo.full_name -ne $Repo) { Refuse "PR head is from $($p.head.repo.full_name), not $Repo" }
    if ($p.head.ref -notmatch "^loop/$Issue-[a-z0-9][a-z0-9-]*$") { Refuse "PR branch '$($p.head.ref)' is not loop/$Issue-<slug>" }
    if ($p.user.login -ne $script:Owner) { Refuse "PR opened by $($p.user.login)" }
    $headSha = $p.head.sha
    Write-Log "PR #$Pr head $headSha branch $($p.head.ref)"

    # ---- 3. what it changes ----------------------------------------------------------
    $files = @()
    for ($page = 1; $page -le 10; $page++) {
        $batch = @(Get-GhJson @('api', "repos/$Repo/pulls/$Pr/files?per_page=100&page=$page"))
        $files += $batch
        if ($batch.Count -lt 100) { break }
    }
    if ($files.Count -eq 0) { Refuse 'PR changes no files' }
    foreach ($f in $files) {
        foreach ($name in @($f.filename, $f.previous_filename) | Where-Object { $_ }) {
            $hit = Test-ProtectedPath $name
            if ($hit) { Refuse "PR touches protected path $name ($hit): manual / needs Ve" }
        }
        $added = @("$($f.patch)" -split "`n" | Where-Object { $_.StartsWith('+') -and -not $_.StartsWith('+++') })
        foreach ($line in $added) {
            if ($line -match '(?i)D:[\\/]+services') { Refuse "$($f.filename) adds a reference to D:\services" }
            if ($line -match 'VITE_[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)') { Refuse "$($f.filename) puts a secret-looking name in a VITE_ variable" }
            if ($line -match 'ALLOWED_ORIGINS|Access-Control-Allow-Origin|CORS_STRICT') { Refuse "$($f.filename) changes CORS handling: manual / needs Ve" }
            if ($line -match '/api/target|TARGET_(BOT_)?TOKEN') { Refuse "$($f.filename) touches the Target routes: manual / needs Ve" }
        }
    }
    Write-Log "files ok: $(@($files | ForEach-Object { $_.filename }) -join ', ')"

    # ---- 3b. can the server side of this be deployed? (decided BEFORE merging, because merge == Pages deploy)
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', '--prune') -Quiet | Out-Null
    Invoke-Git -Repo $script:Clone -Arguments @('fetch', 'origin', "refs/heads/$($p.head.ref)") -Quiet | Out-Null
    $base = Get-GitValue -Repo $script:Clone -Arguments @('merge-base', 'origin/main', $headSha)
    $plan = Get-ServerPlan -Repo $script:Clone -Target $headSha -OwnCommitsFrom $base
    Write-Log "server plan: liveHead=$($plan.LiveHead) needed=$($plan.ServerNeeded) files=$($plan.ServerFiles -join ',') foreign=$($plan.Foreign -join ',')"
    # $plan.Protected covers live HEAD..PR head. The PR's own files were checked in step 3; in the gap (commits
    # Ve already merged that the live server lacks) innovation/** is ignored and everything else still refuses
    # (gate-rules.ps1 Get-GapDecision says why). Every gap commit is printed so the issue can list it.
    $ownNames = @($files | ForEach-Object { $_.filename; $_.previous_filename } | Where-Object { $_ })
    $gap = Get-GapDecision -Protected $plan.Protected -OwnFiles $ownNames
    $gapCommits = @()
    if ($plan.LiveHead -and $base -and $plan.LiveHead -ne $base) {
        $gapCommits = @((Invoke-Git -Repo $script:Clone -Arguments @('log', '--format=%h %s', "$($plan.LiveHead)..$base") -AllowFail -Quiet).Output | Where-Object { $_ })
    }
    foreach ($c in $gapCommits) { Write-Log "gap commit (on main, not yet on the live server): $c"; Write-Output "MERGE-PR GAP $c" }
    if ($gap.Ignored.Count -gt 0) { Write-Log "gap: ignoring innovation/ files (inert in the live dir): $($gap.Ignored -join ', ')" }
    if ($gap.Refuse.Count -gt 0) { Refuse "protected paths between the live server and this PR: $($gap.Refuse -join ', ')" }
    Save-State "merge-gap-$Issue" @{ issue = $Issue; pr = $Pr; liveHead = $plan.LiveHead; base = $base; commits = $gapCommits; innovationIgnored = $gap.Ignored }
    $mainPlan = Get-ServerPlan -Repo $script:Clone -Target (Get-GitValue -Repo $script:Clone -Arguments @('rev-parse', 'origin/main'))
    if ($mainPlan.ServerNeeded) { Refuse "main already carries server changes the live server does not have ($($mainPlan.ServerFiles -join ', ')); Ve must deploy those first" }
    # ---- 4. CI on the exact head sha -----------------------------------------------------
    # CI is the e2e gate for EVERY change (the loop runs no Playwright suite locally). All three required
    # jobs (gate-rules.ps1 $CiRequiredJobs) must be completed + success on this exact head; a skipped,
    # cancelled, neutral or never-created job refuses. This call blocks at most -WaitMinutes (so a 5-6 minute
    # CI run costs the session one or two turns) and then exits 5 CI-PENDING: call it again with the same
    # arguments. The total wait per head sha is tracked in state\ (-TimeoutMinutes), not by the session.
    $waitKey = "merge-wait-$Issue"
    $w = Read-State $waitKey
    if (-not $w -or "$($w.headSha)" -ne $headSha) { $w = @{ issue = $Issue; pr = $Pr; headSha = $headSha; firstUtc = [DateTime]::UtcNow.ToString('o') }; Save-State $waitKey $w }
    $first = [DateTime]::Parse("$($w.firstUtc)", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $callEnd = (Get-Date).AddMinutes($WaitMinutes)
    $verdict = $null
    while ($true) {
        $cr = Get-GhJson @('api', "repos/$Repo/commits/$headSha/check-runs?per_page=100")
        $waited = ([DateTime]::UtcNow - $first).TotalMinutes
        $verdict = Get-CiVerdict -CheckRuns @($cr.check_runs) -MissingMinutes $waited
        Write-Log "CI $($headSha.Substring(0,7)) after $([int]$waited) min: $($verdict.State): $($verdict.Summary)"
        if ($verdict.State -eq 'refuse') { Refuse "CI on $($headSha.Substring(0,7)): $($verdict.Refuse -join '; ')" }
        if ($verdict.State -eq 'failed') { Write-Output "MERGE-PR CI-FAILED $($verdict.Failed -join '; ') (gh pr checks $Pr -R $Repo; gh run view <id> --log-failed -R $Repo)"; exit 3 }
        if ($verdict.State -eq 'ok') { break }
        if ($waited -ge $TimeoutMinutes) { Write-Output "MERGE-PR CI-TIMEOUT CI on $($headSha.Substring(0,7)) still not finished after $([int]$waited) minutes: $($verdict.Summary)"; exit 4 }
        $now = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
        if ($now.head.sha -ne $headSha) { Refuse "the PR head moved to $($now.head.sha) while waiting for CI" }
        if ((Get-Date).AddSeconds(30) -ge $callEnd) { Write-Output "MERGE-PR CI-PENDING $($verdict.Summary) (waited $([int]$waited) of $TimeoutMinutes min; call merge-pr.ps1 again)"; exit 5 }
        Start-Sleep -Seconds 30
    }

    # ---- 4b. the elevated task, only now that CI is green (merge == Pages deploy, so decided before merging)
    if ($plan.ServerNeeded) {
        $self = Invoke-ElevatedRequest -Mode selftest -TimeoutMinutes 5
        if ($self.status -ne 'ok') { Refuse "this PR needs a server deploy but the elevated deploy task is not usable: $($self.status) $($self.message)" }
        Write-Log "elevated task selftest ok: $($self.message)"
    }

    # ---- 5. merge --------------------------------------------------------------------------
    Invoke-Gh -Arguments @('pr', 'merge', "$Pr", '-R', $Repo, '--merge', '--match-head-commit', $headSha, '--delete-branch') | Out-Null
    $mergeSha = $null
    for ($i = 0; $i -lt 10 -and -not $mergeSha; $i++) {
        $m = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
        if ($m.merged -and $m.merge_commit_sha) { $mergeSha = $m.merge_commit_sha } else { Start-Sleep -Seconds 3 }
    }
    if (-not $mergeSha) { throw 'merge reported success but no merge commit sha was found' }
    Save-State "merge-$Issue" @{ issue = $Issue; pr = $Pr; headSha = $headSha; mergeSha = $mergeSha; mergedUtc = [DateTime]::UtcNow.ToString('o') }
    Write-Log "merged PR #$Pr as $mergeSha"
    Write-Output "MERGE-PR OK $mergeSha"
    exit 0
} catch {
    Write-Log "error: $_" 'ERROR'
    Write-Output "MERGE-PR REFUSED error: $_"
    exit 1
}

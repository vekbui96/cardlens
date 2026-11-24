<#
.SYNOPSIS
  The ONLY way the loop merges to main (merging == a GitHub Pages deploy). Checks everything in code,
  waits for CI on the PR's exact head commit, then merges with --match-head-commit.
  Last output line: MERGE-PR OK <mergeSha> | MERGE-PR REFUSED <why> | MERGE-PR CI-FAILED <why> |
  MERGE-PR CI-PENDING <state> | MERGE-PR CI-TIMEOUT <state>

.DESCRIPTION
  1. check-approval.ps1 -Issue <n> must pass (approved by vekbui96, not edited since, not flagged manual); an
   issue approved via Ve's standing policy (innovation/AUTONOMY.json) is refused when the merge needs a server deploy
  2. the PR is open, base main, from a branch of this repo named loop/<issue>-<slug>, opened by vekbui96,
     and not a draft
  3. no changed file matches a protected path (lib.ps1 ProtectedPathPatterns: card index, scanner gate,
     merge/validation rules, cache versions, Target, CI, .claude, innovation, .env, deploy config, the e2e
     config) and no added line mentions D:\services, a token in a VITE_ variable, CORS origins or the
     Target routes. Between the live server and the PR (the gap: commits already on main), a protected path
     refuses only when it changes what the live server RUNS (card index, shared sync rules, Target bot,
     .env); innovation/**, .github/**, docs, e2e, client-only src are inert there and only listed.
     MERGE-PR GAP lines list every gap commit; MERGE-PR GAP-SERVER lines the ones whose server changes go
     live with this PR's server deploy (the live checkout is reset to the merge)
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
    # Ve's standing policy (innovation/AUTONOMY.json) covers Pages-only changes: a via-policy approval never takes a
    # server deploy, its own or one riding along from the gap. Ve's `approved` label is needed for that.
    $apJson = $null; try { $apJson = (@($ap | Where-Object { "$_".TrimStart().StartsWith('{') }) | Select-Object -Last 1) | ConvertFrom-Json } catch { }
    if ($null -eq $apJson) { Refuse 'cannot read check-approval.ps1''s verdict (fail closed)' }
    if ("$($apJson.approval)" -like 'via-policy*' -and $plan.ServerNeeded) {
        Refuse "issue #$Issue is approved via Ve's standing policy, which covers Pages-only changes, but this merge needs a server deploy ($(@($plan.ServerFiles) -join ', ')): manual / needs Ve (Ve adds ``approved`` to build it with the server)"
    }
    # $plan.Protected covers live HEAD..PR head. The PR's own files were checked in step 3 (strict). In the gap
    # (commits already on main that the live server lacks) only protected paths that change what the server
    # RUNS refuse; the rest is inert on server-pc and only listed (gate-rules.ps1 Get-GapDecision says why).
    # Non-protected server changes in the gap ride along with this PR's server deploy and are listed too.
    $ownNames = @($files | ForEach-Object { $_.filename; $_.previous_filename } | Where-Object { $_ })
    $gap = Get-GapDecision -Protected $plan.Protected -OwnFiles $ownNames -ServerPaths $plan.ServerPaths
    $gapCommits = @(); $gapServerCommits = @(); $gapBlockCommits = @()
    if ($plan.LiveHead -and $base -and $plan.LiveHead -ne $base) {
        $range = "$($plan.LiveHead)..$base"
        $gapCommits = @((Invoke-Git -Repo $script:Clone -Arguments @('log', '--format=%h %s', $range) -AllowFail -Quiet).Output | Where-Object { $_ })
        $gapLive = @((Get-ChangedFiles -Repo $script:Clone -From $plan.LiveHead -To $base) | Where-Object { Test-LiveAffectingPath $_ $plan.ServerPaths })
        if ($gapLive.Count -gt 0) { $gapServerCommits = @((Invoke-Git -Repo $script:Clone -Arguments (@('log', '--format=%h %s', $range, '--') + $gapLive) -AllowFail -Quiet).Output | Where-Object { $_ }) }
        if ($gap.Block.Count -gt 0) { $gapBlockCommits = @((Invoke-Git -Repo $script:Clone -Arguments (@('log', '--format=%h %s', $range, '--') + $gap.Block) -AllowFail -Quiet).Output | Where-Object { $_ }) }
    }
    foreach ($c in $gapCommits) { Write-Log "gap commit (on main, not yet on the live server): $c"; Write-Output "MERGE-PR GAP $c" }
    foreach ($c in $gapServerCommits) { Write-Log "gap commit that changes what the server runs (goes live with this PR's server deploy): $c"; Write-Output "MERGE-PR GAP-SERVER $c" }
    if ($gap.Ignored.Count -gt 0) { Write-Log "gap: protected but inert on server-pc, ignored: $($gap.Ignored -join ', ')" }
    Save-State "merge-gap-$Issue" @{ issue = $Issue; pr = $Pr; runId = "$env:INNOVATION_LOOP_RUN_ID"; liveHead = $plan.LiveHead; base = $base; commits = $gapCommits
        serverCommits = $gapServerCommits; inertProtected = $gap.Ignored; blocked = $gap.Block; refused = ($gap.Refuse.Count -gt 0) }
    if ($gap.Refuse.Count -gt 0) {
        $why = "protected paths between the live server and this PR: $($gap.Refuse -join ', ')"
        if ($gapBlockCommits.Count -gt 0) {
            $why += ". Already on main in: $($gapBlockCommits -join '; '). The loop never takes those to the live server itself (card index, sync rules, Target bot, .env need Ve); deploy them by hand first (docs/runbook.md: server deploy, plus Restart-Service recognition for a card-index change), then the loop can merge"
        }
        Refuse $why
    }
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
        if ($self.status -ne 'ok') {
            $gs = ''; if ($gapServerCommits.Count -gt 0) { $gs = " (server changes already on main and not yet live: $($gapServerCommits -join '; '))" }
            Refuse "this merge needs a server deploy ($($plan.ServerFiles -join ', '))$gs but the elevated deploy task is not usable: $($self.status) $($self.message)"
        }
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
    if ($gapServerCommits.Count -gt 0) {
        # say it on the issue in code, not only via the session: Ve's merged server work goes live with this deploy
        try {
            $lines = @($gapServerCommits | ForEach-Object { '- ' + ("$_" -replace '@', '&#64;' -replace '<!--', '&lt;!--') })
            $body = "<!-- innovation-loop -->`nThe server deploy for this change also takes these commits, already on main but not yet on the live server, live (the live checkout is reset to the merge $($mergeSha.Substring(0,7))):`n`n$($lines -join "`n")`n`nIf the deploy fails verification it is rolled back as a whole and these stay undeployed, as before."
            $nf = Join-Path $script:LoopHome "work\gap-note-$Issue.md"
            [IO.File]::WriteAllText($nf, $body, (New-Object Text.UTF8Encoding $false))
            $null = Invoke-Gh -Arguments @('issue', 'comment', "$Issue", '-R', $Repo, '--body-file', $nf) -AllowFail -Quiet
        } catch { Write-Log "could not post the gap note: $_" 'WARN' }
    }
    Write-Output "MERGE-PR OK $mergeSha"
    exit 0
} catch {
    Write-Log "error: $_" 'ERROR'
    Write-Output "MERGE-PR REFUSED error: $_"
    exit 1
}

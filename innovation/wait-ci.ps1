<#
.SYNOPSIS
  Wait for CI on a loop PR's head commit in ONE call, instead of the session polling turn by turn.
  Last output line: WAIT-CI PASS <sha7> ... | WAIT-CI FAIL <sha7> ...; failed jobs: <names> |
  WAIT-CI REFUSED <sha7> ... | WAIT-CI PENDING <sha7> ... | WAIT-CI TIMEOUT <sha7> ...

.DESCRIPTION
  Polls the check runs of the PR's current head (GET repos/<repo>/commits/<sha>/check-runs) with backoff
  (20 s, then 30 s, 45 s, 60 s) and judges them with the same rule merge-pr.ps1 merges on (gate-rules.ps1
  Get-CiVerdict: Typecheck/Lint/Unit/Build, Playwright E2E and v2 Visual Regression all completed + success).
  It never re-runs, cancels or dispatches anything and changes nothing; merge-pr.ps1 stays the authority and
  checks CI again before merging.

  - PASS: every required job is green on the head. Call merge-pr.ps1 next.
  - FAIL: a required job failed. Above the last line it prints the failed jobs and the tail of
    `gh run view <id> --log-failed` for each failed run, so a CI fix round needs no further gh calls.
  - REFUSED: a required job was skipped, cancelled or never appeared (merge-pr.ps1 would refuse it; this is
    not a test failure on the change).
  - PENDING (exit 5): this call's -CallMinutes ran out first (a foreground tool call is killed after 10
    minutes). Call it again with the same arguments; the total wait per head commit is kept in state\ and
    capped at -TimeoutMinutes (then TIMEOUT).
  A push to the PR restarts the wait for the new head.

.EXIT CODES
  0 PASS | 3 FAIL | 1 REFUSED or error | 4 TIMEOUT | 5 PENDING (call again)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Pr,
    [int]$TimeoutMinutes = 45,
    [ValidateRange(1, 9)][int]$CallMinutes = 9,
    [ValidateRange(10, 120)][int]$TailLines = 40
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\gate-rules.ps1"
Start-ScriptLog "wait-ci-$Pr"
Add-GhToPath
$Repo = $script:Repo
function Note([string]$m) { if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value ('{0} {1}' -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 } }

try {
    $p = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
    if ($p.state -ne 'open') { Write-Output "WAIT-CI REFUSED PR #$Pr is $($p.state)"; exit 1 }
    if ($p.head.repo.full_name -ne $Repo -or $p.head.ref -notmatch '^loop/\d+-[a-z0-9][a-z0-9-]*$') { Write-Output "WAIT-CI REFUSED PR #$Pr is not a loop/<issue>-<slug> branch of $Repo"; exit 1 }
    $headSha = "$($p.head.sha)"
    $key = "ci-wait-$Pr"
    $w = Read-State $key
    if (-not $w -or "$($w.headSha)" -ne $headSha) { $w = @{ pr = $Pr; headSha = $headSha; firstUtc = [DateTime]::UtcNow.ToString('o') }; Save-State $key $w }
    $first = [DateTime]::Parse("$($w.firstUtc)", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $callEnd = (Get-Date).AddMinutes($CallMinutes)
    $delays = @(20, 30, 45, 60); $i = 0
    while ($true) {
        $cr = Get-GhJson @('api', "repos/$Repo/commits/$headSha/check-runs?per_page=100")
        $waited = ([DateTime]::UtcNow - $first).TotalMinutes
        $v = Get-CiVerdict -CheckRuns @($cr.check_runs) -MissingMinutes $waited
        Note "CI $($headSha.Substring(0,7)) after $([int]$waited) min: $($v.State): $($v.Summary)"
        if ($v.State -in @('ok', 'refuse')) { break }
        if ($v.State -eq 'failed') {
            Write-Output "Failed jobs on $($headSha.Substring(0,7)):"
            foreach ($f in $v.Failed) { Write-Output "  $f" }
            # one log per failed workflow run (a check run's html_url is .../actions/runs/<runId>/job/<jobId>)
            $runIds = @($v.Failed | ForEach-Object { [regex]::Match("$_", '/actions/runs/(\d+)').Groups[1].Value } | Where-Object { $_ } | Select-Object -Unique)
            foreach ($rid in $runIds) {
                $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                $log = & $script:GhExe run view $rid -R $Repo --log-failed 2>&1 | ForEach-Object { "$_" }
                $ErrorActionPreference = $prev
                Write-Output "Run $rid (gh run view $rid -R $Repo --log-failed), tail:"
                foreach ($l in (Get-CiLogTail -Log ($log -join "`n") -Lines $TailLines)) { Write-Output "  $l" }
            }
            break
        }
        if ($waited -ge $TimeoutMinutes) { break }
        $now = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
        if ("$($now.head.sha)" -ne $headSha) {
            Note "head moved to $($now.head.sha); restarting the wait"
            $headSha = "$($now.head.sha)"; $first = [DateTime]::UtcNow
            Save-State $key @{ pr = $Pr; headSha = $headSha; firstUtc = $first.ToString('o') }
            continue
        }
        $d = $delays[[math]::Min($i, $delays.Count - 1)]; $i++
        if ((Get-Date).AddSeconds($d + 5) -ge $callEnd) { break }
        Start-Sleep -Seconds $d
    }
    $line = Format-WaitCiLine -Verdict $v -Sha $headSha -WaitedMinutes $waited -TimeoutMinutes $TimeoutMinutes
    Note $line
    Write-Output $line
    switch -regex ($line) {
        '^WAIT-CI PASS' { exit 0 }
        '^WAIT-CI FAIL' { exit 3 }
        '^WAIT-CI TIMEOUT' { exit 4 }
        '^WAIT-CI PENDING' { exit 5 }
        default { exit 1 }
    }
} catch {
    Note "error: $_"
    Write-Output "WAIT-CI REFUSED error: $_"
    exit 1
}

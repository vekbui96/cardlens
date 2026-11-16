<#
.SYNOPSIS
  ELEVATED wrapper behind the `innovation-loop-cardlens-deploy` scheduled task (highest privileges, no
  trigger, fixed action, runs from the admin-only copy in C:\ProgramData\innovation-loop-cardlens\bin).

.DESCRIPTION
  The non-elevated loop cannot pass arguments to the task. It writes a request file and starts the task;
  this wrapper treats that file as UNTRUSTED input:

   - reads ~\.innovation-loop-cardlens\elevated\request.json (<= 4 KB) and deletes it at once (consumed)
   - schema: exactly { mode, issue, sha, requestedAt, nonce }
       mode         deploy | rollback | selftest     (revert-only needs no elevation: rollback.ps1 -RevertOnly)
       issue        integer 1..999999
       sha          40 lowercase hex
       requestedAt  ISO-8601 UTC, at most 15 minutes old and not in the future
       nonce        32 lowercase hex, never seen before (ProgramData state\nonces.txt; admin-writable only)
   - deploy:   after a fresh `git fetch origin main` in the live checkout, sha must be on origin/main and
               ahead of the live HEAD; then runs <bin>\deploy-server.ps1 -TargetSha <sha> -Issue <issue>
   - rollback: sha and issue must equal the last deploy recorded in ProgramData state; then runs
               <bin>\rollback-server.ps1 (which takes PREV from that state, never from the request)
   - selftest: touches nothing; proves the task can be started by the non-elevated user and runs elevated
   - one at a time (lock in ProgramData; the task itself is also IgnoreNew)

  Script paths are fixed ($PSScriptRoot) and every argument is built here from validated values.
  The result goes to C:\ProgramData\innovation-loop-cardlens\results\<nonce>.json (Users can read it):
  { nonce, mode, issue, sha, status: started|ok|rejected|failed|rolled-back|rollback-failed, exitCode, message, log }

  -RequestPath / -DryRun exist for testing only (the scheduled task passes no arguments). -DryRun validates
  and reports what would run, and runs deploy-server.ps1 / rollback-server.ps1 with their own -DryRun.
#>
[CmdletBinding()]
param([string]$RequestPath = '', [switch]$DryRun)
. "$PSScriptRoot\lib.ps1"
foreach ($d in 'logs', 'results', 'state', 'lock') { $p = Join-Path $script:ElevHome $d; if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }
Start-ScriptLog 'elevated-task' -Dir (Join-Path $script:ElevHome 'logs')
if (-not $RequestPath) { $RequestPath = $script:RequestPath }
$nonceFile = Join-Path $script:ElevHome 'state\nonces.txt'
$lockPath = Join-Path $script:ElevHome 'lock\elevated.lock'
$stateFile = Join-Path $script:ElevHome 'state\server-last-deploy.json'
$script:Req = $null

function Write-Result {
    param([string]$Status, [int]$ExitCode = -1, [string]$Message = '')
    if (-not $script:Req -or -not $script:Req.nonce) { Write-Log "no valid nonce; result not written ($Status $Message)" 'WARN'; return }
    $path = Join-Path $script:ResultDir "$($script:Req.nonce).json"
    if ($Status -eq 'rejected' -and (Test-Path -LiteralPath $path)) { Write-Log "result for this nonce already exists; not overwriting ($Message)" 'WARN'; return }
    $o = [ordered]@{ nonce = $script:Req.nonce; mode = $script:Req.mode; issue = $script:Req.issue; sha = $script:Req.sha
        status = $Status; exitCode = $ExitCode; message = $Message; elevated = (Test-IsElevated); log = $script:LogFile; atUtc = [DateTime]::UtcNow.ToString('o') }
    Save-JsonFile -Path (Join-Path $script:ResultDir "$($script:Req.nonce).json") -Object $o
}

function Reject([string]$why) {
    Write-Log "REJECTED: $why" 'ERROR'
    Write-Result -Status 'rejected' -ExitCode 1 -Message $why
    Write-Output "ELEVATED-TASK REJECTED $why"
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    exit 1
}

# ---- lock --------------------------------------------------------------------------------------
try {
    $fs = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $b = [Text.Encoding]::UTF8.GetBytes("$PID`n$([DateTime]::UtcNow.ToString('o'))"); $fs.Write($b, 0, $b.Length); $fs.Close()
} catch [IO.IOException] {
    $age = [DateTime]::UtcNow - (Get-Item -LiteralPath $lockPath).LastWriteTimeUtc
    if ($age.TotalMinutes -lt 90) { Write-Log "another elevated run holds the lock (age $([int]$age.TotalMinutes) min); exiting" 'WARN'; exit 1 }
    Write-Log 'removing stale elevated lock' 'WARN'
    Remove-Item -LiteralPath $lockPath -Force
    $fs = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None); $fs.Close()
}

# ---- read and consume the request ---------------------------------------------------------------
$raw = $null
try {
    if (-not (Test-Path -LiteralPath $RequestPath)) { throw "no request at $RequestPath" }
    $item = Get-Item -LiteralPath $RequestPath
    if ($item.Length -gt 4096) { throw "request is $($item.Length) bytes (max 4096)" }
    $raw = [IO.File]::ReadAllText($RequestPath)
} catch {
    Write-Log "cannot read request: $_" 'ERROR'
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    exit 1
} finally {
    Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue   # consumed whether valid or not
}

try { $obj = $raw | ConvertFrom-Json } catch { Reject 'request is not valid JSON' }
if (-not $obj -or $obj -is [array] -or $obj -isnot [pscustomobject]) { Reject 'request is not a JSON object' }
$keys = @($obj.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
# nonce first, so a rejection can be reported back to the requester
if ($keys -contains 'nonce' -and "$($obj.nonce)" -cmatch '^[0-9a-f]{32}$') { $script:Req = [ordered]@{ nonce = "$($obj.nonce)"; mode = "$($obj.mode)"; issue = "$($obj.issue)"; sha = "$($obj.sha)" } }
if (($keys -join ',') -cne 'issue,mode,nonce,requestedAt,sha') { Reject "request keys must be exactly issue,mode,nonce,requestedAt,sha (got $($keys -join ','))" }
if (-not $script:Req) { Reject 'nonce must be 32 lowercase hex characters' }
$mode = "$($obj.mode)"
if ($mode -cnotin @('deploy', 'rollback', 'selftest')) {
    if ($mode -eq 'revert-only') { Reject 'revert-only needs no elevation; the loop runs rollback.ps1 -RevertOnly itself' }
    Reject "unknown mode '$mode'"
}
if ($obj.issue -isnot [int] -and $obj.issue -isnot [long]) { Reject 'issue must be an integer' }
$issue = [int]$obj.issue
if ($issue -lt 1 -or $issue -gt 999999) { Reject 'issue out of range' }
$sha = "$($obj.sha)"
if ($sha -cnotmatch '^[0-9a-f]{40}$') { Reject 'sha must be 40 lowercase hex characters' }
$at = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse("$($obj.requestedAt)", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$at)) { Reject 'requestedAt is not a timestamp' }
$age = [DateTimeOffset]::UtcNow - $at
if ($age.TotalMinutes -gt 15) { Reject "request is stale ($([int]$age.TotalMinutes) min old)" }
if ($age.TotalMinutes -lt -2) { Reject 'requestedAt is in the future' }
$seen = @(); if (Test-Path -LiteralPath $nonceFile) { $seen = @(Get-Content -LiteralPath $nonceFile) }
if ($seen -contains $script:Req.nonce) { $script:Req = $null; Reject 'nonce was already used (replayed request)' }   # never overwrite the original request's result
Add-Content -LiteralPath $nonceFile -Value $script:Req.nonce -Encoding ASCII
if ($seen.Count -gt 2000) { Set-Content -LiteralPath $nonceFile -Value (@($seen | Select-Object -Last 1000) + $script:Req.nonce) -Encoding ASCII }

Write-Log "valid request: mode=$mode issue=$issue sha=$sha age=$([int]$age.TotalSeconds)s dryRun=$DryRun elevated=$(Test-IsElevated)"
Write-Result -Status 'started' -ExitCode -1 -Message "accepted $mode"

if (-not (Test-IsElevated) -and -not $DryRun) { Write-Result -Status 'failed' -ExitCode 1 -Message 'wrapper is not running elevated (task not set to highest privileges?)'; Remove-Item -LiteralPath $lockPath -Force; exit 1 }

# ---- dispatch (fixed script paths, arguments built here) -------------------------------------------
$code = 1
try {
    switch ($mode) {
        'selftest' {
            $head = ''
            try { $head = Get-GitValue -Repo $script:LiveDir -Arguments @('rev-parse', 'HEAD') } catch { }
            Write-Result -Status 'ok' -ExitCode 0 -Message "selftest ok; user=$([Security.Principal.WindowsIdentity]::GetCurrent().Name) liveHead=$head"
            Write-Output 'ELEVATED-TASK OK selftest'
            $code = 0
        }
        'deploy' {
            Invoke-Git -Repo $script:LiveDir -Arguments @('fetch', 'origin', 'main', '--quiet') | Out-Null
            $originMain = Get-GitValue -Repo $script:LiveDir -Arguments @('rev-parse', 'FETCH_HEAD')
            $exists = Invoke-Git -Repo $script:LiveDir -Arguments @('cat-file', '-e', "$sha^{commit}") -AllowFail -Quiet
            if ($exists.Code -ne 0) { Reject "$sha is unknown after fetching origin/main" }
            $anc = Invoke-Git -Repo $script:LiveDir -Arguments @('merge-base', '--is-ancestor', $sha, $originMain) -AllowFail -Quiet
            if ($anc.Code -ne 0) { Reject "$sha is not on a freshly fetched origin/main ($originMain)" }
            $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'deploy-server.ps1'), '-TargetSha', $sha, '-Issue', "$issue")
            if ($DryRun) { $argList += '-DryRun' }
            & powershell.exe @argList | ForEach-Object { Write-Log "  $_" 'OUT' }
            $code = $LASTEXITCODE
        }
        'rollback' {
            $st = Read-JsonFile -Path $stateFile
            if (-not $st) { Reject 'no recorded server deploy to roll back' }
            if ("$($st.targetSha)" -ne $sha -or [int]$st.issue -ne $issue) { Reject "rollback request ($issue, $sha) does not match the last recorded deploy ($($st.issue), $($st.targetSha))" }
            $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'rollback-server.ps1'))
            if ($DryRun) { $argList += '-DryRun' }
            & powershell.exe @argList | ForEach-Object { Write-Log "  $_" 'OUT' }
            $code = $LASTEXITCODE
        }
    }
    if ($mode -ne 'selftest') {
        $status = switch ($code) { 0 { 'ok' } 1 { 'failed' } 2 { 'rolled-back' } 3 { 'rollback-failed' } 4 { 'rolled-back' } default { 'failed' } }
        Write-Result -Status $status -ExitCode $code -Message "$mode finished with exit $code"
        Write-Output "ELEVATED-TASK $status ($mode exit $code)"
    }
} catch {
    Write-Log "wrapper error: $_" 'ERROR'
    Write-Result -Status 'failed' -ExitCode 1 -Message "wrapper error: $_"
    $code = 1
} finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
exit $code

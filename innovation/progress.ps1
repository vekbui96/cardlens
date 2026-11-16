<#
.SYNOPSIS
  Update the issue's live "## Progress" comment (one per issue per run, edited in place).

.DESCRIPTION
  The session calls this at every stage boundary of a Phase A build and as a heartbeat during long waits
  (LOOP.md section 3). The first call creates the comment on the hub issue (which must be an issue carrying
  loop:proposal and approved); later calls edit that same comment. The comment id and stage times are kept in
  <LOOP_HOME>\state\progress\<run id>-<issue>.json; the session never passes a comment id, and before every
  edit the comment is re-read and must carry this loop's marker and the progress marker on this repo and
  issue. So the only comment the loop can edit is its own progress comment. The session itself still cannot
  edit comments (the guard blocks gh api writes and --edit-last).

  Never fails a build: it prints PROGRESS OK or PROGRESS WARN and exits 0 either way.

.EXAMPLE
  <SCRIPTS>\progress.ps1 -Issue 12 -Stage test -Detail "npm ci + unit + e2e running"
  <SCRIPTS>\progress.ps1 -Issue 12 -Stage test -Status ok -Detail "1,251 tests pass"
  <SCRIPTS>\progress.ps1 -Issue 12 -Stage done -Outcome deployed -Detail "live and verified"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Issue,
    [Parameter(Mandatory)][ValidateSet('approval', 'plan', 'branch', 'test', 'pr', 'ci', 'merge', 'deploy', 'verify', 'done')][string]$Stage,
    [ValidateSet('running', 'ok', 'failed', 'skipped')][string]$Status = 'running',
    [string]$Detail = '',
    [ValidateSet('', 'deployed', 'failed', 'rolled-back', 'skipped')][string]$Outcome = ''
)
try {
    . "$PSScriptRoot\lib.ps1"
    . "$PSScriptRoot\reporting.ps1"
    $runId = "$env:INNOVATION_LOOP_RUN_ID"
    if ($runId) { $script:LogFile = Join-Path $script:LoopHome "logs\run-$runId.progress.log" }
    $ok = Invoke-LoopProgress -LoopHome $script:LoopHome -RunId $runId -Repo $script:Repo -GhExe $script:GhExe -Issue $Issue -Stage $Stage `
        -Status $Status -Detail $Detail -Outcome $Outcome -Stages @('approval', 'plan', 'branch', 'test', 'pr', 'ci', 'merge', 'deploy', 'verify', 'done') -Marker '<!-- innovation-loop -->'
} catch { $ok = $false; Write-Host "progress: $_" }
if ($ok) { Write-Output "PROGRESS OK #$Issue $Stage $Status" } else { Write-Output "PROGRESS WARN #${Issue} ${Stage}: not updated (see the warning above); carry on with the build" }
exit 0

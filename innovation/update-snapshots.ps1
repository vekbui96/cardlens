<#
.SYNOPSIS
  Regenerate the v2 visual baselines (Linux, in the pinned Playwright container) in the loop's clone.
  Last output line: SNAPSHOTS PASS|FAIL ...

.DESCRIPTION
  CI's `visual` job compares against Linux baselines taken in mcr.microsoft.com/playwright:v1.61.1-noble.
  A UI change therefore needs them regenerated with the repo's own `scripts/snapshots-linux.sh` (Docker).
  This runs exactly that script with Git's bash, in the loop's clone only, and lists the PNGs it changed so
  the loop can look at them (Read the images) before committing them with explicit paths.

  bash is used ONLY for this script, and with MSYS path conversion switched off (MSYS_NO_PATHCONV=1,
  MSYS2_ARG_CONV_EXCL=*): the Git Bash path-mangling trap (CLAUDE.md) otherwise rewrites the container
  paths it hands to docker (`-w /build` became `C:/Program Files/Git/build`). Takes 3-10 minutes: start it
  in the background.
#>
[CmdletBinding()]
param([string]$Issue = 'adhoc', [string]$RepoPath = '')
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\resource-rules.ps1"   # Set-LowPriority
Start-ScriptLog "snapshots-$Issue"
if (-not $RepoPath) { $RepoPath = $script:Clone }
$null = Clear-SecretEnv
try {
    $full = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\')
    $loopRoot = (Join-Path $script:LoopHome 'clones').TrimEnd('\')
    if (-not $full.StartsWith($loopRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "refusing to run outside $loopRoot" }
    if (-not (Test-Path -LiteralPath (Join-Path $full 'node_modules\@playwright\test'))) { throw 'run test-gate.ps1 -Step install first (the script reads the installed @playwright/test version)' }
    $bash = 'C:\Program Files\Git\bin\bash.exe'
    if (-not (Test-Path -LiteralPath $bash)) { throw "no $bash" }
    $d = Invoke-Native -File 'docker' -Arguments @('version', '--format', '{{.Server.Version}}') -AllowFail -Quiet
    if ($d.Code -ne 0) { throw 'docker is not reachable for this user (is Docker Desktop running?)' }
    # MSYS path conversion OFF for this call (bash and the docker.exe it starts inherit it). Without it Git's
    # bash rewrote `-w /build` into `C:/Program Files/Git/build` and the `-v <pwd>/e2e/v2:/out` mount into a
    # `...;C` path list, so docker refused before running anything (#12, #22). Docker Desktop takes the
    # unconverted `/c/Users/...` host paths that `$(pwd)` gives as they are.
    $savedConv = @{ MSYS_NO_PATHCONV = $env:MSYS_NO_PATHCONV; MSYS2_ARG_CONV_EXCL = $env:MSYS2_ARG_CONV_EXCL }
    $env:MSYS_NO_PATHCONV = '1'; $env:MSYS2_ARG_CONV_EXCL = '*'
    try {
        # one test browser at a time across the loops (browser-lock.mjs): the baselines run Playwright in the
        # container, so they take the shared slot (wait up to 10 min). They are needed for the build, so a busy slot
        # only delays them: after the wait they run anyway, logged. BelowNormal for this process tree (the docker
        # client; the container itself runs in Docker's VM, whose priority Windows does not take from here).
        Set-LowPriority
        $lk = Invoke-Native -File $script:NodeExe -Arguments @("$PSScriptRoot\browser-lock.mjs", 'acquire', '--what', "docker baselines #$Issue", '--owner-pid', "$PID", '--hold-min', '20', '--wait-sec', '600', '--no-memory') -AllowFail -Quiet
        if ($lk.Code -ne 0) { Write-Log "browser slot busy after 10 min, running the baselines anyway: $(@($lk.Output) | Select-Object -Last 1)" 'WARN' }
        try { $r = Invoke-Native -File $bash -Arguments @('scripts/snapshots-linux.sh') -WorkDir $full -AllowFail -Quiet }
        finally { if ($lk.Code -eq 0) { $null = Invoke-Native -File $script:NodeExe -Arguments @("$PSScriptRoot\browser-lock.mjs", 'release', '--owner-pid', "$PID") -AllowFail -Quiet } }
    } finally {
        foreach ($k in @($savedConv.Keys)) { if ($null -eq $savedConv[$k]) { Remove-Item -LiteralPath "env:$k" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "env:$k" -Value $savedConv[$k] } }
    }
    foreach ($l in @($r.Output | Select-Object -Last 30)) { Write-Log "  $l" }
    if ($r.Code -ne 0) { throw "snapshots-linux.sh exited $($r.Code)" }
    $changed = @((Invoke-Git -Repo $full -Arguments @('status', '--porcelain', '--', 'e2e/v2') -Quiet).Output | Where-Object { $_.Trim() })
    Write-Output ("changed baselines:`n" + (($changed | ForEach-Object { "  $_" }) -join "`n"))
    Write-Output "SNAPSHOTS PASS ($($changed.Count) baseline file(s) changed)"
    exit 0
} catch {
    Write-Log "$_" 'ERROR'
    Write-Output "SNAPSHOTS FAIL: $_"
    exit 1
}

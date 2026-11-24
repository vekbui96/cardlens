<#
.SYNOPSIS
  Build one PR preview bundle. Started by the runner (preview.ps1 New-LoopPreview) under the REDUCED token
  (lib.ps1 Start-ReducedAndWait), never by a session (the guard does not list it), in a fresh worktree of the PR head.

.DESCRIPTION
  The PR's code runs here (npm ci, vite and its plugins), so this never runs with the runner's admin token.
  Mocks are forced on and every other VITE_ variable and secret is removed from the environment first, so the
  bundle can only talk to its own (static) origin: preview-rules.ps1 Get-PreviewBuildEnv. No type check (the local
  gate and CI did that on the same head); `vite build` only, into <Dir>\dist-preview. -Install runs `npm ci`
  first (the lockfile differs from the loop clone's, so its node_modules could not be linked).
  Last line: PREVIEW-BUILD OK | PREVIEW-BUILD FAILED <why>. Exit 0 / 1.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Dir,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\preview-rules.ps1"
. "$PSScriptRoot\resource-rules.ps1"   # BelowNormal: npm ci and vite (children inherit it) never compete with the services
[void](Set-LowPriority)
function Fail([string]$Why) { Write-Output "PREVIEW-BUILD FAILED $Why"; exit 1 }
try {
    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'package.json'))) { Fail "no package.json in $Dir" }
    # nothing from the runner's environment reaches the PR's build tools: no VITE_ value, no token, no node option
    foreach ($k in @(Get-ChildItem env: | ForEach-Object { $_.Name })) {
        if ($k -match '^(VITE_|GH_|GITHUB_|ANTHROPIC_|CLAUDE_|NPM_CONFIG_|NODE_OPTIONS$|INNOVATION_LOOP_)' -or $k -match '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)') { Remove-Item -LiteralPath "env:$k" -ErrorAction SilentlyContinue }
    }
    $envs = Get-PreviewBuildEnv
    foreach ($k in $envs.Keys) { Set-Item -LiteralPath "env:$k" -Value $envs[$k] }
    $env:CI = '1'
    $node = 'C:\Program Files\nodejs\node.exe'; $npm = 'C:\Program Files\nodejs\npm.cmd'
    Set-Location -LiteralPath $Dir
    if ($Install) {
        Write-Output 'npm ci (lockfile differs from the clone)'
        & $npm ci --no-audit --no-fund --loglevel=error 2>&1 | Select-Object -Last 15 | ForEach-Object { "  $_" }
        if ($LASTEXITCODE -ne 0) { Fail "npm ci exited $LASTEXITCODE" }
    }
    $vite = Join-Path $Dir 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vite)) { Fail 'node_modules\vite is missing' }
    $out = Join-Path $Dir 'dist-preview'
    Write-Output "vite build (mocks on, base /) -> $out"
    & $node $vite build --base / --outDir $out --emptyOutDir --logLevel warn 2>&1 | Select-Object -Last 25 | ForEach-Object { "  $_" }
    if ($LASTEXITCODE -ne 0) { Fail "vite build exited $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath (Join-Path $out 'index.html'))) { Fail 'no index.html in the build output' }
    Write-Output 'PREVIEW-BUILD OK'
    exit 0
} catch { Fail "$_" }

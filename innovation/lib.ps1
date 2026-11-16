# Shared helpers for the cardlens innovation loop. Dot-source it:  . "$PSScriptRoot\lib.ps1"
# PowerShell 5.1 compatible. Nothing in here reads or prints a secret.
#
# Two trust levels use this file:
#   - the NON-elevated side (run-loop, check-approval, test-gate, merge-pr, deploy, rollback), run from
#     Ve's checkout D:\projects\cardlens\innovation;
#   - the ELEVATED side (elevated-task, deploy-server, rollback-server), run from the admin-only copy
#     that install-task.ps1 puts in C:\ProgramData\innovation-loop-cardlens\bin.

Set-StrictMode -Version 1
$script:LogFile = $null
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- fixed locations ---------------------------------------------------------
$script:ElevHomeReal = 'C:\ProgramData\innovation-loop-cardlens'   # literal: env vars can be redefined per user
# Running from the admin-only copy = the elevated task. Its environment comes partly from HKCU\Environment,
# which a non-elevated process can write, so nothing user-controlled is trusted there: no path overrides,
# machine PATH / PSModulePath only (no planted git.exe, npm.cmd or PowerShell module from a user dir).
$script:IsProtectedCopy = ("$PSScriptRoot".TrimEnd('\') -ieq (Join-Path $script:ElevHomeReal 'bin'))
if ($script:IsProtectedCopy) {
    $env:PATH = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
    # ~/.gitconfig and ~/.npmrc are user-writable and can name hooks, fsmonitor commands or a registry:
    # the elevated git/npm use empty admin-owned config files instead (created by install-task.ps1).
    $env:GIT_CONFIG_GLOBAL = 'C:\ProgramData\innovation-loop-cardlens\config\gitconfig'
    $env:GIT_CONFIG_NOSYSTEM = '1'
    $env:NPM_CONFIG_USERCONFIG = 'C:\ProgramData\innovation-loop-cardlens\config\npmrc'
    $env:NPM_CONFIG_CACHE = 'C:\ProgramData\innovation-loop-cardlens\npm-cache'
    foreach ($v in 'INNOVATION_LOOP_CARDLENS_HOME', 'INNOVATION_LOOP_CARDLENS_ELEVHOME', 'INNOVATION_LOOP_CARDLENS_LIVEDIR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'NODE_OPTIONS', 'NPM_CONFIG_REGISTRY', 'NPM_CONFIG_PREFIX', 'NPM_CONFIG_GLOBALCONFIG') {
        Remove-Item -LiteralPath "env:$v" -ErrorAction SilentlyContinue
    }
}
$script:LoopHome = Join-Path $env:USERPROFILE '.innovation-loop-cardlens'
if ($env:INNOVATION_LOOP_CARDLENS_HOME) { $script:LoopHome = $env:INNOVATION_LOOP_CARDLENS_HOME }
# Elevated side's private state: admin-writable only (ACL set by install-task.ps1), readable by Users.
# The override exists for tests of the repo copy only; the protected copy has already dropped it.
$script:ElevHome = $script:ElevHomeReal
if ($env:INNOVATION_LOOP_CARDLENS_ELEVHOME) { $script:ElevHome = $env:INNOVATION_LOOP_CARDLENS_ELEVHOME }

$script:Owner          = 'vekbui96'
$script:Repo           = 'vekbui96/cardlens'
$script:Marker         = '<!-- innovation-loop -->'
$script:GhExe          = 'C:\Program Files\GitHub CLI\gh.exe'
$script:NpmCmd         = 'C:\Program Files\nodejs\npm.cmd'
$script:NodeExe        = 'C:\Program Files\nodejs\node.exe'
$script:Clone          = Join-Path $script:LoopHome 'clones\cardlens'
$script:CloneUrl       = 'git@github-cardlens:vekbui96/cardlens.git'   # SSH alias with the repo's deploy key
$script:SiteUrl        = 'https://vekbui96.github.io/cardlens/'
$script:LiveDir        = 'D:\services\cardlens'      # git checkout the service runs from (HTTPS remote, fetch-only)
# Test-only override (validation tests against a scratch checkout); the protected copy has already dropped it.
if ($env:INNOVATION_LOOP_CARDLENS_LIVEDIR) { $script:LiveDir = $env:INNOVATION_LOOP_CARDLENS_LIVEDIR }
$script:DataDir        = 'D:\services\data'          # irreplaceable; only ever READ (zipped) by the loop
$script:BackupDir      = 'D:\services\backups'       # predeploy-<stamp>.zip are the loop's; nothing else is touched
$script:ServiceName    = 'cardlens'
$script:ApiLocal       = 'http://127.0.0.1:8787'
$script:ApiFunnel      = 'https://server-pc.tail0e4194.ts.net:8443'
$script:RecognitionUrl = 'http://127.0.0.1:8200'
$script:DeployTaskName = 'innovation-loop-cardlens-deploy'
$script:RequestPath    = Join-Path $script:LoopHome 'elevated\request.json'
$script:ResultDir      = Join-Path $script:ElevHome 'results'
if (-not $script:IsProtectedCopy) {
    # git refuses repositories owned by someone else ("dubious ownership"). The loop clone is created by
    # run-loop.ps1, which holds an admin token on this box, so Administrators own it, while the session and
    # its scripts run with a reduced token. GIT_CONFIG_COUNT/KEY/VALUE is command-line scope, which git
    # honours for safe.directory, and it changes no config file. The live checkout is listed for reading HEAD.
    $env:GIT_CONFIG_COUNT = '2'
    $env:GIT_CONFIG_KEY_0 = 'safe.directory'; $env:GIT_CONFIG_VALUE_0 = $script:Clone.Replace('\', '/')
    $env:GIT_CONFIG_KEY_1 = 'safe.directory'; $env:GIT_CONFIG_VALUE_1 = $script:LiveDir.Replace('\', '/')
}# Scripts the elevated task runs; install-task.ps1 copies exactly these into ElevHome\bin.
$script:ElevatedFiles  = @('lib.ps1', 'elevated-task.ps1', 'deploy-server.ps1', 'rollback-server.ps1')

# Exit codes shared by deploy/rollback scripts (same meaning as the website loop)
$script:EXIT_OK              = 0
$script:EXIT_PRECONDITION    = 1   # nothing was changed
$script:EXIT_ROLLED_BACK     = 2   # deploy failed verification, rollback succeeded
$script:EXIT_ROLLBACK_FAILED = 3   # production may be broken: human needed
$script:EXIT_BUILD_FAILED    = 4   # failed before anything live was touched

# Paths the loop must never change on its own (repo-relative, forward slashes). A PR touching any of
# them is refused by merge-pr.ps1, and deploy-server.ps1 refuses to move the live checkout across them.
# Each is either out of scope for the loop (card index, scanner gate mirrored in recognition's judge.py,
# sync merge/validation rules, cache versions, the real Target cart, deploy config) or protects the loop
# itself (its scripts, CI, the e2e scratch-data config).
$script:ProtectedPathPatterns = @(
    '^\.github/', '^\.claude/', '^innovation/', '(^|/)\.env', '^public/card-index/',
    '^src/scan/phash\.ts$', '^src/storage/printings\.ts$', '^src/storage/binders\.ts$', '^src/models/binderParse\.ts$',
    '^src/storage/caches\.ts$', '^server/targetBot\.ts$', '^server/collectionStore\.ts$', '^server/binderStore\.ts$',
    '^scripts/build-card-index\.mjs$', '^playwright\.config\.ts$', '^render\.yaml$', '^netlify\.toml$', '^vercel\.json$'
)

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
}

function Initialize-LoopDirs {
    foreach ($d in 'logs', 'clones', 'lock', 'artifacts', 'state', 'work', 'elevated', 'scratch') {
        $p = Join-Path $script:LoopHome $d
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
    }
}

function Start-ScriptLog {
    param([string]$Name, [string]$Dir = '')
    if (-not $Dir) { Initialize-LoopDirs; $Dir = Join-Path $script:LoopHome 'logs' }
    if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $script:LogFile = Join-Path $Dir ("{0}-{1}.log" -f $Name, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Write-Log "log file: $script:LogFile"
}

function Test-IsElevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-GhToPath {
    $dir = Split-Path $script:GhExe
    if (($env:PATH -split ';') -notcontains $dir) { $env:PATH = "$dir;$env:PATH" }
}

# Remove secret-looking variables from this process (and so from children).
function Clear-SecretEnv {
    $keep = '^(ANTHROPIC_|CLAUDE_CODE_)'
    $removed = @()
    foreach ($v in @(Get-ChildItem env: | Where-Object { $_.Name -match '(SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|RESEND|ALLOWED_ORIGINS|TARGET_BOT)' -and $_.Name -notmatch $keep })) {
        Remove-Item -LiteralPath "env:$($v.Name)"; $removed += $v.Name
    }
    return $removed
}

# Run a native command, stream output to the log, throw on nonzero exit.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @(), [string]$WorkDir = $null, [switch]$AllowFail, [switch]$Quiet)
    $old = Get-Location
    try {
        if ($WorkDir) { Set-Location -LiteralPath $WorkDir }
        Write-Log ("> {0} {1}" -f $File, ($Arguments -join ' '))
        $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $out = & $File @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if (-not $Quiet -or $code -ne 0) { foreach ($l in $out) { Write-Log "  $l" 'OUT' } }
        if ($code -ne 0 -and -not $AllowFail) { throw "command failed (exit $code): $File $($Arguments -join ' ')" }
        return @{ Code = $code; Output = @($out) }
    } finally { Set-Location $old }
}

function Invoke-Git {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string[]]$Arguments, [switch]$AllowFail, [switch]$Quiet)
    return Invoke-Native -File 'git' -Arguments (@('-C', $Repo) + $Arguments) -AllowFail:$AllowFail -Quiet:$Quiet
}

function Get-GitValue {
    param([string]$Repo, [string[]]$Arguments)
    $r = Invoke-Git -Repo $Repo -Arguments $Arguments -Quiet
    return (($r.Output | Where-Object { $_ -ne '' }) | Select-Object -Last 1).Trim()
}

function Invoke-Gh {
    param([string[]]$Arguments, [switch]$AllowFail, [switch]$Quiet)
    return Invoke-Native -File $script:GhExe -Arguments $Arguments -AllowFail:$AllowFail -Quiet:$Quiet
}

function Get-GhJson {
    param([string[]]$GhArgs)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $script:GhExe @GhArgs 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE; $ErrorActionPreference = $prev
    if ($code -ne 0) { throw "gh $($GhArgs -join ' ') failed: $($out -join ' ')" }
    $text = ($out -join "`n").Trim()
    if (-not $text) { return $null }
    return ($text | ConvertFrom-Json)
}

# Start a process and wait for it. PowerShell 5.1 gotcha: Start-Process -PassThru returns an object whose
# ExitCode stays $null unless the process handle is opened right after start, so touch .Handle first.
function Start-AndWait {
    param([string]$File, [string]$ArgumentString, [string]$WorkDir, [string]$StdIn = $null, [string]$StdOut, [string]$StdErr, [int]$TimeoutMinutes)
    $sp = @{ FilePath = $File; ArgumentList = $ArgumentString; WorkingDirectory = $WorkDir; RedirectStandardOutput = $StdOut; RedirectStandardError = $StdErr; PassThru = $true; WindowStyle = 'Hidden' }
    if ($StdIn) { $sp.RedirectStandardInput = $StdIn }
    $proc = Start-Process @sp
    $null = $proc.Handle   # required for a real ExitCode under PS 5.1
    if (-not $proc.WaitForExit($TimeoutMinutes * 60 * 1000)) {
        & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
        return @{ TimedOut = $true; ExitCode = $null; Pid = $proc.Id }
    }
    $proc.WaitForExit()
    return @{ TimedOut = $false; ExitCode = $proc.ExitCode; Pid = $proc.Id }
}

# ---- reduced-token launcher (run-loop.ps1) ---------------------------------------------------------------
# On this box a scheduled task's RunLevel does not matter: non-interactive logons of this admin account get
# a FULL token. So the claude session is started under a SAFER normal-user, Medium-integrity token
# (LowRights.cs), its real token is read back and logged, and anything that still looks elevated is killed.
function Initialize-LowRights {
    if (-not ('CardlensLowRights' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'LowRights.cs') }
}
function Get-TokenState { param([int]$ProcessId = 0) Initialize-LowRights; return [CardlensLowRights]::Inspect($ProcessId) }
# Reduced = Administrators not enabled, integrity Medium or lower, and no privilege beyond what a standard
# user has. (TokenElevation still reads 1 for a SAFER token derived from an elevated one, so it is logged
# but not the test: the group, integrity and privilege list are what decide what the process can do.)
$script:StandardUserPrivileges = @('SeChangeNotifyPrivilege', 'SeShutdownPrivilege', 'SeUndockPrivilege', 'SeIncreaseWorkingSetPrivilege', 'SeTimeZonePrivilege')
function Test-TokenReduced {
    param([string]$State)
    if ($State -notmatch 'adminEnabled=False' -or $State -notmatch 'integrity=0x(2000|1000)\b') { return $false }
    $m = [regex]::Match($State, 'privileges=(\S*)')
    if (-not $m.Success) { return $false }
    foreach ($p in ($m.Groups[1].Value -split ',' | Where-Object { $_ })) { if ($script:StandardUserPrivileges -notcontains $p) { return $false } }
    return $true
}

# Start $File under the reduced token with stdio redirected to files; verify the child's token (fail closed:
# kill it and throw if it is not reduced); wait up to -TimeoutMinutes (kill the tree on timeout).
function Start-ReducedAndWait {
    param([string]$File, [string]$ArgumentString, [string]$WorkDir, [string]$StdIn = '', [string]$StdOut, [string]$StdErr, [int]$TimeoutMinutes)
    Initialize-LowRights
    $cmdLine = '"' + $File + '" ' + $ArgumentString
    $r = [CardlensLowRights]::Start($File, $cmdLine, $WorkDir, $StdIn, $StdOut, $StdErr) -split '\|', 3
    $childPid = [int]$r[0]; $h = [long]$r[1]
    try {
        $state = ''
        try { $state = Get-TokenState -ProcessId $childPid } catch { $state = "unreadable: $_" }
        Write-Log "reduced child pid $childPid via $($r[2]); token: $state"
        if (-not (Test-TokenReduced $state)) {
            & taskkill.exe /PID $childPid /T /F 2>&1 | Out-Null
            throw "child token is not reduced ($state); killed it (failing closed)"
        }
        $code = [CardlensLowRights]::Wait($h, [uint32]($TimeoutMinutes * 60 * 1000))
        if ($code -eq -1) { & taskkill.exe /PID $childPid /T /F 2>&1 | Out-Null; return @{ TimedOut = $true; ExitCode = $null; Pid = $childPid; Token = $state } }
        return @{ TimedOut = $false; ExitCode = [int]$code; Pid = $childPid; Token = $state }
    } finally { [CardlensLowRights]::CloseProcess($h) }
}
# Plain HTTP GET/HEAD that never throws on 4xx/5xx. The loop never sends anything but GET/HEAD to prod.
function Invoke-Http {
    param([string]$Url, [ValidateSet('GET', 'HEAD')][string]$Method = 'GET', [int]$TimeoutSec = 30)
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = $Method
    $req.Timeout = $TimeoutSec * 1000
    $req.ReadWriteTimeout = $TimeoutSec * 1000
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'innovation-loop-verify'
    $req.Headers.Add('Cache-Control', 'no-cache')
    $resp = $null
    try { $resp = $req.GetResponse() }
    catch [System.Net.WebException] {
        if ($_.Exception.Response) { $resp = $_.Exception.Response }
        else { return @{ Status = 0; Body = ''; Error = $_.Exception.Message } }
    }
    try {
        $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd(); $reader.Close()
        return @{ Status = [int]$resp.StatusCode; Body = $text; Error = $null }
    } finally { $resp.Close() }
}

function Get-CacheBustedUrl { param([string]$Url) $sep = '?'; if ($Url.Contains('?')) { $sep = '&' }; return "$Url${sep}cb=$([DateTime]::UtcNow.Ticks)" }

# "/cardlens/assets/index-XXXX.js" from an index.html string (must carry the /cardlens/ base:
# a Git Bash build produced /Program Files/Git/cardlens/... and a blank page that returned 200).
function Get-IndexAsset {
    param([string]$Html)
    $m = [regex]::Match($Html, 'src="(/cardlens/assets/index-[A-Za-z0-9_\-]+\.js)"')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Test-ProtectedPath {
    param([string]$Path)
    $p = $Path.Replace('\', '/')
    foreach ($re in $script:ProtectedPathPatterns) { if ($p -match $re) { return $re } }
    return $null
}

# Files whose change means the SERVER needs deploying: server/, the shared src files listed in
# tsconfig.node.json (read at the given ref, so a newly shared file counts), package.json, package-lock.json.
function Get-ServerPaths {
    param([string]$Repo, [string]$Ref)
    $raw = (Invoke-Git -Repo $Repo -Arguments @('show', "${Ref}:tsconfig.node.json") -Quiet).Output -join "`n"
    $noComments = ($raw -split "`n" | ForEach-Object { $_ -replace '^\s*//.*$', '' }) -join "`n"
    $include = @(($noComments | ConvertFrom-Json).include)
    return @($include + @('server', 'package.json', 'package-lock.json') | Where-Object { $_ } | Select-Object -Unique)
}

function Test-IsServerPath {
    param([string]$Path, [string[]]$ServerPaths)
    $p = $Path.Replace('\', '/')
    foreach ($s in $ServerPaths) {
        $s = $s.Replace('\', '/').TrimEnd('/')
        if ($p -eq $s -or $p.StartsWith("$s/")) { return $true }
    }
    return $false
}

# Does a file in the live checkout change what server-pc RUNS? The server deploy rule (server/, the shared src
# files of tsconfig.node.json, package.json, package-lock.json; -ServerPaths from Get-ServerPaths) minus the two
# build/test configs that list only exists to typecheck (vite.config.ts, playwright.config.ts: the server never
# imports them), plus public/card-index/** (recognition reads its index from the live checkout and keeps it
# until a restart no loop script does) and .env* files. Everything else there (innovation/, .github/, docs,
# e2e, client-only src, scripts) is never executed on server-pc: moving the live checkout across it is inert.
function Test-LiveAffectingPath {
    param([string]$Path, [string[]]$ServerPaths)
    $p = $Path.Replace('\', '/')
    if ($p -match '^public/card-index/' -or $p -match '(^|/)\.env') { return $true }
    if ($p -in @('vite.config.ts', 'playwright.config.ts')) { return $false }
    return (Test-IsServerPath $p $ServerPaths)
}

# Protected paths changed between the live HEAD and a target, split by what they would do to the live server.
#   Block  protected AND live-affecting (card index, sync merge/validation rules, Target bot, .env): the live
#          checkout never moves across these without Ve
#   Inert  protected but never executed on server-pc (innovation/, .github/, playwright.config.ts, client-only
#          src such as caches.ts, scripts): listed, never a reason to refuse
# Shared by merge-pr / deploy (gate-rules.ps1 Get-GapDecision) and the elevated deploy-server.ps1.
function Split-ProtectedByLiveImpact {
    param([string[]]$Protected, [string[]]$ServerPaths)
    $block = New-Object System.Collections.ArrayList; $inert = New-Object System.Collections.ArrayList
    foreach ($f in @($Protected | Where-Object { $_ } | ForEach-Object { "$_".Replace('\', '/') } | Select-Object -Unique)) {
        if (Test-LiveAffectingPath $f $ServerPaths) { [void]$block.Add($f) } else { [void]$inert.Add($f) }
    }
    return [pscustomobject]@{ Block = @($block); Inert = @($inert) }
}

function Get-ChangedFiles {
    param([string]$Repo, [string]$From, [string]$To)
    $r = Invoke-Git -Repo $Repo -Arguments @('diff', '--name-only', "$From..$To") -Quiet
    return @($r.Output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

# Wait for the deploy-pages.yml run of a commit, cancelling nothing but reporting (and, if it has sat
# there for over -StuckMinutes, cancelling) an OLDER Pages run stuck in `waiting`, which blocks the
# whole `pages` concurrency group (CLAUDE.md: one held it for two days).
function Wait-PagesRun {
    param([string]$Sha, [int]$TimeoutSec = 1500, [int]$StuckMinutes = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $seen = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $json = Get-GhJson @('api', "repos/$($script:Repo)/actions/workflows/deploy-pages.yml/runs?per_page=20")
            $runs = @($json.workflow_runs)
            $mine = @($runs | Where-Object { $_.head_sha -eq $Sha } | Sort-Object { [datetime]$_.created_at } -Descending)
            foreach ($r in @($runs | Where-Object { $_.status -in @('waiting', 'queued', 'pending') -and $_.head_sha -ne $Sha })) {
                $age = [DateTime]::UtcNow - ([datetime]$r.created_at).ToUniversalTime()
                Write-Log "older Pages run $($r.id) ($($r.head_sha.Substring(0,7))) is $($r.status) for $([int]$age.TotalMinutes) min" 'WARN'
                if ($r.status -eq 'waiting' -and $age.TotalMinutes -ge $StuckMinutes -and $mine.Count -gt 0 -and ([datetime]$r.created_at) -lt [datetime]$mine[0].created_at) {
                    Write-Log "cancelling stuck Pages run $($r.id) (blocks the pages concurrency group)" 'WARN'
                    Invoke-Gh -Arguments @('run', 'cancel', "$($r.id)", '-R', $script:Repo) -AllowFail | Out-Null
                }
            }
            if ($mine.Count -gt 0) {
                $seen = $true
                $run = $mine[0]
                Write-Log "pages run $($run.id) for $($Sha.Substring(0,7)): status=$($run.status) conclusion=$($run.conclusion)"
                if ($run.status -eq 'completed') { return ($run.conclusion -eq 'success') }
            } else { Write-Log "no Pages run for $($Sha.Substring(0,7)) yet" }
        } catch { Write-Log "could not read Actions runs: $_" 'WARN' }
        Start-Sleep -Seconds 20
    }
    Write-Log "timed out waiting for the Pages run of $Sha (seen=$seen)" 'ERROR'
    return $false
}

# Every /cardlens/assets/* file index.html references (entry js, modulepreloads, css), sorted: the build's
# signature. A CSS-only change keeps index-*.js but changes this.
function Get-IndexAssetSet {
    param([string]$Html)
    return @([regex]::Matches($Html, '"(/cardlens/assets/[A-Za-z0-9_\-\.]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
}

# Served-bytes check of the live front end:
#  - cache-busted index.html references /cardlens/assets/index-*.js; with -NotSignature, its asset set must
#    differ from that one (the previous build), i.e. the new build is what is being served
#  - every asset index.html names and every JS chunk the entry names returns 200; -ExpectString must be in
#    one of them (screens are code-split: the entry alone is a false negative; CSS is searched too) and
#    -AbsentString in none
#  - headless render (smoke.mjs): #root non-empty, no uncaught page error
function Test-LiveSite {
    param([string]$ExpectString = '', [string]$AbsentString = '', [string]$NotSignature = '',
          [string]$RepoForSmoke = '', [string]$ShotPath = '', [int]$TimeoutSec = 600)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $last = ''
    while ((Get-Date) -lt $deadline) {
        $page = Invoke-Http -Url (Get-CacheBustedUrl $script:SiteUrl)
        $asset = Get-IndexAsset $page.Body
        $sig = (Get-IndexAssetSet $page.Body) -join ','
        if ($page.Status -ne 200 -or -not $asset) { $last = "page status=$($page.Status) entry=$asset" }
        elseif ($NotSignature -and $sig -eq $NotSignature) { $last = "still serving the previous build ($asset)" }
        else {
            $entry = Invoke-Http -Url ('https://vekbui96.github.io' + $asset)
            if ($entry.Status -ne 200 -or $entry.Body.Length -lt 1000) { $last = "entry $asset status=$($entry.Status)" }
            else {
                $files = @(Get-IndexAssetSet $page.Body | ForEach-Object { $_.Substring('/cardlens/assets/'.Length) })
                $files += @([regex]::Matches($entry.Body, '(?:\./|/cardlens/assets/|assets/)?([A-Za-z0-9_\-\.]+-[A-Za-z0-9_\-]{6,}\.(?:js|css))') | ForEach-Object { $_.Groups[1].Value })
                $files = @($files | Select-Object -Unique)
                $found = $false; $foundIn = ''; $absentHit = ''; $bad = 0
                foreach ($c in ($files | Select-Object -First 200)) {
                    $cr = if ("/cardlens/assets/$c" -eq $asset) { $entry } else { Invoke-Http -Url ($script:SiteUrl + 'assets/' + $c) }
                    if ($cr.Status -ne 200) { $bad++; continue }
                    if ($ExpectString -and -not $found -and $cr.Body.Contains($ExpectString)) { $found = $true; $foundIn = $c }
                    if ($AbsentString -and $cr.Body.Contains($AbsentString)) { $absentHit = $c }
                }
                Write-Log ("live entry={0} files={1} unreachable={2} expect={3}{4} absentHit={5}" -f $asset, $files.Count, $bad, $found, $(if ($foundIn) { " ($foundIn)" } else { '' }), $absentHit)
                if (((-not $ExpectString) -or $found) -and (-not $absentHit) -and $bad -eq 0) {
                    if (-not $RepoForSmoke) { return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    $smokeArgs = @("$PSScriptRoot\smoke.mjs", $RepoForSmoke, (Get-CacheBustedUrl $script:SiteUrl))
                    if ($ShotPath) { $smokeArgs += $ShotPath }
                    $s = Invoke-Native -File $script:NodeExe -Arguments $smokeArgs -AllowFail
                    if ($s.Code -eq 0) { return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    if ($s.Code -eq 2) { Write-Log 'render check could not run (no playwright-core or browser); served-bytes checks passed' 'WARN'; return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    $last = 'render check failed: ' + ($s.Output -join ' ')
                } else { $last = 'string/file checks not passing' }
            }
        }
        Write-Log "live check not yet passing: $last"
        Start-Sleep -Seconds 20
    }
    Write-Log "live site verification failed: $last" 'ERROR'
    return @{ Ok = $false; Asset = $null; Signature = $null }
}

function Get-LiveSignature { return ((Get-IndexAssetSet (Invoke-Http -Url (Get-CacheBustedUrl $script:SiteUrl)).Body) -join ',') }
# Revert a commit on main (merge or plain) in the loop clone and push. Idempotent: skips if already reverted.
# Returns the sha now at the tip of main (the revert commit, or the existing tip if nothing was needed).
function Invoke-RevertOnMain {
    param([string]$Repo, [string]$Sha)
    Invoke-Git -Repo $Repo -Arguments @('fetch', 'origin', '--prune') | Out-Null
    Invoke-Git -Repo $Repo -Arguments @('checkout', '-f', '-B', 'main', 'origin/main') | Out-Null
    Invoke-Git -Repo $Repo -Arguments @('reset', '--hard', 'origin/main') | Out-Null
    $full = Get-GitValue -Repo $Repo -Arguments @('rev-parse', $Sha)
    $already = Invoke-Git -Repo $Repo -Arguments @('log', 'origin/main', '--format=%H', "--grep=This reverts commit $full") -AllowFail -Quiet
    if (@($already.Output | Where-Object { $_ -match '^[0-9a-f]{40}$' }).Count -gt 0) {
        Write-Log "$full is already reverted on main; nothing to do"
        return (Get-GitValue -Repo $Repo -Arguments @('rev-parse', 'origin/main'))
    }
    $isAncestor = Invoke-Git -Repo $Repo -Arguments @('merge-base', '--is-ancestor', $full, 'origin/main') -AllowFail
    if ($isAncestor.Code -ne 0) { throw "$full is not on origin/main; refusing to revert" }
    $parents = (Get-GitValue -Repo $Repo -Arguments @('rev-list', '--parents', '-n', '1', $full)).Split(' ').Count - 1
    $msgFile = Join-Path $script:LoopHome 'work\revert-msg.txt'
    $subject = Get-GitValue -Repo $Repo -Arguments @('log', '-1', '--format=%s', $full)
    $msg = "Revert `"$subject`"`n`nThis reverts commit $full.`n`nAutomatic rollback by the innovation loop: the change failed post-deploy verification.`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n"
    [IO.File]::WriteAllText($msgFile, $msg, (New-Object Text.UTF8Encoding $false))
    if ($parents -gt 1) { Invoke-Git -Repo $Repo -Arguments @('revert', '--no-commit', '-m', '1', $full) | Out-Null }
    else { Invoke-Git -Repo $Repo -Arguments @('revert', '--no-commit', $full) | Out-Null }
    Invoke-Git -Repo $Repo -Arguments @('commit', '-F', $msgFile) | Out-Null
    Invoke-Git -Repo $Repo -Arguments @('push', 'origin', 'HEAD:main') | Out-Null   # fast-forward only; main is never force-pushed
    $tip = Get-GitValue -Repo $Repo -Arguments @('rev-parse', 'HEAD')
    Write-Log "reverted $full on main with $tip and pushed"
    return $tip
}

function Save-JsonFile { param([string]$Path, $Object) $dir = Split-Path $Path; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; [IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false)) }
function Read-JsonFile { param([string]$Path) if (Test-Path -LiteralPath $Path) { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }; return $null }
function Save-State { param([string]$Name, $Object) Save-JsonFile -Path (Join-Path $script:LoopHome "state\$Name.json") -Object $Object }
function Read-State { param([string]$Name) return (Read-JsonFile -Path (Join-Path $script:LoopHome "state\$Name.json")) }

# ======================================================================================
# Server side (used by deploy-server.ps1 / rollback-server.ps1, elevated)
# ======================================================================================

function Get-ServiceChildPid {
    # NSSM's own pid is stable across app restarts; the node child's is not. A changing child pid during
    # verification means NSSM restarted a crashing app (AppExit Restart, 5s), which a single health check misses.
    $svc = Get-CimInstance Win32_Service -Filter "Name='$($script:ServiceName)'"
    if (-not $svc -or -not $svc.ProcessId) { return 0 }
    $child = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($svc.ProcessId)" | Where-Object { $_.Name -match '^node' })
    if ($child.Count -gt 0) { return [int]$child[0].ProcessId }
    return 0
}

function Wait-ServiceState {
    param([string]$Name, [string]$State, [int]$TimeoutSec = 90)
    $svc = Get-Service -Name $Name
    try { $svc.WaitForStatus($State, [TimeSpan]::FromSeconds($TimeoutSec)); return $true } catch { return $false }
}

# GET-only smoke of the live server. Never POSTs anything (no /merge, /share, /binders/images, /target).
#  - service Running, and the node child pid stable across the whole window (no crash loop)
#  - /api/health {"ok":true} on several consecutive checks
#  - /api/catalog/sets?pageSize=1 then /api/printings/<setId>; retried, because pokemontcg.io fails ~25% in bursts
#    (failures there alone are logged, not fatal, unless every attempt fails: a false rollback is also an outage)
#  - Funnel /api/health (retried)
#  - recognition /health: informational only (the loop never restarts or changes recognition)
function Test-Server {
    param([int]$StartupTimeoutSec = 90, [int]$StableChecks = 6, [int]$CheckIntervalSec = 10)
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        $h = Invoke-Http -Url "$($script:ApiLocal)/api/health" -TimeoutSec 10
        if ($h.Status -eq 200 -and $h.Body -match '"ok"\s*:\s*true') { $up = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $up) { Write-Log 'local /api/health never reported ok' 'ERROR'; return $false }

    $pid0 = Get-ServiceChildPid
    Write-Log "health ok; node child pid $pid0; watching for $($StableChecks * $CheckIntervalSec)s"
    for ($i = 1; $i -le $StableChecks; $i++) {
        Start-Sleep -Seconds $CheckIntervalSec
        $st = (Get-Service -Name $script:ServiceName).Status
        $h = Invoke-Http -Url "$($script:ApiLocal)/api/health" -TimeoutSec 10
        $p = Get-ServiceChildPid
        Write-Log "check $i/${StableChecks}: service=$st health=$($h.Status) pid=$p"
        if ("$st" -ne 'Running') { Write-Log "service is $st" 'ERROR'; return $false }
        if (-not ($h.Status -eq 200 -and $h.Body -match '"ok"\s*:\s*true')) { Write-Log "health failed: $($h.Status) $($h.Body)" 'ERROR'; return $false }
        if ($pid0 -and $p -and $p -ne $pid0) { Write-Log "node pid changed ${pid0} -> ${p}: NSSM restarted a crashing app" 'ERROR'; return $false }
    }

    $catalogOk = $false; $setId = $null; $setName = $null
    for ($i = 0; $i -lt 6 -and -not $catalogOk; $i++) {
        $c = Invoke-Http -Url "$($script:ApiLocal)/api/catalog/sets?pageSize=1" -TimeoutSec 30
        if ($c.Status -eq 200) {
            try { $j = $c.Body | ConvertFrom-Json; $setId = @($j.data)[0].id; $setName = @($j.data)[0].name } catch { }
            if ($setId) { $catalogOk = $true; break }
        }
        Write-Log "catalog sets attempt $($i + 1): status=$($c.Status) (upstream fails ~25%, retrying)" 'WARN'
        Start-Sleep -Seconds (5 * ($i + 1))
    }
    if (-not $catalogOk) { Write-Log 'catalog sets failed on every attempt over ~2 minutes' 'ERROR'; return $false }
    # /api/printings/:setId needs ?name= (TCGdex joins sets by name). 200 = ok. After every retry, an
    # upstream-shaped failure (404 set_not_found_upstream, 502/503/504) is a warning, not a rollback: TCGdex
    # being down is not this deploy's fault. 0 / 400 / 500 mean the route itself is broken.
    $printOk = $false; $printStatus = 0
    for ($i = 0; $i -lt 4 -and -not $printOk; $i++) {
        $pr = Invoke-Http -Url "$($script:ApiLocal)/api/printings/$([uri]::EscapeDataString($setId))?name=$([uri]::EscapeDataString("$setName"))" -TimeoutSec 60
        $printStatus = $pr.Status
        if ($pr.Status -eq 200 -and $pr.Body.Length -gt 2) { $printOk = $true } else { Write-Log "printings/$setId attempt $($i + 1): $($pr.Status) $($pr.Body.Substring(0, [Math]::Min(80, $pr.Body.Length)))" 'WARN'; Start-Sleep -Seconds 10 }
    }
    if (-not $printOk) {
        if ($printStatus -in @(404, 502, 503, 504)) { Write-Log "printings/$setId kept failing upstream ($printStatus); not treated as a deploy failure" 'WARN' }
        else { Write-Log "printings/$setId failed on every attempt ($printStatus)" 'ERROR'; return $false }
    }

    $funnelOk = $false
    for ($i = 0; $i -lt 6 -and -not $funnelOk; $i++) {
        $f = Invoke-Http -Url "$($script:ApiFunnel)/api/health" -TimeoutSec 20
        if ($f.Status -eq 200 -and $f.Body -match '"ok"\s*:\s*true') { $funnelOk = $true } else { Start-Sleep -Seconds 10 }
    }
    if (-not $funnelOk) { Write-Log 'funnel /api/health failed' 'ERROR'; return $false }

    try {
        $rec = Invoke-Http -Url "$($script:RecognitionUrl)/health" -TimeoutSec 10
        $latest = Read-JsonFile -Path (Join-Path $script:LiveDir 'public\card-index\latest.json')
        $recJson = $rec.Body | ConvertFrom-Json
        if ($latest -and $recJson.cards -ne $latest.cards) { Write-Log "recognition serves $($recJson.cards) cards, latest.json says $($latest.cards) (not caused by the loop; Ve should look)" 'WARN' }
        else { Write-Log "recognition ok: cards=$($recJson.cards) indexVersion=$($recJson.indexVersion)" }
    } catch { Write-Log "recognition health not readable: $_ (informational)" 'WARN' }

    if ((Get-ServiceChildPid) -ne $pid0) { Write-Log 'node pid changed during the smoke checks' 'ERROR'; return $false }
    Write-Log 'server verification passed'
    return $true
}

# ======================================================================================
# Non-elevated side: asking the elevated task to act
# ======================================================================================

# Write a request for the elevated task, start the task (exactly this one task name), poll for the result.
# Returns the result object; .status is ok | rejected | failed | rolled-back | rollback-failed | not-started | timeout.
function Invoke-ElevatedRequest {
    param([ValidateSet('deploy', 'rollback', 'selftest')][string]$Mode, [int]$Issue = 1, [string]$Sha = ('0' * 40), [int]$TimeoutMinutes = 45, [int]$PickupSeconds = 120)
    Initialize-LoopDirs
    $bytes = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $nonce = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $req = [ordered]@{ mode = $Mode; issue = $Issue; sha = $Sha.ToLowerInvariant(); requestedAt = [DateTime]::UtcNow.ToString('o'); nonce = $nonce }
    Save-JsonFile -Path $script:RequestPath -Object $req
    $resultPath = Join-Path $script:ResultDir "$nonce.json"
    Write-Log "elevated request: mode=$Mode issue=$Issue sha=$Sha nonce=$nonce"
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & schtasks.exe /run /tn $script:DeployTaskName 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE; $ErrorActionPreference = $prev
    Write-Log "schtasks /run: exit $code $($out -join ' ')"
    if ($code -ne 0) {
        Remove-Item -LiteralPath $script:RequestPath -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ nonce = $nonce; status = 'not-started'; exitCode = -1; message = "could not start task $($script:DeployTaskName): $($out -join ' ')" }
    }
    $pickupDeadline = (Get-Date).AddSeconds($PickupSeconds)
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $last = ''
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        $r = $null
        try { $r = Read-JsonFile -Path $resultPath } catch { }
        if (-not $r) {
            if ((Get-Date) -gt $pickupDeadline) {
                Remove-Item -LiteralPath $script:RequestPath -Force -ErrorAction SilentlyContinue
                return [pscustomobject]@{ nonce = $nonce; status = 'not-started'; exitCode = -1; message = "task did not pick up the request within $PickupSeconds s (already running? not installed?)" }
            }
            continue
        }
        if ($r.status -ne $last) { Write-Log "elevated status: $($r.status) $($r.message)"; $last = $r.status }
        if ($r.status -ne 'started') { return $r }
    }
    return [pscustomobject]@{ nonce = $nonce; status = 'timeout'; exitCode = -1; message = "no final result after $TimeoutMinutes min; see $($script:ElevHome)\logs" }
}

# The live checkout's HEAD, readable from a NON-elevated process: D:\services\cardlens is owned by
# Administrators, so git refuses it ("dubious ownership") unless safe.directory names it. -c on the command
# line is a protected scope git honours, and this changes no config anywhere.
function Get-LiveHead {
    $sd = 'safe.directory=' + $script:LiveDir.Replace('\', '/')
    return (Get-GitValue -Repo $script:LiveDir -Arguments @('-c', $sd, 'rev-parse', 'HEAD'))
}
# What a deploy of $Target means for the server, judged against the LIVE checkout's HEAD.
#   ServerNeeded  server/, a tsconfig.node.json shared file, package.json or the lockfile changed
#   Protected     protected paths changed (judged by gate-rules.ps1 Get-GapDecision)
#   Foreign       commits that are NOT part of -OwnCommitsFrom..$Target but change server files: server work
#                 Ve already merged to main that the live server lacks. The deploy carries it (the live
#                 checkout is reset to the merge); merge-pr / deploy list these commits so the issue says so.
#   ServerPaths   Get-ServerPaths at $Target (for Get-GapDecision / Test-LiveAffectingPath)
function Get-ServerPlan {
    param([string]$Repo, [string]$Target, [string]$OwnCommitsFrom = '')
    $liveHead = Get-LiveHead
    $known = Invoke-Git -Repo $Repo -Arguments @('cat-file', '-e', "$liveHead^{commit}") -AllowFail -Quiet
    if ($known.Code -ne 0) { throw "live HEAD $liveHead is not in the loop clone (fetch?)" }
    $fwd = Invoke-Git -Repo $Repo -Arguments @('merge-base', '--is-ancestor', $liveHead, $Target) -AllowFail -Quiet
    if ($fwd.Code -ne 0) { throw "live HEAD $liveHead is not an ancestor of $Target" }
    $serverPaths = Get-ServerPaths -Repo $Repo -Ref $Target
    $changed = Get-ChangedFiles -Repo $Repo -From $liveHead -To $Target
    $serverFiles = @($changed | Where-Object { Test-IsServerPath $_ $serverPaths })
    $protected = @($changed | Where-Object { Test-ProtectedPath $_ })
    $foreign = @()
    if ($serverFiles.Count -gt 0) {
        $own = @()
        if ($OwnCommitsFrom) { $own = @((Invoke-Git -Repo $Repo -Arguments @('rev-list', "$OwnCommitsFrom..$Target") -Quiet).Output | Where-Object { $_ }) }
        $touching = @((Invoke-Git -Repo $Repo -Arguments (@('rev-list', "$liveHead..$Target", '--') + $serverFiles) -Quiet).Output | Where-Object { $_ })
        $foreign = @($touching | Where-Object { $own -notcontains $_ })
    }
    return [pscustomobject]@{ LiveHead = $liveHead; Changed = $changed; ServerPaths = $serverPaths; ServerFiles = $serverFiles; ServerNeeded = ($serverFiles.Count -gt 0); Protected = $protected; Foreign = $foreign }
}

# Revert a merge on main and verify Pages served the reverted build (the change-specific string is gone
# and the page renders). Returns $true when the front end is back.
function Invoke-FrontendRevert {
    param([string]$MergeSha, [string]$AbsentString = '', [string]$ShotPath = '')
    $tip = Invoke-RevertOnMain -Repo $script:Clone -Sha $MergeSha
    if (-not (Wait-PagesRun -Sha $tip)) { Write-Log "Pages run for the revert $tip did not succeed" 'ERROR'; return $false }
    $v = Test-LiveSite -AbsentString $AbsentString -RepoForSmoke $script:Clone -ShotPath $ShotPath -TimeoutSec 600
    return [bool]$v.Ok
}

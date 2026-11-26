<#
.SYNOPSIS
  Local test gate for cardlens, run ONLY in the loop's clone. Last output line: TEST-GATE PASS|FAIL ...

.DESCRIPTION
  Steps (-Step, default 'all' = install, format, verify, build: the local gate. CI is the e2e gate for every
  change, so the loop does not run the Playwright suite locally; merge-pr.ps1 requires CI's Playwright E2E and
  v2 Visual Regression jobs green on the PR head):
    install  npm.cmd ci                                     (package-lock; never npm install, never --omit=dev)
             then `playwright install chromium` (no --with-deps on Windows) so the browser revision the
             installed @playwright/test wants is present after a Playwright bump (update-snapshots and a
             manual e2e need it); logs the revision; a failed download fails the gate
    format   npm.cmd run format                              (Prettier is enforced by CI; run after edits)
    verify   npm.cmd run verify                              (format:check, typecheck, lint, check:v2, unit tests)
    unit     npm.cmd exec -- vitest run <-UnitFilter>        (quick iteration on one test file)
    build    npm.cmd run build with the Pages env set IN POWERSHELL (VITE_BASE=/cardlens/; never Git Bash,
             which mangles it into /Program Files/Git/cardlens/), then dist\index.html must reference
             /cardlens/assets/index-*.js; with -ExpectString it must be in a built dist\assets\*.js or *.css,
             NOT already served by the live site (one pass over the live chunk graph), and the result is
             recorded in state\gate-build-<issue>.json with the front-end content's fingerprint: merge-pr.ps1
             merges only with a string this record verified for the PR head's exact front-end code.
             With -NoVisibleString "<reason>" instead (a change that only adds src/ modules nothing imports
             yet): the branch's diff against origin/main must pass live-check.ps1 Get-NoVisibleStringDecision
             (every front-end file new under src/, no shipped import.meta.glob) and none of the new modules
             may appear in the built source maps, i.e. the served bundle will not change
    e2e      Playwright (non-visual) on ALTERNATE ports with scratch data. As configured, the e2e webServer
             defaults to port 8787 with reuseExistingServer when !CI, i.e. the LIVE service and live data.
             This sets CI=1 (no server reuse), CL_E2E_PORT=5273, CL_E2E_API_PORT=8887, points every *_FILE /
             *_DIR at a scratch dir, sends RECOGNITION_URL / TARGET_BOT_URL to a dead port, refuses to run if
             either port is busy, and refuses if playwright.config.ts no longer sets the scratch paths.
             --workers=4 overrides CI=1's single worker (one worker took ~2 hours locally).
             MANUAL USE ONLY (not part of the loop's flow; LOOP.md does not call it). Start it in the background.
    all      install, format, verify, build

  The clone path is fixed (~\.innovation-loop-cardlens\clones\cardlens); D:\projects\cardlens and
  D:\services\cardlens are refused. No secrets are needed or read.

.EXIT CODES
  0 pass | 1 fail
#>
[CmdletBinding()]
param(
    [ValidateSet('install', 'format', 'verify', 'unit', 'build', 'e2e', 'all')][string]$Step = 'all',
    [string]$Issue = 'adhoc',
    [string]$UnitFilter = '',
    [string]$ExpectString = '',
    [string]$NoVisibleString = '',
    [string]$RepoPath = ''
)
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\live-check.ps1"   # Get-NoVisibleStringDecision, Find-ModulesInSourceMaps (same rule as deploy.ps1)
Start-ScriptLog "test-gate-$Issue-$Step"
. "$PSScriptRoot\resource-rules.ps1"   # BelowNormal for this process and what it starts (npm ci, verify, vite build)
if (-not (Set-LowPriority)) { Write-Log 'could not lower this process to BelowNormal; the gate runs at normal priority' 'WARN' }
if (-not $RepoPath) { $RepoPath = $script:Clone }
$failures = New-Object System.Collections.ArrayList
$null = Clear-SecretEnv

function Fail([string]$m) { [void]$failures.Add($m); Write-Log "FAIL: $m" 'ERROR' }

# Make sure the Chromium build that the INSTALLED @playwright/test expects is present (a Playwright bump in
# the lockfile needs a new browser revision, and the loop has no other way to fetch it). Windows: no
# --with-deps. Logs the revisions; returns '' or a failure message.
function Install-PlaywrightBrowser {
    param([string]$Dir)
    $bj = Join-Path $Dir 'node_modules\playwright-core\browsers.json'
    $want = @()
    if (Test-Path -LiteralPath $bj) {
        try { $want = @((Get-Content -LiteralPath $bj -Raw | ConvertFrom-Json).browsers | Where-Object { $_.name -in @('chromium', 'chromium-headless-shell') }) } catch { }
    }
    $pwVer = ''
    $pj = Join-Path $Dir 'node_modules\@playwright\test\package.json'
    if (Test-Path -LiteralPath $pj) { try { $pwVer = "$((Get-Content -LiteralPath $pj -Raw | ConvertFrom-Json).version)" } catch { } }
    Write-Log ("playwright {0}; wants {1}" -f $pwVer, (@($want | ForEach-Object { "$($_.name) r$($_.revision) ($($_.browserVersion))" }) -join ', '))
    $r = Invoke-Native -File $script:NpmCmd -Arguments @('exec', '--', 'playwright', 'install', 'chromium') -WorkDir $Dir -AllowFail -Quiet
    if ($r.Code -ne 0) { return ("npx playwright install chromium failed (exit $($r.Code)); the browser for @playwright/test $pwVer could not be downloaded: " + (($r.Output | Select-Object -Last 4) -join ' | ')) }
    $root = $env:PLAYWRIGHT_BROWSERS_PATH; if (-not $root -or $root -eq '0') { $root = Join-Path $env:LOCALAPPDATA 'ms-playwright' }
    foreach ($b in $want) {
        $dirName = '{0}-{1}' -f ($b.name -replace '-', '_'), $b.revision
        if (Test-Path -LiteralPath (Join-Path $root $dirName)) { Write-Log "browser present: $root\$dirName" }
        else { return "after playwright install, $root\$dirName is still missing (browser revision $($b.revision) for @playwright/test $pwVer)" }
    }
    return ''
}

function Test-PortFree {
    param([int]$Port)
    $l = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($l.Count -eq 0)
}

try {
    $full = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\')
    $loopRoot = (Join-Path $script:LoopHome 'clones').TrimEnd('\')
    if (-not $full.StartsWith($loopRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "refusing to test outside the loop's clones dir ($loopRoot): $full" }
    if (-not (Test-Path -LiteralPath (Join-Path $full 'package-lock.json'))) { throw "no package-lock.json in $full" }
} catch {
    Write-Output "TEST-GATE FAIL: $_"
    exit 1
}

$npm = $script:NpmCmd
$steps = if ($Step -eq 'all') { @('install', 'format', 'verify', 'build') } else { @($Step) }

foreach ($s in $steps) {
    if ($failures.Count -gt 0) { break }
    Write-Log "---- step $s ----"
    try {
        switch ($s) {
            'install' {
                $r = Invoke-Native -File $npm -Arguments @('ci', '--no-audit', '--no-fund') -WorkDir $full -AllowFail -Quiet
                if ($r.Code -ne 0) { Fail "npm ci failed (exit $($r.Code)); package.json and package-lock.json must agree (the loop cannot run npm install)"; break }
                $pw = Install-PlaywrightBrowser -Dir $full
                if ($pw) { Fail "playwright browser: $pw" }
            }
            'format' {
                $r = Invoke-Native -File $npm -Arguments @('run', 'format') -WorkDir $full -AllowFail -Quiet
                if ($r.Code -ne 0) { Fail "npm run format failed (exit $($r.Code))" }
            }
            'verify' {
                $r = Invoke-Native -File $npm -Arguments @('run', 'verify') -WorkDir $full -AllowFail -Quiet
                $tail = @($r.Output | Where-Object { $_ -match 'Tests\s+\d|Test Files|error|warn|Code style issues|problems?\)' } | Select-Object -Last 15)
                foreach ($t in $tail) { Write-Log "  $t" }
                if ($r.Code -ne 0) { Fail ("npm run verify failed (exit $($r.Code)): " + (($tail | Select-Object -Last 5) -join ' | ')) }
            }
            'unit' {
                if (-not $UnitFilter -or $UnitFilter -notmatch '^[A-Za-z0-9_./\\-]+$') { throw '-UnitFilter <path to a test file> is required (letters, digits, . / \ _ - only)' }
                $r = Invoke-Native -File $npm -Arguments @('exec', '--', 'vitest', 'run', $UnitFilter) -WorkDir $full -AllowFail -Quiet
                foreach ($t in @($r.Output | Select-Object -Last 25)) { Write-Log "  $t" }
                if ($r.Code -ne 0) { Fail "vitest run $UnitFilter failed (exit $($r.Code))" }
            }
            'build' {
                $env:VITE_BASE = '/cardlens/'
                $env:VITE_ENABLE_DEV_PANEL = 'false'
                $env:VITE_COMPANION_API_BASE_URL = 'https://server-pc.tail0e4194.ts.net:8443/api'
                $env:VITE_API_BASE_URL = 'https://server-pc.tail0e4194.ts.net:8443/api/catalog'
                Remove-Item env:VITE_USE_MOCKS -ErrorAction SilentlyContinue
                $r = Invoke-Native -File $npm -Arguments @('run', 'build') -WorkDir $full -AllowFail -Quiet
                if ($r.Code -ne 0) { Fail ("npm run build failed (exit $($r.Code)): " + (($r.Output | Select-Object -Last 8) -join ' | ')); break }
                $idx = Join-Path $full 'dist\index.html'
                if (-not (Test-Path -LiteralPath $idx)) { Fail 'dist\index.html missing'; break }
                $asset = Get-IndexAsset (Get-Content -LiteralPath $idx -Raw)
                if (-not $asset) { Fail 'dist\index.html does not reference /cardlens/assets/index-*.js (wrong VITE_BASE?)'; break }
                Write-Log "built entry: $asset"
                if ($ExpectString) {
                    # JS and CSS, like the live check (a layout-only change can be verified by a new CSS declaration
                    # as it appears minified in dist\assets\*.css)
                    $hit = Select-String -Path @((Join-Path $full 'dist\assets\*.js'), (Join-Path $full 'dist\assets\*.css')) -SimpleMatch -Pattern $ExpectString -List | Select-Object -First 1
                    if (-not $hit) { Fail "ExpectString not found in any dist\assets\*.js or *.css" } else { Write-Log "ExpectString found in $(Split-Path $hit.Path -Leaf)" }
                    # must be NEW: a string the live site already serves cannot prove the new build is live, and the
                    # rollback (string gone again) would end in PRODUCTION NEEDS VE (live-check.ps1 Test-StringServedNow)
                    $live = $null
                    if ($hit) {
                        $live = Test-StringServedNow -String $ExpectString
                        if ($live.Found) { Fail "ExpectString is already served by the live site ($($live.In)): choose a string only the new build contains" }
                        elseif ($live.Checked) { Write-Log "ExpectString is not served by the live site today: $($live.Why)" }
                        else { Write-Log "could not check whether the live site already serves the ExpectString: $($live.Why)" 'WARN' }
                    }
                    # merge-pr.ps1 merges only with a string this record verified for the PR head's exact front-end content
                    try {
                        $fp = Get-WorkingFrontFingerprint -Repo $full -TempIndex (Join-Path $script:LoopHome "work\gate-index-$Issue")
                        $servedNow = $null; $servedIn = ''
                        if ($live -and $live.Checked) { $servedNow = [bool]$live.Found; $servedIn = "$($live.In)" }
                        $foundIn = ''; if ($hit) { $foundIn = Split-Path $hit.Path -Leaf }
                        Save-State "gate-build-$Issue" @{ issue = "$Issue"; expectString = $ExpectString; found = [bool]$hit; foundIn = $foundIn
                            servedNow = $servedNow; servedIn = $servedIn; fingerprint = $fp
                            head = (Get-GitValue -Repo $full -Arguments @('rev-parse', 'HEAD')); utc = [DateTime]::UtcNow.ToString('o') }
                        Write-Log "recorded the deploy check for merge-pr.ps1 (state\gate-build-$Issue.json)"
                    } catch { Fail "could not record the verified ExpectString for merge-pr.ps1: $_" }
                }
                if ($NoVisibleString) {
                    if ($ExpectString) { Fail 'pass -ExpectString or -NoVisibleString, not both'; break }
                    if ($NoVisibleString.Trim().Length -lt 10) { Fail '-NoVisibleString needs a reason (why the change has no visible string)'; break }
                    $ns = @((Invoke-Git -Repo $full -Arguments @('diff', '--name-status', '--no-renames', 'origin/main...HEAD') -Quiet).Output)
                    $gg = Invoke-Git -Repo $full -Arguments @('grep', '-l', '-F', 'import.meta.glob', 'HEAD', '--', 'src') -AllowFail -Quiet
                    $globs = @($gg.Output | Where-Object { $_ } | ForEach-Object { "$_" -replace '^HEAD:', '' })
                    $nv = Get-NoVisibleStringDecision -NameStatus $ns -GlobFiles $globs
                    if (-not $nv.Ok) { Fail "-NoVisibleString refused (deploy.ps1 would refuse it too): $($nv.Why)"; break }
                    $maps = @(Get-ChildItem -LiteralPath (Join-Path $full 'dist\assets') -Filter '*.map' -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName) })
                    if ($maps.Count -eq 0) { Fail 'no source maps in dist\assets (build.sourcemap off?): cannot prove the new modules are not bundled'; break }
                    $in = @(Find-ModulesInSourceMaps -Modules $nv.Added -MapTexts $maps)
                    if ($in.Count -gt 0) { Fail "-NoVisibleString: these new modules ARE in the bundle, so the change is served: $($in -join ', '); give it a visible string (-ExpectString)" }
                    else { Write-Log "no visible string ($NoVisibleString): new module(s) $($nv.Added -join ', ') are not in any of $($maps.Count) source map(s); the served bundle will not change" }
                }
            }
            'e2e' {
                $cfg = Get-Content -LiteralPath (Join-Path $full 'playwright.config.ts') -Raw
                foreach ($need in 'COLLECTION_FILE: join(DATA', 'BINDERS_FILE: join(DATA', 'BINDER_IMAGES_DIR: join(DATA', 'SHARES_FILE: join(DATA', 'PRINTINGS_DIR: join(DATA', 'SEALED_DIR: join(DATA', 'process.env.CL_E2E_API_PORT') {
                    if (-not $cfg.Contains($need)) { throw "playwright.config.ts no longer contains '$need'; refusing to run e2e on the server that holds live data" }
                }
                $cfgCode = @($cfg -split "`n" | Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' }) -join "`n"   # the config's comments mention D:/services on purpose
                if ($cfgCode -match '(?i)D:[\\/]+services') { throw 'playwright.config.ts code mentions D:\services; refusing' }
                foreach ($p in 8887, 5273) { if (-not (Test-PortFree $p)) { throw "port $p is busy; refusing (a reused server could be the wrong one)" } }
                $scratch = Join-Path $script:LoopHome "scratch\e2e-$Issue"
                if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
                New-Item -ItemType Directory -Path $scratch | Out-Null
                $env:CI = '1'
                $env:CL_E2E_PORT = '5273'
                $env:CL_E2E_API_PORT = '8887'
                # Playwright's per-server env overrides these for the paths it names; the rest (and any the
                # config might lose) still land in scratch instead of falling back to D:/services/data.
                $env:COLLECTION_FILE = Join-Path $scratch 'collection.json'
                $env:BINDERS_FILE = Join-Path $scratch 'binders.json'
                $env:BINDER_IMAGES_DIR = Join-Path $scratch 'binder-images'
                $env:SHARES_FILE = Join-Path $scratch 'shares.json'
                $env:PRINTINGS_DIR = Join-Path $scratch 'printings'
                $env:SEALED_DIR = Join-Path $scratch 'sealed'
                $env:CATALOG_PRICES_DIR = Join-Path $scratch 'catalog-prices'   # not set by playwright.config.ts
                $env:RECOGNITION_URL = 'http://127.0.0.1:9'                     # never the live recogniser (CI has none either)
                $env:TARGET_BOT_URL = 'http://127.0.0.1:9'                      # never the real Target bot
                $env:PORT = '8887'
                $pw = Install-PlaywrightBrowser -Dir $full
                if ($pw) { Fail "playwright browser: $pw"; break }
                $r = Invoke-Native -File $npm -Arguments @('run', 'e2e', '--', '--reporter=line', '--workers=4') -WorkDir $full -AllowFail -Quiet
                $tail = @($r.Output | Where-Object { $_ -match '\d+ (passed|failed|flaky|skipped)|Error:|\[fail|failed' } | Select-Object -Last 20)
                foreach ($t in $tail) { Write-Log "  $t" }
                if ($r.Code -ne 0) { Fail ("e2e failed (exit $($r.Code)): " + (($tail | Select-Object -Last 6) -join ' | ')) }
                foreach ($p in 8887, 5273) {
                    foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) {
                        Write-Log "leftover listener on $p (pid $($c.OwningProcess)); stopping it" 'WARN'
                        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                    }
                }
            }
        }
    } catch { Fail "error in step ${s}: $_" }
}

if ($failures.Count -gt 0) {
    Write-Output ("TEST-GATE FAIL ($($steps -join ',')): " + ($failures -join ' | '))
    exit 1
}
Write-Output "TEST-GATE PASS ($($steps -join ','))"
exit 0

<#
.SYNOPSIS
  Local test gate for cardlens, run ONLY in the loop's clone. Last output line: TEST-GATE PASS|FAIL ...

.DESCRIPTION
  Steps (-Step, default 'all' = install, verify, build):
    install  npm.cmd ci                                     (package-lock; never npm install, never --omit=dev)
    format   npm.cmd run format                              (Prettier is enforced by CI; run after edits)
    verify   npm.cmd run verify                              (format:check, typecheck, lint, check:v2, unit tests)
    unit     npm.cmd exec -- vitest run <-UnitFilter>        (quick iteration on one test file)
    build    npm.cmd run build with the Pages env set IN POWERSHELL (VITE_BASE=/cardlens/; never Git Bash,
             which mangles it into /Program Files/Git/cardlens/), then dist\index.html must reference
             /cardlens/assets/index-*.js; with -ExpectString it must be in a built dist\assets\*.js
    e2e      Playwright (non-visual) on ALTERNATE ports with scratch data. As configured, the e2e webServer
             defaults to port 8787 with reuseExistingServer when !CI, i.e. the LIVE service and live data.
             This sets CI=1 (no server reuse), CL_E2E_PORT=5273, CL_E2E_API_PORT=8887, points every *_FILE /
             *_DIR at a scratch dir, sends RECOGNITION_URL / TARGET_BOT_URL to a dead port, refuses to run if
             either port is busy, and refuses if playwright.config.ts no longer sets the scratch paths.
             --workers=4 overrides CI=1's single worker (one worker took ~2 hours locally).
             Start it in the background.
    all      install, verify, build

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
    [string]$RepoPath = ''
)
. "$PSScriptRoot\lib.ps1"
Start-ScriptLog "test-gate-$Issue-$Step"
if (-not $RepoPath) { $RepoPath = $script:Clone }
$failures = New-Object System.Collections.ArrayList
$null = Clear-SecretEnv

function Fail([string]$m) { [void]$failures.Add($m); Write-Log "FAIL: $m" 'ERROR' }

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
$steps = if ($Step -eq 'all') { @('install', 'verify', 'build') } else { @($Step) }

foreach ($s in $steps) {
    if ($failures.Count -gt 0) { break }
    Write-Log "---- step $s ----"
    try {
        switch ($s) {
            'install' {
                $r = Invoke-Native -File $npm -Arguments @('ci', '--no-audit', '--no-fund') -WorkDir $full -AllowFail -Quiet
                if ($r.Code -ne 0) { Fail "npm ci failed (exit $($r.Code)); package.json and package-lock.json must agree (the loop cannot run npm install)" }
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
                    $hit = Select-String -Path (Join-Path $full 'dist\assets\*.js') -SimpleMatch -Pattern $ExpectString -List | Select-Object -First 1
                    if (-not $hit) { Fail "ExpectString not found in any dist\assets\*.js" } else { Write-Log "ExpectString found in $(Split-Path $hit.Path -Leaf)" }
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
                $browsers = Join-Path $env:LOCALAPPDATA 'ms-playwright'
                if (-not (Get-ChildItem -LiteralPath $browsers -Directory -Filter 'chromium*' -ErrorAction SilentlyContinue)) {
                    Invoke-Native -File $npm -Arguments @('exec', '--', 'playwright', 'install', 'chromium') -WorkDir $full -Quiet | Out-Null
                }
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

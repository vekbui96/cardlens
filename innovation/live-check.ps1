# Live front-end check for the cardlens innovation loop (NON-elevated side only).
# Dot-source it AFTER lib.ps1:  . "$PSScriptRoot\lib.ps1"; . "$PSScriptRoot\live-check.ps1"
# PowerShell 5.1 compatible.
#
# Why a separate file: lib.ps1 is one of the elevated side's files (install-task.ps1 copies it into
# C:\ProgramData\innovation-loop-cardlens\bin) and any change to it makes that copy stale, which turns
# SERVER_DEPLOY off until Ve re-runs install-task.ps1 -ElevatedOnly. The elevated side never checks the
# live front end, so this lives here instead (the same reason gate-rules.ps1 exists).
#
# The Test-LiveSite defined below REPLACES the older one-level version still in lib.ps1 (a later function
# definition wins in PowerShell; lib.ps1's Invoke-FrontendRevert resolves Test-LiveSite at call time, so it
# gets this one too). Every script that calls Test-LiveSite or Invoke-FrontendRevert (deploy.ps1,
# rollback.ps1) must dot-source this file; test-live-check.ps1 checks that. The lib.ps1 copy can be
# deleted the next time lib.ps1 changes for another reason.
#
# The bug this fixes: the old check searched index.html's assets plus only the chunks the ENTRY names.
# Vite nests dynamic imports (entry -> V2App-*.js -> index-*.js, the v2 Home screen), so a string in a
# grandchild chunk was never searched: #85, #94, #96 and #102 went live, were not found, and were rolled
# back although the change was really served.

$script:LiveChunkCap = 400   # the live graph is ~120 files (Nov 2026); beyond the cap the check fails closed
# Chunk references inside a JS chunk or the entry: "./x-hash.js" imports, "assets/x-hash.js" in Vite's
# __vite__mapDeps lists, and absolute "/cardlens/assets/x-hash.css" names. Same pattern the one-level
# check used.
$script:ChunkRefPattern = '(?:\./|/cardlens/assets/|assets/)?([A-Za-z0-9_\-\.]+-[A-Za-z0-9_\-]{6,}\.(?:js|css))'

function Get-ChunkRefs {
    param([string]$Body)
    if (-not $Body) { return @() }
    return @([regex]::Matches($Body, $script:ChunkRefPattern) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
}

# Breadth-first walk of the chunk graph from the root asset names (index.html's assets, entry first is not
# required). Pure apart from the fetcher, so it is unit-tested without HTTP.
#   -Fetch      scriptblock: param([string]$Name) -> @{ Status = <int>; Body = <string> }, called once per file
#   -Preloaded  name -> already fetched response (the entry), not fetched again
# Every file reached is fetched once (de-duplicated, cycles are fine); every fetched .js body is parsed for
# further references; CSS is searched but not parsed. A file that does not return 200 counts as
# unreachable. If more than -MaxFiles names are discovered the walk stops and Capped is set (the caller
# fails: an unvisited file could hold the AbsentString or be missing).
# Returns Files (visited, BFS order), Depth (name -> depth, roots 0), Unreachable, Found, FoundIn,
# FoundDepth, AbsentHit (first file containing AbsentString), Capped, MaxDepth.
function Find-InChunkGraph {
    param([string[]]$Roots, [scriptblock]$Fetch, [hashtable]$Preloaded = @{},
          [string]$ExpectString = '', [string]$AbsentString = '', [int]$MaxFiles = $script:LiveChunkCap)
    $depth = @{}
    $order = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $capped = $false
    foreach ($r in @($Roots)) {
        if (-not $r -or $depth.ContainsKey($r)) { continue }
        $depth[$r] = 0; $queue.Enqueue($r)
    }
    $res = [ordered]@{ Files = @(); Depth = $depth; Unreachable = @(); Found = $false; FoundIn = ''; FoundDepth = -1; AbsentHit = ''; Capped = $false; MaxDepth = 0 }
    $unreachable = New-Object System.Collections.ArrayList
    while ($queue.Count -gt 0) {
        $name = [string]$queue.Dequeue()
        [void]$order.Add($name)
        $resp = if ($Preloaded.ContainsKey($name)) { $Preloaded[$name] } else { & $Fetch $name }
        if (-not $resp -or [int]$resp.Status -ne 200) { [void]$unreachable.Add($name); continue }
        $body = [string]$resp.Body
        if ($depth[$name] -gt $res.MaxDepth) { $res.MaxDepth = $depth[$name] }
        if ($ExpectString -and -not $res.Found -and $body.Contains($ExpectString)) { $res.Found = $true; $res.FoundIn = $name; $res.FoundDepth = $depth[$name] }
        if ($AbsentString -and -not $res.AbsentHit -and $body.Contains($AbsentString)) { $res.AbsentHit = $name }
        if ($name -notlike '*.js') { continue }
        foreach ($c in (Get-ChunkRefs $body)) {
            if ($depth.ContainsKey($c)) { continue }
            if ($depth.Count -ge $MaxFiles) { $capped = $true; break }
            $depth[$c] = $depth[$name] + 1
            $queue.Enqueue($c)
        }
        if ($capped) { break }
    }
    $res.Files = @($order)
    $res.Unreachable = @($unreachable)
    $res.Capped = $capped
    return [pscustomobject]$res
}

# Served-bytes check of the live front end:
#  - cache-busted index.html references /cardlens/assets/index-*.js; with -NotSignature, its asset set must
#    differ from that one (the previous build), i.e. the new build is what is being served
#  - every file reachable from index.html (its assets, then every chunk any fetched JS chunk names, at any
#    depth; Find-InChunkGraph) returns 200; -ExpectString must be in one of them (screens are code-split and
#    nested: the entry alone is a false negative; CSS is searched too) and -AbsentString in none
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
                $prefix = '/cardlens/assets/'
                $roots = @(Get-IndexAssetSet $page.Body | ForEach-Object { $_.Substring($prefix.Length) })
                $entryName = $asset.Substring($prefix.Length)
                $fetch = { param([string]$Name) Invoke-Http -Url ($script:SiteUrl + 'assets/' + $Name) }
                $g = Find-InChunkGraph -Roots $roots -Fetch $fetch -Preloaded @{ $entryName = $entry } -ExpectString $ExpectString -AbsentString $AbsentString
                $bad = @($g.Unreachable).Count
                Write-Log ("live entry={0} files={1} maxDepth={2} unreachable={3}{4} expect={5}{6} absentHit={7}{8}" -f $asset, @($g.Files).Count, $g.MaxDepth, $bad,
                    $(if ($bad) { ' (' + ((@($g.Unreachable) | Select-Object -First 5) -join ', ') + ')' } else { '' }),
                    $g.Found, $(if ($g.FoundIn) { " ($($g.FoundIn), depth $($g.FoundDepth))" } else { '' }), $g.AbsentHit,
                    $(if ($g.Capped) { " CAPPED at $($script:LiveChunkCap) files" } else { '' }))
                if (((-not $ExpectString) -or $g.Found) -and (-not $g.AbsentHit) -and $bad -eq 0 -and -not $g.Capped) {
                    if (-not $RepoForSmoke) { return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    $smokeArgs = @("$PSScriptRoot\smoke.mjs", $RepoForSmoke, (Get-CacheBustedUrl $script:SiteUrl))
                    if ($ShotPath) { $smokeArgs += $ShotPath }
                    $s = Invoke-Native -File $script:NodeExe -Arguments $smokeArgs -AllowFail
                    if ($s.Code -eq 0) { return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    if ($s.Code -eq 2) { Write-Log 'render check could not run (no playwright-core or browser, or unverified (busy): the shared browser slot was taken or memory was low, browser-lock.mjs); served-bytes checks passed' 'WARN'; return @{ Ok = $true; Asset = $asset; Signature = $sig } }
                    $last = 'render check failed: ' + ($s.Output -join ' ')
                } elseif ($g.Capped) { $last = "chunk graph exceeds $($script:LiveChunkCap) files (raise `$script:LiveChunkCap in live-check.ps1 deliberately)" }
                else { $last = 'string/file checks not passing' }
            }
        }
        Write-Log "live check not yet passing: $last"
        Start-Sleep -Seconds 20
    }
    Write-Log "live site verification failed: $last" 'ERROR'
    return @{ Ok = $false; Asset = $null; Signature = $null }
}

# ---- "no visible string" changes --------------------------------------------------------------------
# A front-end change normally proves it is live by a string only the new build contains (-ExpectString).
# A change that only ADDS modules nothing imports yet (a model or utility for a later slice, with its unit
# tests) has no such string: Vite tree-shakes it out, so the served build is byte-identical and no string
# can ever be found (#145 was rolled back for exactly that). For those, deploy.ps1 / test-gate.ps1 accept
# -NoVisibleString "<reason>" instead, but ONLY when this rule proves from git that the served bundle cannot
# change: every front-end file the change touches is NEW (status A), under src/, and no shipped (non-test)
# src/ file uses import.meta.glob (which could pull a new file in without an import). Any modified,
# deleted or renamed front-end file, anything in public/, index.html or vite.config.ts means the change can
# alter what users see, and then a visible string stays mandatory. The live check for these changes is the
# deploy-pages run of THIS sha succeeding, every served chunk loading, the headless render and (server
# changes) /api/health; test-gate.ps1 also checks the new modules are absent from the built source maps.

# Same classification deploy.ps1 has always used for "changes the front end".
function Test-FrontFile {
    param([string]$Path)
    return ($Path -match '^(src/|public/|index\.html$|vite\.config\.ts$)' -and $Path -notmatch '\.test\.tsx?$|/__tests__/|/test/')
}

# -NameStatus  lines of `git diff --name-status --no-renames <base> <head>` ("A`tsrc/x.ts")
# -GlobFiles   paths (repo-relative) of src/ files containing import.meta.glob at the head
# Returns Ok, Why, Added (the new front-end modules, for the source-map check and the log).
function Get-NoVisibleStringDecision {
    param([string[]]$NameStatus = @(), [string[]]$GlobFiles = @())
    $added = New-Object System.Collections.ArrayList
    $bad = New-Object System.Collections.ArrayList
    foreach ($line in @($NameStatus)) {
        if (-not $line -or -not $line.Trim()) { continue }
        $parts = $line.Trim() -split "`t"
        if ($parts.Count -lt 2) { [void]$bad.Add("unparsed diff line '$line'"); continue }
        $st = $parts[0].Substring(0, 1).ToUpperInvariant(); $p = $parts[$parts.Count - 1]
        if ($parts.Count -gt 2 -or $st -in @('R', 'C')) { foreach ($q in $parts[1..($parts.Count - 1)]) { if (Test-FrontFile $q) { [void]$bad.Add("$st $q") } }; continue }
        if (-not (Test-FrontFile $p)) { continue }
        if ($st -ne 'A') { [void]$bad.Add("$st $p"); continue }
        if ($p -notlike 'src/*') { [void]$bad.Add("A $p (served as is)"); continue }
        [void]$added.Add($p)
    }
    $globs = @($GlobFiles | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } | Where-Object { Test-FrontFile $_ })
    $why = ''
    if ($bad.Count -gt 0) { $why = "the change modifies front-end files that ship ($((@($bad) | Select-Object -First 5) -join ', ')); it can change what users see, so pass -ExpectString" }
    elseif ($globs.Count -gt 0) { $why = "shipped src/ files use import.meta.glob ($($globs -join ', ')), which can bundle a new file without an import; pass -ExpectString" }
    elseif ($added.Count -eq 0) { $why = 'the change adds no front-end module; -NoVisibleString is not needed (omit both)' }
    return [pscustomobject]@{ Ok = ($why -eq ''); Why = $why; Added = @($added) }
}

# The source-map check for a built dist\assets (test-gate.ps1): returns the new modules that DID end up in
# the bundle (a path in some *.map "sources" list). Pure apart from reading the given map texts.
function Find-ModulesInSourceMaps {
    param([string[]]$Modules = @(), [string[]]$MapTexts = @())
    $hits = @()
    foreach ($m in @($Modules)) {
        foreach ($t in @($MapTexts)) { if ($t -and $t.Contains($m + [char]34)) { $hits += $m; break } }   # ".../src/x.ts" in "sources"
    }
    return @($hits)
}

# ---- the deploy check, decided BEFORE the merge ------------------------------------------------------
# Merging is a Pages deploy, and deploy.ps1 only learns after the merge whether the session's deploy check
# can work at all. When it cannot (no -ExpectString for a change that ships, a -NoVisibleString the rule
# refuses, a string the new build does not contain), the merge is reverted on main: #145, #320 and #327
# were working builds rolled back that way, and #294 merged a string the live check never found. So
# test-gate.ps1 records the string it verified in the build (state\gate-build-<n>.json, tied to the exact
# front-end content by the fingerprint below), and merge-pr.ps1 refuses to merge unless the deploy check
# it is given would pass (Get-DeployCheckDecision). deploy.ps1 then uses the check merge-pr.ps1 recorded.

# The paths whose content decides the served bundle (Test-FrontFile's set plus package.json and the lockfile).
$script:FrontFingerprintPaths = @('src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json')

# -LsTree: lines of `git ls-tree <tree> -- <FrontFingerprintPaths>` ("<mode> <type> <sha>`t<path>").
# Returns one string, "<path>=<sha>;..." sorted by path: equal strings mean equal front-end content.
function Format-FrontFingerprint {
    param([string[]]$LsTree = @())
    $parts = @(@($LsTree) | Where-Object { $_ -and $_.Trim() } | ForEach-Object {
            $t = "$_" -split "`t", 2
            if ($t.Count -eq 2) {
                $f = @($t[0].Trim() -split '\s+')
                if ($f.Count -ge 3) { '{0}={1}' -f $t[1].Trim(), $f[2] }
            }
        } | Where-Object { $_ } | Sort-Object)
    return ($parts -join ';')
}

# The front-end fingerprint of a commit or tree in -Repo (merge-pr.ps1: the PR head).
function Get-FrontFingerprint {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Treeish)
    $r = Invoke-Git -Repo $Repo -Arguments (@('ls-tree', $Treeish, '--') + $script:FrontFingerprintPaths) -Quiet
    return (Format-FrontFingerprint -LsTree @($r.Output))
}

# The same fingerprint for the WORKING TREE of -Repo (test-gate.ps1: what was just built), committed or not.
# A throwaway index (GIT_INDEX_FILE) keeps the clone's own index and files untouched.
function Get-WorkingFrontFingerprint {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$TempIndex)
    $saved = $env:GIT_INDEX_FILE
    try {
        if (Test-Path -LiteralPath $TempIndex) { Remove-Item -LiteralPath $TempIndex -Force }
        $env:GIT_INDEX_FILE = $TempIndex
        Invoke-Git -Repo $Repo -Arguments @('read-tree', 'HEAD') -Quiet | Out-Null
        $present = @($script:FrontFingerprintPaths | Where-Object { Test-Path -LiteralPath (Join-Path $Repo $_) })
        if ($present.Count -gt 0) { Invoke-Git -Repo $Repo -Arguments (@('add', '-A', '--') + $present) -Quiet | Out-Null }
        $tree = Get-GitValue -Repo $Repo -Arguments @('write-tree')
    } finally {
        if ($null -eq $saved) { Remove-Item -LiteralPath 'env:GIT_INDEX_FILE' -ErrorAction SilentlyContinue } else { $env:GIT_INDEX_FILE = $saved }
        Remove-Item -LiteralPath $TempIndex -Force -ErrorAction SilentlyContinue
    }
    return (Get-FrontFingerprint -Repo $Repo -Treeish $tree)
}

# One pass over the LIVE site's chunk graph (no waiting, no render): is -String served today? test-gate.ps1
# refuses an -ExpectString the live build already contains: it cannot prove the new build is live, and the
# rollback (which checks the string is gone again) would end in PRODUCTION NEEDS VE after reverting.
# Returns Checked (the walk completed), Found, In, Why.
function Test-StringServedNow {
    param([Parameter(Mandatory)][string]$String)
    try {
        $page = Invoke-Http -Url (Get-CacheBustedUrl $script:SiteUrl)
        $asset = Get-IndexAsset $page.Body
        if ($page.Status -ne 200 -or -not $asset) { return [pscustomobject]@{ Checked = $false; Found = $false; In = ''; Why = "live index.html status=$($page.Status) entry=$asset" } }
        $prefix = '/cardlens/assets/'
        $roots = @(Get-IndexAssetSet $page.Body | ForEach-Object { $_.Substring($prefix.Length) })
        $fetch = { param([string]$Name) Invoke-Http -Url ($script:SiteUrl + 'assets/' + $Name) }
        $g = Find-InChunkGraph -Roots $roots -Fetch $fetch -ExpectString $String
        if ($g.Found) { return [pscustomobject]@{ Checked = $true; Found = $true; In = $g.FoundIn; Why = "served today in $($g.FoundIn)" } }
        if (@($g.Unreachable).Count -gt 0 -or $g.Capped) { return [pscustomobject]@{ Checked = $false; Found = $false; In = ''; Why = "live walk incomplete (unreachable $(@($g.Unreachable).Count), capped $($g.Capped))" } }
        return [pscustomobject]@{ Checked = $true; Found = $false; In = ''; Why = "not served today ($(@($g.Files).Count) live files searched)" }
    } catch {
        return [pscustomobject]@{ Checked = $false; Found = $false; In = ''; Why = "live check error: $_" }
    }
}

# merge-pr.ps1's pre-merge rule. Pure.
#   -FrontFiles      the PR's files that ship (Test-FrontFile)
#   -ExpectString / -NoVisibleString   what the session will pass to deploy.ps1
#   -NoVisible       Get-NoVisibleStringDecision for the PR's diff (read only with -NoVisibleString)
#   -GateRecord      state\gate-build-<n>.json written by test-gate.ps1, or $null
#   -Fingerprint     Get-FrontFingerprint of the PR head
# Returns Ok, Mode (none | expect | novisible), Why.
function Get-DeployCheckDecision {
    param([string[]]$FrontFiles = @(), [string]$ExpectString = '', [string]$NoVisibleString = '',
          $NoVisible = $null, $GateRecord = $null, [string]$Fingerprint = '')
    $mk = { param([bool]$Ok, [string]$Mode, [string]$Why) [pscustomobject]@{ Ok = $Ok; Mode = $Mode; Why = $Why } }
    $front = @($FrontFiles | Where-Object { $_ })
    if ($ExpectString -and $NoVisibleString) { return (& $mk $false '' 'pass -ExpectString or -NoVisibleString, not both') }
    if ($front.Count -eq 0) { return (& $mk $true 'none' 'the PR changes no front-end file that ships: deploy.ps1 needs no string') }
    $list = (@($front) | Select-Object -First 5) -join ', '
    if ($NoVisibleString) {
        if ($NoVisibleString.Trim().Length -lt 10) { return (& $mk $false 'novisible' '-NoVisibleString needs a reason (why the change has no visible string)') }
        if ($null -eq $NoVisible) { return (& $mk $false 'novisible' 'the no-visible-string rule could not be evaluated (fail closed)') }
        if (-not $NoVisible.Ok) { return (& $mk $false 'novisible' "-NoVisibleString would be refused by deploy.ps1: $($NoVisible.Why)") }
        return (& $mk $true 'novisible' "no visible string: the PR only adds unreferenced src/ module(s) $(@($NoVisible.Added) -join ', ')")
    }
    if (-not $ExpectString) {
        return (& $mk $false '' "the PR changes front-end files that ship ($list): pass the -ExpectString you will give deploy.ps1 (a string only the new build contains, verified by test-gate.ps1 -Step build -ExpectString on this code), or -NoVisibleString '<reason>' if it only adds src/ modules nothing imports yet")
    }
    $fix = "run test-gate.ps1 -Issue <n> -Step build -ExpectString '<string>' on the PR's final code, then call merge-pr.ps1 again with the same string"
    if ($null -eq $GateRecord) { return (& $mk $false 'expect' "no test-gate build record for this issue: $fix") }
    if ("$($GateRecord.expectString)" -cne $ExpectString) { return (& $mk $false 'expect' "test-gate verified a different string ('$($GateRecord.expectString)'): $fix") }
    if (-not $Fingerprint -or "$($GateRecord.fingerprint)" -ne $Fingerprint) { return (& $mk $false 'expect' "the test-gate build that checked the string was of different front-end code than the PR head: $fix") }
    if ($GateRecord.found -ne $true) { return (& $mk $false 'expect' "the string is not in the built dist\assets (*.js, *.css): choose a string your change adds to the build, then $fix") }
    if ($GateRecord.servedNow -eq $true) { return (& $mk $false 'expect' "the live site already serves this string ($($GateRecord.servedIn)), so it cannot prove the new build is live: choose one only the new build contains, then $fix") }
    $live = ' (the live site could not be checked)'; if ($GateRecord.servedNow -eq $false) { $live = ' and not served today' }
    return (& $mk $true 'expect' "the string is in the build of this exact front-end code$live")
}

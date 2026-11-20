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
                    if ($s.Code -eq 2) { Write-Log 'render check could not run (no playwright-core or browser); served-bytes checks passed' 'WARN'; return @{ Ok = $true; Asset = $asset; Signature = $sig } }
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

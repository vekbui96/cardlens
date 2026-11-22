<#
.SYNOPSIS
  Unit tests for live-check.ps1: the chunk-graph walk the live front-end check searches (Find-InChunkGraph)
  and Test-LiveSite on top of it, against a fake site. No network, no git.

  powershell -ExecutionPolicy Bypass -File innovation\test-live-check.ps1
#>
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\live-check.ps1"
$script:fail = 0; $script:pass = 0
function Check { param([bool]$Cond, [string]$What) if ($Cond) { $script:pass++ } else { $script:fail++; Write-Host "FAIL: $What" } }

# ---- a fake Vite build: entry -> V2App (lazy) -> home index chunk (lazy, nested) -> movers panel ---------
$pad = 'x' * 1200   # the entry must be >= 1000 bytes for Test-LiveSite
$site = @{
    'index-ENTRY111.js'   = @{ Status = 200; Body = "const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[`"assets/V2App-AAAAAA11.js`",`"assets/Workshop-CCCCCC33.css`"])))=>i.map(i=>d[i]);import{a}from`"./vendor-VVVVVV11.js`";const V=lazy(()=>import(`"./V2App-AAAAAA11.js`"));$pad" }
    'vendor-VVVVVV11.js'  = @{ Status = 200; Body = 'export const a=1;' }
    'index-STYLE111.css'  = @{ Status = 200; Body = '.root{color:red}' }
    'Workshop-CCCCCC33.css' = @{ Status = 200; Body = '.w{}' }
    # child: names the grandchild in both forms Vite emits (a mapDeps entry and the import itself)
    'V2App-AAAAAA11.js'   = @{ Status = 200; Body = 'const m=["assets/index-HOME0011.js"];const H=lazy(()=>import("./index-HOME0011.js"));' }
    # grandchild: imports back up (cycle) and a great-grandchild
    'index-HOME0011.js'   = @{ Status = 200; Body = 'import"./V2App-AAAAAA11.js";import{P}from"./MoversPanel-MMMMMM11.js";h1("Your collection")' }
    'MoversPanel-MMMMMM11.js' = @{ Status = 200; Body = 'export const P=()=>Panel({title:"Biggest movers"});' }
}
$roots = @('index-ENTRY111.js', 'index-STYLE111.css', 'vendor-VVVVVV11.js')
$script:fetched = New-Object System.Collections.ArrayList
$fetch = { param([string]$Name) [void]$script:fetched.Add($Name); if ($site.ContainsKey($Name)) { $site[$Name] } else { @{ Status = 404; Body = 'Not Found' } } }

# 1. string only in the great-grandchild (depth 3): found, nothing unreachable
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -ExpectString 'Biggest movers'
Check $g.Found 'nested string (depth 3) is found'
Check ($g.FoundIn -eq 'MoversPanel-MMMMMM11.js') "found in the movers chunk (got '$($g.FoundIn)')"
Check ($g.FoundDepth -eq 3) "found at depth 3 (got $($g.FoundDepth))"
Check (@($g.Unreachable).Count -eq 0) "nothing unreachable (got $(@($g.Unreachable) -join ','))"
Check (@($g.Files).Count -eq 7) "every reachable file visited once (got $(@($g.Files).Count): $(@($g.Files) -join ','))"
Check (@($script:fetched | Group-Object | Where-Object { $_.Count -gt 1 }).Count -eq 0) 'no file fetched twice (cycle V2App <-> home is de-duplicated)'
Check (-not $g.Capped) 'not capped'
Check ($g.MaxDepth -eq 3) "maxDepth 3 (got $($g.MaxDepth))"

# 1b. the old one-level walk (index assets + what the entry names) would NOT have searched the grandchild
$old = @($roots) + @(Get-ChunkRefs $site['index-ENTRY111.js'].Body)
Check (-not ($old -contains 'index-HOME0011.js')) 'regression: the one-level set misses the grandchild chunk'
Check (-not ($old -contains 'MoversPanel-MMMMMM11.js')) 'regression: the one-level set misses the great-grandchild chunk'
Check ((@($old | Where-Object { $site.ContainsKey($_) -and $site[$_].Body.Contains('Biggest movers') })).Count -eq 0) 'regression: the one-level set does not contain the string'

# 2. the string is in a CSS file reached from a JS chunk: CSS is searched
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -ExpectString '.w{}'
Check ($g.Found -and $g.FoundIn -eq 'Workshop-CCCCCC33.css') 'CSS named by a chunk is searched'

# 3. string nowhere: not found
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -ExpectString 'Nope not here'
Check (-not $g.Found) 'missing string is not found'

# 4. AbsentString in a nested chunk is a hit (rollback verification must see it)
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -AbsentString 'Biggest movers'
Check ($g.AbsentHit -eq 'MoversPanel-MMMMMM11.js') "absent string in a nested chunk is reported (got '$($g.AbsentHit)')"

# 5. an unreachable NESTED chunk counts as unreachable
$site['index-HOME0011.js'] = @{ Status = 200; Body = 'import"./Gone-GGGGGG11.js";import{P}from"./MoversPanel-MMMMMM11.js";' }
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -ExpectString 'Biggest movers'
Check (@($g.Unreachable) -contains 'Gone-GGGGGG11.js') "unreachable grandchild is reported (got $(@($g.Unreachable) -join ','))"
Check $g.Found 'the string is still found elsewhere (the caller fails on unreachable anyway)'

# 6. preloaded entry is not fetched again
$script:fetched.Clear()
$g = Find-InChunkGraph -Roots $roots -Fetch $fetch -Preloaded @{ 'index-ENTRY111.js' = $site['index-ENTRY111.js'] }
Check (-not ($script:fetched -contains 'index-ENTRY111.js')) 'preloaded entry is not refetched'

# 7. cap: a long chain stops at MaxFiles and says so
$chain = @{}
for ($i = 0; $i -lt 30; $i++) { $chain["c$i-HASHHASH.js"] = @{ Status = 200; Body = "import`"./c$($i + 1)-HASHHASH.js`";" } }
$g = Find-InChunkGraph -Roots @('c0-HASHHASH.js') -Fetch { param($n) if ($chain.ContainsKey($n)) { $chain[$n] } else { @{ Status = 404; Body = '' } } } -MaxFiles 10
Check $g.Capped 'a graph larger than MaxFiles is capped'
Check (@($g.Files).Count -le 10) "capped walk visits at most MaxFiles (got $(@($g.Files).Count))"

# 8. a 404 body is not parsed for references
$g = Find-InChunkGraph -Roots @('a-AAAAAAAA.js') -Fetch { param($n) if ($n -eq 'a-AAAAAAAA.js') { @{ Status = 404; Body = 'import"./b-BBBBBBBB.js"' } } else { @{ Status = 200; Body = '' } } }
Check (@($g.Files).Count -eq 1 -and @($g.Unreachable).Count -eq 1) 'a 404 response is unreachable and not walked'

# ---- Test-LiveSite end to end against the fake site (HTTP, logging and sleeping stubbed) ----------------
$site['index-HOME0011.js'] = @{ Status = 200; Body = 'import"./V2App-AAAAAA11.js";import{P}from"./MoversPanel-MMMMMM11.js";' }
$script:indexHtml = '<html><head><script type="module" crossorigin src="/cardlens/assets/index-ENTRY111.js"></script><link rel="modulepreload" crossorigin href="/cardlens/assets/vendor-VVVVVV11.js"><link rel="stylesheet" crossorigin href="/cardlens/assets/index-STYLE111.css"></head><body><div id="root"></div></body></html>'
function Invoke-Http {
    param([string]$Url, [string]$Method = 'GET', [int]$TimeoutSec = 30)
    if ($Url -like 'https://vekbui96.github.io/cardlens/?cb=*') { return @{ Status = 200; Body = $script:indexHtml } }
    $n = $Url -replace '^https://vekbui96\.github\.io/cardlens/assets/', ''
    if ($site.ContainsKey($n)) { return $site[$n] }
    return @{ Status = 404; Body = 'Not Found' }
}
$script:logLines = New-Object System.Collections.ArrayList
function Write-Log { param([string]$Message, [string]$Level = 'INFO') [void]$script:logLines.Add("[$Level] $Message") }
function Start-Sleep { param([int]$Seconds) }

$v = Test-LiveSite -ExpectString 'Biggest movers' -TimeoutSec 5
Check ([bool]$v.Ok) "Test-LiveSite passes when the string is only in a nested chunk ($($script:logLines -join ' | '))"
Check ($v.Asset -eq '/cardlens/assets/index-ENTRY111.js') 'Test-LiveSite reports the entry'
Check (@($script:logLines | Where-Object { $_ -match 'files=7 maxDepth=3 unreachable=0 expect=True \(MoversPanel-MMMMMM11\.js, depth 3\)' }).Count -ge 1) "log line names the file and depth ($($script:logLines[0]))"

$script:logLines.Clear()
$v = Test-LiveSite -AbsentString 'Biggest movers' -TimeoutSec 1
Check (-not $v.Ok) 'Test-LiveSite fails when the AbsentString is in a nested chunk'

$site['index-HOME0011.js'] = @{ Status = 200; Body = 'import"./Gone-GGGGGG11.js";import{P}from"./MoversPanel-MMMMMM11.js";' }
$script:logLines.Clear()
$v = Test-LiveSite -ExpectString 'Biggest movers' -TimeoutSec 1
Check (-not $v.Ok) 'Test-LiveSite fails when a nested chunk is unreachable'
Check (@($script:logLines | Where-Object { $_ -match 'unreachable=1 \(Gone-GGGGGG11\.js\)' }).Count -ge 1) 'log line names the unreachable nested chunk'
$site['index-HOME0011.js'] = @{ Status = 200; Body = 'import"./V2App-AAAAAA11.js";import{P}from"./MoversPanel-MMMMMM11.js";' }

$v = Test-LiveSite -ExpectString 'Biggest movers' -NotSignature '/cardlens/assets/index-ENTRY111.js,/cardlens/assets/index-STYLE111.css,/cardlens/assets/vendor-VVVVVV11.js' -TimeoutSec 1
Check (-not $v.Ok) 'Test-LiveSite still refuses the previous build (NotSignature unchanged)'

# ---- "no visible string" rule (Get-NoVisibleStringDecision, Find-ModulesInSourceMaps) ------------------
$T = "`t"
# #145 exactly: a new model + its unit test, nothing else -> allowed, the model is the only shipped module
$d = Get-NoVisibleStringDecision -NameStatus @("A${T}src/v2/screens/wantlist/wantList.ts", "A${T}src/v2/screens/wantlist/wantList.test.ts")
Check $d.Ok "#145's diff (new model + its test) is a no-visible-string change ($($d.Why))"
Check ((@($d.Added) -join ',') -eq 'src/v2/screens/wantlist/wantList.ts') "only the model counts as a new module (got $(@($d.Added) -join ','))"
# plus inert non-front files (docs, innovation/, server tests) still fine
$d = Get-NoVisibleStringDecision -NameStatus @("A${T}src/lib/x.ts", "M${T}docs/notes.md", "M${T}src/v2/a.test.tsx", "M${T}src/test/setup.ts")
Check $d.Ok 'added module with modified docs and test files is allowed'
# anything that can change the served bundle keeps the string mandatory
foreach ($case in @(
        @("A${T}src/lib/x.ts", "M${T}src/v2/screens/home/Home.tsx"),   # the new module gets imported
        @("A${T}src/lib/x.ts", "D${T}src/lib/old.ts"),
        @("R100${T}src/lib/old.ts${T}src/lib/new.ts"),
        @("A${T}public/new-icon.svg"),
        @("M${T}index.html"),
        @("M${T}vite.config.ts"),
        @("M${T}src/lib/format.ts"),
        @("T${T}src/lib/link.ts"),
        @("garbage line"))) {
    $d = Get-NoVisibleStringDecision -NameStatus $case
    Check (-not $d.Ok) "refused: $($case -join ' | ') ($($d.Why))"
}
$d = Get-NoVisibleStringDecision -NameStatus @("A${T}src/lib/x.ts") -GlobFiles @('src/v2/registry.ts')
Check (-not $d.Ok) 'refused when a shipped file uses import.meta.glob (could bundle the new file)'
$d = Get-NoVisibleStringDecision -NameStatus @("A${T}src/lib/x.ts") -GlobFiles @('src/v2/providers.test.ts', 'src/v2/shell/installable.test.ts')
Check $d.Ok 'import.meta.glob in test files only does not block'
$d = Get-NoVisibleStringDecision -NameStatus @("M${T}server/index.ts", "A${T}src/lib/x.test.ts")
Check (-not $d.Ok) 'refused (not needed) when no front-end module is added'
$maps = @('{"version":3,"sources":["../../src/v2/screens/home/Home.tsx","../../src/lib/format.ts"]}', '{"sources":["../../node_modules/react/index.js"]}')
Check (@(Find-ModulesInSourceMaps -Modules @('src/v2/screens/wantlist/wantList.ts') -MapTexts $maps).Count -eq 0) 'tree-shaken module is absent from the source maps'
Check ((@(Find-ModulesInSourceMaps -Modules @('src/lib/format.ts', 'src/lib/x.ts') -MapTexts $maps) -join ',') -eq 'src/lib/format.ts') 'a bundled module is found in the source maps'
Check (@(Find-ModulesInSourceMaps -Modules @('src/v2/screens/home/Home.ts') -MapTexts $maps).Count -eq 0) 'Home.ts is not matched by Home.tsx (whole path)'
# deploy.ps1 wiring: the rule is applied before anything is verified, and only a string-less deploy drops the
# "build changed" requirement (a change WITH a visible string keeps -NotSignature)
$dp = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'deploy.ps1'))
Check ($dp.Contains('Get-NoVisibleStringDecision') -and $dp.IndexOf('Get-NoVisibleStringDecision') -lt $dp.IndexOf('# ---- 2. server')) 'deploy.ps1 applies the no-visible-string rule in its preconditions'
Check ($dp.Contains('if ($frontFiles.Count -gt 0 -and $ExpectString) { $notSig = $state.prevSignature }')) 'deploy.ps1 still requires a new build whenever a string is given'
$tg = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'test-gate.ps1'))
Check ($tg.Contains('Get-NoVisibleStringDecision') -and $tg.Contains('Find-ModulesInSourceMaps')) 'test-gate.ps1 checks the same rule plus the source maps'

# ---- wiring: every caller loads live-check.ps1 after lib.ps1, and it wins over the lib.ps1 copy ----------
foreach ($f in 'deploy.ps1', 'rollback.ps1') {
    $t = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $f))
    $iLib = $t.IndexOf('. "$PSScriptRoot\lib.ps1"'); $iLive = $t.IndexOf('. "$PSScriptRoot\live-check.ps1"')
    Check ($iLib -ge 0 -and $iLive -gt $iLib) "$f dot-sources live-check.ps1 after lib.ps1"
}
foreach ($f in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter *.ps1 | Where-Object { $_.Name -notin @('lib.ps1', 'live-check.ps1', 'test-live-check.ps1') })) {
    $t = [IO.File]::ReadAllText($f.FullName)
    if ($t -match '\b(Test-LiveSite|Invoke-FrontendRevert)\b') { Check ($t.Contains('. "$PSScriptRoot\live-check.ps1"')) "$($f.Name) calls the live check, so it must dot-source live-check.ps1" }
}
foreach ($f in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter *.ps1 | Where-Object { $script:ElevatedFiles -contains $_.Name })) {
    Check (-not ([IO.File]::ReadAllText($f.FullName)).Contains('live-check.ps1')) "elevated file $($f.Name) does not depend on live-check.ps1 (not copied by install-task.ps1)"
}

if ($script:fail -gt 0) { Write-Host "TEST-LIVE-CHECK FAIL ($script:fail failed, $script:pass passed)"; exit 1 }
Write-Host "TEST-LIVE-CHECK PASS ($script:pass checks)"

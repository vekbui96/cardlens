<#
.SYNOPSIS
  The preview QA session's browser (LOOP.md section 14): open a PR PREVIEW at 390px and/or 1440px, run a few
  steps (goto, click, fill, press, wait, waitFor, expectText, scroll, shot), save screenshots and a result.json.

    <SCRIPTS>\preview-browse.ps1 -Url "https://server-pc.tail0e4194.ts.net:8460/?v=2&seed=collection#/wantlist" -Steps "<WORK>\steps-ac1.json" -Out "<ARTIFACTS>\qa\<run>-<issue>-p1\ac1"

.DESCRIPTION
  Allowed only in a QA_PREVIEW session (guard.mjs) and only for that session's preview: the URL must be
  https://server-pc.tail0e4194.ts.net:<port>/ with <port> the session's preview port (INNOVATION_LOOP_CARDLENS_PREVIEW_PORT,
  set by the runner) AND a slot that is up in state\previews.json. Never the live site, the API (8443 / 8787) or the hub.
  -Steps: a JSON file in WORK ({"viewports": ["390x844","1440x900"], "steps": [...]}); -Out: a folder under
  ARTIFACTS\qa. The page's requests are filtered in preview-browse.mjs (GET to the preview origin and public image
  hosts only). Last line: PREVIEW-BROWSE OK | STEPS-FAILED | REFUSED | FAIL.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Steps,
    [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\preview-rules.ps1"
function Refuse([string]$Why) { Write-Output "PREVIEW-BROWSE REFUSED $Why"; exit 1 }
$port = 0; [void][int]::TryParse("$env:INNOVATION_LOOP_CARDLENS_PREVIEW_PORT", [ref]$port)
if ($port -le 0) { Refuse 'no preview port for this session (only a preview QA session may browse)' }
$why = Test-PreviewUrl -Url $Url -Port $port
if ($why) { Refuse $why }
$st = $null; try { $st = [IO.File]::ReadAllText((Join-Path $script:LoopHome 'state\previews.json')).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { }
$up = @(Get-PreviewSlots $st | Where-Object { $_.status -eq 'up' -and [int]$_.port -eq $port })
if ($up.Count -eq 0) { Refuse "no preview is up on port $port" }
$nrm = { param($p) [IO.Path]::GetFullPath("$p").TrimEnd('\').ToLowerInvariant() }
$work = & $nrm (Join-Path $script:LoopHome 'work'); $qa = & $nrm (Join-Path $script:LoopHome 'artifacts\qa')
$sp = & $nrm $Steps; $op = & $nrm $Out
if (-not $sp.StartsWith("$work\")) { Refuse "the steps file must be in $work" }
if (-not $op.StartsWith("$qa\")) { Refuse "screenshots go to a folder under $qa" }
if (-not (Test-Path -LiteralPath $Steps -PathType Leaf)) { Refuse "no steps file $Steps" }
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$ip = "$(@(& 'C:\Program Files\Tailscale\tailscale.exe' ip -4 2>$null) | Select-Object -First 1)".Trim()   # this box reaches its tailnet-only ports on the tailnet IP
& $script:NodeExe "$PSScriptRoot\preview-browse.mjs" --url $Url --port $port --steps $Steps --out $Out --clone $script:Clone --ip $ip 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE; $ErrorActionPreference = $prev
exit $code

<#
.SYNOPSIS
  Ve's ONE-TIME step for the loop's PR previews: map the tailnet ports 8460-8462 to the three preview slot folders
  with Tailscale Serve (static files, tailnet only, never Funnel). After this the loop needs no elevation and no
  serve change per PR: it only swaps the files in a slot folder.

    powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\preview-serve-setup.ps1            # check (read-only)
    powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\preview-serve-setup.ps1 -Apply     # add the three entries
    powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\preview-serve-setup.ps1 -Remove    # take them out again

.DESCRIPTION
  The serve config is shared with the public Funnel sites (443 -> portfolio API, 8443 -> cardlens API) and the hub
  (8444). This script never runs `tailscale serve reset` and touches nothing but its own ports: per port it runs
    tailscale serve --bg --https=<port> "<LOOP_HOME>\preview\slots\<k>"     (-Apply)
    tailscale serve --https=<port> off                                      (-Remove)
  and compares every OTHER entry (TCP, Web, AllowFunnel) before and after; any difference is reported loudly.
  It refuses a port that is already used by something else.
#>
[CmdletBinding()]
param([switch]$Apply, [switch]$Remove)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
. "$PSScriptRoot\preview.ps1"
$ts = $script:TailscaleExe

function Get-ServeJson { $o = & $ts serve status --json 2>&1; if ($LASTEXITCODE -ne 0) { throw "tailscale serve status failed: $o" }; $t = ($o -join "`n").Trim(); if (-not $t) { return [pscustomobject]@{} }; return ($t | ConvertFrom-Json) }
# every entry that is NOT a preview port, as one comparable string
function Get-OtherEntries {
    param($Cfg)
    $keep = [ordered]@{}
    foreach ($sec in 'TCP', 'Web', 'AllowFunnel') {
        if (-not ($Cfg.PSObject.Properties.Name -contains $sec) -or -not $Cfg.$sec) { continue }
        foreach ($p in $Cfg.$sec.PSObject.Properties) {
            $port = 0; if ($p.Name -match ':(\d+)$') { $port = [int]$Matches[1] } elseif ($p.Name -match '^\d+$') { $port = [int]$p.Name }
            if ($script:PreviewPorts -contains $port) { continue }
            $keep["$sec/$($p.Name)"] = ($p.Value | ConvertTo-Json -Depth 8 -Compress)
        }
    }
    return (($keep.Keys | ForEach-Object { "$_=$($keep[$_])" }) -join "`n")
}

$before = Get-ServeJson
$otherBefore = Get-OtherEntries $before
$dirs = @{}; for ($i = 0; $i -lt $script:PreviewPorts.Count; $i++) { $dirs[[int]$script:PreviewPorts[$i]] = Get-PreviewSlotDir $i }

if ($Apply -or $Remove) {
    foreach ($port in @($dirs.Keys | Sort-Object)) {
        $key = "$($script:PreviewHost):$port"
        $cur = $null; if ($before.PSObject.Properties.Name -contains 'Web' -and $before.Web -and $before.Web.PSObject.Properties.Name -contains $key) { $cur = $before.Web.$key }
        if ($Apply) {
            if ($cur) {
                $tv = Test-PreviewServeConfig -Config $before -SlotDirs @{ $port = $dirs[$port] }
                if ($tv.Ok) { Write-Output "port ${port}: already mapped to $($dirs[$port])"; continue }
                Write-Output "port ${port}: REFUSED, already used by another entry ($($tv.Why)); not touching it"; continue
            }
            if (-not (Test-Path -LiteralPath (Join-Path $dirs[$port] 'index.html'))) { Write-PreviewPlaceholder -Slot ([array]::IndexOf($script:PreviewPorts, $port)) }
            Write-Output "> tailscale serve --bg --https=$port `"$($dirs[$port])`""
            & $ts serve --bg "--https=$port" $dirs[$port] 2>&1 | ForEach-Object { "  $_" }
            if ($LASTEXITCODE -ne 0) { Write-Output "port ${port}: tailscale serve exited $LASTEXITCODE" }
        } else {
            if (-not $cur) { Write-Output "port ${port}: not mapped"; continue }
            $tv = Test-PreviewServeConfig -Config $before -SlotDirs @{ $port = $dirs[$port] }
            if (-not $tv.Ok) { Write-Output "port ${port}: REFUSED, it is not the preview entry ($($tv.Why)); not touching it"; continue }
            Write-Output "> tailscale serve --https=$port off"
            & $ts serve "--https=$port" off 2>&1 | ForEach-Object { "  $_" }
        }
    }
}

$after = Get-ServeJson
$otherAfter = Get-OtherEntries $after
$check = Test-PreviewServeConfig -Config $after -SlotDirs $dirs
Write-Output "preview slots: $($check.Why)"
foreach ($p in @($dirs.Keys | Sort-Object)) { Write-Output "  $(Get-PreviewUrl $p) -> $($dirs[$p])" }
if ($otherBefore -ne $otherAfter) {
    Write-Output 'WARNING: an entry other than the preview ports changed. Before:'; Write-Output $otherBefore; Write-Output 'After:'; Write-Output $otherAfter
    exit 2
}
Write-Output "other serve entries (443 / 8443 / 8444 / Funnel): unchanged ($(@($otherAfter -split "`n" | Where-Object { $_ }).Count) entries)"
if ($Remove) { exit 0 }
if ($check.Ok -and $check.Ports.Count -eq $dirs.Count) { Write-Output 'PREVIEW-SERVE OK'; exit 0 }
Write-Output 'PREVIEW-SERVE NOT READY'; exit 1

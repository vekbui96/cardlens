<#
.SYNOPSIS
  Decide whether a cardlens issue may be built by Phase A. Prints one JSON line; exit 0 = buildable,
  1 = not, 2 = error.

.DESCRIPTION
  An issue is buildable only if ALL hold:
   - it is in vekbui96/cardlens, open, and not a pull request
   - it carries loop:proposal AND approved, and none of loop:in-progress / loop:deployed / loop:failed
   - it was opened by vekbui96 (the loop opens proposals as vekbui96)
   - per the issue events API, the most recent `labeled approved` event was performed by vekbui96, and
     no `unlabeled approved` event came after it (the loop itself can never add `approved`: guard.mjs
     blocks it, and merge-pr.ps1 re-runs this check before merging)
   - the issue body was not edited after that approval (GraphQL lastEditedAt), so the text that was
     approved is the text that gets built
   - the body does not say "Manual / needs Ve" (out-of-scope proposals are never built by the loop)

  Also prints `adjustments`: ids of comments by vekbui96 WITHOUT the `<!-- innovation-loop -->` marker.
  Only those may adjust an approved proposal; comments by anyone else are untrusted data.

  With -List it checks every open approved proposal and prints the buildable ones, oldest first.
#>
[CmdletBinding()]
param(
    [int]$Issue = 0,
    # used by merge-pr.ps1 after the loop marked the issue: loop:in-progress is then REQUIRED instead of refused
    [switch]$InProgress,
    [switch]$List
)
. "$PSScriptRoot\lib.ps1"
Add-GhToPath
$Owner = $script:Owner
$Repo = $script:Repo

function Test-Issue {
    param([int]$Number)
    $res = [ordered]@{ issue = $Number; buildable = $false; reasons = @(); approvedBy = $null; approvedAt = $null; adjustments = @() }
    $i = Get-GhJson @('api', "repos/$Repo/issues/$Number")
    $labels = @($i.labels | ForEach-Object { $_.name })
    if ($i.PSObject.Properties.Name -contains 'pull_request' -and $i.pull_request) { $res.reasons += 'is a pull request' }
    if ($i.state -ne 'open') { $res.reasons += "state is $($i.state)" }
    if ($i.user.login -ne $Owner) { $res.reasons += "opened by $($i.user.login), not $Owner" }
    foreach ($need in 'loop:proposal', 'approved') { if ($labels -notcontains $need) { $res.reasons += "missing label $need" } }
    foreach ($bad in 'loop:deployed', 'loop:failed') { if ($labels -contains $bad) { $res.reasons += "has label $bad" } }
    if ($InProgress) { if ($labels -notcontains 'loop:in-progress') { $res.reasons += 'missing label loop:in-progress' } }
    elseif ($labels -contains 'loop:in-progress') { $res.reasons += 'has label loop:in-progress' }
    if ("$($i.body)" -match '(?im)^\s*\**\s*(manual\s*/\s*needs\s+ve|manual step required)') { $res.reasons += 'proposal is flagged manual / needs Ve; the loop never builds it' }

    $events = @()
    $page = 1
    do {
        $batch = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/events?per_page=100&page=$page"))
        $events += $batch; $page++
    } while ($batch.Count -eq 100 -and $page -lt 10)
    $approvalEvents = @($events | Where-Object { ($_.event -eq 'labeled' -or $_.event -eq 'unlabeled') -and $_.label -and $_.label.name -eq 'approved' })
    $lastLabeled = $approvalEvents | Where-Object { $_.event -eq 'labeled' } | Select-Object -Last 1
    if (-not $lastLabeled) { $res.reasons += 'no labeled-approved event found' }
    else {
        $res.approvedBy = $lastLabeled.actor.login
        $res.approvedAt = $lastLabeled.created_at
        if ($lastLabeled.actor.login -ne $Owner) { $res.reasons += "approved label added by $($lastLabeled.actor.login), not $Owner" }
        $later = @($approvalEvents | Where-Object { $_.event -eq 'unlabeled' -and [datetime]$_.created_at -gt [datetime]$lastLabeled.created_at })
        if ($later.Count -gt 0) { $res.reasons += 'approved label was removed after it was added' }
        $q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){lastEditedAt}}}'
        $g = Get-GhJson @('api', 'graphql', '-f', "query=$q", '-F', "o=$Owner", '-F', 'r=cardlens', '-F', "n=$Number")
        $edited = $g.data.repository.issue.lastEditedAt
        if ($edited -and ([datetime]$edited -gt [datetime]$lastLabeled.created_at)) { $res.reasons += "issue body edited at $edited, after approval; re-approve (remove and re-add approved) to build it" }
    }

    $comments = @(Get-GhJson @('api', "repos/$Repo/issues/$Number/comments?per_page=100"))
    $res.adjustments = @($comments | Where-Object { $_.user.login -eq $Owner -and -not ($_.body -and $_.body.Contains($script:Marker)) } | ForEach-Object { $_.id })
    $res.buildable = ($res.reasons.Count -eq 0)
    return $res
}

try {
    if ($List) {
        $open = @(Get-GhJson @('issue', 'list', '-R', $Repo, '--state', 'open', '--label', 'loop:proposal', '--label', 'approved', '--json', 'number,createdAt', '--limit', '50'))
        $results = @()
        foreach ($o in ($open | Where-Object { $_ } | Sort-Object { [datetime]$_.createdAt })) { $results += (Test-Issue -Number $o.number) }
        $ok = @($results | Where-Object { $_.buildable })
        Write-Output (@{ buildable = @($ok | ForEach-Object { $_.issue }); checked = $results } | ConvertTo-Json -Depth 5 -Compress)
        if ($ok.Count -gt 0) { exit 0 } else { exit 1 }
    }
    if ($Issue -le 0) { throw 'pass -Issue <n> or -List' }
    $r = Test-Issue -Number $Issue
    Write-Output ($r | ConvertTo-Json -Depth 5 -Compress)
    if ($r.buildable) { exit 0 } else { exit 1 }
} catch {
    Write-Output (@{ error = "$_" } | ConvertTo-Json -Compress)
    exit 2
}

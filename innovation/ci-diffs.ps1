<#
.SYNOPSIS
  The ONLY way a build session gets CI's visual-regression images: download the `visual-diffs` artifact of a
  failed CI run of the loop's own PR into WORK and list the expected / actual / diff PNGs, so the session can
  Read them. Last output line: CI-DIFFS OK <n> image(s) in <dir> | CI-DIFFS REFUSED <why>

.DESCRIPTION
  Why: #356 spent three CI fix rounds (48 minutes, $1.90) changing its visual case blind. CI's log says only
  "175 pixels are different"; the images that show WHICH pixels are in the run's `visual-diffs` artifact, and
  the session could not get them (the guard refuses `gh run download`, rightly: it would fetch anything).
  This script fetches exactly that one artifact and nothing else.

  Refuses unless ALL hold:
   - PR #<Pr> is open, from loop/<Issue>-<slug> of vekbui96/cardlens, opened by vekbui96
   - run <RunId> is a CI workflow run of vekbui96/cardlens on that PR's branch (any head of it: the images of
     the previous round are still useful after a fix push) and it completed with failure
   - the run has an unexpired artifact named `visual-diffs` (the v2 Visual Regression job uploads its
     test-results there on failure) of at most $MaxArtifactMb MB
  Then `gh run download <RunId> -n visual-diffs -D <WORK>\ci-diffs-<Issue>\<RunId>`, keeps only the PNGs
  (traces and other files are deleted), and prints one line per image:
    CI-DIFFS <case dir> <expected|actual|diff> <full path>
  Nothing is re-run, cancelled or dispatched, and nothing outside WORK is written.

.EXIT CODES
  0 images listed | 1 refused or failed (nothing kept)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Pr,
    [Parameter(Mandatory)][int]$Issue,
    [Parameter(Mandatory)][long]$RunId,
    [ValidateRange(1, 200)][int]$MaxArtifactMb = 50
)
. "$PSScriptRoot\lib.ps1"
Start-ScriptLog "ci-diffs-$Issue-$RunId"
Add-GhToPath
$Repo = $script:Repo
$ArtifactName = 'visual-diffs'
function Refuse([string]$why) { Write-Log "refused: $why" 'ERROR'; Write-Output "CI-DIFFS REFUSED $why"; exit 1 }

# "<case dir>/<name>-expected.png" -> kind (expected / actual / diff) or '' for any other file. Playwright's
# toHaveScreenshot writes <snapshot>-expected.png, <snapshot>-actual.png and <snapshot>-diff.png per failed try.
function Get-DiffImageKind {
    param([string]$Name)
    $m = [regex]::Match($Name, '-(expected|actual|diff)\.png$', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.ToLowerInvariant() }
    return ''
}

try {
    $p = Get-GhJson @('api', "repos/$Repo/pulls/$Pr")
    if ($p.state -ne 'open') { Refuse "PR #$Pr is $($p.state)" }
    if ($p.head.repo.full_name -ne $Repo) { Refuse "PR head is from $($p.head.repo.full_name)" }
    if ($p.head.ref -notmatch "^loop/$Issue-[a-z0-9][a-z0-9-]*$") { Refuse "PR branch '$($p.head.ref)' is not loop/$Issue-<slug>" }
    if ($p.user.login -ne $script:Owner) { Refuse "PR opened by $($p.user.login)" }
    $run = Get-GhJson @('api', "repos/$Repo/actions/runs/$RunId")
    if ($run.head_branch -ne $p.head.ref) { Refuse "run $RunId is for branch $($run.head_branch), not $($p.head.ref)" }
    if ($run.name -ne 'CI') { Refuse "run $RunId is workflow '$($run.name)', not CI" }
    if ($run.repository.full_name -ne $Repo) { Refuse "run $RunId is not a run of $Repo" }
    if ($run.status -ne 'completed' -or $run.conclusion -ne 'failure') { Refuse "run $RunId is $($run.status)/$($run.conclusion), not a completed failure" }
    $arts = Get-GhJson @('api', "repos/$Repo/actions/runs/$RunId/artifacts?per_page=100")
    $art = @($arts.artifacts | Where-Object { $_.name -eq $ArtifactName }) | Select-Object -First 1
    if (-not $art) { Refuse "run $RunId has no '$ArtifactName' artifact (only the v2 Visual Regression job uploads one, and only when it fails)" }
    if ($art.expired) { Refuse "the '$ArtifactName' artifact of run $RunId has expired (kept 7 days)" }
    $mb = [math]::Round([double]$art.size_in_bytes / 1MB, 1)
    if ([double]$art.size_in_bytes -gt ($MaxArtifactMb * 1MB)) { Refuse "the '$ArtifactName' artifact is $mb MB (cap $MaxArtifactMb MB)" }

    $work = Join-Path $script:LoopHome 'work'
    $dest = Join-Path $work "ci-diffs-$Issue\$RunId"
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Invoke-Gh -Arguments @('run', 'download', "$RunId", '-R', $Repo, '-n', $ArtifactName, '-D', $dest) -Quiet | Out-Null

    # keep only the PNGs Playwright wrote for failed screenshots; everything else (traces, error-context, videos) goes
    $root = (Resolve-Path -LiteralPath $dest).Path.TrimEnd('\')
    $kept = New-Object System.Collections.ArrayList
    foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File)) {
        $full = $f.FullName
        if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $full -Force; continue }
        $kind = Get-DiffImageKind $f.Name
        if (-not $kind) { Remove-Item -LiteralPath $full -Force; continue }
        $case = $f.Directory.Name
        [void]$kept.Add([pscustomobject]@{ Case = $case; Kind = $kind; Path = $full })
    }
    Save-State "ci-diffs-$Issue-$RunId" @{ issue = $Issue; pr = $Pr; runId = $RunId; headSha = "$($run.head_sha)"; images = $kept.Count; dir = $root; utc = [DateTime]::UtcNow.ToString('o') }
    if ($kept.Count -eq 0) { Write-Output "CI-DIFFS REFUSED the '$ArtifactName' artifact of run $RunId holds no expected/actual/diff PNG"; exit 1 }
    foreach ($k in @($kept | Sort-Object Case, Kind)) { Write-Output ("CI-DIFFS {0} {1} {2}" -f $k.Case, $k.Kind, $k.Path) }
    Write-Log "kept $($kept.Count) image(s) from run $RunId ($mb MB artifact) in $root"
    Write-Output "CI-DIFFS OK $($kept.Count) image(s) in $root (run $RunId on $("$($run.head_sha)".Substring(0, 7)); Read the -diff.png first: it marks the differing pixels in red)"
    exit 0
} catch {
    Write-Log "error: $_" 'ERROR'
    Write-Output "CI-DIFFS REFUSED error: $_"
    exit 1
}

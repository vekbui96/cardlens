<#
.SYNOPSIS
  Install (or update) the cardlens innovation loop's two scheduled tasks. Run from an ELEVATED PowerShell.
  Asks for VeBui's password once (Task Scheduler stores it so the tasks run while logged off).

.DESCRIPTION
  1. innovation-loop-cardlens          daily at -At, NON-elevated (RunLevel Limited), runs run-loop.ps1 from
                                       this checkout. Created DISABLED.
  2. innovation-loop-cardlens-deploy   NO trigger, RunLevel Highest, fixed action:
                                         powershell -File C:\ProgramData\innovation-loop-cardlens\bin\elevated-task.ps1
                                       Enabled (a task with no trigger only runs when started). Its security
                                       descriptor lets SERVER-PC\VeBui's NON-elevated token start (and read) it,
                                       nothing more. The loop starts it with `schtasks /run /tn <name>` from inside
                                       deploy.ps1 / rollback.ps1 / merge-pr.ps1 / run-loop.ps1 only.
  3. Copies the elevated scripts (lib.ps1, elevated-task.ps1, deploy-server.ps1, rollback-server.ps1) into
     C:\ProgramData\innovation-loop-cardlens\bin, and locks C:\ProgramData\innovation-loop-cardlens down to
     SYSTEM + Administrators (full) and Users (read/execute). The elevated task therefore never runs a file a
     non-elevated process can edit: changing what runs elevated needs this script, elevated, again.
     run-loop.ps1 compares the copy with this checkout every run and refuses server deploys on a mismatch.

  Afterwards, from a NORMAL (non-admin) PowerShell, prove the non-elevated trigger works:
     powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -SelfTest

  4. With -WithProductReview (or -ProductReviewOnly, which leaves the daily task as it is):
     innovation-loop-cardlens-review, WEEKLY on -ReviewDay at -ReviewAt,
     NON-elevated like the daily task, runs `run-loop.ps1 -ProductReview` (read-only research; opens one
     loop:product-review issue; LOOP.md section 7). Created DISABLED. It shares the daily task's run lock, so
     the two never run at once (the later one exits).

  Enable the daily loop when ready:  Enable-ScheduledTask -TaskName innovation-loop-cardlens
  Enable the weekly review:          Enable-ScheduledTask -TaskName innovation-loop-cardlens-review
  Remove everything:                 .\install-task.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$At = '14:23',
    [string]$User = 'SERVER-PC\VeBui',
    [string]$ExtraArgs = '',     # e.g. '-ProposeOnly' for the first supervised week
    [switch]$Uninstall,
    [switch]$ElevatedOnly,       # only refresh the elevated copy + deploy task (after git pull)
    [switch]$WithProductReview,  # also register the weekly product review task (disabled)
    [switch]$ProductReviewOnly,  # ONLY the weekly review task (+ the idempotent elevated refresh); the daily task is untouched
    [ValidateSet('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')][string]$ReviewDay = 'Sunday',
    [string]$ReviewAt = '10:37'
)
$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'run this from an elevated PowerShell'
}
$LoopTask = 'innovation-loop-cardlens'
$DeployTask = 'innovation-loop-cardlens-deploy'
$ReviewTask = 'innovation-loop-cardlens-review'
$ElevHome = 'C:\ProgramData\innovation-loop-cardlens'   # must match lib.ps1 ElevHomeReal
$Bin = Join-Path $ElevHome 'bin'
$Files = @('lib.ps1', 'elevated-task.ps1', 'deploy-server.ps1', 'rollback-server.ps1')
# $PSScriptRoot is empty in param() defaults under `powershell -File` on PS 5.1, so resolve it here.
$Here = $PSScriptRoot; if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$RunLoop = Join-Path $Here 'run-loop.ps1'

if ($Uninstall) {
    foreach ($t in $LoopTask, $DeployTask, $ReviewTask) { if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t -Confirm:$false; Write-Host "removed $t" } }
    Write-Host "left $ElevHome in place (logs, deploy records); delete it by hand if wanted"
    return
}
if ($Here -match '\s') { throw "this checkout's path contains whitespace; the loop's permission rules need a path without spaces" }

# ---- 1. admin-only copy of the elevated scripts ---------------------------------------------------
foreach ($d in $ElevHome, $Bin, (Join-Path $ElevHome 'results'), (Join-Path $ElevHome 'state'), (Join-Path $ElevHome 'logs'), (Join-Path $ElevHome 'lock'), (Join-Path $ElevHome 'config'), (Join-Path $ElevHome 'npm-cache')) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)   # no inherited rules
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$none = [Security.AccessControl.PropagationFlags]::None
foreach ($rule in @(
        (New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inherit, $none, 'Allow')),
        (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inherit, $none, 'Allow')),
        (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Users', 'ReadAndExecute', $inherit, $none, 'Allow')))) { $acl.AddAccessRule($rule) }
$acl.SetOwner((New-Object Security.Principal.NTAccount('BUILTIN\Administrators')))
Set-Acl -LiteralPath $ElevHome -AclObject $acl
foreach ($f in $Files) {
    Copy-Item -LiteralPath (Join-Path $Here $f) -Destination (Join-Path $Bin $f) -Force
}
Get-ChildItem -LiteralPath $ElevHome -Recurse | ForEach-Object {
    $a = Get-Acl -LiteralPath $_.FullName; $a.SetAccessRuleProtection($false, $false); Set-Acl -LiteralPath $_.FullName -AclObject $a
}
# empty, admin-owned git/npm config for the elevated side (lib.ps1 points GIT_CONFIG_GLOBAL / NPM_CONFIG_USERCONFIG here)
foreach ($c in 'gitconfig', 'npmrc') { $p = Join-Path $ElevHome "config\$c"; if (-not (Test-Path -LiteralPath $p)) { [IO.File]::WriteAllText($p, '') } }
Write-Host "copied $($Files -join ', ') to $Bin (Users: read/execute only)"

# Console prompt, not Get-Credential: this is often run over SSH, where no dialog can appear.
$sec = Read-Host -AsSecureString "Password for $User (stored by Task Scheduler so the tasks run while logged off)"
$pw = (New-Object System.Net.NetworkCredential('', $sec)).Password
$settingsCommon = @{ MultipleInstances = 'IgnoreNew'; AllowStartIfOnBatteries = $true; DontStopIfGoingOnBatteries = $true }

# ---- 2. elevated deploy task: no trigger, fixed action ----------------------------------------------
$elevScript = Join-Path $Bin 'elevated-task.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$elevScript`"" -WorkingDirectory $Bin
$settings = New-ScheduledTaskSettingsSet @settingsCommon -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Password -RunLevel Highest
$task = New-ScheduledTask -Action $action -Settings $settings -Principal $principal `
    -Description 'Elevated half of the cardlens innovation loop: validates ~\.innovation-loop-cardlens\elevated\request.json and deploys/rolls back the cardlens server. No trigger. See D:\projects\cardlens\innovation\README.md'
Register-ScheduledTask -TaskName $DeployTask -InputObject $task -User $User -Password $pw -Force | Out-Null

# Let VeBui's NON-elevated token start it: append (A;;GRGX;;;<VeBui SID>) to the task's DACL.
$sid = (New-Object Security.Principal.NTAccount($User)).Translate([Security.Principal.SecurityIdentifier]).Value
$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$t = $svc.GetFolder('\').GetTask($DeployTask)
$sddl = $t.GetSecurityDescriptor(4)   # DACL_SECURITY_INFORMATION
$ace = "(A;;GRGX;;;$sid)"
if ($sddl -notmatch [regex]::Escape($ace)) { $t.SetSecurityDescriptor($sddl + $ace, 0) }
Write-Host "registered $DeployTask (no trigger, highest privileges); DACL: $($t.GetSecurityDescriptor(4))"

# ---- 3. the daily loop: NON-elevated, disabled -------------------------------------------------------
if (-not $ElevatedOnly -and -not $ProductReviewOnly) {
    $argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunLoop`" $ExtraArgs".Trim()
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $Here
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet @settingsCommon -ExecutionTimeLimit (New-TimeSpan -Hours 5) -StartWhenAvailable -RunOnlyIfNetworkAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Password -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description 'CardLens innovation loop (claude -p, LOOP.md), non-elevated. See D:\projects\cardlens\innovation\README.md'
    Register-ScheduledTask -TaskName $LoopTask -InputObject $task -User $User -Password $pw -Force | Out-Null
    Disable-ScheduledTask -TaskName $LoopTask | Out-Null
    Write-Host "registered $LoopTask (DISABLED, non-elevated, daily $At)"
}

# ---- 4. the weekly product review: NON-elevated, disabled (optional) ------------------------------------
if ((-not $ElevatedOnly -and $WithProductReview) -or $ProductReviewOnly) {
    $argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunLoop`" -ProductReview"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $Here
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $ReviewDay -At $ReviewAt
    $settings = New-ScheduledTaskSettingsSet @settingsCommon -ExecutionTimeLimit (New-TimeSpan -Hours 5) -StartWhenAvailable -RunOnlyIfNetworkAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Password -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description 'CardLens weekly product review (run-loop.ps1 -ProductReview: read-only, opens one loop:product-review issue), non-elevated. See D:\projects\cardlens\innovation\README.md'
    Register-ScheduledTask -TaskName $ReviewTask -InputObject $task -User $User -Password $pw -Force | Out-Null
    Disable-ScheduledTask -TaskName $ReviewTask | Out-Null
    Write-Host "registered $ReviewTask (DISABLED, non-elevated, weekly $ReviewDay $ReviewAt)"
}
Get-ScheduledTask -TaskName $LoopTask, $DeployTask, $ReviewTask -ErrorAction SilentlyContinue | Format-Table TaskName, State
Write-Host 'Next, from a NORMAL PowerShell:  powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -SelfTest'

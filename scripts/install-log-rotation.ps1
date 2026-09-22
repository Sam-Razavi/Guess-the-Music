# One-time setup: registers a daily Scheduled Task that runs rotate-logs.ps1
# to keep pm2's log files bounded. Re-run this any time the repo moves to a
# different path.

$scriptPath = Join-Path $PSScriptRoot "rotate-logs.ps1"
$taskName = "GuessTheMusic-LogRotate"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At 4am

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Description "Keeps Guess the Music's pm2 logs from growing unbounded" | Out-Null

Write-Host "Scheduled task '$taskName' registered - runs daily at 4am."
Write-Host "To test it now, run:"
Write-Host ('  powershell -NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '"')

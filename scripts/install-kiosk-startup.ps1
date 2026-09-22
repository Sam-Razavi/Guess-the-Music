# One-time setup: creates a shortcut in the current user's Startup folder
# that runs launch-kiosk.ps1 at logon, hidden (no visible PowerShell window).
# Re-run this any time the repo is moved to a different path.

$scriptPath = Join-Path $PSScriptRoot "launch-kiosk.ps1"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "Guess the Music Kiosk.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7  # minimized
$shortcut.Description = "Launch Guess the Music TV screen in kiosk mode"
$shortcut.Save()

Write-Host "Startup shortcut created: $shortcutPath"
Write-Host "It will launch on next logon. To test it now, run:"
Write-Host "  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

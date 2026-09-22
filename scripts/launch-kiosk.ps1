# Waits for the game server to come up, then opens the TV screen in
# Chrome kiosk mode. Run this at Windows logon (see the Startup-folder
# shortcut created by install-kiosk-startup.ps1) so the TV always comes
# back up on its own after a reboot.

$url = "http://localhost:3000/tv.html"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileDir = Join-Path $env:LOCALAPPDATA "guess-the-music-kiosk-profile"

$maxAttempts = 60
$delaySeconds = 2
$serverUp = $false

for ($i = 0; $i -lt $maxAttempts; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $serverUp = $true
            break
        }
    } catch {
        Start-Sleep -Seconds $delaySeconds
    }
}

if (-not $serverUp) {
    # Server never came up (e.g. pm2 failed to resurrect). Launch anyway so
    # a manual server start doesn't also require a manual browser restart —
    # Chrome will just show a connection error until the server appears.
}

& $chrome `
    "--kiosk" `
    $url `
    "--autoplay-policy=no-user-gesture-required" `
    "--user-data-dir=$profileDir" `
    "--no-first-run" `
    "--no-default-browser-check" `
    "--disable-infobars" `
    "--disable-session-crashed-bubble" `
    "--disable-features=TranslateUI" `
    "--overscroll-history-navigation=0" `
    "--noerrdialogs"

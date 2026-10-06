# One-time setup for playing from outside your home WiFi via a Cloudflare
# Tunnel (an outbound-only connection from this PC to Cloudflare's edge — no
# port-forwarding or exposed IP needed). See README.md's "Playing from
# outside your WiFi" section for the full walkthrough and why each step
# exists.
#
# UNVERIFIED NOTE: unlike the rest of this repo's PowerShell scripts, this
# one hasn't been run against a real Windows machine or Cloudflare account
# (this session has neither) — the app-side JOIN_PIN change that goes with
# it was fully tested, but this script is best-effort from cloudflared's
# documented behavior. Treat the printed commands as the source of truth if
# anything here doesn't match what cloudflared actually does on your PC.
#
# Cloudflare account/domain steps can't be scripted blindly — they need
# YOUR Cloudflare login and a domain YOU own in that account — so this
# script only handles the mechanical parts and prints the manual steps in
# between. Run it TWICE:
#
#   1st run (no -Hostname yet): installs cloudflared, then stops and prints
#     the exact `cloudflared tunnel ...` commands to run yourself (they open
#     a browser for your Cloudflare login and ask you to pick a domain).
#   2nd run (-Hostname your-subdomain.yourdomain.com, after you've run those
#     commands): finds the tunnel credentials cloudflared just created,
#     writes config.yml pointing at this game's server, and registers
#     cloudflared as a Windows service so it starts automatically on
#     reboot — the same role pm2 and the kiosk startup shortcut play for
#     the rest of this app.

param(
    [string]$Hostname = "",
    [string]$TunnelName = "guess-the-music",
    [int]$Port = 3000
)

$configDir = Join-Path $env:USERPROFILE ".cloudflared"
$configPath = Join-Path $configDir "config.yml"

function Test-Cloudflared {
    return $null -ne (Get-Command cloudflared -ErrorAction SilentlyContinue)
}

if (-not (Test-Cloudflared)) {
    Write-Host "cloudflared not found on PATH - installing via winget..."
    try {
        winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    } catch {
        Write-Host "winget install failed. Download cloudflared.exe manually from:"
        Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest"
        Write-Host "put it somewhere on your PATH, then re-run this script."
        exit 1
    }
    Write-Host ""
    Write-Host "cloudflared was just installed - PATH changes need a brand new PowerShell"
    Write-Host "window to take effect. Close this one, open a new one, and re-run:"
    Write-Host "  cd $PSScriptRoot"
    Write-Host "  .\install-cloudflare-tunnel.ps1"
    exit 0
}

Write-Host "cloudflared is installed: $(cloudflared --version)"

if (-not $Hostname) {
    Write-Host ""
    Write-Host "=== Manual steps (one-time, needs your own Cloudflare account + domain) ==="
    Write-Host "1. cloudflared tunnel login"
    Write-Host "   Opens a browser - log in and pick the domain you'll use."
    Write-Host "2. cloudflared tunnel create $TunnelName"
    Write-Host "   Prints a Tunnel ID and writes a credentials .json under $configDir - note it."
    Write-Host "3. cloudflared tunnel route dns $TunnelName <your-subdomain>.yourdomain.com"
    Write-Host "   e.g. guess-the-music.yourdomain.com - this becomes the link you share."
    Write-Host ""
    Write-Host "Then re-run this script with that hostname:"
    Write-Host "  .\install-cloudflare-tunnel.ps1 -Hostname guess-the-music.yourdomain.com"
    exit 0
}

$credFiles = @(Get-ChildItem $configDir -Filter "*.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^[0-9a-f-]{36}\.json$' })

if ($credFiles.Count -eq 0) {
    Write-Host "No tunnel credentials found in $configDir."
    Write-Host "Run 'cloudflared tunnel login' and 'cloudflared tunnel create $TunnelName' first (see above)."
    exit 1
}
if ($credFiles.Count -gt 1) {
    Write-Host "Multiple tunnel credential files found under $configDir - not sure which one is '$TunnelName':"
    $credFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
    Write-Host "Delete the ones you don't want and re-run."
    exit 1
}

$tunnelId = $credFiles[0].BaseName
$credFile = $credFiles[0].FullName

$configYaml = @"
tunnel: $tunnelId
credentials-file: $credFile

ingress:
  - hostname: $Hostname
    service: http://localhost:$Port
  - service: http_status:404
"@

Set-Content -Path $configPath -Value $configYaml -Encoding UTF8
Write-Host "Wrote $configPath"

Write-Host "Registering cloudflared as a Windows service (so it auto-starts on reboot)..."
cloudflared service install

Write-Host ""
Write-Host "Done (assuming the service install above printed no errors)."
Write-Host "Your game should now be reachable at: https://$Hostname/player.html (and /host.html)"
Write-Host ""
Write-Host "Check it:   Get-Service cloudflared"
Write-Host "Restart it: Restart-Service cloudflared"
Write-Host ""
Write-Host "Strongly recommended now that this is reachable from the internet: set JOIN_PIN"
Write-Host "in your .env (see .env.example), then 'pm2 restart guess-the-music' to pick it up."

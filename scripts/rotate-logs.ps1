# Keeps pm2's log files for this app from growing unbounded over months of
# 24/7 uptime. pm2-logrotate (the usual fix) can't install on this machine —
# its installer breaks on the space in the Windows profile path ("Min
# Dator"), a known PM2-on-Windows bug — so this does the same job directly:
# rotate any oversized log, keep a few generations, then ask pm2 to reopen
# fresh log files.

$pm2LogDir = Join-Path $env:USERPROFILE ".pm2\logs"
$maxSizeMB = 10
$keepGenerations = 3

Get-ChildItem -Path $pm2LogDir -Filter "guess-the-music-*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    $base = $_.FullName
    if ($_.Length -le ($maxSizeMB * 1MB)) { return }

    $oldest = "$base.$keepGenerations"
    if (Test-Path $oldest) { Remove-Item $oldest -Force }
    for ($i = $keepGenerations - 1; $i -ge 1; $i--) {
        $src = "$base.$i"
        if (Test-Path $src) { Move-Item $src "$base.$($i + 1)" -Force }
    }
    Move-Item $base "$base.1" -Force
}

pm2 reloadLogs | Out-Null

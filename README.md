# Guess the Music 🎵

A local party game: the TV shows the stage, everyone's phone is a buzzer, songs play for real from YouTube.

It runs from a laptop on your WiFi — nothing to install on the Android TV itself besides its normal browser.

> **Running on the always-on TV PC?** The server and kiosk screen already start themselves — see [Windows always-on setup](#windows-always-on-setup) below. You don't need `npm start`; just check `pm2 status`.

## 1. Install & start

```bash
npm install
npm start
```

You'll see something like:

```
TV (Android TV browser):  http://192.168.1.42:3000/tv.html
Host control (your phone/laptop): http://192.168.1.42:3000/host.html
Players join:              http://192.168.1.42:3000/player.html
```

Keep this terminal running for the whole game night — closing it stops the game (and clears scores; the playlist itself is saved to `playlist.json` and survives restarts).

**Everyone must be on the same WiFi network** (TV, host, and every player's phone).

## 2. Set it up

- **TV:** open the Android TV's browser and go to the `tv.html` link above. Tap the **"Tap once to enable sound"** button once so the browser is allowed to autoplay audio for the rest of the session.
- **You (the host):** open `host.html` on your own phone or laptop — this is your control panel, so keep the song titles secret from the TV screen. Hosting from your phone? Tip: open `host.html`, then use your browser's **"Add to Home Screen"** option — it installs as a proper app icon and opens full-screen next time, no browser address bar or re-typing the URL. Players can do the same with `player.html`.
- **Players:** scan the QR code shown on the TV (or open the `player.html` link) on their own phones, type a name, and they're in.

## 3. Add songs

On the host page, paste a YouTube link (or just the video ID) plus the title, and add it to the playlist. The title/artist are only ever shown to you — the TV and players never see them until you reveal.

Tip: pick videos that don't show the song title on screen (plain "official audio" uploads work great), since the video only stays hidden behind a spinning-record animation *while the round is live* — once you hit **Reveal**, the real video appears.

## 4. Run a round

1. Hit **Play** next to a song in your playlist.
2. The TV shows a spinning record and starts playing the audio; players' buzzers light up.
3. First phone to tap **BUZZ** locks the buzzer — their name pops up on the TV.
4. Judge their answer out loud, then:
   - **Correct:** hit **+1** next to their name.
   - **Wrong:** hit **Reset buzzers** so everyone else can jump in again (the player who already went can't buzz twice on the same song).
5. Hit **Reveal answer** to show the real title/artist and video on the TV.
6. Hit **Close round** and pick the next song.

Hosting from a laptop/desktop with a keyboard: `Space` = reveal, `R` = reset buzzers, `C` = close round (shown on the host page itself; hidden on touch devices where it doesn't apply).

Scores update live on every screen. **Reset entire game** on the host page wipes scores and marks every song unplayed again for a rematch.

## Notes & limits

- This is plain local networking, not a hosted service — it only works while your laptop is running the server and everyone's on the same WiFi. It won't work over mobile data or across different networks.
- If a device can't reach the site, double check the IP address printed in the terminal is still current (it can change if you reconnect to WiFi) — restart the server if so.
- Player names/scores are kept in memory for that run of the server; the song playlist is the only thing saved to disk (`playlist.json`).

## Windows always-on setup

This is how the game is deployed on the always-on PC that's HDMI'd into the TV. The server runs under [pm2](https://pm2.keymetrics.io/) so it survives reboots and restarts itself if it crashes, and the TV screen launches automatically in Chrome kiosk mode at logon.

**Already set up — nothing to install.** The commands below (`npm install -g pm2 ...`, `install-kiosk-startup.ps1`) were the one-time setup and don't need to be re-run. Day to day, all you need is:

| I want to... | Run this |
|---|---|
| Check the game is running | `pm2 status` |
| See the server's console output | `pm2 logs guess-the-music` |
| Restart the server (e.g. after a config change) | `pm2 restart guess-the-music` |
| Re-open the TV kiosk screen (e.g. you closed it) | `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Guess-the-Music\scripts\launch-kiosk.ps1` |
| Add songs / run the game | Open `host.html` on your phone — see [Set it up](#2-set-it-up) above |

`npm start` will fail with `EADDRINUSE` if you try it here — that's expected, it just means pm2 already has the server running on port 3000. You don't need it.

### Server: pm2

Install pm2 and the Windows startup helper globally, then start the app under it:

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\Guess-the-Music
pm2 start server.js --name guess-the-music
pm2 save
pm2-startup install
```

- `pm2 save` snapshots the current process list so it comes back after a reboot.
- `pm2-startup install` registers a `HKCU\...\Run` entry that runs `pm2 resurrect` at logon — the PC needs to be set to auto-login for this to work fully unattended after a reboot.

**Check it's running:**

```powershell
pm2 status          # should show guess-the-music as "online"
pm2 logs guess-the-music   # tail the server's console output
```

### TV screen: Chrome kiosk mode

`scripts/launch-kiosk.ps1` waits for the server to answer on `http://localhost:3000/tv.html` (so it doesn't race the server on boot) and then opens it in Chrome with `--kiosk` and `--autoplay-policy=no-user-gesture-required` (so YouTube audio plays without a manual unlock tap), using a separate Chrome profile so it doesn't touch your normal browsing session.

To register it to launch automatically at logon (creates a shortcut in the Startup folder):

```powershell
cd C:\Guess-the-Music\scripts
powershell -ExecutionPolicy Bypass -File .\install-kiosk-startup.ps1
```

To launch it manually / test it without logging out:

```powershell
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Guess-the-Music\scripts\launch-kiosk.ps1
```

To exit kiosk mode, `Alt+F4` the Chrome window (or kill it from Task Manager).

### YouTube playlist import (optional)

The host page can bulk-import a whole YouTube playlist by link, using the official YouTube Data API v3. This needs your own free API key:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an existing one).
2. Enable the **YouTube Data API v3** for that project.
3. Create an API key under **Credentials**.
4. Copy `.env.example` to `.env` in the project folder and paste the key in:
   ```
   YOUTUBE_API_KEY=your-key-here
   ```
5. `pm2 restart guess-the-music` so the server picks it up.

Everything else works fine without this — the host page just shows a clear error on the import button if it's not configured.

The same key also powers **"🔁 Find replacement"**, next to any song flagged as non-embeddable (the "Check for broken videos" scan, or the live "❌ Embedding disabled" error during a round). It searches YouTube for a different upload of the same song — often an "Artist - Topic" auto-upload or a lyric video allows embedding even when the official music video doesn't — and lets you swap it in with one click, keeping the song's title/artist/category/points as-is. Each lookup costs about 100 of your daily 10,000 API quota units, so it's a per-song action, not something to run on a whole playlist at once.

### Spotify auto-categories (optional)

With the "Auto-categories" game option turned on, the host page can suggest
a category per song (manual add or playlist import) from its artist's genre
on Spotify. This needs its own free API credentials, separate from YouTube:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), log in, and create an app (any name/redirect URI — this only uses the app's client credentials, not a user login).
2. From the app's Settings page, copy the **Client ID** and **Client Secret**.
3. Add both to `.env`:
   ```
   SPOTIFY_CLIENT_ID=your-client-id-here
   SPOTIFY_CLIENT_SECRET=your-client-secret-here
   ```
4. `pm2 restart guess-the-music` so the server picks it up.

Spotify's genre tagging is inconsistent (sparse for many non-Western
artists), so this is a suggestion the host can always override, not a
guarantee — and it never overwrites a category you typed yourself. Works
fine with nothing configured — the setting just won't find any suggestions.

### Friendly hostname (mDNS)

The server also advertises itself as `guess-the-music.local` on the network, shown as a secondary hint under the QR code on the host page. It's a convenience only, not the primary path — the QR code and printed IP-based links stay the reliable way to join, since Android Chrome's support for `.local` addresses is inconsistent. The first time the server starts, Windows may prompt a one-time Firewall dialog for Node.js (multicast UDP) — allow it on **Private networks**.

### Log rotation

`pm2-logrotate` (the usual way to bound pm2's log file sizes) can't install on this machine — its installer breaks on the space in the Windows profile path (`C:\Users\Min Dator`), a known PM2-on-Windows issue. Instead, a small scheduled task handles it directly:

```powershell
cd C:\Guess-the-Music\scripts
powershell -ExecutionPolicy Bypass -File .\install-log-rotation.ps1
```

This registers a daily task (`GuessTheMusic-LogRotate`, runs at 4am) that rotates any pm2 log file over 10MB, keeping 3 old generations, and asks pm2 to reopen fresh log files. To run it manually / test it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Guess-the-Music\scripts\rotate-logs.ps1
```

### Updating the app later

```powershell
cd C:\Guess-the-Music
git pull
npm install
pm2 restart guess-the-music
```

### Finding the PC's LAN IP (for the QR code / player join links)

The server prints its own LAN IP on startup (`pm2 logs guess-the-music`), but if you need to check it directly:

```powershell
ipconfig
```

Look for the `IPv4 Address` under your active adapter (Wi-Fi or Ethernet). If it's changed since the server last started, restart the pm2 process (`pm2 restart guess-the-music`) so the printed URLs and QR code match.

> Consider setting a **DHCP reservation** for this PC in your router so its LAN IP never changes — otherwise the QR code can go stale after a router reboot or lease renewal.

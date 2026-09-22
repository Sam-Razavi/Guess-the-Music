# Guess the Music — roadmap / ideas

Phase 2 (all shipped):

- Resilience: fixed reconnect handling (host/tv/player now re-register on every Socket.IO 'connect', not just once) and persist player scores to players.json so a restart doesn't wipe them.
- Host UX: YouTube playlist import (Data API v3, needs YOUTUBE_API_KEY in .env — see README), drag-to-reorder playlist, optional round timer (soft cutoff).
- TV polish: buzz-in pop animation, confetti + chime on a correct answer, rotating idle-screen hints.
- Network robustness: mDNS hostname (guess-the-music.local) advertised as a secondary join hint; DHCP reservation is still a manual router step (see README).
- Ops: pm2-logrotate can't install on this machine (breaks on the space in the Windows profile path) — replaced with scripts/rotate-logs.ps1 + a daily scheduled task instead.

Also fixed two pre-existing bugs found along the way, unrelated to the above: `[hidden]` elements weren't actually hiding sitewide (CSS specificity — see style.css), and the YouTube IFrame API sometimes silently never initializes or starts playback (see tv.js's retry/backstop logic).

Phase 3 (shipped):

- Farsi/English toggle for the TV and player screens, set from the host page (EN/فارسی pill buttons) and broadcast live via state.language — no reload needed. Host control panel stays English-only by design. Translation dictionary + RTL/font handling lives in public/js/i18n.js; see that file to add more languages or strings.
- Delete player: host scoreboard has a remove button per player (host:removePlayer), which also reopens buzzing if it removes whoever currently holds the floor.

Phase 4 (shipped):

- Buzz sound + vibration on the player screen (Web Audio, no asset file; vibration is a no-op on iOS Safari).
- Song categories: optional freeform tag per song, filter-chip bar on the host playlist, host-only data (never sent to tv/player, so no hint leakage).
- End-of-game results screen: new 'results' roundStatus, 'Show results' button on host, ranked scores + one-shot confetti on TV, game-over message on player. 'Reset entire game' is the way back to idle.
- Wrong-answer feedback: resetBuzzers now targets a 'wrong' event (distinct tone + vibration pattern) at only the specific player's socket, not a broadcast.

Also fixed: tv.js's buzzed-panel, the correct-answer confetti gating, and player.js's "locked in"/"buzzed first" logic all used to key off `buzzOrder[0]` (the first buzzer of the round) instead of the current one — stale after a reset + a different second buzzer. All three now use `buzzOrder[buzzOrder.length - 1]`. Verified directly with a two-player buzz/reset/rebuzz sequence.

Phase 5 (shipped):

- Mobile drag-to-reorder: replaced the custom HTML5 drag-and-drop (mouse-only) with SortableJS (CDN), which covers mouse/touch/pen through one library. Handle-only drag (.grip), touch gets a short delay so scrolling through the handle isn't mistaken for a drag.
- Round auto-advance: opt-in "Auto-advance after reveal (sec, 0 = off)" on host. Server-side timer (state.autoAdvance, mirrors the round-timer pattern) auto-starts the next unplayed song after a reveal, cancelled by any manual round action in the meantime. Live countdown on host + TV.

Note for next time: on tv.html, anything that needs to be visible during the 'revealed' state must live outside `.overlay` (see the `#auto-advance-hint` element, moved there after first placing it inside `#panel-revealed` and finding it never rendered) — `.overlay` intentionally fades to invisible during 'revealed' to show the real video underneath.

Phase 6 (shipped):

- Playlist search: text box on the host page, filters by title/artist (case-insensitive substring), combined with the category filter rather than replacing it. Directly useful once the playlist has dozens of songs.
- Keyboard shortcuts for hosting from a laptop: Space = reveal, R = reset buzzers, C = close round. Reuses the existing button click handlers; guarded against firing while typing in an input; hint text hidden on touch devices.
- Home-screen app icon (PWA manifest) for host.html and player.html — "Add to Home Screen" installs a real app icon, opens full-screen, no re-typing the URL. Icon is a simple vinyl-record mark generated via an offscreen canvas (matches the TV screen's existing record animation), at public/icons/. Separate manifest per page (own name/start_url) sharing the same icon set.

Phase 7 (shipped):

- Custom logo: public/logo.svg, a vinyl record with a play triangle worked into the label (same visual language as the TV's existing record animation). Replaces the 🎵 emoji in every header and as the site favicon (SVG preferred, PNG fallback). PWA icons in public/icons/ regenerated from this exact SVG (drawn onto an offscreen canvas) so the header logo, favicon, and home-screen icon are all visually identical — previously the PNG icons had a plain center hole, predating this design.
- Pre-game readiness pass: confirmed pm2 healthy, reset playlist/scores to a clean unplayed state (a keyboard-shortcut test had marked one song played), and relaunched the actual kiosk window to confirm the full real deployment path (server + kiosk Chrome + autoplay flag) still works with every change applied.

Icon generation approach (reusable next time an icon changes): draw/load the design onto an offscreen `<canvas>` in a temp page under `public/`, `canvas.toDataURL('image/png')`, and POST it to a temporary `/_save-icon` Express route that writes the decoded buffer to disk — needed because the base64 data URL is too large to return through this session's tool output directly. Remove the temp route, temp HTML file, and any JSON body-size-limit bump afterward.

Phase 8 (shipped):

- Diagnosed "video unavailable": many official-label YouTube uploads have embedding disabled by the publisher — not fixable client-side. TV now relays its real YouTube player state/errors to the host (socket event, deliberately kept out of state/broadcast() since it's TV-local monitoring info, not shared game state) so the host sees "🔊 Playing" / "⏳ Buffering…" / "❌ Embedding disabled…" next to the round-status pill instead of guessing from silence.
- Playlist import now batch-checks embeddability via the YouTube Data API (videos?part=status, up to 50 ids/call) and drops unplayable entries before they can ruin a round; import status reports a skipped count. Manual single-song add gets the same check as a best-effort, non-blocking warning (only when YOUTUBE_API_KEY is set — manual add still works with zero API setup).
- TV visual polish: the record's ring texture was perfectly rotationally symmetric so spinning it showed no visible motion — added an asymmetric diagonal shine streak. Reveal title/artist render in a playful "Fredoka" font (Vazirmatn for Farsi, same RTL font-token override pattern as --font-display/--font-body). Generalized the old buzz-only entrance animation into a shared .panel-enter effect for every panel switch. Scoreboard entries pulse (scale + color flash) on both host and TV when a score changes.
- Host layout: "Add a song" card (manual add + import) collapses during a live round (playing/buzzed) to keep focus on the Current Round card and Scoreboard, reopens on idle/revealed/results.
- Explicitly out of scope: displaying song lyrics on screen was requested but refused — reproducing copyrighted lyrics to the audience isn't something to build regardless of source or implementation.

Phase 9 (shipped):

- The reveal panel's title/artist was fading with `.overlay` almost immediately (intentional, to show the real video underneath — see the Phase 5 note) — too quick to actually read. Added a persistent caption outside `.overlay` that stays up for the whole 'revealed' state.
- Broken-video cleanup: host can now scan the *existing* playlist (not just new imports) for videos that won't embed, and remove them one at a time or in bulk — `/api/check-playlist` reuses the same `checkEmbeddable()` helper from import-time filtering.
- Manual YouTube fallback for a playback error: a button pops the real youtube.com page in an ordinary Chrome window on the kiosk PC itself (the machine that's both running the server and HDMI'd to the TV), so a non-embeddable song can still be played manually. Server reads the video ID from its own state (never trusts the client) and validates it against YouTube's 11-char ID shape before it reaches `exec()`.
- More animations: buzz-in flashes the screen gold + a shockwave rings out from the buzzer's name on TV; idle screen has musical notes gently floating up; player's buzz button pops when it becomes pressable and shakes on a wrong answer, own score pulses on change; host's round-status pill flashes on any transition, new buzz-in rows slide in.
- Confirmed (again) that YouTube Premium has no effect on "embedding disabled" — that's a checkbox the video's owner sets, unrelated to the viewer's subscription. No legitimate workaround exists beyond avoiding/removing those videos or the manual fallback above.
- Confirmed no player-count cap exists anywhere in the code — join is a plain open dictionary keyed by generated player id.
- Lyrics-on-screen was requested again (reasoning: YouTube Music shows lyrics for most songs) and refused again — a lyric being *displayed* somewhere doesn't mean it's *licensed for redistribution*; YouTube Music licenses those specifically, this app doesn't. Not going to change.
- Incident: while cleaning up a test browser window opened by the YouTube-fallback feature, killed the wrong Chrome process via `Stop-Process -Force`, which disconnected the Claude Code browser automation extension (Chrome itself and the real kiosk TV window survived undamaged — confirmed via `Get-Process`). Lesson: don't `Stop-Process -Force` on a Chrome PID to close one window — closing a specific automation-opened window should go through the automation tooling itself, not raw OS process kill, since Chrome's PID-to-window mapping isn't reliably 1:1.

Phase 10 (shipped):

- Bug fix — "increasing one player's score bumps a different player's score": host.js's scoreboard re-sorted by score on every render, so the instant you tapped +1 the row could jump position; a quick second tap (natural when awarding several points fast) then landed on whichever player's row had just slid into that screen spot. Fix: the host's own scoreboard now stays in a stable (join) order and never reorders on score changes — it's a control panel being actively tapped, not a public leaderboard. TV/player boards are untouched and still rank live, since they're display-only (no click targets to misfire).
- Bigger, better-spaced touch targets on the host page for mobile: scoreboard +/- are now 2.75rem (3rem under 600px) round buttons, and the destructive remove-player button was made visibly smaller and moved further away (extra gap, wrapped the +/- pair in its own `.score-adjust` group) so a fast tap aimed at +/- can't land on it by mistake. Buzz-row award and playlist Play/Remove buttons got the same treatment. Both this and the scoreboard-order fix are pure static file changes (host.js/host.css) — express.static serves them straight from disk, so neither needed a pm2 restart to go live.

Phase 11 (shipped):

- Fixed a real auto-advance bug: `host:resetBuzzers` never cancelled a pending auto-advance timer, so firing it while 'revealed' (e.g. the `R` keyboard shortcut out of habit) left the countdown pill silently vanishing with nothing happening instead of visibly cancelling. Now clears it like every other manual round action.
- New **toggleable game options** system: `state.settings` (settings.json, mirrors the players/playlist persistence pattern exactly — `loadSettings()`/`saveSettings()`), a generic `host:updateSettings` socket event (patch object, only known boolean keys accepted), and a "Game options" card on host with one checkbox per feature. Broadcast to host/tv/player alike since later features need tv/player awareness too (e.g. blind mode). Settings not yet built render as visibly-disabled "(coming soon)" checkboxes so the list is self-documenting rather than appearing piecemeal.
- First feature shipped behind a toggle: **Steal Mechanic**. Reuses the existing resetBuzzers flow almost entirely (it already reopens buzzing to other players after a wrong answer — the wrong buzzer just can't re-buzz via the existing `buzzOrder` guard). When enabled, a `state.roundHadMiss` flag (set on resetBuzzers, cleared on `startRound()` and after one bonus is paid) drives a `+1` bonus in `host:awardPoint` plus a distinct `'steal'` TV event (STOLEN! banner + confetti/chime) instead of the normal `'correct'` event.
- Verification approach worth reusing: with a real session live and the browser extension still down from the Phase 9 incident, tested the whole steal-mechanic flow (16 checks: settings broadcast, full steal sequence, anti-double-bonus, and a regression check that the toggle OFF exactly reproduces prior behavior) against a **fully isolated second instance** of the server — copied `server.js` alone into a scratch dir with its own empty `playlist.json`/`players.json`, ran it on port 3999 via `NODE_PATH` pointing at the real `node_modules` (no need to copy/reinstall deps), drove it with a temporary `npm install --no-save socket.io-client` test script, then killed the test process and removed the temp dir + uninstalled the temp dependency. Zero risk to the live game/data — reuse this pattern for testing future features while a real session might be running.
- Backlog for the remaining toggle-gated features, in the agreed build order: speed bonus → point values per song → TV animation bundle (countdown ring, "takes the lead" banner, 3-2-1-GO flash, all under the `extraAnimations` toggle) → blind mode → session stats → karaoke-style blank-hint (copyright-safe lyrics alternative — no real lyric text) → team mode (biggest lift, deliberately last) → Spotify-based auto-categories (separate axis, needs its own `SPOTIFY_CLIENT_ID`/`SECRET` env vars, optional like `YOUTUBE_API_KEY`). Full plan for the first of these lives in the session history — re-derive similarly (short plan, one feature at a time) rather than trying to batch multiple.

Next ideas, not yet started:

- Resuming round progress after a restart (currently only scores persist — round state intentionally resets to idle).
- More languages — i18n.js's translations object is keyed by language code, so adding a third is mostly copying the 'en'/'fa' block and adding a toggle button in host.html.
- Remote play (join from outside the home WiFi) — would need a tunnel (Cloudflare Tunnel recommended) or Tailscale, plus a join PIN since the app currently has zero authentication (anyone with the link can join/control).

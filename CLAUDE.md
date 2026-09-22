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

Note found while building the above, not fixed (out of scope for what was asked): tv.js's buzzed-panel and the correct-answer confetti gating both key off `buzzOrder[0]` (the first buzzer of the round) rather than the current one. Harmless for the common one-buzz-per-round case; after a reset + a different second buzzer, the TV would still show/credit the original name. Worth a look if it's ever seen to actually misbehave in play.

Next ideas, not yet started:

- Mobile drag-to-reorder — the current implementation is native HTML5 drag-and-drop, which doesn't support touch, so reordering from a phone still means remove + re-add.
- Round auto-advance to the next unplayed song after reveal, if the host wants a fully hands-off mode.
- Resuming round progress after a restart (currently only scores persist — round state intentionally resets to idle).
- More languages — i18n.js's translations object is keyed by language code, so adding a third is mostly copying the 'en'/'fa' block and adding a toggle button in host.html.
- Fix the buzzOrder[0]-vs-current-buzzer inconsistency noted above, if it turns out to matter in practice.

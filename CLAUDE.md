# Guess the Music — roadmap / ideas

Phase 2 (all shipped):

- Resilience: fixed reconnect handling (host/tv/player now re-register on every Socket.IO 'connect', not just once) and persist player scores to players.json so a restart doesn't wipe them.
- Host UX: YouTube playlist import (Data API v3, needs YOUTUBE_API_KEY in .env — see README), drag-to-reorder playlist, optional round timer (soft cutoff).
- TV polish: buzz-in pop animation, confetti + chime on a correct answer, rotating idle-screen hints.
- Network robustness: mDNS hostname (guess-the-music.local) advertised as a secondary join hint; DHCP reservation is still a manual router step (see README).
- Ops: pm2-logrotate can't install on this machine (breaks on the space in the Windows profile path) — replaced with scripts/rotate-logs.ps1 + a daily scheduled task instead.

Also fixed two pre-existing bugs found along the way, unrelated to the above: `[hidden]` elements weren't actually hiding sitewide (CSS specificity — see style.css), and the YouTube IFrame API sometimes silently never initializes or starts playback (see tv.js's retry/backstop logic).

Next ideas, not yet started:

- Mobile drag-to-reorder — the current implementation is native HTML5 drag-and-drop, which doesn't support touch, so reordering from a phone still means remove + re-add.
- Round auto-advance to the next unplayed song after reveal, if the host wants a fully hands-off mode.
- Resuming round progress after a restart (currently only scores persist — round state intentionally resets to idle).

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

Next ideas, not yet started:

- Resuming round progress after a restart (currently only scores persist — round state intentionally resets to idle).
- More languages — i18n.js's translations object is keyed by language code, so adding a third is mostly copying the 'en'/'fa' block and adding a toggle button in host.html.
- Remote play (join from outside the home WiFi) — would need a tunnel (Cloudflare Tunnel recommended) or Tailscale, plus a join PIN since the app currently has zero authentication (anyone with the link can join/control).

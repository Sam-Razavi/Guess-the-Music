# Guess the Music — roadmap / ideas

Phase 2 candidates, not yet started:

- Resilience: player reconnect/rejoin after a phone locks or drops WiFi (scores currently live only in server memory, so a server restart mid-game wipes them — could persist state like playlist.json does).
- Host UX: playlist search/import (e.g. paste a YouTube playlist URL instead of one song at a time), drag-to-reorder, round timer/auto-advance.
- TV polish: nicer buzz-in animation, confetti/sound on correct answer, better idle screen while no round is active.
- Network robustness: mDNS/friendly hostname (guess-the-music.local) so the QR code doesn't need to be regenerated as often, or the DHCP reservation we noted in the README.
- Ops: log rotation for pm2 (pm2 install pm2-logrotate) so logs don't grow unbounded over months of 24/7 uptime.

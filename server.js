require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Bonjour } = require('bonjour-service');

const MDNS_HOST = 'guess-the-music.local';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYLIST_FILE = path.join(__dirname, 'playlist.json');
const PLAYERS_FILE = path.join(__dirname, 'players.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---------- persistence ----------

function loadPlaylist() {
  try {
    return JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePlaylist() {
  fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(state.playlist, null, 2));
}

function loadPlayers() {
  try {
    const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    // No live socket survives a restart — always come back disconnected.
    Object.values(players).forEach(p => { p.connected = false; p.socketId = null; });
    return players;
  } catch {
    return {};
  }
}

function savePlayers() {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(state.players, null, 2));
}

function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) candidates.push({ name, address: net.address });
    }
  }
  if (!candidates.length) return 'localhost';

  // VirtualBox's default host-only network (used by e.g. BlueStacks) —
  // phones can never reach this, so never pick it if anything else exists.
  const isVirtualboxDefault = (ip) => ip.startsWith('192.168.56.');
  const isWifi = (name) => /wi-?fi|wlan/i.test(name);

  return (
    candidates.find(c => isWifi(c.name) && !isVirtualboxDefault(c.address)) ||
    candidates.find(c => !isVirtualboxDefault(c.address)) ||
    candidates[0]
  ).address;
}

// ---------- game state ----------

const state = {
  playlist: loadPlaylist(),       // [{id, youtubeId, title, artist, played}]
  currentIndex: -1,
  roundStatus: 'idle',            // idle | playing | buzzed | revealed
  buzzOrder: [],                  // [{id, name, time}]
  players: loadPlayers(),         // playerId -> {name, score, connected, socketId}
  roundTimer: null,               // {seconds, endsAt} | null — a soft cutoff, doesn't change roundStatus
  buzzingLocked: false,           // true once the timer expires with no buzz — host still controls reveal/close
  language: 'en',                 // 'en' | 'fa' — TV/player display language, set by the host
  autoAdvance: null,               // {endsAt} | null — pending auto-start of the next unplayed song after a reveal
};

let roundTimerHandle = null;
let autoAdvanceHandle = null;

function clearRoundTimer() {
  clearTimeout(roundTimerHandle);
  roundTimerHandle = null;
  state.roundTimer = null;
  state.buzzingLocked = false;
}

function clearAutoAdvance() {
  clearTimeout(autoAdvanceHandle);
  autoAdvanceHandle = null;
  state.autoAdvance = null;
}

function startRoundTimer(seconds) {
  clearTimeout(roundTimerHandle);
  state.roundTimer = { seconds, endsAt: Date.now() + seconds * 1000 };
  state.buzzingLocked = false;
  const idx = state.currentIndex;
  roundTimerHandle = setTimeout(() => {
    // Only lock if we're still on the same round and nobody's buzzed in.
    if (state.currentIndex === idx && state.roundStatus === 'playing') {
      state.buzzingLocked = true;
      broadcast();
    }
  }, seconds * 1000);
}

function startRound(id, timerSeconds) {
  const idx = state.playlist.findIndex(s => s.id === id);
  if (idx === -1) return false;
  state.currentIndex = idx;
  state.roundStatus = 'playing';
  state.buzzOrder = [];
  clearRoundTimer();
  clearAutoAdvance();
  if (timerSeconds > 0) startRoundTimer(timerSeconds);
  return true;
}

function currentSong() {
  return state.currentIndex >= 0 ? state.playlist[state.currentIndex] : null;
}

function makeSong(youtubeId, title, artist, category) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    youtubeId: youtubeId.trim(),
    title: (title || '').trim() || 'Untitled',
    artist: (artist || '').trim(),
    category: (category || '').trim(),
    played: false,
  };
}

function publicPlayers() {
  return Object.entries(state.players).map(([id, p]) => ({
    id, name: p.name, score: p.score, connected: p.connected,
  }));
}

// Three payload shapes, because the TV and players must NOT see the
// answer while a round is live, but the host always needs to.

function payloadFor(role) {
  const song = currentSong();
  const base = {
    roundStatus: state.roundStatus,
    buzzOrder: state.buzzOrder.map(b => ({ id: b.id, name: b.name })),
    players: publicPlayers(),
    roundTimer: state.roundTimer,
    buzzingLocked: state.buzzingLocked,
    language: state.language,
    autoAdvance: state.autoAdvance,
  };

  if (role === 'host') {
    return {
      ...base,
      playlist: state.playlist,
      currentIndex: state.currentIndex,
      currentSong: song,
    };
  }

  if (role === 'tv') {
    const revealed = state.roundStatus === 'revealed';
    return {
      ...base,
      currentSong: song
        ? { youtubeId: song.youtubeId, title: revealed ? song.title : null, artist: revealed ? song.artist : null }
        : null,
    };
  }

  // player
  return base;
}

function broadcast() {
  io.to('host').emit('state', payloadFor('host'));
  io.to('tv').emit('state', payloadFor('tv'));
  io.to('player').emit('state', payloadFor('player'));
}

// ---------- routes ----------

app.get('/join-info', (req, res) => {
  const ip = getLanIp();
  res.json({
    url: `http://${ip}:${PORT}/player.html`,
    // Secondary convenience only — Android Chrome's mDNS support is
    // inconsistent, so the IP-based URL above (and the QR code) stays
    // the reliable one.
    mdnsUrl: `http://${MDNS_HOST}:${PORT}/player.html`,
  });
});

app.get('/qr.png', async (req, res) => {
  const ip = getLanIp();
  const url = `http://${ip}:${PORT}/player.html`;
  try {
    const png = await QRCode.toBuffer(url, { width: 320, margin: 1, color: { dark: '#16121f', light: '#00000000' } });
    res.type('png').send(png);
  } catch (e) {
    res.status(500).end();
  }
});

function extractPlaylistId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const list = url.searchParams.get('list');
    if (list) return list;
  } catch { /* not a URL — maybe a bare playlist ID */ }
  if (/^[\w-]+$/.test(raw)) return raw;
  return null;
}

// Checks which of the given video IDs can actually play in an embedded
// player — many official-label uploads have this disabled by the
// publisher, which is exactly what shows up as "Video unavailable" once
// a round is already live. Batches in groups of 50 (the API's max per
// call). Returns a Set of the IDs that ARE embeddable.
async function checkEmbeddable(apiKey, videoIds) {
  const embeddable = new Set();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      apiUrl.searchParams.set('part', 'status');
      apiUrl.searchParams.set('id', batch.join(','));
      apiUrl.searchParams.set('key', apiKey);
      const r = await fetch(apiUrl);
      if (!r.ok) { batch.forEach(id => embeddable.add(id)); continue; } // fail open — never block an import over a failed check
      const data = await r.json();
      const seen = new Set();
      for (const item of data.items || []) {
        seen.add(item.id);
        if (item.status && item.status.embeddable !== false) embeddable.add(item.id);
      }
      // An id the API didn't return at all (rare) — fail open rather than silently dropping it.
      batch.forEach(id => { if (!seen.has(id)) embeddable.add(id); });
    } catch (e) {
      batch.forEach(id => embeddable.add(id));
    }
  }
  return embeddable;
}

app.post('/api/import-playlist', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: "YouTube import isn't configured — add YOUTUBE_API_KEY to your .env file (see README).",
    });
  }

  const playlistId = extractPlaylistId(req.body && req.body.url);
  if (!playlistId) {
    return res.status(400).json({ error: "Couldn't find a playlist ID in that link." });
  }

  try {
    const songs = [];
    let pageToken = '';
    do {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      apiUrl.searchParams.set('part', 'snippet');
      apiUrl.searchParams.set('playlistId', playlistId);
      apiUrl.searchParams.set('maxResults', '50');
      apiUrl.searchParams.set('key', apiKey);
      if (pageToken) apiUrl.searchParams.set('pageToken', pageToken);

      const r = await fetch(apiUrl);
      const data = await r.json();
      if (!r.ok) {
        const message = (data.error && data.error.message) || `YouTube API error (${r.status})`;
        return res.status(502).json({ error: message });
      }

      for (const item of data.items || []) {
        const s = item.snippet;
        if (!s || s.title === 'Private video' || s.title === 'Deleted video') continue;
        const videoId = s.resourceId && s.resourceId.videoId;
        if (!videoId) continue;
        songs.push({ youtubeId: videoId, title: s.title, artist: s.videoOwnerChannelTitle || '' });
      }

      pageToken = data.nextPageToken || '';
    } while (pageToken && songs.length < 200);

    const embeddable = await checkEmbeddable(apiKey, songs.map(s => s.youtubeId));
    const playable = songs.filter(s => embeddable.has(s.youtubeId));

    res.json({ songs: playable, skipped: songs.length - playable.length });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the YouTube API — check your connection and try again.' });
  }
});

// ---------- sockets ----------

io.on('connection', (socket) => {
  let role = null;
  let playerId = null;

  socket.on('register', ({ role: r, id, name }) => {
    role = r;
    socket.join(role);

    if (role === 'player') {
      playerId = id;
      if (!state.players[playerId]) {
        state.players[playerId] = { name: name || 'Player', score: 0, connected: true, socketId: socket.id };
      } else {
        state.players[playerId].connected = true;
        state.players[playerId].socketId = socket.id;
        if (name) state.players[playerId].name = name;
      }
      savePlayers();
      broadcast();
    } else {
      socket.emit('state', payloadFor(role));
    }
  });

  socket.on('player:rename', ({ name }) => {
    if (playerId && state.players[playerId] && name && name.trim()) {
      state.players[playerId].name = name.trim().slice(0, 24);
      savePlayers();
      broadcast();
    }
  });

  socket.on('player:buzz', () => {
    if (!playerId || state.roundStatus !== 'playing' || state.buzzingLocked) return;
    if (state.buzzOrder.find(b => b.id === playerId)) return;
    // Reaching this point means the round was open ('playing') and this
    // player hadn't buzzed yet — so this is always the buzz that takes
    // the floor, whether it's the round's 1st buzz or a later one after
    // a host:resetBuzzers reopened things.
    state.buzzOrder.push({ id: playerId, name: state.players[playerId].name, time: Date.now() });
    state.roundStatus = 'buzzed';
    broadcast();
  });

  socket.on('host:addSong', async ({ youtubeId, title, artist, category }) => {
    if (!youtubeId) return;
    state.playlist.push(makeSong(youtubeId, title, artist, category));
    savePlaylist();
    broadcast();

    // Best-effort only — manual add works with zero YouTube API setup
    // today, and should keep working the same way with none configured.
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      const id = youtubeId.trim();
      try {
        const embeddable = await checkEmbeddable(apiKey, [id]);
        if (!embeddable.has(id)) {
          socket.emit('addSongWarning', {
            youtubeId: id,
            message: "Heads up: this video has embedding disabled by its owner and likely won't play on the TV.",
          });
        }
      } catch (e) { /* non-blocking — the song's already added either way */ }
    }
  });

  socket.on('host:addSongs', (songs) => {
    if (!Array.isArray(songs) || !songs.length) return;
    const existingIds = new Set(state.playlist.map(s => s.youtubeId));
    for (const { youtubeId, title, artist, category } of songs) {
      if (!youtubeId || existingIds.has(youtubeId.trim())) continue;
      const song = makeSong(youtubeId, title, artist, category);
      state.playlist.push(song);
      existingIds.add(song.youtubeId);
    }
    savePlaylist();
    broadcast();
  });

  socket.on('host:removeSong', ({ id }) => {
    state.playlist = state.playlist.filter(s => s.id !== id);
    if (currentSong() && currentSong().id === id) {
      state.currentIndex = -1;
      state.roundStatus = 'idle';
      clearRoundTimer();
    }
    savePlaylist();
    broadcast();
  });

  socket.on('host:reorderPlaylist', ({ ids }) => {
    if (!Array.isArray(ids)) return;
    const byId = new Map(state.playlist.map(s => [s.id, s]));
    const reordered = ids.map(id => byId.get(id)).filter(Boolean);
    // Only accept it if it's a true reordering (same songs, new order) —
    // a stale/partial list from a slow client shouldn't drop songs.
    if (reordered.length !== state.playlist.length) return;
    state.playlist = reordered;
    savePlaylist();
    broadcast();
  });

  socket.on('host:startRound', ({ id, timerSeconds }) => {
    if (startRound(id, timerSeconds)) broadcast();
  });

  socket.on('host:resetBuzzers', () => {
    if (state.currentIndex === -1) return;
    // Resetting buzzers after someone's had a turn means their answer was
    // wrong — give that specific player (not everyone) a distinct sound/
    // vibration on their own phone. Targeted at their actual socket, not
    // broadcast to the whole 'player' room.
    const current = state.buzzOrder[state.buzzOrder.length - 1];
    if (current && state.players[current.id] && state.players[current.id].socketId) {
      io.to(state.players[current.id].socketId).emit('wrong');
    }
    const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
    state.roundStatus = 'playing';
    clearRoundTimer();
    if (priorTimerSeconds > 0) startRoundTimer(priorTimerSeconds);
    broadcast();
  });

  socket.on('host:revealAnswer', ({ autoAdvanceSeconds } = {}) => {
    // Snapshot the round timer that was active for the song just revealed,
    // so an auto-started next round can reuse the same duration — not
    // read back from a persisted field, since the host's timer input may
    // change before auto-advance actually fires.
    const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
    clearAutoAdvance();
    if (state.currentIndex >= 0) {
      state.playlist[state.currentIndex].played = true;
      savePlaylist();
    }
    state.roundStatus = 'revealed';
    clearRoundTimer();

    if (autoAdvanceSeconds > 0) {
      state.autoAdvance = { endsAt: Date.now() + autoAdvanceSeconds * 1000 };
      autoAdvanceHandle = setTimeout(() => {
        state.autoAdvance = null;
        // Only proceed if the host hasn't already moved on manually —
        // any of resetBuzzers/startRound/closeRound/showResults/resetGame
        // would have changed roundStatus away from 'revealed' by now.
        if (state.roundStatus === 'revealed') {
          const next = state.playlist.find(s => !s.played);
          if (next) startRound(next.id, priorTimerSeconds);
        }
        broadcast();
      }, autoAdvanceSeconds * 1000);
    }

    broadcast();
  });

  socket.on('host:awardPoint', ({ id, delta }) => {
    if (state.players[id]) {
      state.players[id].score += delta;
      savePlayers();
      // Confetti/chime on the TV only for the natural "they got it right"
      // case — the current buzz-in leader (the most recent buzzer, not
      // necessarily the first of the round if there was a reset in
      // between) getting a point — not just any manual scoreboard tweak
      // elsewhere on the host page.
      const currentBuzzer = state.buzzOrder[state.buzzOrder.length - 1];
      if (delta > 0 && state.roundStatus === 'buzzed' && currentBuzzer && currentBuzzer.id === id) {
        io.to('tv').emit('correct', { name: state.players[id].name });
      }
      broadcast();
    }
  });

  socket.on('host:setLanguage', (lang) => {
    if (lang !== 'en' && lang !== 'fa') return;
    state.language = lang;
    broadcast();
  });

  // Relay only — TV-local playback monitoring for the host's benefit, not
  // shared game state, so it deliberately bypasses state/broadcast().
  socket.on('tv:playerStatus', (payload) => {
    io.to('host').emit('playerStatus', payload);
  });

  socket.on('host:removePlayer', ({ id }) => {
    if (!state.players[id]) return;
    delete state.players[id];
    const hadBuzzed = state.buzzOrder.some(b => b.id === id);
    state.buzzOrder = state.buzzOrder.filter(b => b.id !== id);
    // If the player we removed was the one currently holding the floor,
    // reopen buzzing for whoever's left rather than leaving the round
    // stuck on a buzz-in that no longer has anyone behind it.
    if (hadBuzzed && state.roundStatus === 'buzzed' && state.buzzOrder.length === 0) {
      state.roundStatus = 'playing';
    }
    savePlayers();
    broadcast();
  });

  socket.on('host:showResults', () => {
    state.roundStatus = 'results';
    state.currentIndex = -1;
    state.buzzOrder = [];
    clearRoundTimer();
    clearAutoAdvance();
    broadcast();
  });

  socket.on('host:closeRound', () => {
    state.roundStatus = 'idle';
    state.currentIndex = -1;
    state.buzzOrder = [];
    clearRoundTimer();
    clearAutoAdvance();
    broadcast();
  });

  socket.on('host:resetGame', () => {
    Object.values(state.players).forEach(p => { p.score = 0; });
    state.playlist.forEach(s => { s.played = false; });
    savePlaylist();
    savePlayers();
    state.currentIndex = -1;
    state.roundStatus = 'idle';
    state.buzzOrder = [];
    clearRoundTimer();
    clearAutoAdvance();
    broadcast();
  });

  socket.on('disconnect', () => {
    if (role === 'player' && playerId && state.players[playerId]) {
      state.players[playerId].connected = false;
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  const ip = getLanIp();
  console.log('\nGuess the Music is running!\n');
  console.log(`  TV (Android TV browser):  http://${ip}:${PORT}/tv.html`);
  console.log(`  Host control (your phone/laptop): http://${ip}:${PORT}/host.html`);
  console.log(`  Players join:              http://${ip}:${PORT}/player.html`);
  console.log(`\n  (All devices must be on the same WiFi network.)\n`);

  // Best-effort convenience only — mDNS relies on UDP multicast, which some
  // networks/firewalls block. Never let a failure here affect the game.
  try {
    const bonjour = new Bonjour();
    bonjour.publish({ name: 'Guess the Music', type: 'http', port: PORT, host: MDNS_HOST });
    console.log(`  Also reachable at: http://${MDNS_HOST}:${PORT}/ (if your network allows mDNS)\n`);
    const shutdown = () => bonjour.unpublishAll(() => bonjour.destroy());
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (e) {
    console.log('  (mDNS advertising unavailable — the IP-based links above still work.)\n');
  }
});

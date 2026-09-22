require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

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
};

let roundTimerHandle = null;

function clearRoundTimer() {
  clearTimeout(roundTimerHandle);
  roundTimerHandle = null;
  state.roundTimer = null;
  state.buzzingLocked = false;
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

function currentSong() {
  return state.currentIndex >= 0 ? state.playlist[state.currentIndex] : null;
}

function makeSong(youtubeId, title, artist) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    youtubeId: youtubeId.trim(),
    title: (title || '').trim() || 'Untitled',
    artist: (artist || '').trim(),
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
  res.json({ url: `http://${ip}:${PORT}/player.html` });
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

    res.json({ songs });
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

  socket.on('host:addSong', ({ youtubeId, title, artist }) => {
    if (!youtubeId) return;
    state.playlist.push(makeSong(youtubeId, title, artist));
    savePlaylist();
    broadcast();
  });

  socket.on('host:addSongs', (songs) => {
    if (!Array.isArray(songs) || !songs.length) return;
    const existingIds = new Set(state.playlist.map(s => s.youtubeId));
    for (const { youtubeId, title, artist } of songs) {
      if (!youtubeId || existingIds.has(youtubeId.trim())) continue;
      const song = makeSong(youtubeId, title, artist);
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
    const idx = state.playlist.findIndex(s => s.id === id);
    if (idx === -1) return;
    state.currentIndex = idx;
    state.roundStatus = 'playing';
    state.buzzOrder = [];
    clearRoundTimer();
    if (timerSeconds > 0) startRoundTimer(timerSeconds);
    broadcast();
  });

  socket.on('host:resetBuzzers', () => {
    if (state.currentIndex === -1) return;
    const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
    state.roundStatus = 'playing';
    clearRoundTimer();
    if (priorTimerSeconds > 0) startRoundTimer(priorTimerSeconds);
    broadcast();
  });

  socket.on('host:revealAnswer', () => {
    if (state.currentIndex >= 0) {
      state.playlist[state.currentIndex].played = true;
      savePlaylist();
    }
    state.roundStatus = 'revealed';
    clearRoundTimer();
    broadcast();
  });

  socket.on('host:awardPoint', ({ id, delta }) => {
    if (state.players[id]) {
      state.players[id].score += delta;
      savePlayers();
      broadcast();
    }
  });

  socket.on('host:closeRound', () => {
    state.roundStatus = 'idle';
    state.currentIndex = -1;
    state.buzzOrder = [];
    clearRoundTimer();
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
});

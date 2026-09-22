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

app.use(express.static(path.join(__dirname, 'public')));

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

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ---------- game state ----------

const state = {
  playlist: loadPlaylist(),       // [{id, youtubeId, title, artist, played}]
  currentIndex: -1,
  roundStatus: 'idle',            // idle | playing | buzzed | revealed
  buzzOrder: [],                  // [{id, name, time}]
  players: {},                    // playerId -> {name, score, connected, socketId}
};

function currentSong() {
  return state.currentIndex >= 0 ? state.playlist[state.currentIndex] : null;
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
      broadcast();
    } else {
      socket.emit('state', payloadFor(role));
    }
  });

  socket.on('player:rename', ({ name }) => {
    if (playerId && state.players[playerId] && name && name.trim()) {
      state.players[playerId].name = name.trim().slice(0, 24);
      broadcast();
    }
  });

  socket.on('player:buzz', () => {
    if (!playerId || state.roundStatus !== 'playing') return;
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
    state.playlist.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      youtubeId: youtubeId.trim(),
      title: (title || '').trim() || 'Untitled',
      artist: (artist || '').trim(),
      played: false,
    });
    savePlaylist();
    broadcast();
  });

  socket.on('host:removeSong', ({ id }) => {
    state.playlist = state.playlist.filter(s => s.id !== id);
    if (currentSong() && currentSong().id === id) {
      state.currentIndex = -1;
      state.roundStatus = 'idle';
    }
    savePlaylist();
    broadcast();
  });

  socket.on('host:startRound', ({ id }) => {
    const idx = state.playlist.findIndex(s => s.id === id);
    if (idx === -1) return;
    state.currentIndex = idx;
    state.roundStatus = 'playing';
    state.buzzOrder = [];
    broadcast();
  });

  socket.on('host:resetBuzzers', () => {
    if (state.currentIndex === -1) return;
    state.roundStatus = 'playing';
    broadcast();
  });

  socket.on('host:revealAnswer', () => {
    if (state.currentIndex >= 0) {
      state.playlist[state.currentIndex].played = true;
      savePlaylist();
    }
    state.roundStatus = 'revealed';
    broadcast();
  });

  socket.on('host:awardPoint', ({ id, delta }) => {
    if (state.players[id]) {
      state.players[id].score += delta;
      broadcast();
    }
  });

  socket.on('host:closeRound', () => {
    state.roundStatus = 'idle';
    state.currentIndex = -1;
    state.buzzOrder = [];
    broadcast();
  });

  socket.on('host:resetGame', () => {
    Object.values(state.players).forEach(p => { p.score = 0; });
    state.playlist.forEach(s => { s.played = false; });
    savePlaylist();
    state.currentIndex = -1;
    state.roundStatus = 'idle';
    state.buzzOrder = [];
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

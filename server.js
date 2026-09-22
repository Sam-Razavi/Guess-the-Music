require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Bonjour } = require('bonjour-service');
const { exec } = require('child_process');

const MDNS_HOST = 'guess-the-music.local';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYLIST_FILE = path.join(__dirname, 'playlist.json');
const PLAYERS_FILE = path.join(__dirname, 'players.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const STATS_FILE = path.join(__dirname, 'stats.json');

const DEFAULT_STATS = {
  fastestBuzz: null,          // {name, ms, at} | null — quickest reaction to a round starting, all-time
  mostPointsInRound: null,    // {name, points, at} | null — biggest single correct-answer award, all-time
};

const DEFAULT_SETTINGS = {
  stealMechanic: false,
  speedBonus: false,
  pointValues: false,
  blindMode: false,
  teamMode: false,
  sessionStats: false,
  karaokeHint: false,
  autoCategories: false,
  extraAnimations: true,
  mysteryRound: false,
  categoryVoting: false,
};

// Mystery Modifier Round: exactly one song per game gets a random surprise
// twist, built entirely from toggles/mechanics that already exist elsewhere
// (point values per song, the karaoke hint, blind-mode's score hiding) —
// see ensureMysterySong() and payloadFor() for how each one is applied.
const MYSTERY_LABELS = {
  double: 'Double Points!',
  noHint: 'No Hints!',
  blind: 'Blind Reveal!',
};
const MYSTERY_MODIFIER_KEYS = Object.keys(MYSTERY_LABELS);

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

function loadSettings() {
  try {
    // Merge over defaults so a settings.json from before a new toggle was
    // added still gets that toggle's default, instead of it reading undefined.
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state.settings, null, 2));
}

function loadStats() {
  try {
    return { ...DEFAULT_STATS, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveStats() {
  fs.writeFileSync(STATS_FILE, JSON.stringify(state.stats, null, 2));
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
  settings: loadSettings(),       // host-toggleable game options — see DEFAULT_SETTINGS
  roundHadMiss: false,             // true once resetBuzzers has fired this round — powers the steal-mechanic bonus
  roundStartedAt: null,            // Date.now() when the current round began — powers the speed-bonus window
  speedBonusPaid: false,           // true once this round's speed bonus has been awarded once
  stats: loadStats(),              // all-time records — see DEFAULT_STATS; only recorded while sessionStats is on
  hintRevealedIndices: [],         // character indices of the current song's title already revealed — see buildHintMask
  mysterySongId: null,             // id of this game's one Mystery Modifier Round song, or null — see ensureMysterySong()
  mysteryModifier: null,           // 'double' | 'noHint' | 'blind' | null — only revealed (via payloadFor) once that song's round starts
  categoryVote: null,              // {options, votes: {playerId: category}, closed, result, endsAt} | null — see host:startCategoryVote
};

const SPEED_BONUS_WINDOW_MS = 3000;

let roundTimerHandle = null;
let autoAdvanceHandle = null;
let voteTimerHandle = null;

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
  state.roundHadMiss = false;
  state.roundStartedAt = Date.now();
  state.speedBonusPaid = false;
  state.hintRevealedIndices = [];
  // The vote (if any) has done its job of picking a category to play from —
  // clear it so a stale result doesn't linger once the round it fed into begins.
  clearVoteTimer();
  state.categoryVote = null;
  clearRoundTimer();
  clearAutoAdvance();
  if (timerSeconds > 0) startRoundTimer(timerSeconds);
  return true;
}

// Picks this game's one Mystery Modifier Round song, lazily and stickily:
// called on every broadcast, it only actually assigns once (when the toggle
// is on and no song is currently flagged), and never re-rolls afterwards —
// including once that song's been played — so it's truly one song per game.
// resetGame is what clears it for a fresh pick next game.
function ensureMysterySong() {
  if (!state.settings.mysteryRound) {
    if (state.mysterySongId) { state.mysterySongId = null; state.mysteryModifier = null; }
    return;
  }
  if (state.mysterySongId && state.playlist.some(s => s.id === state.mysterySongId)) return;
  const candidates = state.playlist.filter(s => !s.played);
  if (!candidates.length) return; // nothing to assign yet — retried on the next broadcast
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.mysterySongId = pick.id;
  state.mysteryModifier = MYSTERY_MODIFIER_KEYS[Math.floor(Math.random() * MYSTERY_MODIFIER_KEYS.length)];
}

// ---------- category voting ----------

function clearVoteTimer() {
  clearTimeout(voteTimerHandle);
  voteTimerHandle = null;
}

function tallyVotes(vote) {
  const counts = {};
  vote.options.forEach(c => { counts[c] = 0; });
  Object.values(vote.votes).forEach(c => { if (counts[c] !== undefined) counts[c]++; });
  return counts;
}

function closeCategoryVote() {
  if (!state.categoryVote || state.categoryVote.closed) return;
  clearVoteTimer();
  const counts = tallyVotes(state.categoryVote);
  const max = Math.max(0, ...Object.values(counts));
  const winners = state.categoryVote.options.filter(c => counts[c] === max);
  // Nobody voted at all (max === 0) — pick at random rather than leaving the
  // host stuck with no result.
  const result = winners.length ? winners[Math.floor(Math.random() * winners.length)] : null;
  state.categoryVote.closed = true;
  state.categoryVote.result = result;
}

// Karaoke hint: a copyright-safe guessing aid built from the song's own
// TITLE (data the host typed themselves), never from actual lyrics — there's
// no licensed lyrics source available, so this is the closest safe
// equivalent to "blank-per-word, reveal as you go". Letters/digits start
// masked as underscores; spaces and punctuation stay visible so the word
// shape is readable.
function buildHintMask(title, revealedIndices) {
  const revealed = new Set(revealedIndices);
  return [...title].map((ch, i) => (/[a-zA-Z0-9]/.test(ch) ? (revealed.has(i) ? ch : '_') : ch)).join(' ');
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
    points: 1,                    // how many points a correct buzz on this song is worth — see host:setSongPoints
  };
}

function publicPlayers() {
  return Object.entries(state.players).map(([id, p]) => ({
    id, name: p.name, score: p.score, connected: p.connected, team: p.team || '',
  }));
}

// Team mode: an empty/blank team means "no team" (solo), never grouped
// with other blank-team players — so team checks always compare non-empty,
// trimmed team names.
function teamOf(playerId) {
  const p = state.players[playerId];
  return p ? (p.team || '').trim() : '';
}

// Three payload shapes, because the TV and players must NOT see the
// answer while a round is live, but the host always needs to.

function payloadFor(role) {
  const song = currentSong();
  // The mystery modifier only ever surfaces once its flagged song is the
  // one actually being played — never previewed ahead of time, so it stays
  // a surprise for host, TV and players alike.
  const isMysterySong = !!(song && state.settings.mysteryRound && state.mysterySongId === song.id);
  const mysteryModifier = isMysterySong ? state.mysteryModifier : null;

  const base = {
    roundStatus: state.roundStatus,
    buzzOrder: state.buzzOrder.map(b => ({ id: b.id, name: b.name })),
    players: publicPlayers(),
    roundTimer: state.roundTimer,
    buzzingLocked: state.buzzingLocked,
    language: state.language,
    autoAdvance: state.autoAdvance,
    settings: state.settings,
    stats: state.stats,
    mysteryRound: mysteryModifier ? { modifier: mysteryModifier, label: MYSTERY_LABELS[mysteryModifier] } : null,
    categoryVote: state.categoryVote
      ? {
          options: state.categoryVote.options,
          votes: state.categoryVote.votes,
          counts: tallyVotes(state.categoryVote),
          closed: state.categoryVote.closed,
          result: state.categoryVote.result,
          endsAt: state.categoryVote.endsAt,
        }
      : null,
  };

  if (role === 'host') {
    return {
      ...base,
      playlist: state.playlist,
      currentIndex: state.currentIndex,
      // "Double points" reuses the points-per-song pipeline exactly — just
      // overriding the runtime value shown/awarded for this one round. The
      // song's own stored points field never changes.
      currentSong: song && mysteryModifier === 'double' ? { ...song, points: (song.points || 1) * 2 } : song,
      // Which unplayed song is this game's mystery song — shown as a badge
      // in the host's playlist so they can choose when to play it. The
      // MODIFIER itself is still withheld (via mysteryRound above) until
      // that round actually starts, so it's a surprise for the host too.
      mysterySongId: state.settings.mysteryRound ? state.mysterySongId : null,
    };
  }

  if (role === 'tv') {
    const revealed = state.roundStatus === 'revealed';
    // Blind mode: TV shows names but not scores until results, for
    // suspense. Only the TV's own copy of players is touched here — host
    // always sees real scores, and each player still sees their own on
    // their own phone (that's personal, not a public leaderboard reveal).
    // A mystery "blind reveal" round does the same thing but scoped to just
    // that one round — hidden while it's live, back to normal the moment it
    // reaches 'revealed', regardless of whether blindMode itself is on.
    const isMysteryBlindLive = mysteryModifier === 'blind' && (state.roundStatus === 'playing' || state.roundStatus === 'buzzed');
    const hideScores = (state.settings.blindMode && state.roundStatus !== 'results') || isMysteryBlindLive;
    const showHint = state.settings.karaokeHint && state.roundStatus === 'playing' && song && mysteryModifier !== 'noHint';
    return {
      ...base,
      players: hideScores ? base.players.map(p => ({ ...p, score: null })) : base.players,
      currentSong: song
        ? {
            youtubeId: song.youtubeId,
            title: revealed ? song.title : null,
            artist: revealed ? song.artist : null,
            hint: showHint ? buildHintMask(song.title, state.hintRevealedIndices) : null,
          }
        : null,
    };
  }

  // player
  return base;
}

function broadcast() {
  ensureMysterySong();
  io.to('host').emit('state', payloadFor('host'));
  io.to('tv').emit('state', payloadFor('tv'));
  io.to('player').emit('state', payloadFor('player'));
}

// ---------- Spotify auto-categories (optional, like YOUTUBE_API_KEY) ----------

let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) return spotifyTokenCache.token;
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const data = await r.json();
    spotifyTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return spotifyTokenCache.token;
  } catch (e) {
    return null;
  }
}

// Best-effort category suggestion from the matched track's artist genre.
// Fails silently (returns null) on missing config, no match, or any error —
// this is a convenience only and must never block adding a song or an
// import. Spotify's genre tagging is inconsistent (sparse for many
// non-Western artists), so this is "suggested category, host can override",
// never a guarantee.
async function suggestCategory(title, artist) {
  const token = await getSpotifyToken();
  if (!token) return null;
  try {
    const q = encodeURIComponent(`track:${title}${artist ? ' artist:' + artist : ''}`);
    const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const track = searchData.tracks && searchData.tracks.items && searchData.tracks.items[0];
    const artistId = track && track.artists && track.artists[0] && track.artists[0].id;
    if (!artistId) return null;
    const artistRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!artistRes.ok) return null;
    const artistData = await artistRes.json();
    const genre = artistData.genres && artistData.genres[0];
    if (!genre) return null;
    return genre.replace(/\b\w/g, (c) => c.toUpperCase()); // "art pop" -> "Art Pop"
  } catch (e) {
    return null;
  }
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

    // Auto-category suggestion per song — a small concurrency limit keeps a
    // big playlist from taking forever while not hammering Spotify's rate
    // limit. The host's own blanket "Tag these as..." (applied client-side,
    // if they used it) still wins over these per-song suggestions.
    if (state.settings.autoCategories) {
      const CONCURRENCY = 5;
      for (let i = 0; i < playable.length; i += CONCURRENCY) {
        const batch = playable.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (s) => {
          try {
            const suggested = await suggestCategory(s.title, s.artist);
            if (suggested) s.category = suggested;
          } catch (e) { /* non-blocking */ }
        }));
      }
    }

    res.json({ songs: playable, skipped: songs.length - playable.length });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the YouTube API — check your connection and try again.' });
  }
});

// Read-only: scans the songs already in the playlist (added before the
// import/add-time checks below existed, or added back when no API key was
// configured) and reports which ones can't actually play embedded. Doesn't
// touch state — removal is a separate, explicit host action.
app.post('/api/check-playlist', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: "YouTube checks aren't configured — add YOUTUBE_API_KEY to your .env file (see README).",
    });
  }
  try {
    const embeddable = await checkEmbeddable(apiKey, state.playlist.map(s => s.youtubeId));
    const broken = state.playlist
      .filter(s => !embeddable.has(s.youtubeId))
      .map(s => ({ id: s.id, title: s.title, artist: s.artist }));
    res.json({ broken });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the YouTube API — check your connection and try again.' });
  }
});

// ---------- sockets ----------

io.on('connection', (socket) => {
  let role = null;
  let playerId = null;

  socket.on('register', ({ role: r, id, name, team }) => {
    role = r;
    socket.join(role);

    if (role === 'player') {
      playerId = id;
      const cleanTeam = (team || '').trim().slice(0, 24);
      if (!state.players[playerId]) {
        state.players[playerId] = { name: name || 'Player', score: 0, connected: true, socketId: socket.id, team: cleanTeam };
      } else {
        state.players[playerId].connected = true;
        state.players[playerId].socketId = socket.id;
        if (name) state.players[playerId].name = name;
        if (team !== undefined) state.players[playerId].team = cleanTeam;
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
    // Team mode: a buzz locks out the whole team, not just the one player —
    // teammates share the buzz-in the same way an individual player does.
    if (state.settings.teamMode) {
      const myTeam = teamOf(playerId);
      if (myTeam && state.buzzOrder.some(b => teamOf(b.id) === myTeam)) return;
    }
    // Reaching this point means the round was open ('playing') and this
    // player hadn't buzzed yet — so this is always the buzz that takes
    // the floor, whether it's the round's 1st buzz or a later one after
    // a host:resetBuzzers reopened things.
    const buzzTime = Date.now();
    const isFirstBuzzOfRound = state.buzzOrder.length === 0;
    state.buzzOrder.push({ id: playerId, name: state.players[playerId].name, time: buzzTime });
    state.roundStatus = 'buzzed';

    // Fastest-buzz record only counts the round's actual first reaction —
    // a steal's buzz happens well after the round started and isn't a fair
    // comparison against a fresh round-start reaction.
    if (state.settings.sessionStats && isFirstBuzzOfRound && state.roundStartedAt) {
      const ms = buzzTime - state.roundStartedAt;
      if (!state.stats.fastestBuzz || ms < state.stats.fastestBuzz.ms) {
        state.stats.fastestBuzz = { name: state.players[playerId].name, ms, at: buzzTime };
        saveStats();
      }
    }

    broadcast();
  });

  socket.on('host:addSong', async ({ youtubeId, title, artist, category }) => {
    if (!youtubeId) return;
    const song = makeSong(youtubeId, title, artist, category);
    state.playlist.push(song);
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

    // Auto-category suggestion — only when the host didn't already type
    // one themselves; never overwrites a manual choice.
    if (state.settings.autoCategories && !song.category) {
      try {
        const suggested = await suggestCategory(song.title, song.artist);
        if (suggested && !song.category) {
          song.category = suggested;
          savePlaylist();
          broadcast();
        }
      } catch (e) { /* non-blocking */ }
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

  socket.on('host:setSongPoints', ({ id, points }) => {
    const song = state.playlist.find(s => s.id === id);
    const n = Number(points);
    if (!song || !Number.isFinite(n) || n < 1) return;
    song.points = Math.round(n);
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
    // Marks this round as "had a miss" — powers the steal-mechanic bonus if
    // whoever buzzes in next actually gets it right (see host:awardPoint).
    if (current) state.roundHadMiss = true;
    const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
    state.roundStatus = 'playing';
    clearRoundTimer();
    // Also cancel any pending auto-advance — resetBuzzers can fire while
    // 'revealed' (e.g. the R shortcut hit out of habit), and without this
    // the countdown pill just silently vanishes with nothing happening,
    // instead of visibly cancelling.
    clearAutoAdvance();
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
      // Confetti/chime on the TV only for the natural "they got it right"
      // case — the current buzz-in leader (the most recent buzzer, not
      // necessarily the first of the round if there was a reset in
      // between) getting a point — not just any manual scoreboard tweak
      // elsewhere on the host page.
      const currentBuzzer = state.buzzOrder[state.buzzOrder.length - 1];
      const isNaturalCorrectAward = delta > 0 && state.roundStatus === 'buzzed' && currentBuzzer && currentBuzzer.id === id;
      // A "steal": this round already had a miss (resetBuzzers fired), and
      // whoever buzzed in after that miss just got it right — bonus point
      // on top of the normal award. Only one bonus per steal opportunity,
      // so a second manual +1 on the same buzzer doesn't re-trigger it.
      const isSteal = isNaturalCorrectAward && state.settings.stealMechanic && state.roundHadMiss;
      // Speed bonus: buzzed in within the first few seconds of the round
      // actually starting (not of the reveal, or of this award — the buzz
      // timestamp itself). One bonus per round, same one-shot guard pattern
      // as the steal bonus above.
      const isSpeedBonus = isNaturalCorrectAward && state.settings.speedBonus && !state.speedBonusPaid
        && state.roundStartedAt && (currentBuzzer.time - state.roundStartedAt) <= SPEED_BONUS_WINDOW_MS;

      const totalAwarded = delta + (isSteal ? 1 : 0) + (isSpeedBonus ? 1 : 0);
      // Team mode: the award goes to every teammate too, not just whoever's
      // buzzer this was — steal/speed bonus eligibility above is still based
      // on the actual buzzer's own timing, only the resulting points fan out.
      const team = state.settings.teamMode ? teamOf(id) : '';
      const recipients = team ? Object.keys(state.players).filter(pid => teamOf(pid) === team) : [id];
      recipients.forEach(pid => { state.players[pid].score += totalAwarded; });
      savePlayers();

      if (isSpeedBonus) state.speedBonusPaid = true;

      // Only a natural correct-answer award counts as a "round" achievement
      // for the record book — a manual scoreboard nudge isn't tied to
      // actually answering anything.
      if (isNaturalCorrectAward && state.settings.sessionStats && totalAwarded > 0
          && (!state.stats.mostPointsInRound || totalAwarded > state.stats.mostPointsInRound.points)) {
        state.stats.mostPointsInRound = { name: state.players[id].name, points: totalAwarded, at: Date.now() };
        saveStats();
      }

      if (isSteal) {
        state.roundHadMiss = false;
        io.to('tv').emit('steal', { name: state.players[id].name, speedBonus: isSpeedBonus });
      } else if (isNaturalCorrectAward) {
        io.to('tv').emit('correct', { name: state.players[id].name, speedBonus: isSpeedBonus });
      }
      broadcast();
    }
  });

  socket.on('host:setLanguage', (lang) => {
    if (lang !== 'en' && lang !== 'fa') return;
    state.language = lang;
    broadcast();
  });

  socket.on('host:revealHintLetter', () => {
    const song = currentSong();
    if (!song || state.roundStatus !== 'playing') return;
    // Defense in depth — the host UI already hides this button during a
    // "no hints" mystery round, but never let a stray event through.
    if (state.settings.mysteryRound && state.mysterySongId === song.id && state.mysteryModifier === 'noHint') return;
    const revealed = new Set(state.hintRevealedIndices);
    const revealable = [...song.title].map((ch, i) => i).filter(i => /[a-zA-Z0-9]/.test(song.title[i]) && !revealed.has(i));
    if (!revealable.length) return; // nothing left to reveal
    const pick = revealable[Math.floor(Math.random() * revealable.length)];
    state.hintRevealedIndices.push(pick);
    broadcast();
  });

  socket.on('host:updateSettings', (patch) => {
    if (!patch || typeof patch !== 'object') return;
    // Only accept known keys with boolean values — never let an arbitrary
    // client payload widen state.settings beyond DEFAULT_SETTINGS's shape.
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key) && typeof patch[key] === 'boolean') {
        state.settings[key] = patch[key];
      }
    }
    // Turning voting off mid-vote shouldn't leave a dangling vote around —
    // the mystery song equivalent is handled automatically by
    // ensureMysterySong() on the next broadcast, but a vote needs its
    // pending timer cleared explicitly.
    if (!state.settings.categoryVoting && state.categoryVote) {
      clearVoteTimer();
      state.categoryVote = null;
    }
    saveSettings();
    broadcast();
  });

  // Category voting: host offers a set of categories (derived from unplayed
  // songs) and players tap one to vote; most votes wins, chosen either by
  // the optional soft-cutoff timer or the host closing it manually — same
  // pattern as the round timer / auto-advance. Deliberately idle-only, so it
  // never competes with an in-progress buzz round.
  socket.on('host:startCategoryVote', ({ categories, seconds } = {}) => {
    if (!state.settings.categoryVoting || state.roundStatus !== 'idle') return;
    const available = [...new Set(state.playlist.filter(s => !s.played && s.category).map(s => s.category))];
    const requested = Array.isArray(categories) && categories.length ? categories : available;
    const options = [...new Set(requested)].filter(c => available.includes(c));
    if (options.length < 2) return;
    clearVoteTimer();
    const voteSeconds = Number(seconds) || 0;
    state.categoryVote = {
      options,
      votes: {},
      closed: false,
      result: null,
      endsAt: voteSeconds > 0 ? Date.now() + voteSeconds * 1000 : null,
    };
    if (voteSeconds > 0) {
      voteTimerHandle = setTimeout(() => { closeCategoryVote(); broadcast(); }, voteSeconds * 1000);
    }
    broadcast();
  });

  socket.on('host:closeCategoryVote', () => {
    closeCategoryVote();
    broadcast();
  });

  socket.on('player:voteCategory', ({ category } = {}) => {
    if (!playerId || !state.categoryVote || state.categoryVote.closed) return;
    if (!state.categoryVote.options.includes(category)) return;
    state.categoryVote.votes[playerId] = category;
    broadcast();
  });

  // Relay only — TV-local playback monitoring for the host's benefit, not
  // shared game state, so it deliberately bypasses state/broadcast().
  socket.on('tv:playerStatus', (payload) => {
    io.to('host').emit('playerStatus', payload);
  });

  // Manual fallback for videos with embedding disabled (no client fix exists
  // for that): pops the real youtube.com page in an ordinary browser window
  // on THIS machine — the same PC that's HDMI'd to the TV — so the host can
  // still play the song, just without the custom TV overlay for that one
  // song. Reads the video ID from server state rather than trusting the
  // client, and validates it against YouTube's own ID shape before it ever
  // reaches a shell command.
  socket.on('host:openOnYoutube', () => {
    const song = currentSong();
    if (!song || !/^[\w-]{11}$/.test(song.youtubeId)) return;
    exec(`start "" "https://www.youtube.com/watch?v=${song.youtubeId}"`, (err) => {
      if (err) console.error('Failed to open YouTube fallback window:', err.message);
    });
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
    // Fresh game, fresh mystery pick and a clean slate for voting.
    state.mysterySongId = null;
    state.mysteryModifier = null;
    clearVoteTimer();
    state.categoryVote = null;
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

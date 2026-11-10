// Game hub: which game the TV, phones and host are on right now, plus the
// plumbing every party game in this folder shares.
//
// The music game keeps its own pages (tv.html / host.html / player.html) and
// its own 'state' broadcast. Every other game lives on the hub pages
// (/hub/tv.html etc.), which register with `view: 'arcade'` and get a
// separate, much smaller 'arcade' payload. Each page redirects itself to the
// other set of pages whenever activeGame says it's on the wrong one, so
// switching game on the host moves the TV and every phone along with it.

const fs = require('fs');

const ARCADE_GAMES = ['esmfamil', 'golpooch', 'pantomime', 'mostlikely', 'mafia', 'spy'];
const ALL_GAMES = ['music', ...ARCADE_GAMES];
const TROPHY_LIMIT = 24;
// Party points for the night: a game's 1st / 2nd / 3rd place (ties share a place).
const PLACE_POINTS = [3, 2, 1];
const SPIN_MS = 5200;

module.exports = function createHub({ io, state, displayName, broadcastAll, musicIsLive, buildId, file }) {
  const hub = load();
  const votes = {}; // playerId -> gameId, while the hub menu is up

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        activeGame: ALL_GAMES.includes(raw.activeGame) || raw.activeGame === 'hub' ? raw.activeGame : 'hub',
        trophies: Array.isArray(raw.trophies) ? raw.trophies.slice(0, TROPHY_LIMIT) : [],
        night: raw.night && typeof raw.night.points === 'object' ? { points: raw.night.points, names: raw.night.names || {} } : { points: {}, names: {} },
      };
    } catch {
      return { activeGame: 'hub', trophies: [], night: { points: {}, names: {} } };
    }
  }
  function save() {
    try { fs.writeFileSync(file, JSON.stringify(hub, null, 2)); } catch (e) { console.error('[hub] save failed', e.message); }
  }

  // ---- context handed to every game module ----
  let soonTimer = null;
  const ctx = {
    now: () => Date.now(),
    lang: () => (state.language === 'fa' ? 'fa' : 'en'),
    exists: (pid) => !!state.players[pid],
    isConnected: (pid) => !!(state.players[pid] && state.players[pid].connected),
    name: (pid) => (state.players[pid] ? displayName(state.players[pid].name) : '?'),
    players: () => Object.entries(state.players).map(([id, p]) => ({ id, name: displayName(p.name), connected: !!p.connected })),
    connectedIds: () => Object.entries(state.players).filter(([, p]) => p.connected).map(([id]) => id),
    allIds: () => Object.keys(state.players),
    broadcast: () => broadcast(),
    // Coalesces bursts (e.g. everyone typing answers at once) into one update.
    broadcastSoon: () => {
      if (soonTimer) return;
      soonTimer = setTimeout(() => { soonTimer = null; broadcast(); }, 150);
    },
    emitTo: (pid, event, data) => {
      for (const s of arcadeSockets()) if (s.data.role === 'player' && s.data.playerId === pid) s.emit(event, data);
    },
    emitTv: (event, data) => {
      for (const s of arcadeSockets()) if (s.data.role === 'tv') s.emit(event, data);
    },
    emitAll: (event, data) => {
      for (const s of arcadeSockets()) s.emit(event, data);
    },
    // A finished game reports its ranking as groups of player ids, best first
    // (players in one group tied). The first group goes on the trophy shelf and
    // the top three groups earn party points for the night.
    finish: (game, groups) => {
      const clean = (groups || []).map(gr => gr.filter(id => state.players[id])).filter(gr => gr.length);
      if (!clean.length) return;
      hub.trophies.unshift({ game, names: clean[0].slice(0, 6).map(id => displayName(state.players[id].name)), at: Date.now() });
      hub.trophies.length = Math.min(hub.trophies.length, TROPHY_LIMIT);
      clean.slice(0, PLACE_POINTS.length).forEach((gr, i) => {
        for (const id of gr) {
          hub.night.points[id] = (hub.night.points[id] || 0) + PLACE_POINTS[i];
          hub.night.names[id] = state.players[id].name;
        }
      });
      save();
    },
  };

  const games = {};
  for (const id of ARCADE_GAMES) games[id] = require(`./${id}`)(ctx);

  function* arcadeSockets() {
    for (const s of io.sockets.sockets.values()) if (s.data && s.data.view === 'arcade' && s.data.role) yield s;
  }

  function nightBoard() {
    return Object.entries(hub.night.points)
      .map(([id, points]) => ({ id, name: state.players[id] ? displayName(state.players[id].name) : displayName(hub.night.names[id] || '?'), points }))
      .sort((a, b) => b.points - a.points);
  }

  function payloadFor(role, pid) {
    const active = hub.activeGame;
    const game = games[active];
    const me = role === 'player' && pid && state.players[pid]
      ? { id: pid, name: displayName(state.players[pid].name) }
      : null;
    return {
      buildId,
      serverNow: Date.now(),
      activeGame: active,
      language: ctx.lang(),
      theme: state.theme === 'light' ? 'light' : 'dark',
      fx: !!(state.settings && state.settings.extraAnimations),
      players: ctx.players(),
      me,
      hub: {
        votes: active === 'hub' ? votes : {},
        trophies: hub.trophies,
        night: nightBoard(),
        spin: spin && active === 'hub' ? spin : null,
        musicLive: musicIsLive(),
      },
      game: game ? game.payload(role, pid) : null,
    };
  }

  function sendTo(socket) {
    socket.emit('arcade', payloadFor(socket.data.role, socket.data.playerId));
  }

  function broadcast() {
    for (const s of arcadeSockets()) sendTo(s);
  }

  // "Surprise me": the TV's spotlight hops across the game cards and lands on
  // one — weighted by the players' votes if there are any — then it launches.
  let spin = null;
  let spinTimer = null;
  function surprise() {
    if (hub.activeGame !== 'hub' || spin) return;
    const counts = {};
    for (const g of Object.values(votes)) counts[g] = (counts[g] || 0) + 1;
    const pool = Object.keys(counts).length
      ? Object.entries(counts).flatMap(([g, n]) => Array(n).fill(g))
      : ALL_GAMES;
    const game = pool[Math.floor(Math.random() * pool.length)];
    spin = { game, endsAt: Date.now() + SPIN_MS };
    spinTimer = setTimeout(() => { spinTimer = null; select(game); }, SPIN_MS + 900);
    broadcast();
  }

  function select(game, socket) {
    if (game !== 'hub' && !ALL_GAMES.includes(game)) return;
    if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
    spin = null;
    if (game === hub.activeGame) return;
    if (hub.activeGame === 'music' && musicIsLive()) {
      if (socket) socket.emit('hubError', { message: 'A music round is still in progress — close or reveal it first.' });
      return;
    }
    const leaving = games[hub.activeGame];
    if (leaving && leaving.leave) leaving.leave();
    if (games[game]) games[game].reset();
    for (const k of Object.keys(votes)) delete votes[k];
    hub.activeGame = game;
    save();
    broadcastAll(); // the music pages learn about the switch through their own 'state'
  }

  // Registers the hub's and every game's socket events. Names start with
  // host:/player:, so server.js's guard already enforces the sender's role.
  function attach(socket, info) {
    socket.on('host:hub:select', (d) => select(d && d.game, socket));
    socket.on('host:hub:clearTrophies', () => { hub.trophies = []; hub.night = { points: {}, names: {} }; save(); broadcast(); });
    socket.on('host:hub:surprise', () => surprise());
    socket.on('player:hub:vote', (d) => {
      const game = d && d.game;
      const { playerId } = info();
      if (hub.activeGame !== 'hub' || !playerId || !state.players[playerId]) return;
      if (!ALL_GAMES.includes(game) || votes[playerId] === game) delete votes[playerId];
      else votes[playerId] = game;
      broadcast();
    });
    for (const [id, g] of Object.entries(games)) {
      for (const [event, handler] of Object.entries(g.handlers)) {
        socket.on(event, (data) => {
          if (hub.activeGame !== id) return;
          const who = info();
          if (who.role === 'player' && (!who.playerId || !state.players[who.playerId])) return;
          handler(who, data && typeof data === 'object' ? data : {});
        });
      }
    }
  }

  function onPlayerRemoved(pid) {
    delete votes[pid];
    for (const g of Object.values(games)) if (g.onPlayerRemoved) g.onPlayerRemoved(pid);
  }

  return {
    activeGame: () => hub.activeGame,
    attach,
    sendTo,
    broadcast,
    onPlayerRemoved,
    games,
  };
};

module.exports.ARCADE_GAMES = ARCADE_GAMES;

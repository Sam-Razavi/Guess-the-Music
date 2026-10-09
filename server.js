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
const Anthropic = require('@anthropic-ai/sdk');

const MDNS_HOST = 'guess-the-music.local';

const app = express();
const server = http.createServer(app);
// perMessageDeflate only above 4KB: a big playlist makes every host-bound
// state broadcast hundreds of KB of highly repetitive JSON, which compresses
// ~5-10x; small messages (everything the TV/players get) stay uncompressed.
const io = new Server(server, { perMessageDeflate: { threshold: 4096 } });

const PORT = process.env.PORT || 3000;
const PLAYLIST_FILE = path.join(__dirname, 'playlist.json');
const PLAYERS_FILE = path.join(__dirname, 'players.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const STATS_FILE = path.join(__dirname, 'stats.json');
const PRESETS_FILE = path.join(__dirname, 'presets.json');
const ROUNDSTATE_FILE = path.join(__dirname, 'roundstate.json');

// Optional shared-secret gate for host/player join — see .env.example.
// Blank (the default) short-circuits the `JOIN_PIN && ...` check below, so
// nothing ever prompts for a PIN unless one is actually configured. Never
// required for 'tv' — the kiosk display can't interactively supply one.
const JOIN_PIN = (process.env.JOIN_PIN || '').trim();

const DEFAULT_STATS = {
  fastestBuzz: null,          // {name, ms, at} | null — quickest reaction to a round starting, all-time
  mostPointsInRound: null,    // {name, points, at} | null — biggest single correct-answer award, all-time
};

const DEFAULT_SETTINGS = {
  autoRevealOnCorrect: true,   // ✅ Correct also reveals the song and ends the round
  wrongPenalty: true,          // ❌ Wrong takes 1 point from the player who answered
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
  preflightCheck: false,
  pauseGame: false,
  actionLog: false,
  setlistPresets: false,
  achievementBadges: false,
  snippetMode: false,
  wagerRound: false,
  startOffset: false,
  gameLimit: false,
  scoreLimitValue: 0,    // score at which a player/team ends the game early (0 = off) — see checkGameLimit()
  roundLimitValue: 0,    // rounds played at which the game ends early (0 = off) — see checkGameLimit()
  easterEggMahtab: false,
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

// Newest modification time of anything in public/. Sent with every state so an
// already-open TV/phone/host page can tell the site was updated while it was
// running (it keeps executing the OLD page scripts after a deploy) and reload
// itself. Restarting the server without changing any site file leaves this
// unchanged, so those restarts don't reload anyone.
const BUILD_ID = (() => {
  let latest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p); else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try { walk(path.join(__dirname, 'public')); } catch (e) { /* no public dir — leave 0 */ }
  return Math.round(latest).toString(36);
})();
app.use(express.json());

// The /api routes spend YouTube quota and read the playlist, so with a join PIN
// set they need it too — the host page sends it as x-join-pin. (They used to
// be open to anyone who could reach the server.) No PIN configured = no check.
app.use('/api', (req, res, next) => {
  if (JOIN_PIN && req.get('x-join-pin') !== JOIN_PIN) return res.status(401).json({ error: 'Join PIN required.' });
  next();
});

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

function loadPresets() {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePresets() {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(state.presets, null, 2));
}

// Round-state resume: so a crash + pm2 auto-restart (or any server restart)
// mid-round comes back exactly where it left off — same song, same buzz
// order — instead of silently dropping to 'idle' and leaving the host to
// notice and re-pick the interrupted song by hand. Written on every
// broadcast() (cheap: a handful of fields, one small file) and read back at
// startup. Deliberately narrower than a full snapshot of `state`:
//   - roundTimer / autoAdvance / pauseRemaining (the live countdowns) are NOT
//     resumed — only the static `buzzingLocked`/`paused` flags survive.
//     Reconstructing an exact "seconds remaining" across an unknown-length
//     outage isn't worth the complexity; buzzing just stays open a bit
//     longer than intended, or a resumed pause has nothing to re-arm on
//     unpause — both far smaller losses than the round vanishing outright.
//   - categoryVote is NOT resumed — it's an idle-only, players-tap-a-button
//     interaction with no game state riding on it; re-starting a vote after
//     a crash costs a few seconds, not worth persisting for.
//   - mysterySongId/mysteryModifier/paused/actionLog/badgeStats/roundsPlayed
//     ARE resumed independent of roundStatus (not just during an active
//     round) — they're this-game running state with no other persistence
//     path. ensureMysterySong() would otherwise silently re-roll a
//     different song on every restart, breaking the "one song, sticky for
//     the whole game" guarantee; the others would just quietly lose a
//     dispute log / achievement progress / round count to an unrelated crash.
//   - wager IS resumed when set: resuming mid-'wagering' with a null wager
//     would leave player:submitWager permanently rejecting the real
//     wagering player (it checks state.wager.playerId).
function loadRoundState() {
  try {
    return JSON.parse(fs.readFileSync(ROUNDSTATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveRoundState() {
  const song = currentSong();
  fs.writeFileSync(ROUNDSTATE_FILE, JSON.stringify({
    currentSongId: song ? song.id : null,
    roundStatus: state.roundStatus,
    buzzOrder: state.buzzOrder,
    buzzingLocked: state.buzzingLocked,
    roundHadMiss: state.roundHadMiss,
    roundStartedAt: state.roundStartedAt,
    speedBonusPaid: state.speedBonusPaid,
    hintRevealedIndices: state.hintRevealedIndices,
    snippetSeconds: state.snippetSeconds,
    startOffsetSeconds: state.startOffsetSeconds,
    wager: state.wager,
    mysterySongId: state.mysterySongId,
    mysteryModifier: state.mysteryModifier,
    paused: state.paused,
    actionLog: state.actionLog,
    badgeStats: state.badgeStats,
    roundsPlayed: state.roundsPlayed,
  }, null, 2));
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
  // Carrier-grade NAT range (100.64.0.0/10) — used by VPN clients like
  // NordVPN/NordLynx and Tailscale, never a real home LAN.
  const isCgnat = (ip) => {
    const parts = ip.split('.').map(Number);
    return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  };
  // VPN clients, Hyper-V/container virtual switches — never the network
  // a phone is actually joined to, even though they get a real-looking IP.
  const isVirtualOrVpn = (name) => /vpn|nordlynx|wireguard|tailscale|zerotier|tap-|vethernet|virtual|vswitch|hyper-v|docker|wsl/i.test(name);
  const isRealLan = (c) => !isVirtualboxDefault(c.address) && !isCgnat(c.address) && !isVirtualOrVpn(c.name);
  const isWifiOrEthernet = (name) => /^wi-?fi|wlan|^ethernet/i.test(name);

  return (
    candidates.find(c => isRealLan(c) && isWifiOrEthernet(c.name)) ||
    candidates.find(c => isRealLan(c)) ||
    candidates.find(c => !isVirtualboxDefault(c.address)) ||
    candidates[0]
  ).address;
}

// ---------- game state ----------

const initialPlaylist = loadPlaylist();
const savedRound = loadRoundState();
// 'idle'/'results' need no current song (currentIndex is legitimately -1 for
// both); 'playing'/'buzzed'/'revealed'/'wagering' do — if that song can't be
// found (removed from the playlist during the outage, a rare edge case),
// fall back to a clean idle state rather than resuming into something broken.
const roundNeedsSong = savedRound && ['playing', 'buzzed', 'revealed', 'wagering'].includes(savedRound.roundStatus);
const resumedIndex = roundNeedsSong ? initialPlaylist.findIndex(s => s.id === savedRound.currentSongId) : -1;
const canResumeRound = !!savedRound && savedRound.roundStatus !== 'idle' && (!roundNeedsSong || resumedIndex !== -1);

const state = {
  playlist: initialPlaylist,       // [{id, youtubeId, title, artist, played}]
  currentIndex: canResumeRound ? resumedIndex : -1,
  roundStatus: canResumeRound ? savedRound.roundStatus : 'idle',   // idle | playing | buzzed | revealed | results
  buzzOrder: canResumeRound ? (savedRound.buzzOrder || []) : [],  // [{id, name, time}]
  players: loadPlayers(),         // playerId -> {name, score, connected, socketId}
  roundTimer: null,               // {seconds, endsAt} | null — a soft cutoff; doesn't survive a restart, see saveRoundState()
  buzzingLocked: canResumeRound ? !!savedRound.buzzingLocked : false, // true once the timer expires with no buzz — host still controls reveal/close
  language: 'en',                 // 'en' | 'fa' — TV/player display language, set by the host
  theme: 'dark',                  // 'dark' | 'light' — TV/player/host display theme, set by the host; same in-memory-only, resets-on-restart treatment as language
  playFilter: { category: '', decade: '', difficulty: '' }, // narrows which unplayed songs pickNextSong() draws from — mirrors the host's playlist filter chips; '' = no filter on that axis. In-memory only, same as playOrder.
  playOrder: 'sequential',        // 'sequential' | 'random' — order pickNextSong() picks from for auto-advance/host:playNext; same in-memory-only treatment as language/theme. Manually clicking Play on a specific song always ignores this and just plays that song.
  autoAdvance: null,               // {endsAt} | null — pending auto-start of the next unplayed song; doesn't survive a restart, see saveRoundState()
  settings: loadSettings(),       // host-toggleable game options — see DEFAULT_SETTINGS
  roundHadMiss: canResumeRound ? !!savedRound.roundHadMiss : false, // true once resetBuzzers has fired this round — powers the steal-mechanic bonus
  roundStartedAt: canResumeRound ? savedRound.roundStartedAt : null, // Date.now() when the current round began — powers the speed-bonus window
  speedBonusPaid: canResumeRound ? !!savedRound.speedBonusPaid : false, // true once this round's speed bonus has been awarded once
  stats: loadStats(),              // all-time records — see DEFAULT_STATS; only recorded while sessionStats is on
  hintRevealedIndices: canResumeRound ? (savedRound.hintRevealedIndices || []) : [], // character indices of the current song's title already revealed — see buildHintMask
  mysterySongId: savedRound ? savedRound.mysterySongId : null,     // id of this game's one Mystery Modifier Round song, or null — see ensureMysterySong()
  mysteryModifier: savedRound ? savedRound.mysteryModifier : null, // 'double' | 'noHint' | 'blind' | null — only revealed (via payloadFor) once that song's round starts
  categoryVote: null,              // {options, votes: {playerId: category}, closed, result, endsAt} | null — deliberately not resumed, see saveRoundState()
  paused: savedRound ? !!savedRound.paused : false, // true between host:togglePause calls — freezes buzzing and any running timers for a break
  pauseRemaining: null,             // {roundTimerSeconds, autoAdvanceSeconds} snapshotted at pause time; doesn't survive a restart, see saveRoundState()
  actionLog: savedRound ? (savedRound.actionLog || []) : [], // [{at, text}] most-recent-first, capped — host-only audit trail, see logAction()
  presets: loadPresets(),          // name -> {playlist, settings, savedAt} — saved setlist+settings combos, see host:savePreset
  badgeStats: (savedRound && savedRound.badgeStats) || { fastestBuzz: null, steals: {}, correct: {}, everLastPlace: {} }, // THIS GAME's running counters for computeBadges() — reset on resetGame
  snippetSeconds: canResumeRound ? (Number(savedRound.snippetSeconds) || 0) : 0, // how long the TV plays this round's song before auto-pausing, 0 = off — see host:startRound
  startOffsetSeconds: canResumeRound ? (Number(savedRound.startOffsetSeconds) || 0) : 0, // how many seconds into the video this round starts playback from, 0 = the beginning — see host:startRound
  wager: canResumeRound ? (savedRound.wager || null) : null, // {playerId, amount, timerSeconds} | null — Daily-Double-style exclusive round, see host:startRound/player:submitWager
  knownBroken: {},                 // songId -> {message, at} — songs the TV has *actually* hit a real playback error on, see tv:playerStatus. In-memory only (not persisted, doesn't survive a restart) — it's a live diagnostic, not durable data, same reasoning the original playerStatus relay used for staying out of state/broadcast().
  roundsPlayed: savedRound ? (Number(savedRound.roundsPlayed) || 0) : 0, // count of rounds revealed this game — powers the gameLimit setting's round-count end condition, reset by host:resetGame
};

const ACTION_LOG_LIMIT = 50;

// Host-only audit trail for settling "wait, who got that point?" disputes
// live. Only accumulates while the actionLog setting is on — same opt-in
// pattern as sessionStats — so there's zero cost when it's off. Never sent
// to tv/player (see payloadFor's host-only branch), same reasoning as the
// playlist itself: this is host-management data, not shared game state.
function logAction(text) {
  if (!state.settings.actionLog) return;
  state.actionLog.unshift({ at: Date.now(), text });
  if (state.actionLog.length > ACTION_LOG_LIMIT) state.actionLog.length = ACTION_LOG_LIMIT;
}

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

// Picks which unplayed song plays next, honoring state.playOrder — shared by
// auto-advance and host:playNext so both respect the same host-chosen order.
// 'random' never repeats an already-played song within a session, same as
// 'sequential' — it only ever draws from the unplayed pool. Manually clicking
// Play/Replay on a specific playlist row bypasses this entirely by design
// (that's the one place a deliberate repeat is allowed).
function matchesPlayFilter(song) {
  const f = state.playFilter;
  return (!f.category || song.category === f.category)
    && (!f.decade || song.decade === f.decade)
    && (!f.difficulty || song.difficulty === f.difficulty);
}

function pickNextSong() {
  const unplayed = state.playlist.filter(s => !s.played && matchesPlayFilter(s));
  if (!unplayed.length) return null;
  if (state.playOrder === 'random') return unplayed[Math.floor(Math.random() * unplayed.length)];
  return unplayed[0];
}

// Shared by host:showResults and checkGameLimit() below (an early, automatic
// game-over hits the exact same end state a host manually clicking "Show
// results" would).
function showResults() {
  state.roundStatus = 'results';
  state.currentIndex = -1;
  state.buzzOrder = [];
  state.wager = null;
  clearRoundTimer();
  clearAutoAdvance();
}

// Game limit: host-toggleable early end condition — the first player (or,
// in team mode, team) to reach scoreLimitValue points, or roundLimitValue
// rounds played, jumps straight to results. Checked at the two moments
// either limit can newly be crossed: right after a score changes
// (host:awardPoint) and right after a round is revealed (host:revealAnswer,
// where roundsPlayed increments). No-ops once already at 'results'/'idle' so
// it can't refire after the host has already moved past it.
function checkGameLimit() {
  if (!state.settings.gameLimit || state.roundStatus === 'results' || state.roundStatus === 'idle') return;
  const { scoreLimitValue, roundLimitValue } = state.settings;
  let hit = false;

  if (scoreLimitValue > 0) {
    if (state.settings.teamMode) {
      const teamTotals = {};
      Object.values(state.players).forEach(p => {
        const t = (p.team || '').trim();
        if (t) teamTotals[t] = (teamTotals[t] || 0) + p.score;
        else if (p.score >= scoreLimitValue) hit = true; // solo (no-team) player, scored individually
      });
      if (Object.values(teamTotals).some(total => total >= scoreLimitValue)) hit = true;
    } else if (Object.values(state.players).some(p => p.score >= scoreLimitValue)) {
      hit = true;
    }
  }
  if (!hit && roundLimitValue > 0 && state.roundsPlayed >= roundLimitValue) hit = true;

  if (hit) showResults();
}

// Shared by host:revealAnswer and the pause/resume flow (host:togglePause) —
// a resume just re-arms the same countdown with whatever time was left when
// it got frozen, so both call sites need the exact same "start the next
// unplayed song" behavior when the countdown elapses.
function scheduleAutoAdvance(seconds, nextRoundTimerSeconds) {
  // nextRoundTimerSeconds rides along on state.autoAdvance itself (not just
  // captured in this closure) so a pause can recover it later — pausing
  // clears this very timeout via clearAutoAdvance(), which would otherwise
  // lose the value when host:togglePause re-arms it on resume.
  state.autoAdvance = { endsAt: Date.now() + seconds * 1000, nextRoundTimerSeconds };
  autoAdvanceHandle = setTimeout(() => {
    state.autoAdvance = null;
    // Only proceed if the host hasn't already moved on manually — any of
    // resetBuzzers/startRound/closeRound/showResults/resetGame would have
    // changed roundStatus away from 'revealed' by now. A pause also blocks
    // it, same as those manual actions would.
    if (state.roundStatus === 'revealed' && !state.paused) {
      const next = pickNextSong();
      if (next) startRound(next.id, nextRoundTimerSeconds);
    }
    broadcast();
  }, seconds * 1000);
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

function startRound(id, timerSeconds, snippetSeconds, wagerPlayerId, startOffsetSeconds) {
  const idx = state.playlist.findIndex(s => s.id === id);
  if (idx === -1) return false;
  const song = state.playlist[idx];
  state.currentIndex = idx;
  state.buzzOrder = [];
  state.roundHadMiss = false;
  state.hintRevealedIndices = [];
  // Only meaningful with the toggle on — never carries a value in from a
  // stale client field once the host has switched the setting off.
  state.snippetSeconds = state.settings.snippetMode ? (Number(snippetSeconds) || 0) : 0;
  state.startOffsetSeconds = state.settings.startOffset ? Math.max(0, Number(startOffsetSeconds) || 0) : 0;
  // The vote (if any) has done its job of picking a category to play from —
  // clear it so a stale result doesn't linger once the round it fed into begins.
  clearVoteTimer();
  state.categoryVote = null;
  clearRoundTimer();
  clearAutoAdvance();

  // Wager round ("Daily Double"): only when the toggle's on, this specific
  // song is host-flagged eligible, and the host actually picked someone to
  // wager. Goes to a 'wagering' holding status first — no video loads, no
  // buzzing, no round timer yet — until player:submitWager locks in an
  // amount and flips it over to a normal 'playing' round exclusive to them.
  const useWager = state.settings.wagerRound && song.wagerEligible && wagerPlayerId && state.players[wagerPlayerId];
  if (useWager) {
    state.roundStatus = 'wagering';
    state.wager = { playerId: wagerPlayerId, amount: null, timerSeconds: Number(timerSeconds) || 0 };
    state.roundStartedAt = null;
    state.speedBonusPaid = false;
  } else {
    state.roundStatus = 'playing';
    state.wager = null;
    state.roundStartedAt = Date.now();
    state.speedBonusPaid = false;
    if (timerSeconds > 0) startRoundTimer(timerSeconds);
  }
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

// "This game" awards computed from state.badgeStats (reset every
// resetGame) — deliberately server-side rather than reconstructed
// client-side, since the server already has every counter it needs and
// this avoids re-implementing the same tie/lead logic in every client.
// Only ever meaningful once state.roundStatus reaches 'results' (rendered
// there), but cheap enough to compute unconditionally.
function computeBadges() {
  if (!state.settings.achievementBadges) return null;
  const badges = [];
  const bs = state.badgeStats;

  if (bs.fastestBuzz && state.players[bs.fastestBuzz.id]) {
    badges.push({ key: 'fastest', icon: '🏃', label: 'Fastest Buzzer', name: displayName(bs.fastestBuzz.name), detail: `${(bs.fastestBuzz.ms / 1000).toFixed(2)}s`, value: (bs.fastestBuzz.ms / 1000).toFixed(2) });
  }

  const stealTop = Object.entries(bs.steals).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])[0];
  if (stealTop && state.players[stealTop[0]]) {
    badges.push({ key: 'steals', icon: '🔥', label: 'Most Steals', name: displayName(state.players[stealTop[0]].name), detail: `${stealTop[1]} steal${stealTop[1] === 1 ? '' : 's'}`, value: stealTop[1] });
  }

  const correctTop = Object.entries(bs.correct).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])[0];
  if (correctTop && state.players[correctTop[0]]) {
    badges.push({ key: 'sharpshooter', icon: '🎯', label: 'Sharpshooter', name: displayName(state.players[correctTop[0]].name), detail: `${correctTop[1]} correct`, value: correctTop[1] });
  }

  // Comeback Kid: ever registered in (sole or shared) last place at some
  // point this game, and now the sole (non-tied) leader.
  const entries = Object.entries(state.players);
  const scores = entries.map(([, p]) => p.score);
  const max = scores.length ? Math.max(...scores) : 0;
  const soleLeaders = entries.filter(([, p]) => p.score === max);
  if (max > 0 && soleLeaders.length === 1 && bs.everLastPlace[soleLeaders[0][0]]) {
    badges.push({ key: 'comeback', icon: '🔁', label: 'Comeback Kid', name: displayName(soleLeaders[0][1].name), detail: 'came from behind' });
  }

  return badges;
}

function currentSong() {
  return state.currentIndex >= 0 ? state.playlist[state.currentIndex] : null;
}

// Reveals the current song: marks it played, ends the round's timers and
// (optionally) schedules the auto-advance to the next song. Shared by the
// host's Reveal button and the automatic reveal after ✅ Correct. The caller
// broadcasts.
function revealRound(autoAdvanceSeconds) {
  // Snapshot the round timer that was active for the song just revealed,
  // so an auto-started next round can reuse the same duration — not
  // read back from a persisted field, since the host's timer input may
  // change before auto-advance actually fires.
  const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
  clearAutoAdvance();
  if (state.currentIndex >= 0) {
    state.playlist[state.currentIndex].played = true;
    state.roundsPlayed += 1;
    savePlaylist();
  }
  state.roundStatus = 'revealed';
  clearRoundTimer();

  // May immediately overwrite 'revealed' with 'results' if this round just
  // crossed the round-limit — deliberate: the limit is enforced the moment
  // the round that hits it gets revealed, not deferred to the next one.
  checkGameLimit();
  const seconds = Number(autoAdvanceSeconds);
  if (state.roundStatus === 'revealed' && seconds > 0) scheduleAutoAdvance(seconds, priorTimerSeconds);
}

// Judges a buzz-in wrong: remembers it on the buzz entry (so the host and TV
// keep showing the verdict), notes that this round had a miss (what arms the
// steal bonus), buzzes that player's own phone, shows "Wrong!" on the TV and
// logs it. Safe to call twice for the same buzz — it only fires once.
function applyWrongVerdict(entry, penalty = 0) {
  if (!entry || entry.verdict) return false;
  entry.verdict = 'wrong';
  state.roundHadMiss = true;
  const p = state.players[entry.id];
  // Targeted at that player's actual socket, not broadcast to everyone.
  if (p && p.socketId) io.to(p.socketId).emit('wrong');
  io.to('tv').emit('wrong', { name: displayName(entry.name), penalty });
  const song = currentSong();
  logAction(`❌ ${entry.name} answered wrong${song ? ` on "${song.title}"` : ''}`);
  return true;
}

// Reopens buzzing for the players who haven't had a turn (earlier buzzers stay
// locked out because buzzOrder is cumulative within a round).
function reopenBuzzing() {
  const priorTimerSeconds = state.roundTimer ? state.roundTimer.seconds : 0;
  state.roundStatus = 'playing';
  clearRoundTimer();
  // Also cancel any pending auto-advance — a reset can fire while 'revealed'
  // (e.g. the R shortcut hit out of habit), and without this the countdown
  // pill just silently vanishes with nothing happening.
  clearAutoAdvance();
  if (priorTimerSeconds > 0) startRoundTimer(priorTimerSeconds);
}

// Is there anyone connected who hasn't had a turn this round (and, in team
// mode, whose team hasn't)? Used so a steal isn't "opened" for nobody.
function someoneCanStillBuzz() {
  const taken = new Set(state.buzzOrder.map(b => b.id));
  const teamsTaken = state.settings.teamMode ? new Set(state.buzzOrder.map(b => teamOf(b.id)).filter(Boolean)) : new Set();
  return Object.entries(state.players).some(([pid, p]) => {
    if (taken.has(pid) || p.connected === false) return false;
    if (state.settings.teamMode && teamsTaken.has(teamOf(pid))) return false;
    return true;
  });
}

// Optional organizing tags beyond `category` (which doubles as the genre):
// release year / decade and a host-facing difficulty. Validated here rather
// than trusted — these arrive from the host UI and from bulk loads alike.
const DIFFICULTIES = ['easy', 'medium', 'hard'];
function decadeLabel(year) {
  return `${Math.floor(year / 10) * 10}s`;
}
function sanitizeSongTags({ year, decade, difficulty } = {}) {
  const out = { year: null, decade: '', difficulty: '' };
  const y = Math.round(Number(year));
  if (Number.isFinite(y) && y >= 1900 && y <= 2100) {
    out.year = y;
    out.decade = decadeLabel(y);
  }
  // An explicit decade only counts when no year was given (a year wins).
  if (!out.decade && /^(19|20)\d0s$/.test(String(decade || ''))) out.decade = String(decade);
  if (DIFFICULTIES.includes(difficulty)) out.difficulty = difficulty;
  return out;
}

function makeSong(youtubeId, title, artist, category, tags) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 5),
    youtubeId: youtubeId.trim(),
    title: (title || '').trim() || 'Untitled',
    artist: (artist || '').trim(),
    category: (category || '').trim(),
    ...sanitizeSongTags(tags),
    played: false,
    points: 1,                    // how many points a correct buzz on this song is worth — see host:setSongPoints
    wagerEligible: false,         // host-flagged "Daily Double" song — see host:setWagerEligible
  };
}

// ---------- Easter egg: Mahtab ----------
// A host-toggleable, fun-only joke for a specific friend. Never touches the
// stored name (state.players[id].name) — only the copy sent out for
// display — so it doesn't affect team grouping, player lookup, or what's
// saved to players.json. Off by default; see DEFAULT_SETTINGS.easterEggMahtab.
function isMahtabName(name) {
  if (!name) return false;
  const n = name.trim();
  if (n.toLowerCase() === 'mahtab') return true;
  // ي/ك (Arabic forms) vs ی/ک (Persian forms) — normalize so either
  // keyboard layout still matches "مهتاب".
  const normalizedFa = n.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
  return normalizedFa === 'مهتاب';
}

const MAHTAB_TEASES = {
  en: ['😏 uh oh…', '👀 here we go', '💍 the usual suspect', '😂 called it', '🙄 again?'],
  fa: ['😏 اوه اوه…', '👀 بازم این یکی', '💍 بازم همون داستان', '😂 حدس زده بودیم', '🙄 بازم؟'],
};

// Applied only at display time — the suffix follows whichever language the
// host currently has selected (shared state.language, same as every other
// TV/player-facing string), not the viewer's own device.
function displayName(name) {
  if (!state.settings.easterEggMahtab || !isMahtabName(name)) return name;
  return `${name} ${state.language === 'fa' ? 'شوهری' : 'Shohari'}`;
}

function mahtabTease() {
  const list = MAHTAB_TEASES[state.language === 'fa' ? 'fa' : 'en'];
  return list[Math.floor(Math.random() * list.length)];
}

function publicPlayers() {
  return Object.entries(state.players).map(([id, p]) => ({
    id, name: displayName(p.name), score: p.score, connected: p.connected, team: p.team || '',
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
    buildId: BUILD_ID,
    roundStatus: state.roundStatus,
    buzzOrder: state.buzzOrder.map(b => ({ id: b.id, name: displayName(b.name), tease: b.tease || null, verdict: b.verdict || null })),
    // True while a wrong answer has reopened buzzing for a steal — TV and
    // phones use it to say "steal it!" instead of the plain buzz prompt.
    stealOpen: !!(state.settings.stealMechanic && state.roundHadMiss && state.roundStatus === 'playing' && !state.wager),
    roundsPlayed: state.roundsPlayed,
    players: publicPlayers(),
    roundTimer: state.roundTimer,
    buzzingLocked: state.buzzingLocked,
    language: state.language,
    theme: state.theme,
    autoAdvance: state.autoAdvance,
    settings: state.settings,
    paused: state.paused,
    stats: state.stats,
    badges: computeBadges(),
    snippetSeconds: state.settings.snippetMode ? state.snippetSeconds : 0,
    startOffsetSeconds: state.settings.startOffset ? state.startOffsetSeconds : 0,
    wager: state.wager
      ? { playerId: state.wager.playerId, playerName: (state.players[state.wager.playerId] || {}).name || '', amount: state.wager.amount }
      : null,
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
      playOrder: state.playOrder,
      playFilter: state.playFilter,
      // "Double points" reuses the points-per-song pipeline exactly — just
      // overriding the runtime value shown/awarded for this one round. The
      // song's own stored points field never changes.
      currentSong: song && mysteryModifier === 'double' ? { ...song, points: (song.points || 1) * 2 } : song,
      actionLog: state.actionLog,
      presets: Object.entries(state.presets).map(([name, p]) => ({
        name, songCount: p.playlist.length, savedAt: p.savedAt,
      })),
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
    // A wager round withholds the song entirely (no video loads, no title
    // leak) while the chosen player is still deciding their amount — nobody
    // should be able to size up the clue before the stakes are locked in.
    const wageringHidden = state.roundStatus === 'wagering';
    return {
      ...base,
      players: hideScores ? base.players.map(p => ({ ...p, score: null })) : base.players,
      currentSong: song && !wageringHidden
        ? {
            id: song.id, // lets tv.js attribute a real playback error to this specific song — see tv:playerStatus
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
  saveRoundState();
  io.to('host').emit('state', payloadFor('host'));
  io.to('tv').emit('state', payloadFor('tv'));
  io.to('player').emit('state', payloadFor('player'));
}

// ---------- Claude-based auto-categories (optional, like YOUTUBE_API_KEY) ----------
// Replaced the earlier Spotify-genre version in Phase 19 — Spotify's genre
// tagging was sparse for non-Western artists anyway, and this needed no
// OAuth app-registration step, just an API key.

let anthropicClient = null;
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// The genre list the playlist's filters are built around (host.js shows these
// as the Genre chips). Auto-tagging only ever suggests from this list, so new
// songs land in the same buckets as the rest of the playlist instead of
// inventing one-off tags ("Sassy Pop") that clutter the filter row.
const GENRES_INTERNATIONAL = ['Pop', 'Rock', 'Classical', 'Metal', 'Alternative', 'Hip-Hop', 'R&B & Soul', 'Funk & Disco', 'Electronic', 'Country', 'Folk', 'Jazz', 'Blues', 'Reggae', 'Latin', 'K-Pop', 'Gospel', 'World', 'Soundtrack'];
const GENRES_PERSIAN = ['Persian Pop', 'Persian Rock', 'Persian Hip-Hop', 'Persian Traditional', 'Persian Folk', 'Bandari', 'Persian Dance', 'Persian Jazz', 'Persian Electronic', 'Persian Alternative'];
const ALL_GENRES = [...GENRES_INTERNATIONAL, ...GENRES_PERSIAN];

// Best-effort tags for a song from an LLM: { category (a genre from
// ALL_GENRES), year, difficulty }. Haiku, low effort, thinking off — a quick
// classification, not a reasoning task. Difficulty is how recognizable the
// song is to a mixed party crowd (>=8 easy, 5-7 medium, <=4 hard) — the host
// can change it from the badge on the playlist row. Fails silently (returns
// null) on missing config, a bad reply, or any error: this is a convenience
// only and must never block adding a song or an import — always "suggested,
// host can override", never a guarantee.
async function suggestSongTags(title, artist) {
  const client = getAnthropicClient();
  if (!client) return null;
  try {
    const song = artist ? `"${title}" by ${artist}` : `"${title}"`;
    const response = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 80,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content: `Tag the song ${song} for a music-guessing party game. Reply with ONLY a JSON object: {"genre": ..., "year": ..., "recog": ...}.
- genre: exactly one of: ${ALL_GENRES.join(', ')}. Use the "Persian ..." genres (and Bandari) only for Persian-language/Iranian songs; Persian Traditional = classical/dastgah, Persian Folk = regional folk, Persian Dance = upbeat party pop.
- year: the year the song was first released (integer).
- recog: integer 1-10, how likely a mixed-age party crowd could name it within ~10 seconds (10 = everyone, 4 = only fans, 1 = obscure).`,
      }],
    });
    const block = response.content.find(b => b.type === 'text');
    if (!block) return null;
    const parsed = JSON.parse(block.text.trim().replace(/^```(?:json)?|```$/g, '').trim());
    if (!ALL_GENRES.includes(parsed.genre)) return null;
    const recog = Math.round(Number(parsed.recog));
    return {
      category: parsed.genre,
      year: parsed.year,
      difficulty: Number.isFinite(recog) ? (recog >= 8 ? 'easy' : recog >= 5 ? 'medium' : 'hard') : '',
    };
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
    // Just a flag for the host/player pages to know whether to show a PIN
    // field — deliberately never the PIN value itself, since this route is
    // unauthenticated (anyone who can reach it at all already has the
    // join link, but that's not the same as having the PIN).
    pinRequired: !!JOIN_PIN,
    // Language/theme so a phone that hasn't joined yet (it only receives game
    // state after registering) can already show its join screen in the right
    // language instead of always starting in English.
    language: state.language,
    theme: state.theme,
  });
});

app.get('/qr.png', async (req, res) => {
  const ip = getLanIp();
  // Unlike /join-info above, the QR code DOES bake the real PIN in (when
  // set) — it exists specifically for in-person, zero-typing join, and
  // only people physically in the room scanning the TV screen ever see it.
  const url = JOIN_PIN
    ? `http://${ip}:${PORT}/player.html?pin=${encodeURIComponent(JOIN_PIN)}`
    : `http://${ip}:${PORT}/player.html`;
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
// call). Returns { embeddable: Set of IDs that ARE embeddable, hadApiError:
// true if any batch's own API call failed (bad key, quota exceeded, network
// issue) — see the two fail-open/fail-closed notes below for why those are
// handled differently, and why the caller needs to know which happened.
//
// "Embeddable" here means "will actually play on the TV", which is more than
// the owner's embeddable flag: an age-restricted video can't be embedded
// either, and a video blocked in the country the kiosk PC is in plays as
// "unavailable". The region check only runs when PLAYBACK_REGION (a 2-letter
// country code, e.g. SE) is set in .env — the server has no way to know
// where it is. `reasons` (id -> short human reason) explains each exclusion
// so add-time checks can say WHY instead of just refusing.
const PLAYBACK_REGION = (process.env.PLAYBACK_REGION || '').trim().toUpperCase();

async function checkEmbeddable(apiKey, videoIds) {
  const embeddable = new Set();
  const reasons = new Map();
  let hadApiError = false;
  const batches = [];
  for (let i = 0; i < videoIds.length; i += 50) batches.push(videoIds.slice(i, i + 50));
  const checkBatch = async (batch) => {
    if (!batch.length) return;
    try {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      apiUrl.searchParams.set('part', 'status,contentDetails');
      apiUrl.searchParams.set('id', batch.join(','));
      apiUrl.searchParams.set('key', apiKey);
      const r = await fetch(apiUrl);
      if (!r.ok) {
        // A real API-level failure (bad key, quota exceeded, network issue)
        // — fail OPEN so a transient hiccup can't wrongly flag good songs as
        // broken, but remember it happened so the caller can tell the host
        // the check didn't actually run, instead of silently claiming
        // everything's fine when nothing was verified at all.
        hadApiError = true;
        batch.forEach(id => embeddable.add(id));
        return;
      }
      const data = await r.json();
      const seen = new Set();
      for (const item of data.items || []) {
        seen.add(item.id);
        const cd = item.contentDetails || {};
        const region = cd.regionRestriction || null;
        if (!item.status || item.status.embeddable === false) {
          reasons.set(item.id, "the video's owner has disabled embedding");
        } else if (cd.contentRating && cd.contentRating.ytRating === 'ytAgeRestricted') {
          reasons.set(item.id, 'the video is age-restricted');
        } else if (PLAYBACK_REGION && region && ((region.blocked && region.blocked.includes(PLAYBACK_REGION)) || (region.allowed && !region.allowed.includes(PLAYBACK_REGION)))) {
          reasons.set(item.id, `the video is blocked in your country (${PLAYBACK_REGION})`);
        } else {
          embeddable.add(item.id);
        }
      }
      batch.forEach(id => { if (!seen.has(id)) reasons.set(id, "the video doesn't exist or is private"); });
      // An id the API didn't return at all means that video is gone —
      // deleted, made private, or otherwise no longer exists publicly (this
      // used to fail OPEN here on the theory that a missing id was some rare
      // fluke, but a missing video is exactly as unplayable as an explicit
      // embeddable:false one, just for a different reason — leaving it out
      // of `embeddable` now correctly flags it as broken too).
    } catch (e) {
      hadApiError = true;
      batch.forEach(id => embeddable.add(id));
    }
  };
  // A few batches in flight at once. The batches are independent, and a
  // 2,000+ song playlist is ~45 of them — one after another that took ~15
  // seconds, long enough for the pre-flight / broken-video buttons to look
  // hung (and for a flaky phone connection to give up on the request).
  let nextBatch = 0;
  await Promise.all(Array.from({ length: Math.min(6, batches.length) }, async () => {
    while (nextBatch < batches.length) await checkBatch(batches[nextBatch++]);
  }));
  return { embeddable, hadApiError, reasons };
}

// Turns a YouTube API failure into something the host can act on, instead of
// one generic "couldn't reach the API" for everything. Search (which "Find
// replacement" needs) has its own small daily quota — separate from the
// cheap calls adding/importing songs use — and it resets at midnight Pacific
// time, which is about 09:00 in Sweden.
function explainYoutubeError(e) {
  const reason = e && e.reason;
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'dailyLimitExceeded' || (e && e.status === 429)) {
    return { status: 429, code: 'quota', message: "YouTube's daily search limit has been used up, so replacements can't be looked up right now. It resets every day at midnight Pacific time (about 09:00 in Sweden). Adding and playing songs still works — only searching is paused." };
  }
  if (reason === 'keyInvalid' || reason === 'keyExpired' || reason === 'API_KEY_INVALID') {
    return { status: 400, code: 'key', message: "The YouTube API key isn't valid — check YOUTUBE_API_KEY in your .env file." };
  }
  if (reason === 'accessNotConfigured' || reason === 'forbidden') {
    return { status: 403, code: 'access', message: 'YouTube refused the request — make sure the YouTube Data API v3 is enabled for your API key.' };
  }
  return null;
}

// Looks for a differently-uploaded copy of the same song when the current
// video has embedding disabled — many official-label uploads block it, but
// an "Artist - Topic" auto-generated upload, a lyric video, or a fan upload
// of the same track often doesn't. videoEmbeddable=true pre-filters on
// YouTube's own end; checkEmbeddable() re-verifies anyway since that filter
// can be stale, same as everywhere else this app checks embeddability.
// Costs real API quota (100 units for the search + ~1 for the re-check), so
// this is a deliberate, host-triggered lookup — never automatic.
async function findReplacement(apiKey, title, artist) {
  const q = [title, artist].filter(Boolean).join(' ');
  const apiUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  apiUrl.searchParams.set('part', 'snippet');
  apiUrl.searchParams.set('q', q);
  apiUrl.searchParams.set('type', 'video');
  apiUrl.searchParams.set('videoCategoryId', '10'); // Music — cuts down on reaction/cover-compilation noise
  apiUrl.searchParams.set('videoEmbeddable', 'true');
  apiUrl.searchParams.set('maxResults', '5');
  apiUrl.searchParams.set('key', apiKey);

  const r = await fetch(apiUrl);
  const data = await r.json();
  if (!r.ok) {
    const err = new Error((data.error && data.error.message) || `YouTube API error (${r.status})`);
    err.status = r.status;
    err.reason = data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
    throw err;
  }

  const candidates = (data.items || [])
    .map(item => ({
      youtubeId: item.id && item.id.videoId,
      title: item.snippet && item.snippet.title,
      channelTitle: item.snippet && item.snippet.channelTitle,
    }))
    .filter(c => c.youtubeId);
  if (!candidates.length) return null;

  const { embeddable } = await checkEmbeddable(apiKey, candidates.map(c => c.youtubeId));
  return candidates.find(c => embeddable.has(c.youtubeId)) || null;
}

app.post('/api/find-replacement', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: "YouTube search isn't configured — add YOUTUBE_API_KEY to your .env file (see README).",
    });
  }
  const song = state.playlist.find(s => s.id === (req.body && req.body.id));
  if (!song) return res.status(404).json({ error: 'Song not found.' });
  try {
    const replacement = await findReplacement(apiKey, song.title, song.artist);
    res.json({ replacement });
  } catch (e) {
    const known = explainYoutubeError(e);
    res.status(known ? known.status : 502).json(known ? { error: known.message, code: known.code } : { error: 'Could not reach the YouTube API — check your connection and try again.' });
  }
});

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

    const { embeddable } = await checkEmbeddable(apiKey, songs.map(s => s.youtubeId));
    const playable = songs.filter(s => embeddable.has(s.youtubeId));

    // Auto-category suggestion per song — a small concurrency limit keeps a
    // big playlist from taking forever while not firing off too many
    // concurrent API calls at once. The host's own blanket "Tag these as..." (applied client-side,
    // if they used it) still wins over these per-song suggestions.
    if (state.settings.autoCategories) {
      const CONCURRENCY = 5;
      for (let i = 0; i < playable.length; i += CONCURRENCY) {
        const batch = playable.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (s) => {
          try {
            const tags = await suggestSongTags(s.title, s.artist);
            if (tags) Object.assign(s, tags);
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
  // Real-playback failures the TV has actually hit (see tv:playerStatus) are
  // ground truth regardless of whether a YOUTUBE_API_KEY is even configured
  // — never gate those behind the optional key the way the Data-API check
  // below is.
  const knownBrokenIds = new Set(Object.keys(state.knownBroken));

  if (!apiKey) {
    const broken = state.playlist
      .filter(s => knownBrokenIds.has(s.id))
      .map(s => ({ id: s.id, title: s.title, artist: s.artist }));
    return res.json({
      broken,
      checkError: "Full playlist scan isn't configured — add YOUTUBE_API_KEY to your .env file (see README). Showing only songs with a confirmed real playback failure so far.",
    });
  }
  try {
    const { embeddable, hadApiError } = await checkEmbeddable(apiKey, state.playlist.map(s => s.youtubeId));
    const broken = state.playlist
      .filter(s => !embeddable.has(s.youtubeId) || knownBrokenIds.has(s.id))
      .map(s => ({ id: s.id, title: s.title, artist: s.artist }));
    // hadApiError means at least one batch's own API call failed (bad key,
    // quota exceeded, network issue) and that batch was skipped rather than
    // actually checked — tell the host that plainly instead of letting a
    // clean "0 broken" reading look like a real all-clear when part of the
    // playlist was never verified at all.
    res.json({
      broken,
      checkError: hadApiError
        ? "Some songs couldn't be fully verified — a YouTube API call failed (quota exceeded or a network issue). Results below may be incomplete; try again in a bit."
        : null,
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the YouTube API — check your connection and try again.' });
  }
});

// Read-only "ready to go?" gate the host can run right before the party
// starts — bundles a few checks that would otherwise only surface one at a
// time, mid-party, as separate surprises (an empty playlist, a broken video
// discovered live, nobody's joined yet). Reuses checkEmbeddable() exactly
// like /api/check-playlist; degrades gracefully (a skipped check, not an
// error) when YOUTUBE_API_KEY isn't configured, same as everywhere else this
// app treats that key as optional.
app.post('/api/preflight', async (req, res) => {
  const checks = [];
  checks.push({
    label: 'Playlist has songs',
    ok: state.playlist.length > 0,
    detail: `${state.playlist.length} song${state.playlist.length === 1 ? '' : 's'}`,
  });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    checks.push({ label: 'No broken videos', ok: null, detail: 'YOUTUBE_API_KEY not set — skipped' });
  } else if (!state.playlist.length) {
    checks.push({ label: 'No broken videos', ok: null, detail: 'No songs to check' });
  } else {
    try {
      const { embeddable } = await checkEmbeddable(apiKey, state.playlist.map(s => s.youtubeId));
      const brokenCount = state.playlist.filter(s => !embeddable.has(s.youtubeId)).length;
      checks.push({
        label: 'No broken videos',
        ok: brokenCount === 0,
        detail: brokenCount ? `${brokenCount} won't play` : 'All songs check out',
      });
    } catch (e) {
      checks.push({ label: 'No broken videos', ok: null, detail: 'Could not reach YouTube — try again' });
    }
  }

  const playerCount = Object.keys(state.players).length;
  checks.push({
    label: 'At least one player joined',
    ok: playerCount > 0,
    detail: `${playerCount} player${playerCount === 1 ? '' : 's'}`,
  });

  // Only an explicit false blocks readiness — a skipped (null) check (no API
  // key configured) shouldn't stop the host from starting.
  const ready = checks.every(c => c.ok !== false);
  res.json({ ready, checks });
});

// ---------- sockets ----------

io.on('connection', (socket) => {
  let role = null;
  let playerId = null;

  // A single malformed payload (e.g. null where a handler destructures an
  // object) used to throw straight out of the handler and crash the whole
  // process mid-game. Every handler below is registered through this guard,
  // so a bad event is logged and dropped instead of taking the server down.
  const rawOn = socket.on.bind(socket);
  socket.on = (event, handler) => rawOn(event, (...args) => {
    // Role gate. Every control event is checked against the role this socket
    // registered as — registering as 'host' is what the join PIN protects, so
    // without this any connected socket (a player's phone, a stray browser
    // tab, anything that can reach the server) could emit host:resetGame and
    // friends without ever registering, sidestepping the PIN entirely.
    if (event.startsWith('host:') && role !== 'host') return;
    if (event.startsWith('player:') && role !== 'player') return;
    if (event === 'tv:playerStatus' && role !== 'tv') return;
    try {
      const result = handler(...args);
      if (result && typeof result.catch === 'function') result.catch(e => console.error(`[socket ${event}]`, e));
    } catch (e) {
      console.error(`[socket ${event}]`, e);
    }
  });

  socket.on('register', ({ role: r, id, name, team, pin } = {}) => {
    if (r !== 'host' && r !== 'tv' && r !== 'player') return;
    if (r === 'player') {
      // The id becomes a key of state.players and ends up in HTML attributes
      // on the host page, so it must be a plain token — the real client sends
      // a UUID or "p-xxxx". Names/teams are clamped to what the UI allows.
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) return;
      name = typeof name === 'string' ? name.trim().slice(0, 24) : '';
      team = typeof team === 'string' ? team : undefined;
    }
    // Checked before socket.join(role), so a wrong/missing PIN never puts
    // this socket in the 'host'/'player' room — it gets no state broadcasts
    // at all until a correct register call comes in. A small deliberate
    // delay on the failure path is a minimal (not exhaustive) brute-force
    // deterrent, not real rate-limiting.
    if (JOIN_PIN && (r === 'host' || r === 'player') && pin !== JOIN_PIN) {
      setTimeout(() => socket.emit('registerError', { reason: 'badPin' }), 400);
      return;
    }
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
    if (!playerId || state.roundStatus !== 'playing' || state.buzzingLocked || state.paused) return;
    // Wager round: exclusive to whoever placed the wager — nobody else gets
    // to race for the buzzer on a Daily Double.
    if (state.wager && playerId !== state.wager.playerId) return;
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
    // Tease is rolled once, right at buzz time, so it stays the same across
    // every re-broadcast of this round instead of changing on every render.
    const tease = state.settings.easterEggMahtab && isMahtabName(state.players[playerId].name) ? mahtabTease() : null;
    state.buzzOrder.push({ id: playerId, name: state.players[playerId].name, time: buzzTime, tease });
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
    // Achievement badges track THIS game only (reset every resetGame), unlike
    // the all-time record book above — a badge is "best of tonight", not a
    // permanent record, so these are two genuinely separate counters even
    // though they're computed from the exact same buzz.
    if (state.settings.achievementBadges && isFirstBuzzOfRound && state.roundStartedAt) {
      const ms = buzzTime - state.roundStartedAt;
      if (!state.badgeStats.fastestBuzz || ms < state.badgeStats.fastestBuzz.ms) {
        state.badgeStats.fastestBuzz = { id: playerId, name: state.players[playerId].name, ms };
      }
    }

    broadcast();
  });

  socket.on('host:addSong', async ({ youtubeId, title, artist, category, year, decade, difficulty }) => {
    if (!youtubeId || typeof youtubeId !== 'string') return;
    const id = youtubeId.trim();
    if (state.playlist.some(s => s.youtubeId === id)) {
      socket.emit('addSongRejected', { youtubeId: id, message: 'That video is already in the playlist.' });
      return;
    }

    // Verify the video will really play on the TV BEFORE adding it, so a
    // broken song never reaches the playlist (it used to be added first and
    // merely warned about afterwards, which is how unplayable songs ended up
    // in rounds). Only a definite "can't play" blocks the add: with no API
    // key configured, or if the check itself errors (bad key, quota), the
    // song is still added with a heads-up that it wasn't verified — manual
    // add must keep working with zero YouTube API setup.
    const apiKey = process.env.YOUTUBE_API_KEY;
    let unverified = null;
    if (!apiKey) {
      unverified = "Added, but this couldn't be checked for embedding — add YOUTUBE_API_KEY to .env so the app can verify videos.";
    } else {
      const { embeddable, hadApiError, reasons } = await checkEmbeddable(apiKey, [id]);
      if (hadApiError) {
        unverified = "Added, but the YouTube check failed (network or quota), so it couldn't be verified as playable.";
      } else if (!embeddable.has(id)) {
        socket.emit('addSongRejected', {
          youtubeId: id,
          message: `Not added — ${reasons.get(id) || "this video can't be played on the TV"}. Try a different upload (an "Artist - Topic" or lyric-video version often works).`,
        });
        return;
      }
    }

    const song = makeSong(id, title, artist, category, { year, decade, difficulty });
    state.playlist.push(song);
    savePlaylist();
    broadcast();
    if (unverified) socket.emit('addSongWarning', { youtubeId: id, message: unverified });

    // Auto-tagging — fills only what the host left blank (genre, year/decade,
    // difficulty); never overwrites a choice they made themselves.
    if (state.settings.autoCategories && (!song.category || !song.decade || !song.difficulty)) {
      try {
        const tags = await suggestSongTags(song.title, song.artist);
        if (tags) {
          if (!song.category) song.category = tags.category;
          if (!song.decade) Object.assign(song, sanitizeSongTags({ year: tags.year, difficulty: song.difficulty }));
          if (!song.difficulty && DIFFICULTIES.includes(tags.difficulty)) song.difficulty = tags.difficulty;
          savePlaylist();
          broadcast();
        }
      } catch (e) { /* non-blocking */ }
    }
  });

  socket.on('host:addSongs', (songs) => {
    if (!Array.isArray(songs) || !songs.length) return;
    const existingIds = new Set(state.playlist.map(s => s.youtubeId));
    for (const entry of songs) {
      if (!entry || typeof entry.youtubeId !== 'string') continue;
      const { youtubeId, title, artist, category, year, decade, difficulty } = entry;
      if (!youtubeId.trim() || existingIds.has(youtubeId.trim())) continue;
      const song = makeSong(youtubeId, title, artist, category, { year, decade, difficulty });
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
    delete state.knownBroken[id];
    savePlaylist();
    broadcast();
  });

  // Click-to-cycle difficulty badge on a playlist row.
  socket.on('host:setSongDifficulty', ({ id, difficulty }) => {
    const song = state.playlist.find(s => s.id === id);
    if (!song || (difficulty !== '' && !DIFFICULTIES.includes(difficulty))) return;
    song.difficulty = difficulty;
    savePlaylist();
    broadcast();
  });

  // The host's playlist filter chips double as the pool Play next / auto-
  // advance / random draw from — see matchesPlayFilter().
  socket.on('host:setPlayFilter', (f) => {
    if (!f || typeof f !== 'object') return;
    const text = v => (typeof v === 'string' ? v.slice(0, 60) : '');
    state.playFilter = {
      category: text(f.category),
      decade: /^(19|20)\d0s$/.test(f.decade) ? f.decade : '',
      difficulty: DIFFICULTIES.includes(f.difficulty) ? f.difficulty : '',
    };
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

  // Swaps in a replacement video found via /api/find-replacement — only the
  // youtubeId changes, title/artist/category/points/played stay exactly as
  // the host already had them. If this song is the live currentSong,
  // broadcasting the new youtubeId is enough on its own: tv.js's syncVideo()
  // reloads whenever currentSong.youtubeId differs from what's loaded, so a
  // mid-round swap just plays automatically, no separate "reload" event
  // needed. Re-validates the id's shape rather than trusting the client,
  // same as host:openOnYoutube.
  socket.on('host:replaceSongVideo', ({ id, youtubeId } = {}) => {
    const song = state.playlist.find(s => s.id === id);
    if (!song || !youtubeId || !/^[\w-]{11}$/.test(youtubeId)) return;
    song.youtubeId = youtubeId;
    delete state.knownBroken[id]; // fresh video — give it a clean slate rather than carrying over the old one's failure
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
    // currentIndex is a position, not a song identity — reordering while a
    // round is live (or just closed) must re-find the same song by id, or
    // it silently points at whatever song now sits at the old position.
    // That bug used to make revealAnswer mark the WRONG song as played,
    // leaving the actually-played one eligible to be picked again later —
    // a repeat within the same session.
    const playingId = state.currentIndex >= 0 ? state.playlist[state.currentIndex].id : null;
    state.playlist = reordered;
    state.currentIndex = playingId !== null ? state.playlist.findIndex(s => s.id === playingId) : -1;
    savePlaylist();
    broadcast();
  });

  // Setlist presets: save/load a whole playlist+settings combo under a name
  // (e.g. "80s night", "Kids party") so a host doesn't have to rebuild the
  // playlist from scratch each game night. Mirrors the playlist/settings
  // persistence pattern exactly (presets.json). Deliberately doesn't touch
  // players/scores — a preset is about songs+rules, not who's currently
  // playing. Loading is idle-only, same reasoning as category voting: never
  // let it compete with or corrupt a round that's actually in progress.
  socket.on('host:savePreset', ({ name } = {}) => {
    if (!state.settings.setlistPresets) return;
    const clean = (name || '').trim().slice(0, 40);
    if (!clean) return;
    // Deep-copy, not a reference — state.playlist/state.settings keep
    // mutating after this (new songs, toggles), and a saved preset must be a
    // frozen snapshot from this exact moment, not a window onto live state.
    state.presets[clean] = {
      playlist: state.playlist.map(s => ({ ...s })),
      settings: { ...state.settings },
      savedAt: Date.now(),
    };
    savePresets();
    broadcast();
  });

  socket.on('host:loadPreset', ({ name } = {}) => {
    if (!state.settings.setlistPresets || state.roundStatus !== 'idle') return;
    const preset = state.presets[name];
    if (!preset) return;
    state.playlist = preset.playlist.map(s => ({ ...s }));
    // setlistPresets itself always stays on after a load — otherwise loading
    // a preset saved before this toggle existed (or saved with it off) would
    // instantly hide the very card the host just used to load it.
    state.settings = { ...DEFAULT_SETTINGS, ...preset.settings, setlistPresets: true };
    state.mysterySongId = null;
    state.mysteryModifier = null;
    clearVoteTimer();
    state.categoryVote = null;
    savePlaylist();
    saveSettings();
    broadcast();
  });

  socket.on('host:deletePreset', ({ name } = {}) => {
    if (!state.settings.setlistPresets) return;
    if (!state.presets[name]) return;
    delete state.presets[name];
    savePresets();
    broadcast();
  });

  socket.on('host:startRound', ({ id, timerSeconds, snippetSeconds, wagerPlayerId, startOffsetSeconds }) => {
    if (startRound(id, timerSeconds, snippetSeconds, wagerPlayerId, startOffsetSeconds)) broadcast();
  });

  socket.on('host:setWagerEligible', ({ id, eligible } = {}) => {
    const song = state.playlist.find(s => s.id === id);
    if (!song) return;
    song.wagerEligible = !!eligible;
    savePlaylist();
    broadcast();
  });

  // The wagering player locks in how much of their own score to risk —
  // roundStartedAt/round timer deliberately don't start until this happens,
  // so the "get ready" thinking time isn't eaten by a running clock.
  socket.on('player:submitWager', ({ amount } = {}) => {
    if (!playerId || !state.wager || state.wager.playerId !== playerId || state.wager.amount !== null) return;
    if (state.roundStatus !== 'wagering') return;
    const player = state.players[playerId];
    const n = Math.round(Number(amount));
    if (!player || !Number.isFinite(n) || n < 0 || n > player.score) return;
    state.wager.amount = n;
    state.roundStatus = 'playing';
    state.roundStartedAt = Date.now();
    state.speedBonusPaid = false;
    if (state.wager.timerSeconds > 0) startRoundTimer(state.wager.timerSeconds);
    broadcast();
  });

  // "Reset buzzers" = "that answer was wrong, let someone else try". If the
  // current buzz hasn't been judged yet it is judged wrong now, so the TV and
  // that player's phone show it exactly as the Wrong button would.
  socket.on('host:resetBuzzers', () => {
    if (state.currentIndex === -1) return;
    const current = state.buzzOrder[state.buzzOrder.length - 1];
    if (current && state.roundStatus === 'buzzed') applyWrongVerdict(current);
    reopenBuzzing();
    broadcast();
  });

  // The host's ❌ Wrong button. Shows the verdict on the TV and on that
  // player's phone, and — only when the steal mechanic is on — reopens buzzing
  // for everyone who hasn't had a turn yet. With steal off the verdict just
  // stays up: the host can reveal the answer, or press Reset buzzers to let
  // others try anyway. A Daily Double miss costs the wager.
  socket.on('host:markWrong', ({ id } = {}) => {
    const current = state.buzzOrder[state.buzzOrder.length - 1];
    if (state.paused || state.roundStatus !== 'buzzed' || !current || current.id !== id || current.verdict) return;
    // What this miss costs: a Daily Double loses the wager; an ordinary round
    // loses 1 point when "Wrong costs a point" is on. (Reset buzzers marks a
    // buzz wrong too but never costs anything — it's the host's no-penalty way
    // to let others try.) Scores may go below zero.
    const wagerAmount = state.wager && state.wager.amount != null ? state.wager.amount : 0;
    const loss = state.wager ? wagerAmount : (state.settings.wrongPenalty ? 1 : 0);
    applyWrongVerdict(current, loss);
    if (loss > 0) {
      const team = state.settings.teamMode ? teamOf(id) : '';
      const recipients = team ? Object.keys(state.players).filter(pid => teamOf(pid) === team) : [id];
      recipients.forEach(pid => { state.players[pid].score -= loss; });
      savePlayers();
      logAction(`-${loss} ${state.players[id].name} (${state.wager ? 'lost the Daily Double wager' : 'wrong answer'})`);
    }

    // Steal: wrong answers reopen buzzing for the players who haven't had a
    // go. Never on a Daily Double (exclusive to one player), and not when
    // nobody is left who could buzz — the host reveals instead.
    if (state.settings.stealMechanic && !state.wager && someoneCanStillBuzz()) reopenBuzzing();
    broadcast();
  });

  // Pause/resume: freezes buzzing and any running countdowns for a break
  // (bathroom, food) without resetting anything. A running round timer or
  // auto-advance countdown is stopped and its remaining seconds snapshotted,
  // then re-armed with that same remaining time on resume — not restarted
  // from full, and not left silently ticking in the background while paused.
  socket.on('host:togglePause', () => {
    if (!state.settings.pauseGame) return;
    if (state.paused) {
      state.paused = false;
      const snap = state.pauseRemaining;
      state.pauseRemaining = null;
      if (snap) {
        if (snap.roundTimerSeconds > 0) startRoundTimer(snap.roundTimerSeconds);
        if (snap.autoAdvanceSeconds > 0) scheduleAutoAdvance(snap.autoAdvanceSeconds, snap.nextRoundTimerSeconds);
      }
    } else {
      const roundTimerSeconds = state.roundTimer ? Math.max(1, Math.ceil((state.roundTimer.endsAt - Date.now()) / 1000)) : 0;
      const autoAdvanceSeconds = state.autoAdvance ? Math.max(1, Math.ceil((state.autoAdvance.endsAt - Date.now()) / 1000)) : 0;
      state.pauseRemaining = {
        roundTimerSeconds,
        autoAdvanceSeconds,
        nextRoundTimerSeconds: state.autoAdvance ? state.autoAdvance.nextRoundTimerSeconds : 0,
      };
      clearRoundTimer();
      clearAutoAdvance();
      state.paused = true;
    }
    broadcast();
  });

  socket.on('host:revealAnswer', ({ autoAdvanceSeconds } = {}) => {
    revealRound(autoAdvanceSeconds);
    broadcast();
  });

  socket.on('host:awardPoint', ({ id, delta, autoAdvanceSeconds }) => {
    if (state.players[id]) {
      // Confetti/chime on the TV only for the natural "they got it right"
      // case — the current buzz-in leader (the most recent buzzer, not
      // necessarily the first of the round if there was a reset in
      // between) getting a point — not just any manual scoreboard tweak
      // elsewhere on the host page.
      const currentBuzzer = state.buzzOrder[state.buzzOrder.length - 1];
      const isNaturalCorrectAward = delta > 0 && state.roundStatus === 'buzzed' && currentBuzzer && currentBuzzer.id === id && !currentBuzzer.verdict;
      // A "steal": this round already had a miss (resetBuzzers fired), and
      // whoever buzzed in after that miss just got it right — bonus point
      // on top of the normal award. Only one bonus per steal opportunity,
      // so a second manual +1 on the same buzzer doesn't re-trigger it.
      const isSteal = isNaturalCorrectAward && state.settings.stealMechanic && state.roundHadMiss && !state.wager;
      // Speed bonus: buzzed in within the first few seconds of the round
      // actually starting (not of the reveal, or of this award — the buzz
      // timestamp itself). One bonus per round, same one-shot guard pattern
      // as the steal bonus above.
      const isSpeedBonus = isNaturalCorrectAward && state.settings.speedBonus && !state.speedBonusPaid && !state.wager
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

      if (isNaturalCorrectAward) currentBuzzer.verdict = 'correct';
      if (isSteal) {
        state.roundHadMiss = false;
        io.to('tv').emit('steal', { name: displayName(state.players[id].name), speedBonus: isSpeedBonus });
      } else if (isNaturalCorrectAward) {
        io.to('tv').emit('correct', { name: displayName(state.players[id].name), speedBonus: isSpeedBonus });
      }

      const song = currentSong();
      const bonusTags = [isSteal ? '🔥 steal' : null, isSpeedBonus ? '⚡ speed' : null].filter(Boolean);
      const bonusNote = bonusTags.length ? ` (${bonusTags.join(', ')})` : '';
      const recipientNote = recipients.length > 1 ? ` [+${recipients.length - 1} teammate${recipients.length > 2 ? 's' : ''}]` : '';
      const context = isNaturalCorrectAward && song ? ` — "${song.title}"` : ' (manual)';
      logAction(`${totalAwarded >= 0 ? '+' : ''}${totalAwarded} ${state.players[id].name}${recipientNote}${bonusNote}${context}`);

      if (state.settings.achievementBadges) {
        if (isNaturalCorrectAward) {
          state.badgeStats.correct[id] = (state.badgeStats.correct[id] || 0) + 1;
          if (isSteal) state.badgeStats.steals[id] = (state.badgeStats.steals[id] || 0) + 1;
        }
        // Comeback Kid: was any player in sole/shared last place just now?
        // Checked after every award (not just this one) so it catches a
        // player being knocked into last by someone ELSE'S point too.
        const scores = Object.values(state.players).map(p => p.score);
        if (scores.length >= 2) {
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          if (min < max) {
            Object.entries(state.players).forEach(([pid, p]) => {
              if (p.score === min) state.badgeStats.everLastPlace[pid] = true;
            });
          }
        }
      }

      checkGameLimit();
      // ✅ Correct also reveals the song (unless this very award just ended the
      // game by hitting the score limit — then results are already showing).
      if (isNaturalCorrectAward && state.settings.autoRevealOnCorrect && state.roundStatus === 'buzzed') {
        revealRound(autoAdvanceSeconds);
      }
      broadcast();
    }
  });

  socket.on('host:setLanguage', (lang) => {
    if (lang !== 'en' && lang !== 'fa') return;
    state.language = lang;
    broadcast();
  });

  socket.on('host:setTheme', (theme) => {
    if (theme !== 'dark' && theme !== 'light') return;
    state.theme = theme;
    broadcast();
  });

  socket.on('host:setPlayOrder', (order) => {
    if (order !== 'sequential' && order !== 'random') return;
    state.playOrder = order;
    broadcast();
  });

  // Starts whichever unplayed song pickNextSong() picks next, honoring
  // state.playOrder — the host-facing way to actually use the order toggle
  // without waiting on auto-advance. No-ops once every song's been played.
  socket.on('host:playNext', ({ timerSeconds, snippetSeconds, startOffsetSeconds } = {}) => {
    const next = pickNextSong();
    if (next && startRound(next.id, timerSeconds, snippetSeconds, undefined, startOffsetSeconds)) broadcast();
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
      // Game limit's two numeric fields ride along in the same settings
      // blob as every boolean toggle (same persistence, same broadcast) —
      // just validated/clamped instead of type-checked as a boolean.
      if (key === 'scoreLimitValue' || key === 'roundLimitValue') {
        state.settings[key] = Math.max(0, Math.floor(Number(patch[key]) || 0));
      } else if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key) && typeof patch[key] === 'boolean') {
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

  // Relay to the host (unchanged — TV-local monitoring info, not shared
  // game state, deliberately bypasses state/broadcast() same as always).
  // Also the one place this app learns the GROUND TRUTH about a video: the
  // YouTube Data API's status.embeddable flag can say true for a video that
  // still fails at actual iframe playback time (a real, documented quirk —
  // Content-ID-claimed major-label uploads in particular can block
  // embedding in a way that only shows up as an onError from the real
  // player, never as an API field) — so a confirmed real failure here is
  // recorded and fed into /api/check-playlist's broken-video scan too,
  // catching exactly the case the Data-API-only check can miss.
  socket.on('tv:playerStatus', (payload) => {
    io.to('host').emit('playerStatus', payload);
    if (!payload || !payload.songId) return;
    if (payload.status === 'error') {
      state.knownBroken[payload.songId] = { message: payload.message || 'Playback error', at: Date.now() };
    } else if (payload.status === 'playing' || payload.status === 'buffering') {
      // A real success for this song (this attempt, or after a replacement
      // was applied) — the earlier failure no longer applies.
      delete state.knownBroken[payload.songId];
    }
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
    logAction(`🗑️ ${state.players[id].name} removed from the game`);
    delete state.players[id];
    const holdingFloor = state.buzzOrder.length > 0 && state.buzzOrder[state.buzzOrder.length - 1].id === id;
    state.buzzOrder = state.buzzOrder.filter(b => b.id !== id);
    // If the player we removed was the one currently holding the floor,
    // reopen buzzing for whoever's left rather than leaving the round
    // stuck on a buzz-in that no longer has anyone behind it. (This used to
    // check "nobody has buzzed at all any more", which missed the case where
    // earlier — already-wrong — buzzers remain after a steal: the round then
    // sat on one of THEM as the "current" buzzer, with buzzing closed.)
    if (holdingFloor && state.roundStatus === 'buzzed') reopenBuzzing();
    savePlayers();
    broadcast();
  });

  socket.on('host:showResults', () => {
    showResults();
    broadcast();
  });

  socket.on('host:closeRound', () => {
    state.roundStatus = 'idle';
    state.currentIndex = -1;
    state.buzzOrder = [];
    state.wager = null;
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
    state.paused = false;
    state.pauseRemaining = null;
    state.actionLog = [];
    state.badgeStats = { fastestBuzz: null, steals: {}, correct: {}, everLastPlace: {} };
    state.wager = null;
    state.roundsPlayed = 0;
    broadcast();
  });

  socket.on('host:clearActionLog', () => {
    state.actionLog = [];
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

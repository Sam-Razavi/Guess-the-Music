// Music Bingo (بینگوی موسیقی): every phone gets a card of real songs from the
// music game's library; the TV plays short clips without saying what they are;
// players mark the songs they recognise and tap BINGO when a line is complete.
//
//   lobby
//   loading  — the TV is loading the next song; the clip timer only starts when
//              it really plays (a slow load never eats into the clip)
//   playing  — the clip; the title is a secret (also from the TV payload)
//   reveal   — title + artist (and the video), then the next song
//   claim    — someone's BINGO checked out: their card on the TV; anyone else
//              with a valid card in the next few seconds shares the prize
//   final    — podium + awards
//
// Prizes on the same cards, in order: one line, two lines, full house (the host
// can pick fewer). A claim counts the cells the player MARKED whose song has
// been played — the clip that's on right now counts. A wrong claim sits the
// player out until the next song.
//
// Everything a phone or the TV could give away stays on the server: the current
// song's title until the reveal, and other players' cards ("1 away" counts only
// use songs that have already been revealed).

const { shuffle, clampInt, makeTimers, rankGroups, answerKey } = require('./common');

const POOL_FOR = { 3: 16, 4: 28, 5: 38 };   // songs per game — see the timing notes in CLAUDE.md
const LOAD_TIMEOUT_MS = 9000;     // no word from the TV: start the clip timer anyway
const REVEAL_MS = 7000;
const CLAIM_MS = 7500;            // the winning card stays up this long
const CLAIM_JOIN_MS = 4000;       // ...and another valid card in this window shares the prize
const PRIZE_POINTS = { line: 1, two: 2, full: 3 };
const PRIZE_SETS = { line: ['line'], lineFull: ['line', 'full'], all: ['line', 'two', 'full'] };
const START_AT = { intro: 0, into: 35 }; // seconds into the video: "into" skips most intros
const POOLS = ['mix', 'persian', 'intl'];
const LEVELS = ['easy', 'medium', 'all'];

const isPersian = (s) => /^Persian|^Bandari/.test(s.category || '');

function linesFor(n) {
  const L = [];
  for (let r = 0; r < n; r++) L.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) L.push(Array.from({ length: n }, (_, r) => r * n + c));
  L.push(Array.from({ length: n }, (_, i) => i * n + i));
  L.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
  return L;
}

module.exports = function bingo(ctx) {
  const timers = makeTimers();
  const used = new Set(); // song ids played in a bingo game tonight — the next game prefers others
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',
      settings: g ? g.settings : { pool: 'mix', level: 'medium', size: 4, clip: 30, prizes: 'all', help: true, auto: true, start: 'into' },
      songs: new Map(),   // id -> { id, youtubeId, title, artist }
      order: [],          // call order (song ids)
      callIdx: -1,
      current: null,      // song id of the current call
      calls: [],          // song ids that really played, in order (the current clip included)
      revealed: 0,        // how many of `calls` have been revealed
      skipped: [],
      cards: {},          // pid -> { cells: [id|null], marks: Set, sitOutUntil, earCalls: Set }
      prizeIdx: 0,
      winners: [],        // [{ prize, pids }]
      claim: null,        // { prize, pids, hits: {pid: [cell idx]}, joinUntil, resume }
      endsAt: null,
      nextAt: null,
      paused: null,       // { left, what } while paused
      token: 0,           // bumped on every (re)start of a clip — the TV restarts playback when it changes
      tv: { status: 'idle', songId: null, code: null },
      points: {},
      ear: {},            // pid -> songs marked correctly while their clip was playing
      falses: {},         // pid -> false bingos
      notice: null,       // { kind: 'false' | 'skip', name, at }
    };
  }
  reset();

  // ---------- songs ----------
  function eligible() {
    const s = g.settings;
    const seen = new Set();
    const out = [];
    for (const x of ctx.playlist()) {
      if (!x || !x.youtubeId || !x.title || ctx.isBroken(x.id)) continue;
      if (s.pool === 'persian' && !isPersian(x)) continue;
      if (s.pool === 'intl' && isPersian(x)) continue;
      if (s.level === 'easy' && x.difficulty !== 'easy') continue;
      if (s.level === 'medium' && x.difficulty === 'hard') continue;
      // Two songs called "Bahar" on one card would be a coin toss — one per title.
      const k = answerKey(x.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }
  const cellsFor = (n) => n * n - (n === 5 ? 1 : 0);

  function buildPool() {
    const want = POOL_FOR[g.settings.size];
    const all = eligible();
    const fresh = shuffle(all.filter(x => !used.has(x.id)));
    const again = shuffle(all.filter(x => used.has(x.id)));
    const pick = fresh.concat(again).slice(0, want);
    g.songs = new Map(pick.map(x => [x.id, { id: x.id, youtubeId: x.youtubeId, title: x.title, artist: x.artist || '' }]));
    g.order = shuffle(pick.map(x => x.id));
  }

  function makeCard() {
    const n = g.settings.size;
    const ids = shuffle([...g.songs.keys()]).slice(0, cellsFor(n));
    if (n === 5) ids.splice(12, 0, null); // FREE in the middle
    return { cells: ids, marks: new Set(), sitOutUntil: 0, earCalls: new Set() };
  }
  function cardOf(pid) {
    if (!g.cards[pid] && ['loading', 'playing', 'reveal', 'claim'].includes(g.status) && ctx.exists(pid)) g.cards[pid] = makeCard();
    return g.cards[pid] || null;
  }

  // ---------- prizes ----------
  const prizeList = () => PRIZE_SETS[g.settings.prizes] || PRIZE_SETS.all;
  const currentPrize = () => prizeList()[g.prizeIdx] || null;

  // Which cells make the given prize, counting cells for which ok(i) is true.
  function winningCells(card, prize, ok) {
    const n = g.settings.size;
    const good = (i) => card.cells[i] === null || ok(i);
    if (prize === 'full') return card.cells.every((_, i) => good(i)) ? card.cells.map((_, i) => i) : null;
    const done = linesFor(n).filter(l => l.every(good));
    if (done.length < (prize === 'two' ? 2 : 1)) return null;
    return [...new Set(done.flat())];
  }
  // A claim counts marked cells whose song has played (the current clip included).
  function claimCells(card, prize) {
    const played = new Set(g.calls);
    return winningCells(card, prize, (i) => card.marks.has(i) && played.has(card.cells[i]));
  }
  // "N away" for the TV: only revealed songs, never the secret current clip.
  function awayCount(card, prize) {
    const shown = new Set(g.calls.slice(0, g.revealed));
    const miss = (i) => card.cells[i] !== null && !shown.has(card.cells[i]);
    if (prize === 'full') return card.cells.filter((_, i) => miss(i)).length;
    const L = linesFor(g.settings.size).map(l => l.filter(miss));
    if (prize === 'line') return Math.min(...L.map(l => l.length));
    let best = Infinity;
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) best = Math.min(best, new Set([...L[a], ...L[b]]).size);
    return best;
  }

  // ---------- the calls ----------
  function nextCall() {
    timers.clear('next'); timers.clear('load'); timers.clear('clip');
    g.nextAt = null;
    g.callIdx += 1;
    if (g.callIdx >= g.order.length) { finish(); return; }
    g.current = g.order[g.callIdx];
    used.add(g.current);
    g.status = 'loading';
    g.endsAt = null;
    g.token += 1;
    g.tv = { status: 'loading', songId: g.current, code: null };
    timers.set('load', LOAD_TIMEOUT_MS, () => startClip());
    ctx.broadcast();
  }

  function startClip() {
    if (g.status !== 'loading') return;
    timers.clear('load');
    g.status = 'playing';
    if (!g.calls.includes(g.current)) g.calls.push(g.current);
    const ms = g.settings.clip * 1000;
    g.endsAt = ctx.now() + ms;
    timers.set('clip', ms, reveal);
    ctx.broadcast();
  }

  function reveal() {
    if (g.status !== 'playing') return;
    timers.clear('clip');
    g.status = 'reveal';
    g.revealed = g.calls.length;
    g.endsAt = null;
    scheduleNext(REVEAL_MS);
    ctx.broadcast();
  }
  function scheduleNext(ms) {
    timers.clear('next');
    if (g.settings.auto) { g.nextAt = ctx.now() + ms; timers.set('next', ms, nextCall); } else g.nextAt = null;
  }

  // The current song can't play (or the host skipped it): it doesn't count.
  function skipCurrent(why) {
    if (!['loading', 'playing'].includes(g.status)) return;
    if (g.status === 'playing') g.calls = g.calls.filter(id => id !== g.current);
    g.skipped.push(g.current);
    if (why !== 'host') ctx.markBroken(g.current, `Music Bingo: the TV couldn't play it (${why})`);
    g.notice = { kind: 'skip', name: '', at: ctx.now() };
    nextCall();
  }

  // ---------- claims ----------
  function claim(pid) {
    const prize = currentPrize();
    if (!prize || !['loading', 'playing', 'reveal', 'claim'].includes(g.status) || g.paused) return { ok: false, reason: 'closed' };
    const card = cardOf(pid);
    if (!card) return { ok: false, reason: 'nocard' };
    if (g.claim) {
      if (g.claim.pids.includes(pid)) return { ok: true, joined: true };
      if (ctx.now() > g.claim.joinUntil) return { ok: false, reason: 'closed' };
    }
    if (card.sitOutUntil > g.calls.length) return { ok: false, reason: 'sitout' };
    const hits = claimCells(card, g.claim ? g.claim.prize : prize);
    if (!hits) {
      card.sitOutUntil = g.calls.length + 1;
      g.falses[pid] = (g.falses[pid] || 0) + 1;
      g.notice = { kind: 'false', name: ctx.name(pid), at: ctx.now() };
      ctx.broadcast();
      return { ok: false, reason: 'false' };
    }
    if (g.claim) {
      g.claim.pids.push(pid);
      g.claim.hits[pid] = hits;
    } else {
      // Freeze the round where it is; resume from here once the moment is over.
      const resume = { status: g.status, clipLeft: g.endsAt ? Math.max(0, g.endsAt - ctx.now()) : null };
      timers.clear('clip'); timers.clear('next'); timers.clear('load');
      g.claim = { prize, pids: [pid], hits: { [pid]: hits }, joinUntil: ctx.now() + CLAIM_JOIN_MS, resume };
      g.status = 'claim';
      g.endsAt = null; g.nextAt = null;
      timers.set('claim', CLAIM_MS, endClaim);
    }
    ctx.broadcast();
    return { ok: true };
  }

  function endClaim() {
    if (g.status !== 'claim' || !g.claim) return;
    const c = g.claim;
    for (const pid of c.pids) g.points[pid] = (g.points[pid] || 0) + PRIZE_POINTS[c.prize];
    g.winners.push({ prize: c.prize, pids: c.pids.slice() });
    g.prizeIdx += 1;
    g.claim = null;
    if (!currentPrize()) { finish(); return; }
    // A clip cut short by the BINGO is revealed now; otherwise carry on.
    if (c.resume.status === 'playing') { g.status = 'playing'; reveal(); return; }
    if (c.resume.status === 'loading') { g.status = 'loading'; g.token += 1; timers.set('load', LOAD_TIMEOUT_MS, () => startClip()); ctx.broadcast(); return; }
    g.status = 'reveal';
    scheduleNext(REVEAL_MS);
    ctx.broadcast();
  }

  // ---------- pause ----------
  function pause() {
    if (g.paused || !['loading', 'playing', 'reveal'].includes(g.status)) return;
    const left = g.status === 'playing' && g.endsAt ? Math.max(500, g.endsAt - ctx.now())
      : g.status === 'reveal' && g.nextAt ? Math.max(500, g.nextAt - ctx.now()) : null;
    timers.clear('clip'); timers.clear('next'); timers.clear('load');
    g.paused = { left };
    g.endsAt = null; g.nextAt = null;
    ctx.broadcast();
  }
  function resume() {
    if (!g.paused) return;
    const { left } = g.paused;
    g.paused = null;
    if (g.status === 'playing') { g.endsAt = ctx.now() + left; timers.set('clip', left, reveal); }
    else if (g.status === 'reveal') { if (g.settings.auto) scheduleNext(left || REVEAL_MS); }
    else if (g.status === 'loading') timers.set('load', LOAD_TIMEOUT_MS, () => startClip());
    ctx.broadcast();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    g.endsAt = null; g.nextAt = null; g.claim = null; g.paused = null;
    const ranked = standings();
    if (ranked.length && ranked[0].points > 0) ctx.finish('bingo', rankGroups(ranked, r => r.points));
    ctx.broadcast();
  }

  function standings() {
    return Object.keys(g.cards).filter(ctx.exists)
      .map(id => ({ id, name: ctx.name(id), points: g.points[id] || 0 }))
      .sort((a, b) => b.points - a.points);
  }

  function awards() {
    const best = (obj) => {
      const rows = Object.entries(obj).filter(([id, n]) => n > 0 && ctx.exists(id));
      if (!rows.length) return null;
      const top = Math.max(...rows.map(r => r[1]));
      return { names: rows.filter(r => r[1] === top).map(r => ctx.name(r[0])), n: top };
    };
    return { ear: best(g.ear), falses: best(g.falses) };
  }

  // ---------- payloads ----------
  const songOut = (id) => { const s = g.songs.get(id); return s ? { title: s.title, artist: s.artist } : null; };
  const startAt = () => START_AT[g.settings.start] || 0;

  function payload(role, pid) {
    const prize = currentPrize();
    const inGame = !['lobby', 'final'].includes(g.status);
    const showSong = g.status === 'reveal' || (g.status === 'claim' && g.claim && g.claim.resume.status === 'reveal');
    const out = {
      status: g.status,
      settings: g.settings,
      paused: !!g.paused,
      callNo: g.calls.length,
      total: g.order.length - g.skipped.length,
      endsAt: g.endsAt,
      nextAt: g.nextAt,
      prize,
      prizes: prizeList(),
      winners: g.winners.filter(w => w.pids.some(ctx.exists)).map(w => ({ prize: w.prize, names: w.pids.filter(ctx.exists).map(ctx.name) })),
      song: showSong ? songOut(g.current) : null,
      onCards: showSong ? Object.values(g.cards).filter(c => c.cells.includes(g.current)).length : 0,
      history: g.calls.slice(0, g.revealed).slice(-6).reverse().map(songOut).filter(Boolean),
      board: inGame && prize ? Object.entries(g.cards).filter(([id]) => ctx.exists(id))
        .map(([id, c]) => ({ id, name: ctx.name(id), away: awayCount(c, prize) }))
        .sort((a, b) => a.away - b.away) : [],
      claim: g.claim ? {
        prize: g.claim.prize,
        winners: g.claim.pids.filter(ctx.exists).map(id => ({
          id, name: ctx.name(id),
          cells: g.cards[id].cells.map((sid, i) => ({ free: sid === null, title: sid ? g.songs.get(sid).title : '', hit: g.claim.hits[id].includes(i) })),
        })),
      } : null,
      notice: g.notice,
      standings: standings(),
      awards: g.status === 'final' ? awards() : null,
      size: g.settings.size,
    };
    if (role === 'tv' || role === 'host') {
      // What to play — the TV needs the video id (never the title) during the clip.
      out.play = inGame && g.current && g.songs.get(g.current) ? { songId: g.current, youtubeId: g.songs.get(g.current).youtubeId, start: startAt(), token: g.token } : null;
      const next = g.order[g.callIdx + 1];
      out.upNext = inGame && next && g.songs.get(next) ? { youtubeId: g.songs.get(next).youtubeId, start: startAt() } : null;
    }
    if (role === 'host') {
      out.secret = inGame && g.current ? songOut(g.current) : null;
      out.tv = g.tv;
      out.available = g.status === 'lobby' || g.status === 'final' ? eligible().length : null;
      out.needed = cellsFor(g.settings.size);
      out.poolSize = g.songs.size;
    }
    if (role === 'player' && pid) {
      const card = inGame || g.status === 'final' ? cardOf(pid) : null;
      if (card) {
        const shown = new Set(g.calls.slice(0, g.revealed));
        out.me = {
          cells: card.cells.map(sid => (sid === null ? { free: true } : { title: g.songs.get(sid).title, artist: g.songs.get(sid).artist, shown: shown.has(sid) })),
          marks: [...card.marks],
          sitOut: card.sitOutUntil > g.calls.length,
          won: g.winners.filter(w => w.pids.includes(pid)).map(w => w.prize),
          points: g.points[pid] || 0,
        };
      }
    }
    return out;
  }

  // ---------- events ----------
  const handlers = {
    'host:bingo:settings': ({}, patch) => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const s = g.settings;
      if (POOLS.includes(patch.pool)) s.pool = patch.pool;
      if (LEVELS.includes(patch.level)) s.level = patch.level;
      if (patch.size !== undefined) { const n = Number(patch.size); if ([3, 4, 5].includes(n)) s.size = n; }
      if (patch.clip !== undefined) s.clip = clampInt(patch.clip, 10, 90, s.clip);
      if (PRIZE_SETS[patch.prizes]) s.prizes = patch.prizes;
      if (START_AT[patch.start] !== undefined) s.start = patch.start;
      if (typeof patch.help === 'boolean') s.help = patch.help;
      if (typeof patch.auto === 'boolean') s.auto = patch.auto;
      ctx.broadcast();
    },
    'host:bingo:start': ({ socket }) => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const ids = ctx.connectedIds();
      if (!ids.length) return;
      if (g.status === 'final') reset();
      buildPool();
      if (g.songs.size < cellsFor(g.settings.size)) {
        const msg = `Only ${g.songs.size} songs match these settings — a card needs ${cellsFor(g.settings.size)}. Pick a wider song pool or a smaller card.`;
        reset();
        if (socket) socket.emit('hubError', { message: msg });
        ctx.broadcast();
        return;
      }
      g.status = 'loading'; // so cardOf() deals
      for (const id of ids) cardOf(id);
      nextCall();
    },
    'host:bingo:pause': () => (g.paused ? resume() : pause()),
    'host:bingo:reveal': () => { if (g.status === 'playing' && !g.paused) reveal(); },
    'host:bingo:next': () => { if (g.status === 'reveal' && !g.paused) nextCall(); },
    'host:bingo:skip': () => { if (g.paused) return; if (g.status === 'reveal') nextCall(); else skipCurrent('host'); },
    'host:bingo:replay': () => {
      if (g.status !== 'playing' || g.paused) return;
      g.token += 1;
      const ms = g.settings.clip * 1000;
      g.endsAt = ctx.now() + ms;
      timers.set('clip', ms, reveal);
      ctx.broadcast();
    },
    'host:bingo:end': () => { if (g.status !== 'lobby' && g.status !== 'final') finish(); },
    'host:bingo:newGame': () => { reset(); ctx.broadcast(); },

    'player:bingo:mark': ({ playerId }, { cell, on }) => {
      if (!['loading', 'playing', 'reveal', 'claim'].includes(g.status)) return;
      const card = cardOf(playerId);
      const i = Number(cell);
      if (!card || !Number.isInteger(i) || i < 0 || i >= card.cells.length || card.cells[i] === null) return;
      const want = typeof on === 'boolean' ? on : !card.marks.has(i);
      if (want) {
        card.marks.add(i);
        // A sharp ear: marked the song while its clip was playing.
        if (g.status === 'playing' && card.cells[i] === g.current && !card.earCalls.has(g.callIdx)) {
          card.earCalls.add(g.callIdx);
          g.ear[playerId] = (g.ear[playerId] || 0) + 1;
        }
      } else card.marks.delete(i);
      ctx.broadcastSoon();
    },
    'player:bingo:claim': ({ playerId }) => {
      const r = claim(playerId);
      ctx.emitTo(playerId, 'bingo:result', r);
    },
    // Only the screen that has the sound reports playback (see games/tv-screens.js).
    'tv:bingo:status': ({ socket }, { songId, status, code }) => {
      if (!ctx.isSoundTv(socket) || songId !== g.current) return;
      if (!['loading', 'playing', 'blocked', 'error'].includes(status)) return;
      g.tv = { status, songId, code: code || null };
      if (status === 'playing' && g.status === 'loading' && !g.paused) { startClip(); return; }
      if (status === 'error') { skipCurrent(`error ${code || ''}`.trim()); return; }
      // Blocked (autoplay): wait for someone to click the TV rather than run a
      // silent clip. If a clip had already started, take it back: back to
      // loading, the song doesn't count yet, and it restarts once it really plays.
      if (status === 'blocked' && g.status === 'loading') timers.clear('load');
      if (status === 'blocked' && g.status === 'playing' && !g.paused) {
        timers.clear('clip');
        g.calls = g.calls.filter(id => id !== g.current);
        g.status = 'loading';
        g.endsAt = null;
      }
      ctx.broadcast();
    },
  };

  return {
    id: 'bingo',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      delete g.cards[pid];
      delete g.points[pid];
      delete g.ear[pid];
      delete g.falses[pid];
      if (g.claim && g.claim.pids.includes(pid)) {
        g.claim.pids = g.claim.pids.filter(x => x !== pid);
        delete g.claim.hits[pid];
        if (!g.claim.pids.length) { // the only winner left: the moment is off, carry on
          const r = g.claim.resume; g.claim = null; timers.clear('claim');
          g.status = r.status === 'playing' ? 'playing' : r.status;
          if (g.status === 'playing') reveal(); else if (g.status === 'reveal') scheduleNext(REVEAL_MS); else timers.set('load', LOAD_TIMEOUT_MS, () => startClip());
        }
      }
    },
    _debug: () => g,
    _lines: linesFor,
  };
};

// Draw It! (نقاشی‌بازی) — one player draws a secret word on their phone, the
// drawing appears live on the TV, everyone else races to type the answer.
//
//   choosing — the artist picks one of three words (two easy, one hard = ×2)
//   drawing  — strokes stream in; guesses are checked on the server
//   reveal   — the word, a time-lapse of the drawing, who got it
//   final    — podium + the night's gallery
//
// Scoring: the 1st right guess = 3, the 2nd = 2, later ones = 1; the artist
// gets 1 for every right guess. A hard word doubles all of it.
//
// Strokes don't go through the regular game payload (that would resend the
// whole drawing on every update): the artist's phone sends small batches of
// points (player:draw:stroke), the server keeps the drawing and relays each
// batch as a 'draw:pts' event. Undo/clear send the whole drawing ('draw:all'),
// and a page that (re)loads mid-turn asks for it with 'hub:sync' -> 'draw:sync'.

const { shuffle, clampInt, cleanText, answerKey, makeTimers, rankGroups } = require('./common');
const WORDS = require('./data/draw-words');

const CHOOSE_MS = 15000;
const ALL_GUESSED_MS = 1500;
const GUESS_GAP_MS = 500;       // per player, so nobody floods the TV
const FEED_MAX = 8;             // wrong guesses shown on the TV
const W = 1000, H = 750;        // the drawing's own coordinates (4:3)
const COLORS = 10, SIZES = 3;
const MAX_STROKES = 800, MAX_POINTS = 80000, MAX_BATCH = 600;
const GALLERY_MAX = 12;
const GUESS_POINTS = [3, 2];    // then 1

// "Cat/Kitty": the first is shown, all are accepted.
function parseWord(raw, hard) {
  const alts = String(raw).split('/').map(s => s.trim()).filter(Boolean);
  return { text: alts[0], keys: [...new Set(alts.map(answerKey).filter(Boolean))], hard: !!hard };
}

// A guess's keys: as typed, without a leading article and without a plural ending.
function guessKeys(raw, lang) {
  const t = cleanText(raw, 40).toLowerCase();
  const out = new Set([answerKey(t)]);
  const art = lang === 'fa' ? /^(یه|یک)\s+/ : /^(a|an|the)\s+/;
  const noArt = t.replace(art, '');
  out.add(answerKey(noArt));
  for (const v of [...out]) {
    if (lang === 'fa') { if (v.endsWith('ها') && v.length > 3) out.add(v.slice(0, -2)); }
    else if (v.length > 3) { if (v.endsWith('es')) out.add(v.slice(0, -2)); if (v.endsWith('s')) out.add(v.slice(0, -1)); }
  }
  out.delete('');
  return [...out];
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Fewer points for the gallery thumbnails (the full drawing stays for the reveal).
function thin(strokes) {
  return strokes.map(s => {
    if (s.p.length <= 80) return s;
    const p = [];
    for (let i = 0; i < s.p.length; i += 4) p.push(s.p[i], s.p[i + 1]);
    p.push(s.p[s.p.length - 2], s.p[s.p.length - 1]);
    return { c: s.c, w: s.w, p };
  });
}

module.exports = function draw(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',       // lobby | choosing | drawing | reveal | final
      settings: g ? g.settings : { seconds: 80, turns: 1, choice: true, hints: true, autoNext: 10 },
      seen: g ? g.seen : new Set(), // words drawn tonight (kept between games)
      lang: ctx.lang(),
      decks: { easy: [], hard: [] },
      queue: [],             // artists still to come, in order
      turnNo: 0,
      totalTurns: 0,
      turnId: g ? g.turnId : 0, // only ever goes up, so pages can tell turns apart
      drawer: null,
      offer: null,
      word: null,
      strokes: [],
      pointCount: 0,
      endsAt: null,
      revealed: [],          // letter positions shown as a hint
      guessed: [],           // [{pid, pts}] in order
      turnPoints: {},
      feed: [],
      feedSeq: 0,
      lastGuess: {},
      scores: {},
      firsts: {},            // pid -> first right guesses
      artistHits: {},        // pid -> right guesses on their drawings
      gallery: [],
      nextAt: null,
    };
  }
  reset();

  // ---------- words ----------
  function deal(kind) {
    if (!g.decks[kind].length) {
      const bank = (WORDS[g.lang] || WORDS.en)[kind];
      let fresh = bank.filter(w => !g.seen.has(g.lang + '|' + w));
      if (fresh.length < 3) { for (const w of bank) g.seen.delete(g.lang + '|' + w); fresh = bank.slice(); }
      g.decks[kind] = shuffle(fresh);
    }
    const raw = g.decks[kind].pop();
    return { raw, ...parseWord(raw, kind === 'hard') };
  }
  const used = (w) => g.seen.add(g.lang + '|' + w.raw);

  // The hint: one slot per letter, spaces and half-spaces kept.
  function pattern() {
    if (!g.word) return [];
    return [...g.word.text].map((ch, i) => (/[\s‌\-]/.test(ch) ? ch : g.revealed.includes(i) ? ch : '_'));
  }
  function revealLetter() {
    if (g.status !== 'drawing' || !g.settings.hints) return;
    const letters = [...g.word.text].map((ch, i) => (/[\s‌\-]/.test(ch) ? -1 : i)).filter(i => i >= 0);
    const hidden = letters.filter(i => !g.revealed.includes(i));
    if (letters.length < 3 || hidden.length <= 2) return; // never give most of it away
    g.revealed.push(hidden[Math.floor(Math.random() * hidden.length)]);
    ctx.broadcast();
  }

  // ---------- turns ----------
  function guessers() { return ctx.connectedIds().filter(id => id !== g.drawer); }

  function nextTurn() {
    timers.clearAll();
    let id = null;
    while (g.queue.length) {
      const c = g.queue.shift();
      if (ctx.isConnected(c)) { id = c; break; }
      g.totalTurns -= 1; // gone: their turn is skipped
    }
    if (!id) { finish(); return; }
    g.turnNo += 1;
    g.turnId += 1;
    g.drawer = id;
    g.word = null;
    g.offer = null;
    g.strokes = [];
    g.pointCount = 0;
    g.revealed = [];
    g.guessed = [];
    g.turnPoints = {};
    g.feed = [];
    g.lastGuess = {};
    g.nextAt = null;
    if (g.settings.choice) {
      g.status = 'choosing';
      g.offer = [deal('easy'), deal('easy'), deal('hard')];
      g.endsAt = ctx.now() + CHOOSE_MS;
      timers.set('choose', CHOOSE_MS, () => choose(Math.floor(Math.random() * 2)));
      ctx.broadcast();
    } else {
      startDrawing(deal(Math.random() < 0.2 ? 'hard' : 'easy'));
    }
  }

  function choose(index) {
    if (g.status !== 'choosing' || !g.offer) return;
    startDrawing(g.offer[clampInt(index, 0, g.offer.length - 1, 0)]);
  }

  function startDrawing(word) {
    timers.clear('choose');
    g.word = word;
    g.offer = null;
    used(word);
    g.status = 'drawing';
    const ms = g.settings.seconds * 1000;
    g.endsAt = ctx.now() + ms;
    timers.set('turn', ms, reveal);
    timers.set('hint1', ms * 0.5, revealLetter);
    timers.set('hint2', ms * 0.75, revealLetter);
    ctx.broadcast();
  }

  function reveal() {
    if (g.status !== 'drawing') return;
    timers.clearAll();
    g.status = 'reveal';
    g.endsAt = null;
    if (g.strokes.length && g.word) {
      g.gallery.push({ by: g.drawer, word: g.word.text, hard: g.word.hard, hits: g.guessed.length, strokes: thin(g.strokes) });
      if (g.gallery.length > GALLERY_MAX) g.gallery.shift();
    }
    if (g.settings.autoNext > 0) {
      g.nextAt = ctx.now() + g.settings.autoNext * 1000;
      timers.set('next', g.settings.autoNext * 1000, next);
    }
    ctx.broadcast();
  }

  function next() {
    if (g.status !== 'reveal') return;
    if (g.queue.length) nextTurn(); else finish();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    g.endsAt = null;
    g.nextAt = null;
    g.drawer = null;
    const ranked = standings();
    if (ranked.length && ranked[0].points > 0) ctx.finish('draw', rankGroups(ranked, r => r.points));
    ctx.broadcast();
    ctx.emitAll('draw:gallery', galleryOut());
  }

  function standings() {
    return Object.keys(g.scores).filter(ctx.exists)
      .map(id => ({ id, name: ctx.name(id), points: g.scores[id] }))
      .sort((a, b) => b.points - a.points);
  }
  function add(pid, n) {
    g.scores[pid] = (g.scores[pid] || 0) + n;
    g.turnPoints[pid] = (g.turnPoints[pid] || 0) + n;
  }

  function galleryOut() {
    return g.gallery.filter(x => x.strokes.length).map(x => ({ by: ctx.exists(x.by) ? ctx.name(x.by) : '?', word: x.word, hard: x.hard, hits: x.hits, strokes: x.strokes }));
  }

  // Best artist (most right guesses on their drawings) and sharpest eye (most firsts).
  function awards() {
    const best = (obj) => {
      const rows = Object.entries(obj).filter(([id, n]) => n > 0 && ctx.exists(id));
      if (!rows.length) return null;
      const top = Math.max(...rows.map(r => r[1]));
      return { names: rows.filter(r => r[1] === top).map(r => ctx.name(r[0])), n: top };
    };
    return { artist: best(g.artistHits), eye: best(g.firsts) };
  }

  function payload(role, pid) {
    const iDraw = role === 'player' && pid && pid === g.drawer;
    const iGuessed = role === 'player' && pid && g.guessed.some(x => x.pid === pid);
    const showWord = g.status === 'reveal' || ((iDraw || iGuessed) && g.status === 'drawing');
    return {
      status: g.status,
      settings: g.settings,
      turnNo: g.turnNo,
      totalTurns: g.totalTurns,
      turnId: g.turnId,
      drawer: g.drawer ? { id: g.drawer, name: ctx.name(g.drawer) } : null,
      endsAt: g.endsAt,
      nextAt: g.nextAt,
      hard: !!(g.word && g.word.hard),
      pattern: g.status === 'drawing' ? pattern() : [],
      word: showWord && g.word ? g.word.text : null,
      offer: iDraw && g.status === 'choosing' && g.offer ? g.offer.map(w => ({ text: w.text, hard: w.hard })) : null,
      strokeCount: g.strokes.length,
      guessed: g.guessed.filter(x => ctx.exists(x.pid)).map(x => ({ id: x.pid, name: ctx.name(x.pid), pts: x.pts })),
      guesserCount: g.drawer ? guessers().length : 0,
      feed: g.feed,
      turnPoints: g.status === 'reveal' ? g.turnPoints : {},
      standings: standings(),
      gallerySize: g.gallery.length,
      awards: g.status === 'final' ? awards() : null,
      iGuessed: !!iGuessed,
      queueLeft: g.queue.length,
    };
  }

  // ---------- guesses ----------
  function guess(pid, text) {
    if (g.status !== 'drawing' || !g.word || pid === g.drawer) return;
    if (g.guessed.some(x => x.pid === pid)) return;
    const shown = cleanText(text, 40);
    if (!shown) return;
    const t = ctx.now();
    if (g.lastGuess[pid] && t - g.lastGuess[pid] < GUESS_GAP_MS) return;
    g.lastGuess[pid] = t;
    const keys = guessKeys(shown, g.lang);
    if (keys.some(k => g.word.keys.includes(k))) {
      const mult = g.word.hard ? 2 : 1;
      const pts = (GUESS_POINTS[g.guessed.length] || 1) * mult;
      if (!g.guessed.length) g.firsts[pid] = (g.firsts[pid] || 0) + 1;
      g.guessed.push({ pid, pts });
      add(pid, pts);
      add(g.drawer, mult);
      g.artistHits[g.drawer] = (g.artistHits[g.drawer] || 0) + 1;
      ctx.emitTo(pid, 'draw:result', { ok: true, pts });
      if (guessers().every(id => g.guessed.some(x => x.pid === id))) timers.set('allIn', ALL_GUESSED_MS, reveal);
      ctx.broadcast();
      return;
    }
    const close = keys.some(k => g.word.keys.some(w => w.length >= 4 && distance(k, w) <= (w.length >= 8 ? 2 : 1)));
    if (close) { ctx.emitTo(pid, 'draw:result', { close: true, text: shown }); return; } // never shown on the TV
    g.feed.push({ id: ++g.feedSeq, name: ctx.name(pid), text: shown });
    if (g.feed.length > FEED_MAX) g.feed.shift();
    ctx.emitTo(pid, 'draw:result', { ok: false, text: shown });
    ctx.broadcastSoon();
  }

  // ---------- strokes ----------
  function cleanPoints(p) {
    if (!Array.isArray(p)) return null;
    const out = [];
    for (let i = 0; i + 1 < p.length && out.length < MAX_BATCH * 2; i += 2) {
      const x = Number(p[i]), y = Number(p[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push(Math.min(W, Math.max(0, Math.round(x))), Math.min(H, Math.max(0, Math.round(y))));
    }
    return out.length ? out : null;
  }

  const handlers = {
    'host:draw:settings': ({}, patch) => {
      const s = g.settings;
      if (patch.seconds !== undefined) s.seconds = clampInt(patch.seconds, 30, 240, s.seconds);
      if (patch.turns !== undefined) s.turns = clampInt(patch.turns, 1, 3, s.turns);
      if (patch.autoNext !== undefined) s.autoNext = clampInt(patch.autoNext, 0, 60, s.autoNext);
      if (typeof patch.choice === 'boolean') s.choice = patch.choice;
      if (typeof patch.hints === 'boolean') s.hints = patch.hints;
      ctx.broadcast();
    },
    'host:draw:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const ids = ctx.connectedIds();
      if (ids.length < 2) return;
      if (g.status === 'final') reset();
      g.lang = ctx.lang();
      g.decks = { easy: [], hard: [] };
      const order = shuffle(ids);
      for (let r = 0; r < g.settings.turns; r++) g.queue.push(...order);
      g.totalTurns = g.queue.length;
      nextTurn();
    },
    'host:draw:endTurn': () => reveal(),
    'host:draw:skip': () => { if (g.status === 'choosing' || g.status === 'drawing') { g.totalTurns -= 1; g.turnNo -= 1; nextTurn(); } },
    'host:draw:next': () => next(),
    'host:draw:end': () => { if (g.status !== 'lobby' && g.status !== 'final') finish(); },
    'host:draw:newGame': () => { reset(); ctx.broadcast(); },
    'player:draw:choose': ({ playerId }, { index }) => { if (playerId === g.drawer) choose(index); },
    'player:draw:stroke': ({ playerId }, { i, c, w, p }) => {
      if (g.status !== 'drawing' || playerId !== g.drawer) return;
      const pts = cleanPoints(p);
      if (!pts || g.pointCount + pts.length / 2 > MAX_POINTS) return;
      const n = g.strokes.length;
      let stroke;
      if (i === n && n < MAX_STROKES) {
        stroke = { c: clampInt(c, 0, COLORS - 1, 0), w: clampInt(w, 0, SIZES - 1, 1), p: [] };
        g.strokes.push(stroke);
      } else if (i === n - 1 && n > 0) {
        stroke = g.strokes[n - 1];
      } else return;
      stroke.p.push(...pts);
      g.pointCount += pts.length / 2;
      ctx.emitAll('draw:pts', { t: g.turnId, i, c: stroke.c, w: stroke.w, p: pts });
    },
    'player:draw:undo': ({ playerId }) => {
      if (g.status !== 'drawing' || playerId !== g.drawer || !g.strokes.length) return;
      const s = g.strokes.pop();
      g.pointCount -= s.p.length / 2;
      ctx.emitAll('draw:all', { t: g.turnId, strokes: g.strokes });
    },
    'player:draw:clear': ({ playerId }) => {
      if (g.status !== 'drawing' || playerId !== g.drawer) return;
      g.strokes = [];
      g.pointCount = 0;
      ctx.emitAll('draw:all', { t: g.turnId, strokes: [] });
    },
    'player:draw:guess': ({ playerId }, { text }) => guess(playerId, text),
  };

  return {
    id: 'draw',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    // A page that (re)loaded mid-game asks for the drawing (and the gallery at the end).
    sync: (socket) => {
      socket.emit('draw:sync', { t: g.turnId, strokes: g.strokes });
      if (g.status === 'final') socket.emit('draw:gallery', galleryOut());
    },
    onPlayerRemoved: (pid) => {
      g.queue = g.queue.filter(id => {
        if (id !== pid) return true;
        g.totalTurns -= 1;
        return false;
      });
      delete g.scores[pid];
      delete g.firsts[pid];
      delete g.artistHits[pid];
      g.guessed = g.guessed.filter(x => x.pid !== pid);
      if (pid === g.drawer && (g.status === 'choosing' || g.status === 'drawing')) { g.totalTurns -= 1; g.turnNo -= 1; nextTurn(); }
    },
    _debug: () => g,
  };
};

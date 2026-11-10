// Spy (جاسوس): everyone's phone shows the same secret word — except the
// spy's, which only says "You're the spy" and the category. Players take
// turns asking each other questions out loud; answers must prove you know the
// word without giving it away to the spy. Then everyone votes. If the spy is
// caught they get one last chance: pick the word from the board on the TV.
//
//   spy escapes (wrong person voted, or a tie) → spy +2
//   spy caught but guesses the word            → spy +2
//   spy caught and guesses wrong               → everyone else +1

const { shuffle, pick, clampInt, makeTimers, rankGroups } = require('./common');
const WORDS = require('./data/pantomime-words');
const PLACES = require('./data/spy-places');

const CATEGORIES = ['place', 'city', 'food', 'job', 'animal', 'sport', 'object'];
const BOARD_SIZE = 16;
const GUESS_SECONDS = 40;
const EARLY_POINTS = 3; // a spy who names the word mid-round, unprompted, scores big

function bankFor(lang, cat) {
  if (cat === 'place') return PLACES[lang] || PLACES.en;
  if (cat === 'city') return PLACES.cities[lang] || PLACES.cities.en;
  return (WORDS[lang] || WORDS.en)[cat] || [];
}

module.exports = function spy(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',     // lobby | cards | talk | vote | guess | result | final
      settings: g ? g.settings : { rounds: 5, minutes: 4, spies: 0, categories: CATEGORIES.slice() },
      round: 0,
      lang: ctx.lang(),
      cat: null,
      word: null,
      board: [],
      players: [],
      spies: [],
      seen: {},
      firstAsker: null,
      endsAt: null,
      votes: {},
      accused: null,
      tie: false,
      guess: null,
      outcome: null,       // 'escaped' | 'guessed' | 'caught' | 'earlyRight' | 'earlyWrong'
      early: false,        // the spy went for the word mid-round
      order: [],           // suggested asking order around the room
      points: {},
      used: [],
    };
  }
  reset();

  const spyCount = (n) => g.settings.spies || (n >= 8 ? 2 : 1);

  function deal() {
    const ids = ctx.connectedIds();
    if (ids.length < 3) return false;
    g.round += 1;
    g.cat = pick(g.settings.categories.length ? g.settings.categories : CATEGORIES);
    const bank = bankFor(g.lang, g.cat).filter(w => !g.used.includes(w));
    const pool = bank.length >= BOARD_SIZE ? bank : bankFor(g.lang, g.cat);
    g.board = shuffle(pool).slice(0, BOARD_SIZE);
    g.word = pick(g.board);
    g.used.push(g.word);
    g.players = shuffle(ids);
    g.spies = g.players.slice(0, Math.min(spyCount(ids.length), ids.length - 2));
    g.players = shuffle(g.players);
    g.seen = {};
    g.order = shuffle(g.players);
    g.firstAsker = g.order[0];
    g.early = false;
    g.votes = {};
    g.accused = null;
    g.tie = false;
    g.guess = null;
    g.outcome = null;
    g.status = 'cards';
    g.endsAt = null;
    ctx.emitAll('spy:cards', {});
    ctx.broadcast();
    return true;
  }

  function startTalk() {
    if (g.status !== 'cards') return;
    g.status = 'talk';
    g.endsAt = ctx.now() + g.settings.minutes * 60000;
    timers.set('talk', g.settings.minutes * 60000, startVote);
    ctx.broadcast();
  }

  function startVote() {
    if (g.status !== 'talk') return;
    timers.clear('talk');
    g.status = 'vote';
    g.votes = {};
    g.endsAt = null;
    ctx.broadcast();
  }

  function closeVote() {
    if (g.status !== 'vote') return;
    timers.clear('allIn');
    const counts = {};
    for (const [v, t] of Object.entries(g.votes)) if (g.players.includes(v)) counts[t] = (counts[t] || 0) + 1;
    const best = Math.max(0, ...Object.values(counts));
    const top = Object.keys(counts).filter(t => counts[t] === best);
    g.accused = best > 0 && top.length === 1 ? top[0] : null;
    g.tie = best > 0 && top.length > 1;
    if (g.accused && g.spies.includes(g.accused)) {
      g.status = 'guess';
      g.endsAt = ctx.now() + GUESS_SECONDS * 1000;
      timers.set('guess', GUESS_SECONDS * 1000, () => settle(null));
      ctx.broadcast();
    } else {
      settle(null, true);
    }
  }

  function settle(guess, escaped = false) {
    timers.clear('guess');
    g.guess = guess;
    const right = !!guess && guess === g.word;
    if (g.early) g.outcome = right ? 'earlyRight' : 'earlyWrong';
    else if (escaped) g.outcome = 'escaped';
    else g.outcome = right ? 'guessed' : 'caught';
    const townWins = g.outcome === 'caught' || g.outcome === 'earlyWrong';
    if (townWins) for (const p of g.players) { if (!g.spies.includes(p)) g.points[p] = (g.points[p] || 0) + 1; }
    else for (const s of g.spies) g.points[s] = (g.points[s] || 0) + (g.outcome === 'earlyRight' ? EARLY_POINTS : 2);
    g.status = 'result';
    g.endsAt = null;
    ctx.broadcast();
  }

  function next() {
    if (g.status !== 'result') return;
    if (g.round >= g.settings.rounds) finish();
    else deal();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    const ranked = standings();
    if (ranked.length && ranked[0].points > 0) ctx.finish('spy', rankGroups(ranked, r => r.points));
    ctx.broadcast();
  }

  function standings() {
    return Object.keys(g.points).filter(ctx.exists)
      .map(id => ({ id, name: ctx.name(id), points: g.points[id] }))
      .sort((a, b) => b.points - a.points);
  }

  function payload(role, pid) {
    const over = g.status === 'result' || g.status === 'final';
    const base = {
      status: g.status,
      settings: g.settings,
      categoriesAll: CATEGORIES,
      round: g.round,
      cat: g.cat,
      board: g.status === 'lobby' ? [] : g.board,
      players: g.players.filter(ctx.exists).map(p => ({ id: p, name: ctx.name(p), spy: over ? g.spies.includes(p) : undefined })),
      spyCount: g.spies.length,
      early: g.early,
      order: g.order.filter(ctx.exists).map(p => ({ id: p, name: ctx.name(p) })),
      seenCount: Object.keys(g.seen).length,
      firstAsker: g.firstAsker ? { id: g.firstAsker, name: ctx.name(g.firstAsker) } : null,
      endsAt: g.endsAt,
      votes: g.status === 'vote' ? Object.keys(g.votes) : g.votes,
      accused: g.accused ? { id: g.accused, name: ctx.name(g.accused) } : null,
      tie: g.tie,
      guess: g.guess,
      outcome: g.outcome,
      word: over ? g.word : null,
      standings: standings(),
      lobbyCount: ctx.connectedIds().length,
    };
    if (role === 'player' && pid && g.players.includes(pid)) {
      const amSpy = g.spies.includes(pid);
      base.me = {
        spy: amSpy,
        word: amSpy ? null : g.word,
        seen: !!g.seen[pid],
        vote: g.status === 'vote' ? (g.votes[pid] || null) : null,
        fellowSpies: amSpy ? g.spies.filter(s => s !== pid).map(s => ctx.name(s)) : [],
      };
    }
    if (role === 'host') { base.secretWord = g.word; base.spies = g.spies.map(s => ({ id: s, name: ctx.name(s) })); }
    return base;
  }

  const handlers = {
    'host:spy:settings': ({}, patch) => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const s = g.settings;
      if (patch.rounds !== undefined) s.rounds = clampInt(patch.rounds, 1, 20, s.rounds);
      if (patch.minutes !== undefined) s.minutes = clampInt(patch.minutes, 1, 15, s.minutes);
      if (patch.spies !== undefined) s.spies = clampInt(patch.spies, 0, 3, s.spies);
      if (Array.isArray(patch.categories)) {
        const cats = CATEGORIES.filter(c => patch.categories.includes(c));
        if (cats.length) s.categories = cats;
      }
      ctx.broadcast();
    },
    'host:spy:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      if (g.status === 'final') reset();
      g.lang = ctx.lang();
      deal();
    },
    'host:spy:talk': () => startTalk(),
    'host:spy:vote': () => startVote(),
    'host:spy:closeVote': () => closeVote(),
    'host:spy:next': () => next(),
    'host:spy:end': () => { if (g.status !== 'lobby') finish(); },
    'host:spy:newGame': () => { reset(); ctx.broadcast(); },
    'player:spy:seen': ({ playerId }) => {
      if (g.status !== 'cards' || !g.players.includes(playerId)) return;
      g.seen[playerId] = true;
      if (g.players.filter(ctx.exists).every(p => g.seen[p])) timers.set('allSeen', 1200, startTalk);
      ctx.broadcast();
    },
    'player:spy:vote': ({ playerId }, { target }) => {
      if (g.status !== 'vote' || !g.players.includes(playerId) || !g.players.includes(target) || target === playerId) return;
      g.votes[playerId] = target;
      const live = g.players.filter(p => ctx.connectedIds().includes(p));
      if (live.every(p => g.votes[p])) timers.set('allIn', 1200, closeVote);
      ctx.broadcast();
    },
    // The spy thinks they've worked it out: stop the round and name the word.
    // Right: big win. Wrong: everyone else scores.
    'player:spy:earlyGuess': ({ playerId }) => {
      if (g.status !== 'talk' || !g.spies.includes(playerId)) return;
      timers.clear('talk');
      g.early = true;
      g.accused = playerId;
      g.status = 'guess';
      g.endsAt = ctx.now() + GUESS_SECONDS * 1000;
      timers.set('guess', GUESS_SECONDS * 1000, () => settle(null));
      ctx.emitAll('spy:early', { name: ctx.name(playerId) });
      ctx.broadcast();
    },
    'player:spy:guess': ({ playerId }, { word }) => {
      if (g.status !== 'guess' || playerId !== g.accused || !g.board.includes(word)) return;
      settle(word);
    },
  };

  return {
    id: 'spy',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      g.players = g.players.filter(p => p !== pid);
      delete g.votes[pid];
      delete g.points[pid];
      if (g.spies.includes(pid) && g.status !== 'lobby' && g.status !== 'final') {
        // The spy left — call the round off and deal a fresh one.
        g.spies = g.spies.filter(s => s !== pid);
        if (!g.spies.length) { g.round -= 1; if (!deal()) { g.status = 'lobby'; } }
      }
    },
    _debug: () => g,
  };
};

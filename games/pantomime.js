// Pantomime (پانتومیم): teams take turns; one player acts out words without
// speaking while their own team shouts guesses against the clock. The actor's
// phone shows the word with ✅ Got it / ⏭ Skip buttons; the other teams'
// phones show it too (in the classic game the rival team picks the word, so
// they're in on it and can enjoy the show). The TV shows the category and
// how many words the answer has — never the answer itself — until the turn
// is over.

const { shuffle, clampInt, cleanText, makeTimers, rankGroups } = require('./common');
const { createTeams, teamOfPlayer, shuffleTeams, syncTeams, movePlayer, setTeamCount } = require('./teams');
const WORDS = require('./data/pantomime-words');
const ADULT = require('./data/pantomime-adult');

// 'adult' (🔞 18+) is offered in the picker but never on by default — the host
// has to choose it for a grown-up crowd.
const CATEGORIES = [...Object.keys(WORDS.en), 'adult'];
const DEFAULT_CATEGORIES = CATEGORIES.filter(c => c !== 'adult');
const TAP_GUARD_MS = 600; // a double tap on ✅ shouldn't burn the next word
// Harder to act out = worth more. Words the players wrote themselves count as hard.
const HARD = ['movie', 'proverb', 'famous'];
const pointsFor = (cat) => (cat === 'custom' || HARD.includes(cat) ? 2 : 1);
const MAX_CUSTOM = 5;

module.exports = function pantomime(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    const teams = createTeams(g ? g.settings.teamCount : 2);
    shuffleTeams(teams, ctx.connectedIds());
    g = {
      status: 'lobby',        // lobby | ready | acting | turnEnd | final
      settings: g ? g.settings : { seconds: 90, turns: 2, skips: 2, categories: DEFAULT_CATEGORIES.slice(), teamCount: 2, choice: true, customWords: true },
      // Words the players wrote for the other teams (kept between games tonight).
      custom: g ? g.custom : {},
      // Words already acted tonight, so the next game deals new ones (a small deck like 18+ only would repeat).
      seen: g ? g.seen : new Set(),
      usedCustom: new Set(),
      offer: null,            // [word, word] while the actor picks easy (1) or hard (2)
      teams,
      scores: Object.fromEntries(teams.ids.map(t => [t, 0])),
      turnNo: 0,
      actorIdx: Object.fromEntries(teams.ids.map(t => [t, -1])),
      team: null,
      actor: null,
      deck: [],
      lang: ctx.lang(),
      word: null,
      endsAt: null,
      turnLog: [],
      skipsUsed: 0,
      lastDrawAt: 0,
      history: [],            // [{team, actor, correct, points}]
    };
  }
  reset();

  // Only people who are here now (players.json remembers everyone who ever joined).
  const members = (t) => g.teams.members[t].filter(ctx.isConnected);
  const totalTurns = () => g.settings.turns * g.teams.ids.length;

  function nextActor(t) {
    const list = members(t);
    if (!list.length) return null;
    const online = new Set(ctx.connectedIds());
    for (let i = 1; i <= list.length; i++) {
      const idx = (g.actorIdx[t] + i) % list.length;
      if (online.has(list[idx]) || i === list.length) { g.actorIdx[t] = idx; return list[idx]; }
    }
    return list[0];
  }

  function refill() {
    const bank = WORDS[g.lang] || WORDS.en;
    const cats = g.settings.categories.length ? g.settings.categories : DEFAULT_CATEGORIES;
    const adult = ADULT[g.lang] || ADULT.en;
    const all = cats.flatMap(cat => (cat === 'adult'
      // 18+ has its own easy (1) and hard (2) cards, so choice mode works with only 18+ on.
      ? [...adult.easy.map(text => ({ cat, text, points: 1 })), ...adult.hard.map(text => ({ cat, text, points: 2 }))]
      : (bank[cat] || []).map(text => ({ cat, text, points: pointsFor(cat) }))));
    let fresh = all.filter(w => !g.seen.has(seenKey(w)));
    // Nearly everything has been played tonight: start the cycle over.
    // (Also when one kind, easy or hard, has run out but the categories have some.)
    const ranOut = (pred) => all.some(pred) && !fresh.some(pred);
    if (fresh.length < 12 || ranOut(w => w.points === 1) || ranOut(w => w.points > 1)) {
      for (const w of all) g.seen.delete(seenKey(w));
      fresh = all;
    }
    g.deck = shuffle(fresh);
  }

  const seenKey = (w) => w.cat + '|' + w.text;
  const acted = (w) => { if (w && w.cat !== 'custom') g.seen.add(seenKey(w)); };

  // A word one of the OTHER teams wrote, not used yet — the classic rule: your
  // rivals choose what you act.
  function rivalWord() {
    if (!g.settings.customWords) return null;
    const mine = new Set(g.teams.members[g.team] || []);
    const pool = [];
    for (const [pid, words] of Object.entries(g.custom)) {
      if (mine.has(pid) || !ctx.exists(pid)) continue;
      words.forEach((text, i) => { if (!g.usedCustom.has(`${pid}|${text}`)) pool.push({ pid, text }); });
    }
    if (!pool.length) return null;
    const w = pool[Math.floor(Math.random() * pool.length)];
    g.usedCustom.add(`${w.pid}|${w.text}`);
    return { cat: 'custom', text: w.text, points: pointsFor('custom'), by: w.pid };
  }

  function fromDeck(wantHard) {
    if (!g.deck.length) refill();
    const i = wantHard === undefined ? g.deck.length - 1 : g.deck.map(w => (w.points > 1) === wantHard).lastIndexOf(true);
    return g.deck.splice(i < 0 ? g.deck.length - 1 : i, 1)[0];
  }

  // Next word — or, in choice mode, a pair: an easy one for 1 and a hard one for 2.
  function draw() {
    g.lastDrawAt = ctx.now();
    if (g.settings.choice) {
      g.word = null;
      g.offer = [fromDeck(false), rivalWord() || fromDeck(true)];
      return;
    }
    g.offer = null;
    g.word = rivalWord() || fromDeck();
    acted(g.word);
  }

  function prepareTurn() {
    // Skip teams that have nobody in them.
    for (let tries = 0; tries < g.teams.ids.length; tries++) {
      const t = g.teams.ids[g.turnNo % g.teams.ids.length];
      if (members(t).length) {
        g.team = t;
        g.actor = nextActor(t);
        g.status = 'ready';
        g.word = null;
        g.offer = null;
        g.turnLog = [];
        g.skipsUsed = 0;
        g.endsAt = null;
        ctx.broadcast();
        return;
      }
      g.turnNo += 1;
    }
    g.status = 'lobby';
    ctx.broadcast();
  }

  function go() {
    if (g.status !== 'ready') return;
    g.status = 'acting';
    g.endsAt = ctx.now() + g.settings.seconds * 1000;
    draw();
    timers.set('turn', g.settings.seconds * 1000, endTurn);
    ctx.broadcast();
  }

  function endTurn() {
    if (g.status !== 'acting') return;
    timers.clear('turn');
    if (g.word) g.turnLog.push({ ...g.word, result: 'missed' });
    g.word = null;
    g.offer = null;
    g.status = 'turnEnd';
    g.endsAt = null;
    const got = g.turnLog.filter(w => w.result === 'correct');
    g.history.push({ team: g.team, actor: g.actor, correct: got.length, points: got.reduce((a, w) => a + w.points, 0) });
    ctx.emitAll('pm:timeUp', {});
    ctx.broadcast();
  }

  function mark(result) {
    if (g.status !== 'acting' || (!g.word && !g.offer)) return;
    if (ctx.now() - g.lastDrawAt < TAP_GUARD_MS) return;
    if (result === 'correct' && !g.word) return; // still choosing
    if (result === 'skip') {
      if (g.skipsUsed >= g.settings.skips) return;
      g.skipsUsed += 1;
    }
    if (g.word) g.turnLog.push({ ...g.word, result });
    if (result === 'correct') {
      g.scores[g.team] += g.word.points;
      ctx.emitAll('pm:correct', { team: g.team, total: g.scores[g.team], points: g.word.points });
    }
    draw();
    ctx.broadcast();
  }

  function advance() {
    if (g.status !== 'turnEnd') return;
    g.turnNo += 1;
    if (g.turnNo >= totalTurns()) { finish(); return; }
    prepareTurn();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    g.word = null;
    g.endsAt = null;
    const best = Math.max(...g.teams.ids.map(t => g.scores[t]));
    if (best > 0) {
      ctx.finish('pantomime', rankGroups(g.teams.ids, t => g.scores[t], t => t).map(ts => ts.flatMap(t => g.teams.members[t])));
    }
    ctx.broadcast();
  }

  function payload(role, pid) {
    // Late joiners slot into a team straight away.
    syncTeams(g.teams, ctx.connectedIds(), ctx.allIds());
    const myTeam = pid ? teamOfPlayer(g.teams, pid) : null;
    const seesWord = role === 'host' || (role === 'player' && (pid === g.actor || (myTeam && myTeam !== g.team)));
    const best = g.history.reduce((b, h) => (h.points > (b ? b.points : 0) ? h : b), null);
    return {
      status: g.status,
      settings: g.settings,
      categoriesAll: CATEGORIES,
      teams: g.teams.ids.map(t => ({ id: t, members: members(t).map(id => ({ id, name: ctx.name(id) })) })),
      scores: g.scores,
      round: Math.floor(g.turnNo / g.teams.ids.length) + 1,
      turnNo: g.turnNo,
      totalTurns: totalTurns(),
      team: g.team,
      actor: g.actor ? { id: g.actor, name: ctx.name(g.actor) } : null,
      endsAt: g.endsAt,
      wordCat: g.word ? g.word.cat : null,
      wordCount: g.word ? g.word.text.split(/\s+/).filter(Boolean).length : 0,
      word: seesWord && g.word ? g.word.text : null,
      wordPoints: g.word ? g.word.points : 0,
      wordBy: g.word && g.word.by ? ctx.name(g.word.by) : null,
      choosing: !!g.offer,
      offer: seesWord && g.offer ? g.offer.map(w => ({ text: w.text, cat: w.cat, points: w.points, by: w.by ? ctx.name(w.by) : null })) : null,
      correctThisTurn: g.turnLog.filter(w => w.result === 'correct').length,
      pointsThisTurn: g.turnLog.filter(w => w.result === 'correct').reduce((a, w) => a + w.points, 0),
      // Words the players wrote: the TV and host just get the count, each phone its own list.
      customCount: Object.values(g.custom).reduce((a, l) => a + l.length, 0),
      myWords: role === 'player' && pid ? (g.custom[pid] || []) : undefined,
      mvp: best && best.points > 0 && ctx.exists(best.actor) ? { id: best.actor, name: ctx.name(best.actor), points: best.points, correct: best.correct } : null,
      skipsLeft: g.settings.skips - g.skipsUsed,
      // During the turn the TV only gets how it's going; the words themselves
      // are shown once time is up.
      turnLog: g.status === 'acting' && role === 'tv' ? g.turnLog.map(w => ({ cat: w.cat, result: w.result })) : g.turnLog,
      myTeam,
      history: g.history,
    };
  }

  const isActor = (pid) => pid && pid === g.actor;

  const handlers = {
    'host:pantomime:settings': ({}, patch) => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const s = g.settings;
      if (patch.seconds !== undefined) s.seconds = clampInt(patch.seconds, 20, 300, s.seconds);
      if (patch.turns !== undefined) s.turns = clampInt(patch.turns, 1, 10, s.turns);
      if (patch.skips !== undefined) s.skips = clampInt(patch.skips, 0, 10, s.skips);
      if (Array.isArray(patch.categories)) {
        const cats = CATEGORIES.filter(c => patch.categories.includes(c));
        if (cats.length) s.categories = cats;
      }
      if (typeof patch.choice === 'boolean') s.choice = patch.choice;
      if (typeof patch.customWords === 'boolean') s.customWords = patch.customWords;
      if (patch.teamCount !== undefined) {
        s.teamCount = clampInt(patch.teamCount, 2, 4, s.teamCount);
        setTeamCount(g.teams, s.teamCount, ctx.connectedIds());
        g.scores = Object.fromEntries(g.teams.ids.map(t => [t, 0]));
        g.actorIdx = Object.fromEntries(g.teams.ids.map(t => [t, -1]));
      }
      ctx.broadcast();
    },
    'host:pantomime:shuffle': () => { if (g.status !== 'lobby') return; shuffleTeams(g.teams, ctx.connectedIds()); ctx.broadcast(); },
    'host:pantomime:move': ({}, { id, team }) => {
      if (g.status === 'acting' || !ctx.exists(id)) return;
      if (movePlayer(g.teams, id, team)) ctx.broadcast();
    },
    'host:pantomime:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      if (g.status === 'final') { const teams = g.teams; reset(); g.teams = teams; }
      g.lang = ctx.lang();
      g.deck = [];
      prepareTurn();
    },
    'host:pantomime:go': () => go(),
    'host:pantomime:correct': () => mark('correct'),
    'host:pantomime:skip': () => mark('skip'),
    'host:pantomime:endTurn': () => endTurn(),
    'host:pantomime:next': () => advance(),
    'host:pantomime:skipActor': () => {
      if (g.status !== 'ready') return;
      g.actor = nextActor(g.team);
      ctx.broadcast();
    },
    'host:pantomime:end': () => { if (g.status !== 'lobby') finish(); },
    'host:pantomime:newGame': () => { const teams = g.teams; reset(); g.teams = teams; ctx.broadcast(); },
    'player:pantomime:go': ({ playerId }) => { if (isActor(playerId)) go(); },
    'player:pantomime:choose': ({ playerId }, { index }) => {
      if (!isActor(playerId) || g.status !== 'acting' || !g.offer) return;
      const w = g.offer[index === 1 ? 1 : 0];
      // The other card goes back in the pile (a rival's word stays unused for later).
      const back = g.offer[index === 1 ? 0 : 1];
      if (back.cat === 'custom') g.usedCustom.delete(`${back.by}|${back.text}`); else g.deck.unshift(back);
      g.word = w;
      acted(w);
      g.offer = null;
      g.lastDrawAt = ctx.now();
      ctx.broadcast();
    },
    // Players write words for the OTHER teams to act — in the lobby or between turns.
    'player:pantomime:addWord': ({ playerId }, { text }) => {
      const t = cleanText(text, 40);
      if (!t || g.status === 'acting') return;
      const list = g.custom[playerId] || (g.custom[playerId] = []);
      if (list.length >= MAX_CUSTOM || list.includes(t)) return;
      list.push(t);
      ctx.broadcast();
    },
    'player:pantomime:removeWord': ({ playerId }, { index }) => {
      const list = g.custom[playerId];
      if (!list || g.status === 'acting') return;
      list.splice(clampInt(index, 0, list.length - 1, 0), 1);
      ctx.broadcast();
    },
    'player:pantomime:correct': ({ playerId }) => { if (isActor(playerId)) mark('correct'); },
    'player:pantomime:skip': ({ playerId }) => { if (isActor(playerId)) mark('skip'); },
    'player:pantomime:next': ({ playerId }) => { if (isActor(playerId)) advance(); },
  };

  return {
    id: 'pantomime',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      for (const t of g.teams.ids) g.teams.members[t] = g.teams.members[t].filter(id => id !== pid);
      if (pid === g.actor) {
        if (g.status === 'acting') endTurn();
        else if (g.status === 'ready') { g.actor = nextActor(g.team); if (!g.actor) prepareTurn(); }
      }
    },
    _debug: () => g,
  };
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;

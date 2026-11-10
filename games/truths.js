// Two Truths and a Lie (دو راست، یه دروغ). In the lobby everyone writes three
// things about themselves on their phone and marks which one is made up.
// Then, one teller at a time:
//   telling — the three lines go up on the TV; the others grill the teller out loud
//   voting  — everyone else secretly taps the one they think is the lie
//   reveal  — LIE stamped on it, votes shown
// Catching the lie = +1. The teller gets +1 for every person fooled, and a
// bonus +1 for fooling everyone (at least two voters).
// A set of lines is used once: after it's been told, that player writes new ones.

const { shuffle, clampInt, cleanText, makeTimers, rankGroups } = require('./common');

const ALL_IN_DELAY_MS = 700;
const LINE_MAX = 120;

module.exports = function truths(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',       // lobby | telling | voting | reveal | final
      settings: g ? g.settings : { askSeconds: 30, voteSeconds: 25, autoNext: 12 },
      sets: g ? g.sets : {}, // pid -> { lines: [3], lie: 0..2 } — kept until told
      queue: [],
      turnNo: 0,
      totalTurns: 0,
      teller: null,
      lines: null,           // the teller's lines in TV order (shuffled)
      lieAt: null,
      voters: [],
      votes: {},
      endsAt: null,
      nextAt: null,
      result: null,
      scores: {},
      caught: {},            // pid -> lies caught
      fooled: {},            // pid -> people fooled as the teller
      told: [],              // who has told this game
    };
  }
  reset();

  const ready = () => Object.keys(g.sets).filter(id => ctx.exists(id));

  function nextTurn() {
    timers.clearAll();
    let id = null;
    while (g.queue.length) {
      const c = g.queue.shift();
      if (ctx.isConnected(c) && g.sets[c]) { id = c; break; }
      g.totalTurns -= 1;
    }
    if (!id) { finish(); return; }
    const set = g.sets[id];
    const order = shuffle([0, 1, 2]);
    g.turnNo += 1;
    g.teller = id;
    g.lines = order.map(i => set.lines[i]);
    g.lieAt = order.indexOf(set.lie);
    g.votes = {};
    g.voters = [];
    g.result = null;
    g.nextAt = null;
    if (g.settings.askSeconds > 0) {
      g.status = 'telling';
      g.endsAt = ctx.now() + g.settings.askSeconds * 1000;
      timers.set('ask', g.settings.askSeconds * 1000, openVoting);
      ctx.broadcast();
    } else startVoting();
  }

  // Question time is over (timer or host): voting opens.
  function openVoting() {
    if (g.status === 'telling') startVoting();
  }
  function startVoting() {
    timers.clear('ask');
    g.status = 'voting';
    g.voters = ctx.connectedIds().filter(id => id !== g.teller);
    g.endsAt = ctx.now() + g.settings.voteSeconds * 1000;
    timers.set('vote', g.settings.voteSeconds * 1000, reveal);
    ctx.broadcast();
  }

  function reveal() {
    if (g.status !== 'voting') return;
    timers.clear('vote');
    timers.clear('allIn');
    const byLine = { 0: [], 1: [], 2: [] };
    for (const [voter, i] of Object.entries(g.votes)) if (ctx.exists(voter)) byLine[i].push(voter);
    const caught = byLine[g.lieAt];
    const fooled = [0, 1, 2].filter(i => i !== g.lieAt).flatMap(i => byLine[i]);
    for (const v of caught) {
      g.scores[v] = (g.scores[v] || 0) + 1;
      g.caught[v] = (g.caught[v] || 0) + 1;
    }
    const perfect = fooled.length >= 2 && caught.length === 0;
    if (fooled.length) {
      g.scores[g.teller] = (g.scores[g.teller] || 0) + fooled.length + (perfect ? 1 : 0);
      g.fooled[g.teller] = (g.fooled[g.teller] || 0) + fooled.length;
    }
    g.result = { byLine, caught: caught.length, fooled: fooled.length, perfect };
    g.told.push(g.teller);
    delete g.sets[g.teller]; // everyone knows them now
    g.status = 'reveal';
    g.endsAt = null;
    if (g.settings.autoNext > 0) {
      g.nextAt = ctx.now() + g.settings.autoNext * 1000;
      timers.set('next', g.settings.autoNext * 1000, next);
    }
    ctx.broadcast();
  }

  function next() {
    if (g.status !== 'reveal') return;
    if (g.queue.some(id => ctx.isConnected(id) && g.sets[id])) nextTurn(); else finish();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    g.endsAt = null;
    g.nextAt = null;
    g.teller = null;
    const ranked = standings();
    if (ranked.length && ranked[0].points > 0) ctx.finish('truths', rankGroups(ranked, r => r.points));
    ctx.broadcast();
  }

  function standings() {
    const ids = new Set([...Object.keys(g.scores), ...g.told].filter(ctx.exists));
    return [...ids]
      .map(id => ({ id, name: ctx.name(id), points: g.scores[id] || 0, caught: g.caught[id] || 0, fooled: g.fooled[id] || 0 }))
      .sort((a, b) => b.points - a.points || b.fooled - a.fooled);
  }

  function awards() {
    const best = (obj) => {
      const rows = Object.entries(obj).filter(([id, n]) => n > 0 && ctx.exists(id));
      if (!rows.length) return null;
      const top = Math.max(...rows.map(r => r[1]));
      return { names: rows.filter(r => r[1] === top).map(r => ctx.name(r[0])), n: top };
    };
    return { liar: best(g.fooled), detector: best(g.caught) };
  }

  function payload(role, pid) {
    const names = (ids) => (ids || []).filter(ctx.exists).map(id => ({ id, name: ctx.name(id) }));
    const live = g.status === 'telling' || g.status === 'voting' || g.status === 'reveal';
    const mine = role === 'player' && pid ? g.sets[pid] : null;
    return {
      status: g.status,
      settings: g.settings,
      turnNo: g.turnNo,
      totalTurns: g.totalTurns,
      teller: g.teller && ctx.exists(g.teller) ? { id: g.teller, name: ctx.name(g.teller) } : null,
      lines: live ? g.lines : null,
      // The lie's position: everyone at the reveal, the teller always (it's theirs).
      lieAt: live && (g.status === 'reveal' || (role === 'player' && pid === g.teller)) ? g.lieAt : null,
      endsAt: g.endsAt,
      nextAt: g.nextAt,
      voted: Object.keys(g.votes),
      voters: names(g.voters),
      myVote: role === 'player' && pid && g.votes[pid] !== undefined ? g.votes[pid] : null,
      result: g.result
        ? { byLine: Object.fromEntries(Object.entries(g.result.byLine).map(([i, v]) => [i, names(v)])), caught: g.result.caught, fooled: g.result.fooled, perfect: g.result.perfect }
        : null,
      ready: names(ready()),
      mySet: mine ? { lines: mine.lines, lie: mine.lie } : null,
      iTold: role === 'player' && pid ? g.told.includes(pid) : false,
      standings: standings(),
      awards: g.status === 'final' ? awards() : null,
      queueLeft: g.queue.filter(id => g.sets[id]).length,
    };
  }

  const handlers = {
    'host:truths:settings': ({}, patch) => {
      const s = g.settings;
      if (patch.askSeconds !== undefined) s.askSeconds = clampInt(patch.askSeconds, 0, 180, s.askSeconds);
      if (patch.voteSeconds !== undefined) s.voteSeconds = clampInt(patch.voteSeconds, 10, 120, s.voteSeconds);
      if (patch.autoNext !== undefined) s.autoNext = clampInt(patch.autoNext, 0, 60, s.autoNext);
      ctx.broadcast();
    },
    'host:truths:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      const online = ctx.connectedIds();
      const tellers = online.filter(id => g.sets[id]);
      if (online.length < 2 || !tellers.length) return;
      if (g.status === 'final') reset();
      g.queue = shuffle(tellers);
      g.totalTurns = g.queue.length;
      nextTurn();
    },
    'host:truths:vote': () => { if (g.status === 'telling') openVoting(); },
    'host:truths:reveal': () => reveal(),
    'host:truths:next': () => next(),
    'host:truths:skip': () => {
      if (g.status !== 'telling' && g.status !== 'voting') return;
      g.totalTurns -= 1;
      g.turnNo -= 1;
      nextTurn(); // their lines stay for another game
    },
    'host:truths:end': () => { if (g.status !== 'lobby' && g.status !== 'final') finish(); },
    'host:truths:newGame': () => { reset(); ctx.broadcast(); },
    'player:truths:write': ({ playerId }, { lines, lie }) => {
      if (!Array.isArray(lines) || lines.length !== 3) return;
      const clean = lines.map(l => cleanText(l, LINE_MAX));
      if (clean.some(l => !l)) return;
      const lieIdx = clampInt(lie, 0, 2, -1);
      if (lieIdx < 0 || Number(lie) !== lieIdx) return;
      if (g.teller === playerId && (g.status === 'telling' || g.status === 'voting')) return; // not mid-turn
      const isNew = !g.sets[playerId];
      g.sets[playerId] = { lines: clean, lie: lieIdx };
      // Written during a game by someone who hasn't told yet: they're up later.
      const live = g.status === 'telling' || g.status === 'voting' || g.status === 'reveal';
      if (isNew && live && !g.told.includes(playerId) && !g.queue.includes(playerId)) {
        g.queue.push(playerId);
        g.totalTurns += 1;
      }
      ctx.broadcast();
    },
    'player:truths:unwrite': ({ playerId }) => {
      if (!g.sets[playerId] || g.teller === playerId) return;
      delete g.sets[playerId];
      ctx.broadcast();
    },
    'player:truths:vote': ({ playerId }, { index }) => {
      if (g.status !== 'voting' || playerId === g.teller) return;
      const i = clampInt(index, 0, 2, -1);
      if (i < 0 || Number(index) !== i) return;
      if (!g.voters.includes(playerId)) g.voters.push(playerId);
      g.votes[playerId] = i;
      const everyone = g.voters.filter(v => ctx.isConnected(v));
      if (everyone.length && everyone.every(v => g.votes[v] !== undefined)) timers.set('allIn', ALL_IN_DELAY_MS, reveal);
      ctx.broadcast();
    },
  };

  return {
    id: 'truths',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      delete g.sets[pid];
      delete g.votes[pid];
      delete g.scores[pid];
      delete g.caught[pid];
      delete g.fooled[pid];
      g.voters = g.voters.filter(v => v !== pid);
      g.queue = g.queue.filter(id => { if (id !== pid) return true; g.totalTurns -= 1; return false; });
      if (pid === g.teller && (g.status === 'telling' || g.status === 'voting')) { g.totalTurns -= 1; g.turnNo -= 1; nextTurn(); }
    },
    _debug: () => g,
  };
};

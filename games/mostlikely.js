// Who's Most Likely…? (کی از همه بیشتر…؟) — a party-poll game with three
// round types, mixed by default:
//   likely  — "Who's most likely to…": everyone secretly votes for a player.
//             The winner collects the title; voting with the crowd = +1.
//   rather  — "Would you rather A or B?": pick a side. The majority side = +1.
//   never   — "Never have I ever…": I have / never. No points — just the
//             reveal of who has (and a "confessions" list at the end).
// Players can also write their own "who's most likely" questions in the
// lobby; those come up first.

const { shuffle, clampInt, cleanText, makeTimers, rankGroups } = require('./common');
const PROMPTS = require('./data/mostlikely-prompts');
const POLLS = require('./data/party-polls');

const ALL_IN_DELAY_MS = 700;
const KINDS = ['likely', 'rather', 'never'];
// "Mix": two "most likely" rounds for every one of each of the others.
const MIX = ['likely', 'rather', 'likely', 'never'];
const MAX_CUSTOM = 3;

module.exports = function mostlikely(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',      // lobby | question | reveal | final
      settings: g ? g.settings : { rounds: 10, seconds: 25, allowSelf: false, autoNext: 12, mode: 'mix' },
      custom: g ? g.custom : [], // [{pid, text}] — players' own questions, kept between games tonight
      round: 0,
      decks: {},
      lang: ctx.lang(),
      kind: 'likely',
      prompt: null,         // likely/never: a sentence; rather: [optionA, optionB]
      by: null,             // who wrote this question (custom ones)
      voters: [],
      votes: {},            // voter -> target pid | 'a' | 'b' | 'yes' | 'no'
      endsAt: null,
      result: null,
      points: {},
      titles: {},           // pid -> [prompt]
      confessions: {},      // pid -> [statement]
      nextAt: null,
    };
  }
  reset();

  function nextKind() {
    const m = g.settings.mode;
    if (KINDS.includes(m)) return m;
    return MIX[(g.round - 1) % MIX.length];
  }

  function nextPrompt(kind) {
    if (!g.decks[kind] || !g.decks[kind].length) {
      if (kind === 'likely') {
        const own = shuffle(g.custom.filter(c => ctx.exists(c.pid)).map(c => ({ text: c.text, by: c.pid })));
        const bank = shuffle(PROMPTS[g.lang] || PROMPTS.en).map(text => ({ text }));
        // Pop takes from the end: put the players' own questions there so they come first.
        g.decks.likely = bank.concat(own);
      } else {
        g.decks[kind] = shuffle((POLLS[kind][g.lang] || POLLS[kind].en)).map(text => ({ text }));
      }
    }
    return g.decks[kind].pop();
  }

  function ask() {
    timers.clear('next');
    g.round += 1;
    g.kind = nextKind();
    const p = nextPrompt(g.kind);
    g.prompt = p.text;
    g.by = p.by || null;
    g.voters = ctx.connectedIds();
    g.votes = {};
    g.result = null;
    g.nextAt = null;
    g.status = 'question';
    g.endsAt = ctx.now() + g.settings.seconds * 1000;
    timers.set('vote', g.settings.seconds * 1000, reveal);
    ctx.broadcast();
  }

  function reveal() {
    if (g.status !== 'question') return;
    timers.clear('vote');
    timers.clear('allIn');
    const byTarget = {};
    for (const [voter, target] of Object.entries(g.votes)) {
      if (!ctx.exists(voter)) continue;
      if (g.kind === 'likely' && !ctx.exists(target)) continue;
      (byTarget[target] = byTarget[target] || []).push(voter);
    }
    const counts = Object.fromEntries(Object.entries(byTarget).map(([t, v]) => [t, v.length]));
    let winners = [];
    if (g.kind === 'likely' || g.kind === 'rather') {
      const best = Math.max(0, ...Object.values(counts));
      winners = best > 0 ? Object.keys(counts).filter(t => counts[t] === best) : [];
      // "Would you rather" with a tie has no majority: nobody scores.
      if (g.kind === 'rather' && winners.length > 1) winners = [];
      for (const [voter, target] of Object.entries(g.votes)) {
        if (winners.includes(target)) g.points[voter] = (g.points[voter] || 0) + 1;
      }
      if (g.kind === 'likely') for (const w of winners) (g.titles[w] = g.titles[w] || []).push(g.prompt);
    } else {
      for (const voter of byTarget.yes || []) (g.confessions[voter] = g.confessions[voter] || []).push(g.prompt);
    }
    g.result = { counts, winners, byTarget };
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
    if (g.round >= g.settings.rounds) finish();
    else ask();
  }

  function finish() {
    timers.clearAll();
    g.status = 'final';
    g.endsAt = null;
    g.nextAt = null;
    const ranked = standings();
    if (ranked.length && ranked[0].points > 0) ctx.finish('mostlikely', rankGroups(ranked, r => r.points));
    ctx.broadcast();
  }

  function standings() {
    const ids = new Set([...Object.keys(g.points), ...Object.keys(g.titles), ...Object.keys(g.confessions)].filter(ctx.exists));
    return [...ids]
      .map(id => ({ id, name: ctx.name(id), points: g.points[id] || 0, titles: g.titles[id] || [], confessions: g.confessions[id] || [] }))
      .sort((a, b) => b.points - a.points || b.titles.length - a.titles.length);
  }

  function payload(role, pid) {
    const names = (ids) => (ids || []).filter(ctx.exists).map(id => ({ id, name: ctx.name(id) }));
    return {
      status: g.status,
      settings: g.settings,
      round: g.round,
      kind: g.kind,
      prompt: g.prompt,
      by: g.by && ctx.exists(g.by) ? ctx.name(g.by) : null,
      endsAt: g.endsAt,
      nextAt: g.nextAt,
      candidates: ctx.players().filter(p => p.connected || g.voters.includes(p.id)).map(p => ({ id: p.id, name: p.name })),
      voted: Object.keys(g.votes),
      voterCount: g.voters.filter(ctx.exists).length,
      // Who voted for what stays secret until the reveal.
      result: g.result
        ? {
            winners: g.kind === 'likely' ? names(g.result.winners) : g.result.winners.map(w => ({ id: w })),
            counts: g.result.counts,
            byTarget: Object.fromEntries(Object.entries(g.result.byTarget).map(([t, v]) => [t, names(v)])),
          }
        : null,
      myVote: role === 'player' && pid ? (g.votes[pid] || null) : null,
      standings: standings(),
      customCount: g.custom.length,
      myQuestions: role === 'player' && pid ? g.custom.filter(c => c.pid === pid).map(c => c.text) : undefined,
    };
  }

  const handlers = {
    'host:mostlikely:settings': ({}, patch) => {
      const s = g.settings;
      if (patch.rounds !== undefined) s.rounds = clampInt(patch.rounds, 1, 50, s.rounds);
      if (patch.seconds !== undefined) s.seconds = clampInt(patch.seconds, 10, 120, s.seconds);
      if (patch.autoNext !== undefined) s.autoNext = clampInt(patch.autoNext, 0, 60, s.autoNext);
      if (typeof patch.allowSelf === 'boolean') s.allowSelf = patch.allowSelf;
      if (['mix', ...KINDS].includes(patch.mode) && (g.status === 'lobby' || g.status === 'final')) s.mode = patch.mode;
      ctx.broadcast();
    },
    'host:mostlikely:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      if (g.status === 'final') reset();
      g.lang = ctx.lang();
      g.decks = {};
      ask();
    },
    'host:mostlikely:reveal': () => reveal(),
    'host:mostlikely:next': () => next(),
    'host:mostlikely:skip': () => { if (g.status === 'question') { g.round -= 1; ask(); } },
    'host:mostlikely:end': () => { if (g.status !== 'lobby') finish(); },
    'host:mostlikely:newGame': () => { reset(); ctx.broadcast(); },
    'player:mostlikely:vote': ({ playerId }, { target }) => {
      if (g.status !== 'question') return;
      if (g.kind === 'likely') {
        if (!ctx.exists(target)) return;
        if (target === playerId && !g.settings.allowSelf) return;
      } else if (g.kind === 'rather') {
        if (target !== 'a' && target !== 'b') return;
      } else if (target !== 'yes' && target !== 'no') return;
      if (!g.voters.includes(playerId)) g.voters.push(playerId);
      g.votes[playerId] = target;
      const everyone = g.voters.filter(v => ctx.connectedIds().includes(v));
      if (everyone.every(v => g.votes[v])) timers.set('allIn', ALL_IN_DELAY_MS, reveal);
      ctx.broadcast();
    },
    // Players' own "who's most likely to…" questions (up to 3 each).
    'player:mostlikely:addQuestion': ({ playerId }, { text }) => {
      let t = cleanText(text, 90);
      if (!t || g.custom.filter(c => c.pid === playerId).length >= MAX_CUSTOM) return;
      if (!/[?؟]$/.test(t)) t += ctx.lang() === 'fa' ? '؟' : '?';
      g.custom.push({ pid: playerId, text: t });
      if (g.decks.likely) g.decks.likely.push({ text: t, by: playerId }); // mid-game: comes up next
      ctx.broadcast();
    },
    'player:mostlikely:removeQuestion': ({ playerId }, { index }) => {
      const mine = g.custom.filter(c => c.pid === playerId);
      const target = mine[clampInt(index, 0, mine.length - 1, 0)];
      if (!target) return;
      g.custom = g.custom.filter(c => c !== target);
      ctx.broadcast();
    },
  };

  return {
    id: 'mostlikely',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      delete g.votes[pid];
      for (const [v, t] of Object.entries(g.votes)) if (t === pid) delete g.votes[v];
      g.voters = g.voters.filter(v => v !== pid);
      delete g.points[pid];
      delete g.titles[pid];
      delete g.confessions[pid];
      g.custom = g.custom.filter(c => c.pid !== pid);
    },
    _debug: () => g,
  };
};

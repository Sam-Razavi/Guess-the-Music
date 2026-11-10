// Gol ya Pooch (گل یا پوچ): two teams. The hiding team's captain secretly
// puts the flower (گل) in one hand of one teammate; the whole team holds out
// closed fists. The other team's captain opens hands one at a time:
//   "Pooch!" (empty) on an empty hand → it's out, keep going
//   "Pooch!" on the flower           → hiders score, they hide again
//   "Gol!" on the flower             → guessers score and take the flower
//   "Gol!" on an empty hand          → hiders score, they hide again
// Opening every empty hand until only the flower's is left also wins it.
// Calling "Gol!" on the very first pick is a bullseye: +2.
//
// Only the holder's own phone (and the hider's) knows where it is — the
// bluffing happens on people's faces, the phones just keep it honest.

const { pick, clampInt, makeTimers } = require('./common');
const STREAK_SHOW = 3; // "on fire" banner from this many rounds in a row
const { createTeams, teamOfPlayer, shuffleTeams, syncTeams, movePlayer } = require('./teams');

const SUSPENSE_MS = 1700;
const REVEAL_MS = 6500;

module.exports = function golpooch(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    const teams = createTeams(2);
    shuffleTeams(teams, ctx.connectedIds());
    g = {
      status: 'lobby',        // lobby | hiding | guessing | reveal | final
      settings: g ? g.settings : { target: 5, hideSeconds: 30 },
      hideEndsAt: null,
      streak: { team: null, count: 0 },
      // For the awards at the end: who found the flower, who opened empty
      // hands, whose poker face kept the flower safe.
      stats: { finds: {}, sweeps: {}, poker: {} },
      teams,
      scores: { red: 0, blue: 0 },
      round: 0,
      hidingTeam: null,
      captainIdx: { red: -1, blue: -1 },
      hider: null,
      guesser: null,
      gol: null,              // {pid, hand: 'L' | 'R'}
      hands: [],              // [{key, pid, hand, open: null | 'empty' | 'gol'}]
      picks: 0,
      pending: null,          // {key, call} while the hand is "opening"
      suggestions: {},        // guessing-team pid -> hand key
      result: null,           // {winner, reason, points, key, call}
      winner: null,
    };
  }
  reset();

  const other = (t) => (t === 'red' ? 'blue' : 'red');
  // Only people who are here tonight: players.json remembers everyone who ever
  // joined, and an absent player mustn't get fists on the TV.
  const members = (t) => g.teams.members[t].filter(ctx.isConnected);
  const sync = () => syncTeams(g.teams, ctx.connectedIds(), ctx.allIds());

  function nextCaptain(t) {
    const list = members(t);
    if (!list.length) return null;
    // Prefer someone who's actually connected, rotating through the team.
    for (let i = 1; i <= list.length; i++) {
      const idx = (g.captainIdx[t] + i) % list.length;
      const pid = list[idx];
      if (ctx.connectedIds().includes(pid) || i === list.length) {
        g.captainIdx[t] = idx;
        return pid;
      }
    }
    return list[0];
  }

  function startRound(hidingTeam) {
    sync(); // anyone who joined during the last round plays from this one
    if (!members('red').length || !members('blue').length) return false;
    g.round += 1;
    g.hidingTeam = hidingTeam;
    g.hider = nextCaptain(hidingTeam);
    g.guesser = nextCaptain(other(hidingTeam));
    g.gol = null;
    g.hands = members(hidingTeam).flatMap(pid => ['L', 'R'].map(hand => ({ key: `${pid}:${hand}`, pid, hand, open: null })));
    g.picks = 0;
    g.pending = null;
    g.suggestions = {};
    g.result = null;
    g.status = 'hiding';
    // Shot clock for the hiding captain: when it runs out the flower goes to a random hand.
    g.hideEndsAt = g.settings.hideSeconds > 0 ? ctx.now() + g.settings.hideSeconds * 1000 : null;
    if (g.hideEndsAt) timers.set('hide', g.settings.hideSeconds * 1000, () => { if (g.status === 'hiding' && g.hands.length) { const h = pick(g.hands); hide(h.pid, h.hand); } });
    ctx.broadcast();
    return true;
  }

  function hide(pid, hand) {
    if (!g.hands.some(h => h.pid === pid && h.hand === hand)) return;
    g.gol = { pid, hand };
    g.status = 'guessing';
    g.hideEndsAt = null;
    timers.clear('hide');
    ctx.emitTo(pid, 'gp:holding', { hand });
    ctx.broadcast();
  }

  function finishRound(winner, reason, extra = {}) {
    const points = reason === 'bullseye' ? 2 : 1;
    g.scores[winner] += points;
    const bump = (table, pid) => { if (pid) table[pid] = (table[pid] || 0) + 1; };
    if (reason === 'found' || reason === 'bullseye' || reason === 'elimination') bump(g.stats.finds, g.guesser);
    else if (g.gol) bump(g.stats.poker, g.gol.pid);
    g.streak = g.streak.team === winner ? { team: winner, count: g.streak.count + 1 } : { team: winner, count: 1 };
    // Reveal every hand at the end of the round.
    for (const h of g.hands) if (!h.open) h.open = (g.gol && h.pid === g.gol.pid && h.hand === g.gol.hand) ? 'gol' : 'empty';
    g.result = { winner, reason, points, ...extra };
    g.status = 'reveal';
    g.pending = null;
    if (g.scores[winner] >= g.settings.target) {
      g.winner = winner;
      timers.set('final', 3500, () => {
        g.status = 'final';
        ctx.finish('golpooch', [g.teams.members[winner], g.teams.members[other(winner)]]);
        ctx.broadcast();
      });
    } else {
      // The flower changes hands only when the guessers find it.
      const nextHiders = winner === g.hidingTeam ? g.hidingTeam : winner;
      g.result.nextHiders = nextHiders;
      timers.set('next', REVEAL_MS, () => startRound(nextHiders));
    }
    ctx.broadcast();
  }

  function resolvePick() {
    const { key, call } = g.pending;
    const hand = g.hands.find(h => h.key === key);
    const isGol = g.gol && hand.pid === g.gol.pid && hand.hand === g.gol.hand;
    const firstPick = g.picks === 0;
    g.picks += 1;
    const guessers = other(g.hidingTeam);
    if (call === 'pooch' && !isGol) {
      hand.open = 'empty';
      g.stats.sweeps[g.guesser] = (g.stats.sweeps[g.guesser] || 0) + 1;
      g.pending = null;
      const closed = g.hands.filter(h => !h.open);
      if (closed.length === 1) { finishRound(guessers, 'elimination', { key: closed[0].key, call }); return; }
      ctx.emitAll('gp:opened', { key, open: 'empty' });
      ctx.broadcast();
      return;
    }
    if (call === 'pooch' && isGol) { hand.open = 'gol'; finishRound(g.hidingTeam, 'poochedGol', { key, call }); return; }
    if (call === 'gol' && isGol) { hand.open = 'gol'; finishRound(guessers, firstPick && g.hands.length > 2 ? 'bullseye' : 'found', { key, call }); return; }
    hand.open = 'empty';
    finishRound(g.hidingTeam, 'wrongGol', { key, call });
  }

  // Best finder, best poker face, cleanest sweeper — whoever leads each table.
  function awards() {
    const top = (table) => {
      const best = Object.entries(table).filter(([id]) => ctx.exists(id)).sort((a, b) => b[1] - a[1])[0];
      return best ? { id: best[0], name: ctx.name(best[0]), n: best[1] } : null;
    };
    return [['eye', g.stats.finds], ['poker', g.stats.poker], ['sweep', g.stats.sweeps]]
      .map(([key, table]) => ({ key, ...(top(table) || {}) }))
      .filter(a => a.id);
  }

  function payload(role, pid) {
    if (g.status === 'lobby') sync();
    const myTeam = pid ? teamOfPlayer(g.teams, pid) : null;
    const revealAll = g.status === 'reveal' || g.status === 'final';
    const base = {
      status: g.status,
      settings: g.settings,
      teams: g.teams.ids.map(t => ({ id: t, members: members(t).map(id => ({ id, name: ctx.name(id) })) })),
      scores: g.scores,
      round: g.round,
      hidingTeam: g.hidingTeam,
      hider: g.hider ? { id: g.hider, name: ctx.name(g.hider) } : null,
      guesser: g.guesser ? { id: g.guesser, name: ctx.name(g.guesser) } : null,
      hands: g.hands.map(h => ({ key: h.key, pid: h.pid, name: ctx.name(h.pid), hand: h.hand, open: h.open })),
      picks: g.picks,
      pending: g.pending,
      suggestions: Object.entries(g.suggestions).map(([id, key]) => ({ id, name: ctx.name(id), key })),
      result: g.result,
      winner: g.winner,
      gol: revealAll ? g.gol : null,
      hidden: !!g.gol,
      hideEndsAt: g.hideEndsAt,
      streak: g.streak.count >= STREAK_SHOW ? g.streak : null,
      awards: g.status === 'final' ? awards() : [],
    };
    if (role === 'player') {
      base.myTeam = myTeam;
      // The holder knows which hand; so does the captain who put it there.
      if (g.gol && (pid === g.gol.pid || pid === g.hider)) base.gol = g.gol;
    }
    if (role === 'host') base.secretGol = g.gol;
    return base;
  }

  const handlers = {
    'host:golpooch:settings': ({}, { target, hideSeconds }) => {
      if (target !== undefined) g.settings.target = clampInt(target, 1, 30, g.settings.target);
      if (hideSeconds !== undefined) g.settings.hideSeconds = clampInt(hideSeconds, 0, 120, g.settings.hideSeconds);
      ctx.broadcast();
    },
    'host:golpooch:shuffle': () => { if (g.status !== 'lobby') return; shuffleTeams(g.teams, ctx.connectedIds()); ctx.broadcast(); },
    'host:golpooch:move': ({}, { id, team }) => {
      if (g.status !== 'lobby' || !ctx.exists(id)) return;
      if (movePlayer(g.teams, id, team)) ctx.broadcast();
    },
    'host:golpooch:start': () => {
      if (g.status !== 'lobby' && g.status !== 'final') return;
      if (g.status === 'final') { const keep = g.settings; const teams = g.teams; reset(); g.settings = keep; g.teams = teams; }
      startRound(pick(['red', 'blue']));
    },
    'host:golpooch:hideRandom': () => {
      if (g.status !== 'hiding' || !g.hands.length) return;
      const h = pick(g.hands);
      hide(h.pid, h.hand);
    },
    'host:golpooch:next': () => {
      if (g.status !== 'reveal' || g.winner) return;
      timers.clear('next');
      startRound(g.result.nextHiders);
    },
    // The guessing captain's phone died or they wandered off: hand the call to a teammate.
    'host:golpooch:newCaptain': () => {
      if (g.status !== 'guessing' || g.pending) return;
      g.guesser = nextCaptain(other(g.hidingTeam));
      g.suggestions = {};
      ctx.broadcast();
    },
    'host:golpooch:newGame': () => { const keep = g.settings; const teams = g.teams; reset(); g.settings = keep; g.teams = teams; ctx.broadcast(); },
    'player:golpooch:hide': ({ playerId }, { key }) => {
      if (g.status !== 'hiding' || playerId !== g.hider) return;
      const h = g.hands.find(x => x.key === key);
      if (h) hide(h.pid, h.hand);
    },
    'player:golpooch:suggest': ({ playerId }, { key }) => {
      if (g.status !== 'guessing' || teamOfPlayer(g.teams, playerId) !== other(g.hidingTeam) || playerId === g.guesser) return;
      const h = g.hands.find(x => x.key === key);
      if (!h || h.open) { delete g.suggestions[playerId]; }
      else if (g.suggestions[playerId] === key) delete g.suggestions[playerId];
      else g.suggestions[playerId] = key;
      ctx.broadcast();
    },
    'player:golpooch:pick': ({ playerId }, { key, call }) => {
      if (g.status !== 'guessing' || g.pending || playerId !== g.guesser) return;
      if (call !== 'pooch' && call !== 'gol') return;
      const h = g.hands.find(x => x.key === key);
      if (!h || h.open) return;
      g.pending = { key, call };
      g.suggestions = {};
      ctx.emitAll('gp:pending', { key, call });
      timers.set('suspense', SUSPENSE_MS, resolvePick);
      ctx.broadcast();
    },
  };

  return {
    id: 'golpooch',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      for (const t of g.teams.ids) g.teams.members[t] = g.teams.members[t].filter(id => id !== pid);
      delete g.suggestions[pid];
      if (g.status === 'hiding' || g.status === 'guessing') {
        // A hand that just vanished could have held the flower — replay the round.
        if (g.hands.some(h => h.pid === pid) || pid === g.hider || pid === g.guesser) {
          timers.clearAll();
          if (!startRound(g.hidingTeam)) { g.status = 'lobby'; }
        }
      }
    },
    _debug: () => g,
  };
};

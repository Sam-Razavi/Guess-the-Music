// Mafia (مافیا): the app is the narrator. Everyone gets a secret role on
// their phone. At night every living player taps someone — the mafia pick a
// victim, the doctor someone to save, the detective someone to investigate,
// the sniper (optional) someone to shoot, and plain citizens pick a
// "suspect" — so a glance at who's tapping their phone gives nothing away.
// By day the town talks, then votes someone out in the open.
//
// The mafia win once they're at least as many as everyone else; the town
// wins when the last mafia member is gone.

const { shuffle, pick, clampInt, makeTimers } = require('./common');

const MAFIA_ROLES = ['godfather', 'mafia'];
const AUTO_STEP_MS = 9000;
const ALL_IN_DELAY_MS = 1500;

module.exports = function mafia(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',      // lobby | roles | night | dawn | day | vote | defense | judgment | verdict | end
      settings: g ? g.settings : {
        mafiaCount: 0,       // 0 = automatic
        godfather: true,
        doctor: true,
        detective: true,
        sniper: false,
        bulletproof: false,  // رویین‌تن — survives the first mafia attack
        jester: false,       // دلقک — wins alone if the town votes them out
        defense: true,       // the accused gets a defense, then a guilty/innocent vote
        defenseSeconds: 45,
        lastWords: 30,       // seconds of last words for whoever is voted out (0 = off)
        introNight: true,    // first night is introductions only — the first day comes straight after the role cards
        revealOnDeath: false,
        nightSeconds: 60,
        daySeconds: 180,
        voteSeconds: 45,
      },
      players: [],
      roles: {},
      alive: {},
      seen: {},
      day: 0,
      night: 0,
      picks: {},             // night: pid -> target | 'none'
      doctorSelfUsed: false,
      sniperShots: 1,
      shield: true,          // the bulletproof player's one free life
      accused: null,         // on trial during defense / judgment
      judgment: {},          // pid -> 'guilty' | 'innocent'
      detectiveLog: [],      // [{day, target, mafia}]
      dawn: null,            // {attacked, saved, deaths: [pid], sniper}
      endsAt: null,
      votes: {},             // day vote: pid -> target | 'skip'
      verdict: null,         // {out: pid | null, tie, counts}
      winner: null,
      log: [],               // host-only narrator log
    };
  }
  reset();

  const isMafia = (pid) => MAFIA_ROLES.includes(g.roles[pid]);
  const living = () => g.players.filter(p => g.alive[p] && ctx.exists(p));
  const note = (text) => { g.log.unshift({ at: ctx.now(), text }); g.log.length = Math.min(g.log.length, 80); };

  function autoMafiaCount(n) {
    if (n <= 6) return 1;
    if (n <= 9) return 2;
    if (n <= 12) return 3;
    return 4;
  }

  function deal() {
    const ids = shuffle(ctx.connectedIds());
    const s = g.settings;
    const k = Math.min(Math.max(1, s.mafiaCount || autoMafiaCount(ids.length)), Math.max(1, Math.floor((ids.length - 1) / 2)));
    const roles = {};
    let i = 0;
    for (; i < k; i++) roles[ids[i]] = (s.godfather && k >= 2 && i === 0) ? 'godfather' : 'mafia';
    for (const special of ['doctor', 'detective', 'sniper', 'bulletproof', 'jester']) {
      if (s[special] && i < ids.length - 1) roles[ids[i++]] = special;
    }
    for (; i < ids.length; i++) roles[ids[i]] = 'citizen';
    g.players = ids;
    g.roles = roles;
    g.alive = Object.fromEntries(ids.map(p => [p, true]));
    g.seen = {};
    note(`Roles dealt to ${ids.length} players (${k} mafia).`);
  }

  function checkWin() {
    const alive = living();
    const m = alive.filter(isMafia).length;
    const town = alive.length - m;
    if (m === 0) return 'town';
    if (m >= town) return 'mafia';
    return null;
  }

  function endGame(winner) {
    timers.clearAll();
    g.winner = winner;
    g.status = 'end';
    g.endsAt = null;
    const champs = winner === 'jester'
      ? g.players.filter(p => g.roles[p] === 'jester')
      : g.players.filter(p => (winner === 'mafia') === isMafia(p) && g.roles[p] !== 'jester');
    ctx.finish('mafia', [champs]);
    note(winner === 'mafia' ? 'The mafia win.' : winner === 'jester' ? 'The jester wins!' : 'The town wins.');
    ctx.broadcast();
  }

  // ---------- phases ----------

  function startNight() {
    g.night += 1;
    g.status = 'night';
    g.picks = {};
    g.dawn = null;
    g.verdict = null;
    g.endsAt = g.settings.nightSeconds > 0 ? ctx.now() + g.settings.nightSeconds * 1000 : null;
    if (g.endsAt) timers.set('phase', g.settings.nightSeconds * 1000, resolveNight);
    ctx.emitAll('mf:night', {});
    ctx.broadcast();
  }

  function resolveNight() {
    if (g.status !== 'night') return;
    timers.clear('phase');
    timers.clear('allIn');
    const alive = living();
    const byRole = (r) => alive.find(p => g.roles[p] === r);

    // The mafia's victim: the godfather's call if he's alive and made one,
    // otherwise the most-picked name among the mafia (ties broken at random).
    const mafiaPicks = alive.filter(isMafia).map(p => g.picks[p]).filter(t => t && t !== 'none' && g.alive[t]);
    const gf = byRole('godfather');
    let target = gf && g.picks[gf] && g.alive[g.picks[gf]] ? g.picks[gf] : null;
    if (!target && mafiaPicks.length) {
      const counts = {};
      for (const t of mafiaPicks) counts[t] = (counts[t] || 0) + 1;
      const best = Math.max(...Object.values(counts));
      target = pick(Object.keys(counts).filter(t => counts[t] === best));
    }
    const doctor = byRole('doctor');
    const save = doctor ? g.picks[doctor] : null;
    if (doctor && save === doctor) g.doctorSelfUsed = true;

    const deaths = [];
    let saved = false;
    let shielded = false;
    if (target) {
      if (save === target) { saved = true; note(`Night ${g.night}: mafia went for ${ctx.name(target)}, the doctor saved them.`); }
      else if (g.roles[target] === 'bulletproof' && g.shield) { shielded = true; g.shield = false; note(`Night ${g.night}: mafia shot ${ctx.name(target)}, who is bulletproof and survived.`); }
      else { deaths.push(target); note(`Night ${g.night}: mafia killed ${ctx.name(target)}.`); }
    } else {
      note(`Night ${g.night}: the mafia didn't pick anyone.`);
    }

    let sniper = 'none';
    const sn = byRole('sniper');
    const shot = sn ? g.picks[sn] : null;
    if (sn && shot && shot !== 'none' && g.alive[shot] && g.sniperShots > 0) {
      g.sniperShots -= 1;
      if (isMafia(shot)) {
        if (save === shot) { sniper = 'saved'; note(`Sniper hit ${ctx.name(shot)} (mafia) but the doctor saved them.`); }
        else { sniper = 'hit'; if (!deaths.includes(shot)) deaths.push(shot); note(`Sniper took out ${ctx.name(shot)} (mafia).`); }
      } else {
        // Shooting an innocent costs the sniper their own life.
        sniper = 'miss';
        if (!deaths.includes(sn)) deaths.push(sn);
        note(`Sniper shot ${ctx.name(shot)}, who was innocent — the sniper is out.`);
      }
    }

    for (const d of deaths) g.alive[d] = false;
    g.dawn = { attacked: !!target, saved, shielded, deaths, sniper };
    g.status = 'dawn';
    g.endsAt = null;
    ctx.broadcast();
    const winner = checkWin();
    timers.set('step', AUTO_STEP_MS, () => (winner ? endGame(winner) : startDay()));
  }

  function startDay() {
    timers.clear('step');
    g.day += 1;
    g.status = 'day';
    g.votes = {};
    g.endsAt = g.settings.daySeconds > 0 ? ctx.now() + g.settings.daySeconds * 1000 : null;
    if (g.endsAt) timers.set('phase', g.settings.daySeconds * 1000, startVote);
    ctx.emitAll('mf:day', {});
    ctx.broadcast();
  }

  function startVote() {
    if (g.status !== 'day') return;
    timers.clear('phase');
    g.status = 'vote';
    g.votes = {};
    g.endsAt = g.settings.voteSeconds > 0 ? ctx.now() + g.settings.voteSeconds * 1000 : null;
    if (g.endsAt) timers.set('phase', g.settings.voteSeconds * 1000, closeVote);
    ctx.broadcast();
  }

  function tally() {
    const counts = {};
    for (const p of living()) {
      const v = g.votes[p];
      if (v) counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }

  function closeVote() {
    if (g.status !== 'vote') return;
    timers.clear('phase');
    timers.clear('allIn');
    const counts = tally();
    const players = Object.keys(counts).filter(k => k !== 'skip');
    const best = Math.max(0, ...players.map(k => counts[k]));
    const top = players.filter(k => counts[k] === best);
    let out = null;
    let tie = false;
    if (best > 0 && top.length === 1 && best > (counts.skip || 0)) out = top[0];
    else if (best > 0) tie = true;
    g.lastCounts = counts;
    if (out && g.settings.defense) { startDefense(out); return; }
    verdict(out, { tie, counts });
  }

  // دفاعیه: the accused speaks, then everyone else votes guilty or innocent.
  function startDefense(pid) {
    g.accused = pid;
    g.status = 'defense';
    g.endsAt = g.settings.defenseSeconds > 0 ? ctx.now() + g.settings.defenseSeconds * 1000 : null;
    if (g.endsAt) timers.set('phase', g.settings.defenseSeconds * 1000, startJudgment);
    note(`Day ${g.day}: ${ctx.name(pid)} is on trial.`);
    ctx.broadcast();
  }

  function startJudgment() {
    if (g.status !== 'defense') return;
    timers.clear('phase');
    g.status = 'judgment';
    g.judgment = {};
    g.endsAt = g.settings.voteSeconds > 0 ? ctx.now() + g.settings.voteSeconds * 1000 : null;
    if (g.endsAt) timers.set('phase', g.settings.voteSeconds * 1000, closeJudgment);
    ctx.broadcast();
  }

  function closeJudgment() {
    if (g.status !== 'judgment') return;
    timers.clear('phase');
    timers.clear('allIn');
    const guilty = Object.values(g.judgment).filter(v => v === 'guilty').length;
    const innocent = Object.values(g.judgment).filter(v => v === 'innocent').length;
    const spared = guilty <= innocent;
    verdict(spared ? null : g.accused, { counts: g.lastCounts || {}, judgment: { guilty, innocent }, spared: spared ? g.accused : null });
  }

  function verdict(out, extra) {
    if (out) { g.alive[out] = false; note(`Day ${g.day}: the town voted out ${ctx.name(out)} (${g.roles[out]}).`); }
    else note(`Day ${g.day}: nobody was voted out.`);
    const lastWords = out && g.settings.lastWords > 0 ? g.settings.lastWords : 0;
    g.verdict = { out, tie: false, ...extra, lastWordsEndsAt: lastWords ? ctx.now() + lastWords * 1000 : null };
    g.accused = null;
    g.status = 'verdict';
    g.endsAt = null;
    ctx.broadcast();
    // The jester wins the moment the town votes them out.
    const winner = out && g.roles[out] === 'jester' ? 'jester' : checkWin();
    timers.set('step', Math.max(AUTO_STEP_MS, lastWords * 1000 + 2500), () => (winner ? endGame(winner) : startNight()));
  }

  // Waits for the living players who are actually connected — a phone that
  // dropped out mustn't hold the whole table up (the phase timers cover the rest).
  function maybeAllIn(kind) {
    const alive = living().filter(ctx.isConnected);
    const done = kind === 'night' ? alive.every(p => g.picks[p])
      : kind === 'judgment' ? alive.filter(p => p !== g.accused).every(p => g.judgment[p])
      : alive.every(p => g.votes[p]);
    if (done) timers.set('allIn', ALL_IN_DELAY_MS, kind === 'night' ? resolveNight : kind === 'judgment' ? closeJudgment : closeVote);
    else timers.clear('allIn');
  }

  // ---------- payload ----------

  function roleCounts() {
    const c = {};
    for (const p of g.players) c[g.roles[p]] = (c[g.roles[p]] || 0) + 1;
    return c;
  }

  function payload(role, pid) {
    const over = g.status === 'end';
    const showRole = (p) => over || role === 'host' || (!g.alive[p] && g.settings.revealOnDeath);
    const base = {
      status: g.status,
      settings: g.settings,
      day: g.day,
      night: g.night,
      endsAt: g.endsAt,
      roleCounts: roleCounts(),
      players: g.players.filter(ctx.exists).map(p => ({
        id: p, name: ctx.name(p), alive: !!g.alive[p], role: showRole(p) ? g.roles[p] : null,
      })),
      seenCount: Object.keys(g.seen).length,
      nightDone: g.status === 'night' ? living().filter(p => g.picks[p]).length : 0,
      livingCount: living().length,
      dawn: g.dawn,
      votes: ['vote', 'defense', 'judgment', 'verdict'].includes(g.status) ? g.votes : {},
      accused: g.accused ? { id: g.accused, name: ctx.name(g.accused) } : null,
      judgedCount: g.status === 'judgment' ? Object.keys(g.judgment).length : 0,
      verdict: g.verdict
        ? { ...g.verdict, outRole: g.verdict.out && (g.settings.revealOnDeath || over) ? g.roles[g.verdict.out] : null }
        : null,
      winner: g.winner,
      lobbyCount: ctx.connectedIds().length,
    };
    if (role === 'player' && pid && g.roles[pid]) {
      const myRole = g.roles[pid];
      base.me = {
        role: myRole,
        alive: !!g.alive[pid],
        seen: !!g.seen[pid],
        pick: g.picks[pid] || null,
        vote: g.votes[pid] || null,
        doctorSelfUsed: g.doctorSelfUsed,
        sniperShots: g.sniperShots,
      };
      if (isMafia(pid)) {
        base.me.team = g.players.filter(p => p !== pid && isMafia(p)).map(p => ({ id: p, name: ctx.name(p), role: g.roles[p], alive: !!g.alive[p], pick: g.picks[p] || null }));
      }
      base.me.judgment = g.status === 'judgment' ? (g.judgment[pid] || null) : null;
      if (myRole === 'detective') base.me.inquiries = g.detectiveLog.map(r => ({ ...r, name: ctx.name(r.target) }));
    }
    if (role === 'host') {
      base.picks = g.picks;
      base.log = g.log;
      base.seen = g.seen;
    }
    return base;
  }

  // ---------- events ----------

  const handlers = {
    'host:mafia:settings': ({}, patch) => {
      if (g.status !== 'lobby' && g.status !== 'end') return;
      const s = g.settings;
      for (const k of ['godfather', 'doctor', 'detective', 'sniper', 'bulletproof', 'jester', 'defense', 'introNight', 'revealOnDeath']) {
        if (typeof patch[k] === 'boolean') s[k] = patch[k];
      }
      if (patch.mafiaCount !== undefined) s.mafiaCount = clampInt(patch.mafiaCount, 0, 6, s.mafiaCount);
      if (patch.nightSeconds !== undefined) s.nightSeconds = clampInt(patch.nightSeconds, 0, 600, s.nightSeconds);
      if (patch.daySeconds !== undefined) s.daySeconds = clampInt(patch.daySeconds, 0, 1800, s.daySeconds);
      if (patch.voteSeconds !== undefined) s.voteSeconds = clampInt(patch.voteSeconds, 0, 600, s.voteSeconds);
      if (patch.defenseSeconds !== undefined) s.defenseSeconds = clampInt(patch.defenseSeconds, 0, 300, s.defenseSeconds);
      if (patch.lastWords !== undefined) s.lastWords = clampInt(patch.lastWords, 0, 120, s.lastWords);
      ctx.broadcast();
    },
    'host:mafia:start': () => {
      if (g.status !== 'lobby' && g.status !== 'end') return;
      if (ctx.connectedIds().length < 4) return;
      if (g.status === 'end') reset();
      deal();
      g.status = 'roles';
      ctx.emitAll('mf:roles', {});
      ctx.broadcast();
    },
    // One button on the host page walks the game forward from whatever
    // phase it's in.
    'host:mafia:advance': () => {
      if (g.status === 'roles') { if (g.settings.introNight) startDay(); else startNight(); }
      else if (g.status === 'night') resolveNight();
      else if (g.status === 'dawn') { timers.clear('step'); const w = checkWin(); if (w) endGame(w); else startDay(); }
      else if (g.status === 'day') startVote();
      else if (g.status === 'vote') closeVote();
      else if (g.status === 'defense') startJudgment();
      else if (g.status === 'judgment') closeJudgment();
      else if (g.status === 'verdict') { timers.clear('step'); const w = checkWin(); if (w) endGame(w); else startNight(); }
    },
    'host:mafia:end': () => { if (g.status !== 'lobby') endGame(checkWin() || 'town'); },
    'host:mafia:newGame': () => { reset(); ctx.broadcast(); },
    'player:mafia:seen': ({ playerId }) => {
      if (g.status !== 'roles' || !g.roles[playerId]) return;
      g.seen[playerId] = true;
      ctx.broadcast();
    },
    'player:mafia:night': ({ playerId }, { target }) => {
      if (g.status !== 'night' || !g.alive[playerId]) return;
      const r = g.roles[playerId];
      if (target === 'none') {
        if (r !== 'sniper') return;
      } else {
        if (!g.alive[target]) return;
        if (target === playerId && !(r === 'doctor' && !g.doctorSelfUsed)) return;
        if (MAFIA_ROLES.includes(r) && isMafia(target)) return;
        if (r === 'sniper' && g.sniperShots <= 0) return;
      }
      // The detective's answer is final once given — no fishing for a second one.
      if (r === 'detective' && g.picks[playerId]) return;
      g.picks[playerId] = target;
      if (r === 'detective') {
        const mafiaLooking = g.roles[target] === 'mafia'; // the godfather passes as innocent
        g.detectiveLog.push({ night: g.night, target, mafia: mafiaLooking });
        ctx.emitTo(playerId, 'mf:inquiry', { name: ctx.name(target), mafia: mafiaLooking });
      }
      maybeAllIn('night');
      ctx.broadcast();
    },
    'player:mafia:judge': ({ playerId }, { verdict }) => {
      if (g.status !== 'judgment' || !g.alive[playerId] || playerId === g.accused) return;
      if (verdict !== 'guilty' && verdict !== 'innocent') return;
      g.judgment[playerId] = verdict;
      maybeAllIn('judgment');
      ctx.broadcast();
    },
    'player:mafia:vote': ({ playerId }, { target }) => {
      if (g.status !== 'vote' || !g.alive[playerId]) return;
      if (target !== 'skip' && (!g.alive[target] || target === playerId)) return;
      g.votes[playerId] = g.votes[playerId] === target ? undefined : target;
      if (!g.votes[playerId]) delete g.votes[playerId];
      maybeAllIn('vote');
      ctx.broadcast();
    },
  };

  return {
    id: 'mafia',
    reset,
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      if (!g.roles[pid]) return;
      g.alive[pid] = false;
      g.players = g.players.filter(p => p !== pid);
      // The accused left mid-trial: the trial is over.
      if (pid === g.accused && (g.status === 'defense' || g.status === 'judgment')) {
        timers.clearAll();
        const w = checkWin();
        if (w) endGame(w); else verdict(null, {});
        return;
      }
      if (['night', 'day', 'vote', 'defense', 'judgment', 'dawn', 'verdict'].includes(g.status)) {
        const w = checkWin();
        if (w) endGame(w);
      }
    },
    _debug: () => g,
  };
};

module.exports.MAFIA_ROLES = MAFIA_ROLES;

// Esm-Famil (اسم فامیل): a letter is drawn, everyone fills in a name, a last
// name, a city… starting with it on their phone. The first player to fill
// every box can shout STOP ("استپ!"), which gives everyone else a few seconds
// to finish. Then the answers are reviewed one category at a time: players
// can thumbs-down an answer they don't accept, the host has the final word.
//
// Classic scoring: 20 if you're the only one with an answer in a category,
// 10 for an answer nobody else has, 5 for one somebody else wrote too.

const { shuffle, pick, clampInt, cleanText, foldPersian, answerKey, makeTimers, rankGroups } = require('./common');

const CATEGORIES = ['name', 'family', 'city', 'country', 'food', 'animal', 'color', 'object',
  'fruit', 'flower', 'car', 'job', 'sport', 'movie', 'singer', 'brand', 'body', 'celebrity'];
const DEFAULT_CATEGORIES = ['name', 'family', 'city', 'country', 'food', 'animal', 'color', 'object'];

const LETTERS = {
  fa: { easy: 'ا ب پ ت ج چ ح خ د ر ز س ش ص ع غ ف ق ک گ ل م ن و ه ی'.split(' '), hard: 'ث ذ ژ ض ط ظ'.split(' ') },
  en: { easy: 'A B C D E F G H I J L M N O P R S T W'.split(' '), hard: 'K Q U V Y Z X'.split(' ') },
};

const SPIN_MS = 4200;
// Answers typed in the last instant before pens-down are still in flight from
// the phones when the round locks — accept them for a moment afterwards.
const LATE_MS = 1500;
const MAX_ANSWER = 32;
const PICK_SECONDS = 20;   // a player choosing the letter gets this long, then it's drawn at random
const STOP_BONUS = 5;

module.exports = function esmfamil(ctx) {
  const timers = makeTimers();
  let g;

  function reset() {
    timers.clearAll();
    g = {
      status: 'lobby',     // lobby | picking | spinning | writing | stopping | review | scores | final
      settings: g ? g.settings : {
        categories: DEFAULT_CATEGORIES.slice(),
        seconds: 120,
        stopGrace: 10,
        rounds: 5,
        alphabet: ctx.lang(),
        hardLetters: false,
        golden: true,        // one random category a round counts double
        stopBonus: true,     // +5 for calling STOP, only if all your answers hold up
        letterMode: 'random', // 'random' | 'player' (a player picks the letter on their phone)
      },
      golden: null,
      picker: null,
      pickerIdx: -1,
      pickEndsAt: null,
      lastBonus: {},
      round: 0,
      usedLetters: [],
      letter: null,
      spinEndsAt: null,
      endsAt: null,
      stopBy: null,
      participants: [],
      answers: {},         // pid -> {cat: text}
      challenges: {},      // `${pid}|${cat}` -> [voterIds]
      overrides: {},       // `${pid}|${cat}` -> 'accept' | 'reject'
      reviewIndex: 0,
      roundScores: null,   // pid -> {cat: points}
      totals: {},
      history: [],         // [{letter, scores: {pid: total}}]
    };
  }
  reset();

  // ---------- validity + scoring ----------

  function startsWithLetter(text, letter, alphabet) {
    const t = foldPersian(text).replace(/^[\s‌"'«(]+/, '');
    if (!t) return false;
    if (alphabet === 'en') return t.normalize('NFKD')[0].toUpperCase() === letter; // "Écosse" counts for E
    return t[0] === foldPersian(letter);
  }

  // One answer's standing: {text, valid, reason, challengers, override}.
  function judge(pid, cat) {
    const text = (g.answers[pid] && g.answers[pid][cat]) || '';
    const k = `${pid}|${cat}`;
    const challengers = (g.challenges[k] || []).filter(v => g.participants.includes(v));
    const override = g.overrides[k] || null;
    const others = g.participants.filter(p => p !== pid).length;
    let valid = true;
    let reason = null;
    if (!text) { valid = false; reason = 'empty'; }
    else if (override === 'accept') { valid = true; }
    else if (override === 'reject') { valid = false; reason = 'host'; }
    else if (!startsWithLetter(text, g.letter, g.settings.alphabet)) { valid = false; reason = 'letter'; }
    // Rejected by the table once at least half of the other players object —
    // and never by a single person, or in a two-player game either player could
    // veto everything the other writes (there, a 👎 just flags it for the host).
    else if (challengers.length >= Math.max(2, Math.ceil(others / 2))) { valid = false; reason = 'voted'; }
    return { text, valid, reason, challengers, override };
  }

  // Points for every participant in one category, from the current verdicts.
  function scoreCategory(cat) {
    const verdicts = Object.fromEntries(g.participants.map(p => [p, judge(p, cat)]));
    const valid = g.participants.filter(p => verdicts[p].valid);
    const groups = {};
    for (const p of valid) {
      const key = answerKey(verdicts[p].text);
      (groups[key] = groups[key] || []).push(p);
    }
    const points = {};
    const mult = cat === g.golden ? 2 : 1;
    for (const p of g.participants) {
      if (!verdicts[p].valid) points[p] = 0;
      else if (valid.length === 1) points[p] = 20 * mult;
      else points[p] = (groups[answerKey(verdicts[p].text)].length > 1 ? 5 : 10) * mult;
    }
    return { verdicts, points, groups, validCount: valid.length };
  }

  function computeRound() {
    const scores = {};
    for (const p of g.participants) scores[p] = {};
    for (const cat of g.settings.categories) {
      const { points } = scoreCategory(cat);
      for (const p of g.participants) scores[p][cat] = points[p];
    }
    return scores;
  }

  // ---------- flow ----------

  function pickLetter() {
    const set = LETTERS[g.settings.alphabet] || LETTERS.fa;
    const pool = g.settings.hardLetters ? set.easy.concat(set.hard) : set.easy;
    const fresh = pool.filter(l => !g.usedLetters.includes(l));
    return pick(fresh.length ? fresh : pool);
  }

  // Starts a round, first letting a player choose the letter if that's the mode.
  function beginRound(chosen) {
    const ids = ctx.connectedIds();
    if (ids.length < 1) return;
    const set = LETTERS[g.settings.alphabet] || LETTERS.fa;
    const hostChose = typeof chosen === 'string' && set.easy.concat(set.hard).includes(chosen);
    if (g.settings.letterMode !== 'player' || hostChose) { startRound(chosen); return; }
    g.pickerIdx = (g.pickerIdx + 1) % ids.length;
    g.picker = ids[g.pickerIdx];
    g.status = 'picking';
    g.pickEndsAt = ctx.now() + PICK_SECONDS * 1000;
    timers.set('pick', PICK_SECONDS * 1000, () => { if (g.status === 'picking') startRound(); });
    ctx.broadcast();
  }

  function startRound(chosen) {
    const ids = ctx.connectedIds();
    if (ids.length < 1) return;
    timers.clear('pick');
    g.pickEndsAt = null;
    const set = LETTERS[g.settings.alphabet] || LETTERS.fa;
    const letter = typeof chosen === 'string' && set.easy.concat(set.hard).includes(chosen) ? chosen : pickLetter();
    g.round += 1;
    g.letter = letter;
    g.usedLetters.push(letter);
    g.participants = ids;
    g.answers = Object.fromEntries(ids.map(p => [p, {}]));
    g.challenges = {};
    g.overrides = {};
    g.reviewIndex = 0;
    g.roundScores = null;
    g.stopBy = null;
    g.golden = g.settings.golden ? pick(g.settings.categories) : null;
    g.lastBonus = {};
    g.status = 'spinning';
    g.spinEndsAt = ctx.now() + SPIN_MS;
    g.endsAt = null;
    timers.set('spin', SPIN_MS, () => {
      g.status = 'writing';
      g.endsAt = ctx.now() + g.settings.seconds * 1000;
      timers.set('write', g.settings.seconds * 1000, lockAnswers);
      ctx.broadcast();
    });
    ctx.broadcast();
  }

  function lockAnswers() {
    if (g.status !== 'writing' && g.status !== 'stopping') return;
    timers.clear('write');
    timers.clear('grace');
    g.status = 'review';
    g.endsAt = null;
    g.reviewIndex = 0;
    g.lockedAt = ctx.now();
    ctx.emitAll('ef:pensDown', {});
    ctx.broadcast();
  }

  function finishReview() {
    g.roundScores = computeRound();
    // Calling STOP pays off only if every answer you rushed in holds up.
    g.lastBonus = {};
    const s = g.stopBy;
    if (g.settings.stopBonus && s && g.participants.includes(s) && g.settings.categories.every(c => judge(s, c).valid)) g.lastBonus[s] = STOP_BONUS;
    const roundTotals = {};
    for (const p of g.participants) {
      const sum = Object.values(g.roundScores[p]).reduce((a, b) => a + b, 0) + (g.lastBonus[p] || 0);
      roundTotals[p] = sum;
      g.totals[p] = (g.totals[p] || 0) + sum;
    }
    g.history.push({ letter: g.letter, scores: roundTotals, bonus: g.lastBonus });
    g.status = 'scores';
    ctx.broadcast();
  }

  function endGame() {
    timers.clearAll();
    g.status = 'final';
    g.endsAt = null;
    const ranked = standings();
    if (ranked.length && ranked[0].total > 0) ctx.finish('esmfamil', rankGroups(ranked, r => r.total));
    ctx.broadcast();
  }

  function standings() {
    const ids = Object.keys(g.totals).filter(ctx.exists);
    return ids
      .map(id => ({ id, name: ctx.name(id), total: g.totals[id] || 0 }))
      .sort((a, b) => b.total - a.total);
  }

  // ---------- payload ----------

  function progressOf(pid) {
    const a = g.answers[pid] || {};
    return g.settings.categories.filter(c => (a[c] || '').trim()).length;
  }

  function payload(role, pid) {
    const base = {
      status: g.status,
      settings: g.settings,
      round: g.round,
      letter: g.status === 'lobby' ? null : g.letter,
      spinEndsAt: g.spinEndsAt,
      endsAt: g.endsAt,
      stopBy: g.stopBy ? { id: g.stopBy, name: ctx.name(g.stopBy) } : null,
      participants: g.participants.filter(ctx.exists).map(p => ({
        id: p, name: ctx.name(p), filled: progressOf(p),
      })),
      reviewIndex: g.reviewIndex,
      standings: standings(),
      usedLetters: g.usedLetters,
      golden: g.status === 'lobby' ? null : g.golden,
      picker: g.picker && g.status === 'picking' ? { id: g.picker, name: ctx.name(g.picker) } : null,
      pickEndsAt: g.status === 'picking' ? g.pickEndsAt : null,
      lastBonus: g.lastBonus,
    };
    const inReview = g.status === 'review';
    if (inReview) {
      const cat = g.settings.categories[g.reviewIndex];
      const { verdicts, points, groups, validCount } = scoreCategory(cat);
      base.review = {
        cat,
        golden: cat === g.golden,
        // "4 people wrote Tehran" / "only Sara answered" moments for the TV
        dupes: Object.values(groups).filter(gr => gr.length > 1).map(gr => ({ text: verdicts[gr[0]].text, names: gr.filter(ctx.exists).map(ctx.name) })),
        solo: validCount === 1 ? ctx.name(g.participants.find(p => verdicts[p].valid)) : null,
        rows: g.participants.filter(ctx.exists).map(p => ({
          id: p,
          name: ctx.name(p),
          text: verdicts[p].text,
          valid: verdicts[p].valid,
          reason: verdicts[p].reason,
          challenges: verdicts[p].challengers.length,
          challengedByMe: role === 'player' && verdicts[p].challengers.includes(pid),
          override: verdicts[p].override,
          points: points[p],
        })),
      };
    }
    if (g.status === 'scores' || g.status === 'final') {
      base.roundScores = g.roundScores;
      base.lastRound = g.history[g.history.length - 1] || null;
      base.answers = g.answers; // the round is over — fine for everyone to see the full table now
    }
    if (role === 'host') {
      base.answers = g.answers;
      if (inReview || g.status === 'scores') {
        base.allVerdicts = Object.fromEntries(g.settings.categories.map(cat => {
          const { verdicts, points } = scoreCategory(cat);
          return [cat, Object.fromEntries(g.participants.map(p => [p, { text: verdicts[p].text, valid: verdicts[p].valid, reason: verdicts[p].reason, override: verdicts[p].override, challengers: verdicts[p].challengers.length, points: points[p] }]))];
        }));
      }
    }
    if (role === 'player' && pid) {
      base.mine = g.answers[pid] || null;
      base.inRound = g.participants.includes(pid);
    }
    return base;
  }

  // ---------- events ----------

  const handlers = {
    'host:esmfamil:settings': (who, patch) => {
      if (!['lobby', 'scores', 'final'].includes(g.status)) return;
      const s = g.settings;
      // Changing categories between rounds would break the score sheet still on screen.
      if (Array.isArray(patch.categories) && g.status !== 'scores') {
        const cats = CATEGORIES.filter(c => patch.categories.includes(c));
        if (cats.length >= 3) s.categories = patch.categories.filter((c, i, a) => CATEGORIES.includes(c) && a.indexOf(c) === i).slice(0, 12);
      }
      if (patch.seconds !== undefined) s.seconds = clampInt(patch.seconds, 30, 600, s.seconds);
      if (patch.stopGrace !== undefined) s.stopGrace = clampInt(patch.stopGrace, 0, 60, s.stopGrace);
      if (patch.rounds !== undefined) s.rounds = clampInt(patch.rounds, 1, 30, s.rounds);
      if (patch.alphabet === 'fa' || patch.alphabet === 'en') s.alphabet = patch.alphabet;
      if (typeof patch.hardLetters === 'boolean') s.hardLetters = patch.hardLetters;
      if (typeof patch.golden === 'boolean') s.golden = patch.golden;
      if (typeof patch.stopBonus === 'boolean') s.stopBonus = patch.stopBonus;
      if (patch.letterMode === 'random' || patch.letterMode === 'player') s.letterMode = patch.letterMode;
      ctx.broadcast();
    },
    'host:esmfamil:start': (who, { letter }) => {
      if (g.status === 'lobby' || g.status === 'final') {
        if (g.status === 'final') { const keep = g.settings; reset(); g.settings = keep; }
        beginRound(letter);
      } else if (g.status === 'scores') {
        if (g.round >= g.settings.rounds) endGame();
        else beginRound(letter);
      }
    },
    'player:esmfamil:pickLetter': ({ playerId }, { letter }) => {
      if (g.status !== 'picking' || playerId !== g.picker) return;
      const set = LETTERS[g.settings.alphabet] || LETTERS.fa;
      if (!set.easy.concat(set.hard).includes(letter)) return;
      startRound(letter);
    },
    'host:esmfamil:randomLetter': () => { if (g.status === 'picking') startRound(); },
    'host:esmfamil:forceStop': () => lockAnswers(),
    'host:esmfamil:addTime': ({}, { seconds }) => {
      if (g.status !== 'writing') return;
      const add = clampInt(seconds, 5, 120, 30) * 1000;
      g.endsAt += add;
      timers.set('write', g.endsAt - ctx.now(), lockAnswers);
      ctx.broadcast();
    },
    'player:esmfamil:answer': ({ playerId }, { cat, text }) => {
      const late = g.status === 'review' && g.reviewIndex === 0 && ctx.now() - (g.lockedAt || 0) < LATE_MS;
      if (g.status !== 'writing' && g.status !== 'stopping' && !late) return;
      if (late && !g.participants.includes(playerId)) return;
      if (!g.participants.includes(playerId)) {
        // Joined after the letter was drawn — let them play the rest of the round.
        g.participants.push(playerId);
        g.answers[playerId] = {};
      }
      if (!g.settings.categories.includes(cat)) return;
      g.answers[playerId][cat] = cleanText(text, MAX_ANSWER);
      ctx.broadcastSoon();
    },
    'player:esmfamil:stop': ({ playerId }) => {
      if (g.status !== 'writing' || !g.participants.includes(playerId)) return;
      if (progressOf(playerId) < g.settings.categories.length) return; // must have filled every box
      g.stopBy = playerId;
      timers.clear('write');
      if (g.settings.stopGrace <= 0) { lockAnswers(); return; }
      g.status = 'stopping';
      g.endsAt = ctx.now() + g.settings.stopGrace * 1000;
      timers.set('grace', g.settings.stopGrace * 1000, lockAnswers);
      ctx.emitAll('ef:stop', { name: ctx.name(playerId) });
      ctx.broadcast();
    },
    'player:esmfamil:challenge': ({ playerId }, { target }) => {
      if (g.status !== 'review' || target === playerId || !g.participants.includes(target)) return;
      if (!g.participants.includes(playerId)) return;
      const cat = g.settings.categories[g.reviewIndex];
      const k = `${target}|${cat}`;
      const list = g.challenges[k] || [];
      g.challenges[k] = list.includes(playerId) ? list.filter(v => v !== playerId) : list.concat(playerId);
      ctx.broadcast();
    },
    'host:esmfamil:judge': ({}, { target, cat, verdict }) => {
      if (g.status !== 'review' && g.status !== 'scores') return;
      if (!g.participants.includes(target) || !g.settings.categories.includes(cat)) return;
      const k = `${target}|${cat}`;
      if (verdict === 'accept' || verdict === 'reject') g.overrides[k] = verdict;
      else delete g.overrides[k];
      if (g.status === 'scores') {
        // Correcting a call after the round was scored: re-score it in place.
        const last = g.history[g.history.length - 1];
        for (const p of g.participants) g.totals[p] = (g.totals[p] || 0) - (last.scores[p] || 0);
        g.history.pop();
        finishReview();
        return;
      }
      ctx.broadcast();
    },
    'host:esmfamil:reviewNav': ({}, { dir }) => {
      if (g.status !== 'review') return;
      const next = g.reviewIndex + (dir < 0 ? -1 : 1);
      if (next < 0) return;
      if (next >= g.settings.categories.length) { finishReview(); return; }
      g.reviewIndex = next;
      ctx.broadcast();
    },
    'host:esmfamil:end': () => { if (g.status !== 'lobby') endGame(); },
    'host:esmfamil:newGame': () => { const keep = g.settings; reset(); g.settings = keep; ctx.broadcast(); },
  };

  return {
    id: 'esmfamil',
    reset: () => { const keep = g && g.settings; reset(); if (keep) g.settings = keep; g.settings.alphabet = ctx.lang(); },
    leave: () => timers.clearAll(),
    payload,
    handlers,
    onPlayerRemoved: (pid) => {
      g.participants = g.participants.filter(p => p !== pid);
      delete g.answers[pid];
      delete g.totals[pid];
    },
    _debug: () => g,
  };
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.LETTERS = LETTERS;

// The expanded games: night points, Surprise me, Esm-Famil golden/STOP bonus/letter
// picking, Gol ya Pooch shot clock/streak/awards, Pantomime choice/written words/MVP,
// Most Likely rather/never/custom questions, Mafia trial/jester/bulletproof, Spy early guess.
// Needs a fresh test server (npm test).
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(40); } console.log('    (timeout)', fn.toString().slice(0, 90)); return false; }
function mk(role, o = {}) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.events = [];
  s.on('arcade', p => { s.last = p; });
  s.onAny((ev, d) => { if (ev !== 'arcade') s.events.push([ev, d]); });
  s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: 'arcade' }));
  return s;
}
const G = (s) => s.last && s.last.game;

(async () => {
  const host = mk('host');
  const P = ['Ali', 'Bita', 'Cyrus', 'Dara'].map((n, i) => mk('player', { id: 'e' + i, name: n }));
  const byId = Object.fromEntries(P.map((s, i) => ['e' + i, s]));
  await until(() => host.last && host.last.players.filter(p => p.connected).length === 4);
  const select = async (game) => { host.emit('host:hub:select', { game }); await until(() => host.last.activeGame === game); };

  console.log('\n# Esm-Famil: player picks the letter, golden category, STOP bonus, moments');
  await select('esmfamil');
  host.emit('host:esmfamil:settings', { categories: ['name', 'city', 'food'], alphabet: 'en', stopGrace: 0, rounds: 1, letterMode: 'player', golden: true, stopBonus: true });
  await until(() => G(host).settings.letterMode === 'player');
  host.emit('host:esmfamil:start');
  await until(() => G(host).status === 'picking');
  const picker = G(host).picker.id;
  ok(G(host).status === 'picking' && !!G(host).pickEndsAt, `a player (${G(host).picker.name}) is choosing the letter`);
  const notPicker = P.find(s => s.last.me.id !== picker);
  notPicker.emit('player:esmfamil:pickLetter', { letter: 'M' });
  await sleep(200);
  ok(G(host).status === 'picking', 'only the picker can choose');
  byId[picker].emit('player:esmfamil:pickLetter', { letter: 'B' });
  await until(() => G(host).status === 'spinning');
  ok(G(host).letter === 'B', 'the chosen letter is used');
  ok(['name', 'city', 'food'].includes(G(host).golden), `golden category picked (${G(host).golden})`);
  await until(() => G(host).status === 'writing', 8000);
  const golden = G(host).golden;
  const ans = { e0: ['Bob', 'Berlin', 'Bread'], e1: ['Bob', 'Bonn', 'Burger'], e2: ['Bill', 'Bath', ''], e3: ['Ben', 'Basel', 'Banana'] };
  const cats = ['name', 'city', 'food'];
  for (const [pid, a] of Object.entries(ans)) a.forEach((t, i) => t && byId[pid].emit('player:esmfamil:answer', { cat: cats[i], text: t }));
  await until(() => G(host).participants.filter(p => p.filled === 3).length === 3);
  byId.e0.emit('player:esmfamil:stop');
  await until(() => G(host).status === 'review');
  ok(G(host).review.dupes.length === 1 && G(host).review.dupes[0].names.length === 2, '"2 people wrote Bob" moment on the name category');
  for (let i = 0; i < 3; i++) { host.emit('host:esmfamil:reviewNav', { dir: 1 }); await sleep(120); }
  await until(() => G(host).status === 'scores');
  const rs = G(host).roundScores;
  const base = { name: { e0: 5, e1: 5, e2: 10, e3: 10 }, city: { e0: 10, e1: 10, e2: 10, e3: 10 }, food: { e0: 10, e1: 10, e2: 0, e3: 10 } };
  ok(['e0', 'e1', 'e2', 'e3'].every(p => rs[p][golden] === base[golden][p] * 2), `the golden category (${golden}) scored double`);
  ok(G(host).lastBonus.e0 === 5, 'Ali called STOP with every answer valid → +5');
  const tot = Object.fromEntries(G(host).standings.map(r => [r.id, r.total]));
  const expectE0 = cats.reduce((a, c) => a + base[c].e0 * (c === golden ? 2 : 1), 0) + 5;
  ok(tot.e0 === expectE0, `round total includes the bonus (${tot.e0} = ${expectE0})`);
  host.emit('host:esmfamil:judge', { target: 'e0', cat: 'city', verdict: 'reject' });
  await until(() => !G(host).lastBonus.e0);
  ok(!G(host).lastBonus.e0, 'rejecting one of the STOP-caller\'s answers takes the bonus away');
  host.emit('host:esmfamil:start');
  await until(() => G(host).status === 'final');
  ok(host.last.hub.night.length >= 3 && host.last.hub.night[0].points === 3, 'night points: 1st place got 3');
  ok(host.last.hub.night.some(r => r.points === 2) && host.last.hub.night.some(r => r.points === 1), '... 2nd got 2, 3rd got 1');

  console.log('\n# Gol ya Pooch: hiding shot clock, streak, awards');
  await select('golpooch');
  host.emit('host:golpooch:settings', { target: 4, hideSeconds: 2 });
  await until(() => G(host).settings.hideSeconds === 2);
  host.emit('host:golpooch:start');
  await until(() => G(host).status === 'hiding');
  ok(G(host).hideEndsAt > Date.now(), 'hiding has a shot clock');
  await until(() => G(host).status === 'guessing', 4000);
  ok(G(host).status === 'guessing' && !!G(host).secretGol, 'time ran out → the flower went to a random hand');
  // let the hiders win three rounds in a row: the guesser calls Gol on an empty hand
  for (let r = 0; r < 3; r++) {
    await until(() => G(host).status === 'guessing', 5000);
    const gol = G(host).secretGol;
    const empty = G(host).hands.find(h => !(h.pid === gol.pid && h.hand === gol.hand));
    byId[G(host).guesser.id].emit('player:golpooch:pick', { key: empty.key, call: 'gol' });
    await until(() => G(host).status === 'reveal' || G(host).status === 'final', 4000);
    if (r < 2) { host.emit('host:golpooch:next'); await until(() => G(host).status === 'hiding'); }
  }
  ok(G(host).streak && G(host).streak.count === 3, 'three in a row → streak banner');
  host.emit('host:golpooch:next');
  await until(() => G(host).status === 'guessing', 5000);
  const gol = G(host).secretGol;
  const empty = G(host).hands.find(h => !(h.pid === gol.pid && h.hand === gol.hand));
  byId[G(host).guesser.id].emit('player:golpooch:pick', { key: empty.key, call: 'pooch' });
  await sleep(2200);
  await until(() => G(host).status === 'guessing' || G(host).status === 'reveal' || G(host).status === 'final', 4000);
  if (G(host).status === 'guessing') { byId[G(host).guesser.id].emit('player:golpooch:pick', { key: `${gol.pid}:${gol.hand}`, call: 'pooch' }); }
  await until(() => G(host).status === 'final', 9000);
  ok(G(host).status === 'final', 'game reaches the target');
  ok(G(host).awards.some(a => a.key === 'poker') && G(host).awards.some(a => a.key === 'sweep'), `awards at the end (${G(host).awards.map(a => a.key)})`);

  console.log('\n# Pantomime: easy/hard choice, words written by the rivals, MVP');
  await select('pantomime');
  host.emit('host:pantomime:settings', { seconds: 60, turns: 1, skips: 2, choice: true, customWords: true });
  await until(() => G(host).settings.choice === true);
  const teams = G(host).teams;
  const teamOf = (pid) => teams.find(t => t.members.some(m => m.id === pid)).id;
  for (const s of P) s.emit('player:pantomime:addWord', { text: `Secret of ${s.last.me.name}` });
  await until(() => G(host).customCount === 4);
  ok(G(P[0]).myWords.length === 1 && G(host).myWords === undefined, 'each phone sees only its own written words');
  host.emit('host:pantomime:start');
  await until(() => G(host).status === 'ready');
  const actorId = G(host).actor.id;
  const actingTeam = G(host).team;
  host.emit('host:pantomime:go');
  await until(() => G(host).status === 'acting');
  const offer = G(byId[actorId]).offer;
  ok(offer && offer.length === 2 && offer[0].points === 1 && offer[1].points === 2, 'the actor gets an easy (1) and a hard (2) word');
  ok(offer[1].cat === 'custom' && offer[1].by && teamOf(P.find(s => s.last.me.name === offer[1].by).last.me.id) !== actingTeam, `the hard card is a word a rival wrote (${offer[1].text})`);
  ok(G(host).word === null && G(host).choosing, 'the TV shows "choosing" — no word yet');
  host.emit('host:pantomime:correct');
  await sleep(200);
  ok(G(host).scores[actingTeam] === 0, 'can\'t score before choosing');
  byId[actorId].emit('player:pantomime:choose', { index: 1 });
  await until(() => G(host).word);
  ok(G(host).wordPoints === 2 && G(host).wordBy, 'chose the hard one: worth 2, TV credits who wrote it');
  await sleep(700);
  byId[actorId].emit('player:pantomime:correct');
  await until(() => G(host).scores[actingTeam] === 2);
  ok(G(host).scores[actingTeam] === 2, 'got it → +2');
  host.emit('host:pantomime:endTurn');
  await until(() => G(host).status === 'turnEnd');
  host.emit('host:pantomime:next');
  await until(() => G(host).status === 'ready');
  host.emit('host:pantomime:go');
  await until(() => G(host).status === 'acting');
  host.emit('host:pantomime:endTurn');
  await until(() => G(host).status === 'turnEnd');
  host.emit('host:pantomime:next');
  await until(() => G(host).status === 'final');
  ok(G(host).mvp && G(host).mvp.id === actorId && G(host).mvp.points === 2, 'MVP: best single turn');

  console.log('\n# Who\'s Most Likely: would you rather, never have I ever, own questions');
  await select('mostlikely');
  P[1].emit('player:mostlikely:addQuestion', { text: 'Who is most likely to adopt a llama' });
  await until(() => G(host).customCount === 1);
  host.emit('host:mostlikely:settings', { rounds: 4, autoNext: 0, mode: 'mix' });
  await until(() => G(host).settings.mode === 'mix' && G(host).settings.rounds === 4);
  host.emit('host:mostlikely:start');
  await until(() => G(host).status === 'question');
  ok(G(host).kind === 'likely' && G(host).prompt === 'Who is most likely to adopt a llama?' && G(host).by === 'Bita', 'a player\'s own question comes first (with a ? added and their name)');
  P.forEach((s, i) => s.emit('player:mostlikely:vote', { target: i === 0 ? 'e1' : 'e0' }));
  await until(() => G(host).status === 'reveal');
  host.emit('host:mostlikely:next');
  await until(() => G(host).status === 'question' && G(host).round === 2);
  ok(G(host).kind === 'rather' && Array.isArray(G(host).prompt) && G(host).prompt.length === 2, 'round 2 is "would you rather"');
  P[0].emit('player:mostlikely:vote', { target: 'e1' });
  await sleep(150);
  ok(!G(host).voted.includes('e0'), 'a player id is not a valid answer to "would you rather"');
  const before = Object.fromEntries(G(host).standings.map(r => [r.id, r.points]));
  ['a', 'a', 'a', 'b'].forEach((v, i) => P[i].emit('player:mostlikely:vote', { target: v }));
  await until(() => G(host).status === 'reveal');
  const after = Object.fromEntries(G(host).standings.map(r => [r.id, r.points]));
  ok((after.e0 || 0) - (before.e0 || 0) === 1 && (after.e3 || 0) - (before.e3 || 0) === 0, 'majority side +1, minority nothing');
  host.emit('host:mostlikely:next');
  await until(() => G(host).round === 3 && G(host).status === 'question');
  host.emit('host:mostlikely:next'); // (no-op while a question is up)
  P.forEach((s, i) => s.emit('player:mostlikely:vote', { target: i === 0 ? 'e2' : 'e0' }));
  await until(() => G(host).status === 'reveal');
  host.emit('host:mostlikely:next');
  await until(() => G(host).round === 4 && G(host).status === 'question');
  ok(G(host).kind === 'never', 'round 4 is "never have I ever"');
  ['yes', 'no', 'no', 'no'].forEach((v, i) => P[i].emit('player:mostlikely:vote', { target: v }));
  await until(() => G(host).status === 'reveal');
  ok((G(host).result.byTarget.yes || []).length === 1, 'reveal: only Ali has');
  host.emit('host:mostlikely:next');
  await until(() => G(host).status === 'final');
  ok(G(host).standings.find(r => r.id === 'e0').confessions.length === 1, 'confession recorded for the final screen');

  console.log('\n# Mafia: defense + guilty/innocent, jester, bulletproof');
  const extra = ['Elham', 'Farid'].map((n, i) => mk('player', { id: 'm' + i, name: n }));
  const all = [...P, ...extra];
  const sock = Object.fromEntries(all.map(s => [s.last ? s.last.me && s.last.me.id : null, s]));
  await until(() => host.last.players.filter(p => p.connected).length === 6);
  for (const s of extra) sock[s.last.me.id] = s;
  await select('mafia');
  host.emit('host:mafia:settings', { introNight: true, nightSeconds: 0, daySeconds: 0, voteSeconds: 0, defenseSeconds: 0, lastWords: 5, jester: true, bulletproof: true, detective: false, sniper: false, defense: true });
  await until(() => G(host).settings.jester === true && G(host).settings.lastWords === 5);
  host.emit('host:mafia:start');
  await until(() => G(host).status === 'roles');
  const roles = Object.fromEntries(G(host).players.map(p => [p.id, p.role]));
  const who = (r) => Object.keys(roles).find(k => roles[k] === r);
  ok(who('jester') && who('bulletproof'), `jester + bulletproof dealt (${JSON.stringify(roles)})`);
  host.emit('host:mafia:advance'); // intro night → day 1
  await until(() => G(host).status === 'day');
  host.emit('host:mafia:advance'); // → vote
  await until(() => G(host).status === 'vote');
  const citizen = who('citizen') || who('doctor');
  const mafiaId = who('mafia');
  Object.keys(roles).forEach(pid => sock[pid].emit('player:mafia:vote', { target: pid === citizen ? mafiaId : citizen }));
  await until(() => G(host).status === 'defense', 4000);
  ok(G(host).status === 'defense' && G(host).accused.id === citizen, 'most-voted player goes on trial');
  host.emit('host:mafia:advance');
  await until(() => G(host).status === 'judgment');
  sock[citizen].emit('player:mafia:judge', { verdict: 'guilty' });
  await sleep(150);
  ok(G(host).judgedCount === 0, 'the accused can\'t vote on their own trial');
  Object.keys(roles).filter(p => p !== citizen).forEach((pid, i) => sock[pid].emit('player:mafia:judge', { verdict: i < 3 ? 'innocent' : 'guilty' }));
  await until(() => G(host).status === 'verdict', 4000);
  ok(G(host).verdict.spared === citizen && !G(host).verdict.out, 'more innocent than guilty → spared');
  host.emit('host:mafia:advance'); // night 1
  await until(() => G(host).status === 'night');
  const bp = who('bulletproof');
  for (const pid of Object.keys(roles)) {
    const r = roles[pid];
    const target = r === 'mafia' ? bp : r === 'doctor' ? pid : Object.keys(roles).find(k => k !== pid);
    sock[pid].emit('player:mafia:night', { target });
  }
  await until(() => G(host).status === 'dawn', 4000);
  ok(G(host).dawn.shielded && G(host).players.find(p => p.id === bp).alive, 'mafia shot the bulletproof player → survived');
  host.emit('host:mafia:advance');
  await until(() => G(host).status === 'day');
  host.emit('host:mafia:advance');
  await until(() => G(host).status === 'vote');
  const jester = who('jester');
  Object.keys(roles).forEach(pid => sock[pid].emit('player:mafia:vote', { target: pid === jester ? citizen : jester }));
  await until(() => G(host).status === 'defense', 4000);
  host.emit('host:mafia:advance');
  await until(() => G(host).status === 'judgment');
  Object.keys(roles).filter(p => p !== jester).forEach(pid => sock[pid].emit('player:mafia:judge', { verdict: 'guilty' }));
  await until(() => G(host).status === 'verdict', 4000);
  ok(G(host).verdict.out === jester && G(host).verdict.lastWordsEndsAt > Date.now(), 'jester voted out, with last words');
  await until(() => G(host).status === 'end', 12000);
  ok(G(host).winner === 'jester', 'voting out the jester → the jester wins');
  ok(host.last.hub.trophies[0].game === 'mafia' && host.last.hub.trophies[0].names.length === 1, 'trophy goes to the jester alone');

  console.log('\n# Spy: early guess, cities');
  await select('spy');
  host.emit('host:spy:settings', { rounds: 2, minutes: 3, categories: ['city'] });
  await until(() => G(host).settings.categories.join() === 'city');
  host.emit('host:spy:start');
  await until(() => G(host).status === 'cards');
  ok(G(host).cat === 'city' && G(host).order.length === 6, 'city board + an asking order for everyone');
  host.emit('host:spy:talk');
  await until(() => G(host).status === 'talk');
  const spyId = G(host).spies[0].id;
  const agent = Object.keys(sock).find(k => k !== spyId && k !== 'null' && sock[k]);
  sock[agent].emit('player:spy:earlyGuess');
  await sleep(200);
  ok(G(host).status === 'talk', 'only the spy can call it early');
  sock[spyId].emit('player:spy:earlyGuess');
  await until(() => G(host).status === 'guess');
  ok(G(host).early && G(host).accused.id === spyId, 'spy calls it early');
  sock[spyId].emit('player:spy:guess', { word: G(host).secretWord });
  await until(() => G(host).status === 'result');
  ok(G(host).outcome === 'earlyRight' && G(host).standings.find(r => r.id === spyId).points === 3, 'right → spy +3');
  host.emit('host:spy:next');
  await until(() => G(host).status === 'cards');
  host.emit('host:spy:talk');
  await until(() => G(host).status === 'talk');
  const spy2 = G(host).spies[0].id;
  sock[spy2].emit('player:spy:earlyGuess');
  await until(() => G(host).status === 'guess');
  sock[spy2].emit('player:spy:guess', { word: G(host).board.find(w => w !== G(host).secretWord) });
  await until(() => G(host).status === 'result');
  ok(G(host).outcome === 'earlyWrong', 'wrong → everyone else scores');

  console.log('\n# Hub: Surprise me');
  await select('hub');
  for (const s of all) s.emit('player:hub:vote', { game: 'golpooch' });
  await until(() => Object.keys(host.last.hub.votes).length === 6);
  host.emit('host:hub:surprise');
  await until(() => host.last.hub.spin);
  ok(host.last.hub.spin.game === 'golpooch', 'everyone voted Gol ya Pooch → the wheel lands there');
  await until(() => host.last.activeGame === 'golpooch', 9000);
  ok(host.last.activeGame === 'golpooch', 'and it launches by itself');
  ok(host.last.hub.night.length >= 4, `night leaderboard has everyone who placed (${host.last.hub.night.map(r => r.name + ':' + r.points).join(', ')})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

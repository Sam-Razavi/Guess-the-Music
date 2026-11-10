// End-to-end socket tests for the game hub + every party game, against the
// fresh test server (npm test -- hub).
const { io } = require('socket.io-client');
const URL = process.env.TEST_URL || 'http://localhost:3999';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(role, opts = {}) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.last = null; s.music = null; s.events = [];
  s.on('arcade', (p) => { s.last = p; });
  s.on('state', (p) => { s.music = p; });
  s.onAny((ev, d) => { if (ev !== 'arcade' && ev !== 'state') s.events.push([ev, d]); });
  s.on('connect', () => s.emit('register', { role, id: opts.id, name: opts.name, view: opts.view || 'arcade' }));
  return s;
}
async function until(fn, ms = 4000, label = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await sleep(40); }
  console.log('    (timeout waiting for', label || fn.toString().slice(0, 90), ')');
  return false;
}
const G = (s) => s.last && s.last.game;

(async () => {
  const tv = client('tv');
  const host = client('host');
  const musicTv = client('tv', { view: 'music' });
  const names = ['Sohrab', 'Mina', 'فریبا', 'Misagh', 'Reza', 'Ana'];
  const P = names.map((n, i) => client('player', { id: `p${i + 1}`, name: n }));
  await until(() => P.every(p => p.last) && tv.last && host.last && musicTv.music, 5000, 'registration');

  console.log('\n# Hub');
  ok(tv.last.activeGame === 'hub', 'fresh instance starts on the hub menu');
  ok(musicTv.music.activeGame === 'hub', 'music-page sockets also learn activeGame (so they can redirect)');
  // the TV's latest update can be a beat behind the sixth phone registering
  await until(() => tv.last.players.length === 6, 3000, 'tv roster');
  ok(tv.last.players.length === 6, 'roster shared with arcade pages (6 players)');
  ok(host.music === null, 'arcade host does not get the big music payload');
  P[0].emit('player:hub:vote', { game: 'esmfamil' });
  P[1].emit('player:hub:vote', { game: 'esmfamil' });
  P[2].emit('player:hub:vote', { game: 'mafia' });
  await until(() => Object.keys(tv.last.hub.votes).length === 3);
  ok(tv.last.hub.votes.p1 === 'esmfamil' && tv.last.hub.votes.p3 === 'mafia', 'votes visible on TV');
  P[0].emit('player:hub:vote', { game: 'esmfamil' });
  await until(() => !tv.last.hub.votes.p1);
  ok(!tv.last.hub.votes.p1, 'voting the same game again removes the vote');
  P[0].emit('host:hub:select', { game: 'mafia' });
  await sleep(300);
  ok(tv.last.activeGame === 'hub', 'a player cannot switch the game (role gate)');
  host.emit('host:hub:select', { game: 'nope' });
  await sleep(200);
  ok(tv.last.activeGame === 'hub', 'unknown game id ignored');

  // ---------------- Esm-Famil ----------------
  console.log('\n# Esm-Famil');
  host.emit('host:hub:select', { game: 'esmfamil' });
  await until(() => tv.last.activeGame === 'esmfamil' && musicTv.music.activeGame === 'esmfamil');
  ok(tv.last.activeGame === 'esmfamil' && musicTv.music.activeGame === 'esmfamil', 'switch reaches arcade and music pages');
  ok(Object.keys(tv.last.hub.votes).length === 0, 'votes cleared on switch');
  // Only 3 players for this game: disconnect the other three for now.
  const [a, b, c] = P;
  P.slice(3).forEach(p => p.disconnect());
  await until(() => tv.last.players.filter(p => p.connected).length === 3);
  host.emit('host:esmfamil:settings', { categories: ['name', 'city', 'food'], seconds: 30, stopGrace: 2, rounds: 1, alphabet: 'fa', golden: false, stopBonus: false });
  await until(() => G(tv).settings.categories.length === 3 && G(tv).settings.stopGrace === 2);
  ok(G(tv).settings.categories.join() === 'name,city,food', 'settings applied');
  host.emit('host:esmfamil:settings', { categories: ['name', 'bogus'] });
  await sleep(200);
  ok(G(tv).settings.categories.length === 3, 'fewer than 3 valid categories rejected');
  host.emit('host:esmfamil:start', { letter: 'ب' });
  await until(() => G(tv).status === 'spinning');
  ok(G(tv).status === 'spinning' && G(tv).letter === 'ب', 'round starts spinning on the chosen letter');
  await until(() => G(tv).status === 'writing', 6000);
  ok(G(tv).status === 'writing' && G(tv).endsAt > Date.now(), 'writing phase with a deadline');
  const ans = (s, cat, text) => s.emit('player:esmfamil:answer', { cat, text });
  ans(a, 'name', 'بهرام'); ans(a, 'city', 'بابل'); ans(a, 'food', 'باقالی‌پلو');
  ans(b, 'name', ' بهرام '); ans(b, 'city', 'بوشهر');
  ans(c, 'name', 'سارا'); ans(c, 'city', 'بم'); ans(c, 'food', 'بستنی');
  await until(() => G(tv).participants.find(p => p.id === 'p1').filled === 3 && G(tv).participants.find(p => p.id === 'p2').filled === 2);
  ok(G(tv).participants.find(p => p.id === 'p2').filled === 2, 'TV sees progress counts');
  ok(!G(tv).answers, 'TV does not see answer text while writing');
  b.emit('player:esmfamil:stop');
  await sleep(250);
  ok(G(tv).status === 'writing', 'STOP refused until every box is filled');
  a.emit('player:esmfamil:stop');
  await until(() => G(tv).status === 'stopping');
  ok(G(tv).status === 'stopping' && G(tv).stopBy.id === 'p1', 'STOP by Sohrab → grace period');
  ok(b.events.some(e => e[0] === 'ef:stop'), 'phones get the ef:stop event');
  ans(b, 'food', ''); // still allowed during the grace period
  await until(() => G(tv).status === 'review', 4000);
  ok(G(tv).status === 'review' && G(tv).review.cat === 'name', 'pens down → review starts with the first category');
  let rows = Object.fromEntries(G(tv).review.rows.map(r => [r.id, r]));
  ok(rows.p1.points === 5 && rows.p2.points === 5, 'same answer (despite spaces) = 5 each');
  ok(!rows.p3.valid && rows.p3.reason === 'letter', 'wrong first letter = invalid');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(tv).review.cat === 'city');
  c.emit('player:esmfamil:challenge', { target: 'p2' });
  await until(() => G(tv).review.rows.find(r => r.id === 'p2').challenges === 1);
  ok(G(tv).review.rows.find(r => r.id === 'p2').valid, 'one objection alone does not reject an answer');
  a.emit('player:esmfamil:challenge', { target: 'p2' });
  await until(() => G(tv).review.rows.find(r => r.id === 'p2').challenges === 2);
  rows = Object.fromEntries(G(tv).review.rows.map(r => [r.id, r]));
  ok(!rows.p2.valid && rows.p2.reason === 'voted', 'both other players thumbs-down → rejected');
  ok(rows.p1.points === 10 && rows.p3.points === 10, 'others now unique = 10');
  ok(G(c).review.rows.find(r => r.id === 'p2').challengedByMe, 'challenger sees their own vote');
  c.emit('player:esmfamil:challenge', { target: 'p3' });
  await sleep(200);
  ok(G(tv).review.rows.find(r => r.id === 'p3').challenges === 0, 'cannot challenge your own answer');
  host.emit('host:esmfamil:judge', { target: 'p2', cat: 'city', verdict: 'accept' });
  await until(() => G(tv).review.rows.find(r => r.id === 'p2').valid);
  ok(G(tv).review.rows.find(r => r.id === 'p2').valid, 'host accept overrides the vote');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(tv).review.cat === 'food');
  rows = Object.fromEntries(G(tv).review.rows.map(r => [r.id, r]));
  ok(rows.p1.points === 10 && rows.p3.points === 10 && rows.p2.reason === 'empty', 'food: two unique, one empty');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(tv).status === 'scores');
  const tot = Object.fromEntries(G(tv).standings.map(r => [r.id, r.total]));
  ok(tot.p1 === 25 && tot.p2 === 15 && tot.p3 === 20, `totals 25/15/20 (got ${tot.p1}/${tot.p2}/${tot.p3})`);
  ok(G(tv).answers && G(tv).answers.p1.city === 'بابل', 'full answer table visible after scoring');
  host.emit('host:esmfamil:judge', { target: 'p3', cat: 'city', verdict: 'reject' });
  await until(() => G(tv).standings.find(r => r.id === 'p3').total === 10);
  ok(G(tv).standings.find(r => r.id === 'p3').total === 10, 'fixing a call after scoring re-scores the round');
  host.emit('host:esmfamil:start');
  await until(() => G(tv).status === 'final');
  ok(G(tv).status === 'final', 'last round → final');
  ok(tv.last.hub.trophies[0] && tv.last.hub.trophies[0].game === 'esmfamil' && tv.last.hub.trophies[0].names[0] === 'Sohrab', 'trophy recorded for the winner');

  // reconnect the rest
  const P2 = names.slice(3).map((n, i) => client('player', { id: `p${i + 4}`, name: n }));
  const ALL = [a, b, c, ...P2];
  await until(() => tv.last.players.filter(p => p.connected).length === 6);

  // ---------------- Gol ya Pooch ----------------
  console.log('\n# Gol ya Pooch');
  host.emit('host:hub:select', { game: 'golpooch' });
  await until(() => tv.last.activeGame === 'golpooch');
  ok(G(tv).teams.every(t => t.members.length === 3), 'teams auto-split 3/3');
  // Teams are random, so move p1 to whichever team they're NOT on, then back.
  const home = G(tv).teams.find(t => t.members.some(m => m.id === 'p1')).id;
  const away = home === 'red' ? 'blue' : 'red';
  host.emit('host:golpooch:move', { id: 'p1', team: away });
  await until(() => G(tv).teams.find(t => t.id === away).members.length === 4);
  ok(G(tv).teams.find(t => t.id === away).members.some(m => m.id === 'p1'), 'host can move a player');
  host.emit('host:golpooch:move', { id: 'p1', team: home });
  await until(() => G(tv).teams.every(t => t.members.length === 3));
  host.emit('host:golpooch:settings', { target: 2 });
  host.emit('host:golpooch:start');
  await until(() => G(tv).status === 'hiding');
  const byId = Object.fromEntries(ALL.map(s => [s.last.me.id, s]));
  let g = G(tv);
  ok(g.status === 'hiding' && g.hands.length === 6, 'hiding team holds out 6 hands');
  const hider = byId[g.hider.id];
  const guesser = byId[g.guesser.id];
  const hidingTeam = g.hidingTeam;
  const target = g.hands[2];
  hider.emit('player:golpooch:hide', { key: target.key });
  await until(() => G(tv).status === 'guessing');
  ok(G(tv).status === 'guessing' && G(tv).gol === null, 'hidden: TV does not know where');
  const holder = byId[target.pid];
  ok(G(holder).gol && G(holder).gol.hand === target.hand, 'the holder\'s phone knows the hand');
  ok(holder.events.some(e => e[0] === 'gp:holding'), 'holder got the private buzz');
  const outsider = ALL.find(s => s !== holder && s !== hider && G(s).myTeam !== hidingTeam);
  ok(!G(outsider).gol, 'the other team cannot see it');
  const empty = G(tv).hands.find(h => h.key !== target.key);
  guesser.emit('player:golpooch:pick', { key: empty.key, call: 'pooch' });
  await until(() => G(tv).pending);
  ok(!!G(tv).pending, 'pick enters the suspense phase');
  guesser.emit('player:golpooch:pick', { key: target.key, call: 'gol' });
  await until(() => !G(tv).pending && G(tv).hands.find(h => h.key === empty.key).open === 'empty', 3000);
  ok(G(tv).hands.find(h => h.key === empty.key).open === 'empty', 'pooch on an empty hand opens it');
  ok(G(tv).status === 'guessing', 'picks during suspense are ignored, round continues');
  guesser.emit('player:golpooch:pick', { key: target.key, call: 'gol' });
  await until(() => G(tv).status === 'reveal', 3000);
  g = G(tv);
  ok(g.result.reason === 'found' && g.result.winner !== hidingTeam, 'Gol! on the flower → guessers win the round');
  ok(g.gol && g.gol.pid === target.pid, 'flower revealed to everyone after the round');
  host.emit('host:golpooch:next');
  await until(() => G(tv).status === 'hiding' && G(tv).round === 2);
  ok(G(tv).hidingTeam !== hidingTeam, 'the finders now hide the flower');
  // round 2: hide, then bullseye (first pick, gol)
  g = G(tv);
  byId[g.hider.id].emit('player:golpooch:hide', { key: g.hands[0].key });
  await until(() => G(tv).status === 'guessing');
  byId[g.guesser.id].emit('player:golpooch:pick', { key: g.hands[0].key, call: 'gol' });
  await until(() => G(tv).status === 'reveal' || G(tv).status === 'final', 3000);
  ok(G(tv).result.reason === 'bullseye' && G(tv).result.points === 2, 'first-pick Gol = bullseye +2');
  await until(() => G(tv).status === 'final', 5000);
  ok(G(tv).status === 'final' && G(tv).scores[G(tv).winner] >= 2, 'reaching the target ends the game');

  // ---------------- Pantomime ----------------
  console.log('\n# Pantomime');
  host.emit('host:hub:select', { game: 'pantomime' });
  await until(() => tv.last.activeGame === 'pantomime');
  host.emit('host:pantomime:settings', { seconds: 20, turns: 1, skips: 1, choice: false, categories: ['animal', 'object'] });
  await until(() => G(tv).settings.seconds === 20);
  host.emit('host:pantomime:start');
  await until(() => G(tv).status === 'ready');
  g = G(tv);
  const actor = byId[g.actor.id];
  ok(!!g.actor && g.team, 'first team + actor chosen');
  const stranger = ALL.find(s => s !== actor);
  stranger.emit('player:pantomime:go');
  await sleep(200);
  ok(G(tv).status === 'ready', 'only the actor can start');
  actor.emit('player:pantomime:go');
  await until(() => G(tv).status === 'acting');
  ok(!!G(actor).word && G(tv).word === null, 'actor sees the word, TV does not');
  const teammate = ALL.find(s => s !== actor && G(s).myTeam === g.team);
  const rival = ALL.find(s => G(s).myTeam && G(s).myTeam !== g.team);
  ok(teammate && G(teammate).word === null, 'actor\'s own team does not see it');
  ok(rival && G(rival).word === G(actor).word, 'the other team sees it');
  ok(G(tv).wordCount >= 1 && G(tv).wordCat, 'TV gets category + word count');
  const w1 = G(actor).word;
  await sleep(700);
  actor.emit('player:pantomime:correct');
  actor.emit('player:pantomime:correct'); // double tap
  await until(() => G(tv).correctThisTurn === 1);
  await sleep(300);
  ok(G(tv).correctThisTurn === 1, 'double tap only counts once');
  ok(G(actor).word !== w1, 'next word drawn');
  await sleep(700);
  actor.emit('player:pantomime:skip');
  await until(() => G(tv).skipsLeft === 0);
  await sleep(700);
  actor.emit('player:pantomime:skip');
  await sleep(250);
  ok(G(tv).turnLog.filter(w => w.result === 'skip').length === 1, 'skip limit respected');
  ok(G(tv).turnLog.every(w => w.text === undefined), 'TV turn log hides words during the turn');
  host.emit('host:pantomime:endTurn');
  await until(() => G(tv).status === 'turnEnd');
  ok(G(tv).turnLog.length === 3 && G(tv).turnLog[0].text === w1, 'turn end reveals the words');
  ok(G(tv).scores[g.team] === 1, 'team scored 1');
  actor.emit('player:pantomime:next');
  await until(() => G(tv).status === 'ready' && G(tv).team !== g.team);
  ok(G(tv).team !== g.team, 'next team up');
  host.emit('host:pantomime:go');
  await until(() => G(tv).status === 'acting');
  host.emit('host:pantomime:endTurn');
  await until(() => G(tv).status === 'turnEnd');
  host.emit('host:pantomime:next');
  await until(() => G(tv).status === 'final');
  ok(G(tv).status === 'final', 'all turns played → final');

  // ---------------- Most Likely ----------------
  console.log('\n# Who\'s Most Likely');
  host.emit('host:hub:select', { game: 'mostlikely' });
  await until(() => tv.last.activeGame === 'mostlikely');
  host.emit('host:mostlikely:settings', { rounds: 1, seconds: 20, autoNext: 0, mode: 'likely' });
  await until(() => G(tv).settings.rounds === 1 && G(tv).settings.autoNext === 0);
  host.emit('host:mostlikely:start');
  await until(() => G(tv).status === 'question');
  ok(!!G(tv).prompt, 'a prompt is up');
  a.emit('player:mostlikely:vote', { target: 'p1' });
  await sleep(200);
  ok(!G(a).myVote, 'self-vote refused by default');
  const votes = { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p2', p5: 'p1', p6: 'p2' };
  for (const s of ALL) s.emit('player:mostlikely:vote', { target: votes[s.last.me.id] });
  await until(() => G(tv).status === 'reveal', 3000);
  ok(G(tv).status === 'reveal', 'everyone voted → auto reveal');
  ok(G(tv).result.winners.length === 1 && G(tv).result.winners[0].id === 'p2', 'Mina wins the title (4 votes)');
  const pts = Object.fromEntries(G(tv).standings.map(r => [r.id, r.points]));
  ok(pts.p1 === 1 && pts.p3 === 1 && !pts.p2, 'voters with the crowd get +1');
  host.emit('host:mostlikely:next');
  await until(() => G(tv).status === 'final');
  ok(G(tv).standings.find(r => r.id === 'p2').titles.length === 1, 'title collected');

  // ---------------- Mafia ----------------
  console.log('\n# Mafia');
  host.emit('host:hub:select', { game: 'mafia' });
  await until(() => tv.last.activeGame === 'mafia');
  host.emit('host:mafia:settings', { introNight: false, nightSeconds: 0, daySeconds: 0, voteSeconds: 0, sniper: true, defense: false, lastWords: 0 });
  await until(() => G(tv).settings.sniper === true);
  host.emit('host:mafia:start');
  await until(() => G(tv).status === 'roles');
  const roles = Object.fromEntries(G(host).players.map(p => [p.id, p.role]));
  const counts = {};
  Object.values(roles).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  ok(counts.mafia === 1 && counts.doctor === 1 && counts.detective === 1 && counts.sniper === 1 && counts.citizen === 2, `6 players → 1 mafia, doctor, detective, sniper, 2 citizens (${JSON.stringify(counts)})`);
  ok(G(tv).players.every(p => p.role === null), 'TV does not see roles');
  ok(ALL.every(s => G(s).me && G(s).me.role === roles[s.last.me.id]), 'each phone sees only its own role');
  ok(!G(a).picks && !G(tv).log, 'night picks + narrator log are host-only');
  const pid = (r) => Object.keys(roles).find(k => roles[k] === r);
  const mafiaId = pid('mafia'), docId = pid('doctor'), detId = pid('detective'), snId = pid('sniper');
  const citizens = Object.keys(roles).filter(k => roles[k] === 'citizen');
  ALL.forEach(s => s.emit('player:mafia:seen'));
  await until(() => G(tv).seenCount === 6);
  host.emit('host:mafia:advance');
  await until(() => G(tv).status === 'night');
  ok(G(tv).night === 1, 'night 1 (no intro night)');
  byId[mafiaId].emit('player:mafia:night', { target: mafiaId });
  await sleep(150);
  ok(!G(byId[mafiaId]).me.pick, 'mafia cannot target themselves');
  byId[mafiaId].emit('player:mafia:night', { target: citizens[0] });
  byId[docId].emit('player:mafia:night', { target: citizens[0] });
  byId[detId].emit('player:mafia:night', { target: mafiaId });
  byId[snId].emit('player:mafia:night', { target: citizens[1] }); // shoots an innocent
  await until(() => byId[detId].events.some(e => e[0] === 'mf:inquiry'));
  const inq = byId[detId].events.find(e => e[0] === 'mf:inquiry')[1];
  ok(inq.mafia === true, 'detective learns the mafia member is mafia');
  byId[detId].emit('player:mafia:night', { target: citizens[0] });
  await sleep(150);
  ok(G(byId[detId]).me.pick === mafiaId, 'detective cannot change the question after the answer');
  ok(G(tv).status === 'night' && G(tv).nightDone === 4, 'night waits for everyone (4/6)');
  citizens.forEach(cid => byId[cid].emit('player:mafia:night', { target: mafiaId }));
  await until(() => G(tv).status === 'dawn', 3000);
  let d = G(tv).dawn;
  ok(d.saved === true, 'doctor saved the victim');
  ok(d.sniper === 'miss' && d.deaths.length === 1 && d.deaths[0] === snId, 'sniper shot an innocent → sniper is out');
  host.emit('host:mafia:advance');
  await until(() => G(tv).status === 'day');
  ok(G(tv).day === 1, 'day 1');
  host.emit('host:mafia:advance');
  await until(() => G(tv).status === 'vote');
  byId[snId].emit('player:mafia:vote', { target: mafiaId });
  await sleep(150);
  ok(!G(tv).votes[snId], 'dead players cannot vote');
  const living = Object.keys(roles).filter(k => k !== snId);
  living.forEach(v => byId[v].emit('player:mafia:vote', { target: v === mafiaId ? citizens[0] : mafiaId }));
  await until(() => G(tv).status === 'verdict' || G(tv).status === 'end', 3000);
  ok(G(tv).verdict && G(tv).verdict.out === mafiaId, 'town votes the mafia out');
  await until(() => G(tv).status === 'end', 11000);
  ok(G(tv).status === 'end' && G(tv).winner === 'town', 'last mafia gone → town wins');
  ok(G(tv).players.every(p => p.role), 'all roles revealed at the end');

  // ---------------- Spy ----------------
  console.log('\n# Spy');
  host.emit('host:hub:select', { game: 'spy' });
  await until(() => tv.last.activeGame === 'spy');
  host.emit('host:spy:settings', { rounds: 1, minutes: 1 });
  host.emit('host:spy:start');
  await until(() => G(tv).status === 'cards');
  ok(G(tv).board.length === 16 && G(tv).word === null, '16-word board, secret word hidden from TV');
  const spies = G(host).spies.map(x => x.id);
  ok(spies.length === 1, 'one spy with 6 players');
  const spyS = byId[spies[0]];
  ok(G(spyS).me.spy && G(spyS).me.word === null, 'spy has no word');
  const agent = ALL.find(s => s !== spyS);
  ok(G(agent).me.word && G(tv).board.includes(G(agent).me.word), 'others see the word, which is on the board');
  ALL.forEach(s => s.emit('player:spy:seen'));
  await until(() => G(tv).status === 'talk', 3000);
  ok(G(tv).status === 'talk' && G(tv).firstAsker, 'everyone seen → questions begin');
  host.emit('host:spy:vote');
  await until(() => G(tv).status === 'vote');
  ALL.forEach(s => s.emit('player:spy:vote', { target: s === spyS ? agent.last.me.id : spies[0] }));
  await until(() => G(tv).status === 'guess', 3000);
  ok(G(tv).status === 'guess' && G(tv).accused.id === spies[0], 'spy caught → gets a last guess');
  const secret = G(host).secretWord;
  agent.emit('player:spy:guess', { word: secret });
  await sleep(200);
  ok(G(tv).status === 'guess', 'only the accused spy can guess');
  spyS.emit('player:spy:guess', { word: secret });
  await until(() => G(tv).status === 'result');
  ok(G(tv).outcome === 'guessed' && G(tv).word === secret, 'spy guesses the word → spy wins the round');
  ok(G(tv).standings.find(r => r.id === spies[0]).points === 2, 'spy +2');

  // ---------------- leaving + music ----------------
  console.log('\n# Back to music');
  host.emit('host:hub:select', { game: 'music' });
  await until(() => musicTv.music.activeGame === 'music' && tv.last.activeGame === 'music');
  ok(musicTv.music.activeGame === 'music' && tv.last.activeGame === 'music', 'music selected: arcade pages are told to redirect');
  host.emit('host:hub:select', { game: 'hub' });
  await until(() => tv.last.activeGame === 'hub');
  ok(tv.last.activeGame === 'hub', 'and back to the hub');

  // removing a player mid-game doesn't break anything
  host.emit('host:hub:select', { game: 'mostlikely' });
  await until(() => tv.last.activeGame === 'mostlikely');
  host.emit('host:mostlikely:start');
  await until(() => G(tv).status === 'question');
  host.music = null;
  // host:removePlayer is a music-game event but works from any host socket
  host.emit('host:removePlayer', { id: 'p6' });
  await until(() => tv.last.players.length === 5);
  ok(tv.last.players.length === 5 && G(tv).candidates.every(c => c.id !== 'p6'), 'removed player drops out of the live game');

  // malformed payloads must not crash the server
  for (const ev of ['host:esmfamil:settings', 'player:golpooch:pick', 'player:mafia:vote', 'host:hub:select', 'player:spy:guess']) {
    host.emit(ev, null); host.emit(ev, 'x'); a.emit(ev, 42); a.emit(ev, { target: { $gt: 1 } });
  }
  await sleep(400);
  host.emit('host:hub:select', { game: 'hub' });
  ok(await until(() => tv.last.activeGame === 'hub'), 'server survives malformed events');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

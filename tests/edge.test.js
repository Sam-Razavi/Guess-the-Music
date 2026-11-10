// Edge cases found in the double-check: offline players and teams, reconnects
// mid-game, 2-player challenges, game switches mid-round, stuck captains.
// Needs a fresh test server (npm test).
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { io } = require('socket.io-client');
const http = require('http');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(40); } return false; }
function mk(role, o = {}) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.events = [];
  s.on('arcade', p => { s.last = p; });
  s.onAny((ev, d) => { if (ev !== 'arcade' && ev !== 'state') s.events.push([ev, d]); });
  s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: 'arcade' }));
  return s;
}
const G = (s) => s.last && s.last.game;
const getJSON = (path) => new Promise((res, rej) => http.get(BASE + path, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

(async () => {
  const host = mk('host');
  await until(() => host.last);

  console.log('\n# join-info tells a fresh phone which game is on');
  let info = await getJSON('/join-info');
  ok(info.activeGame === 'hub', `/join-info has activeGame (${info.activeGame})`);

  console.log('\n# offline players stay out of the teams');
  // Five people have played before; only three are here tonight.
  const P = ['A', 'B', 'C', 'D', 'E'].map((n, i) => mk('player', { id: 'q' + i, name: n }));
  await until(() => host.last.players.filter(p => p.connected).length === 5);
  P[3].disconnect(); P[4].disconnect();
  await until(() => host.last.players.filter(p => p.connected).length === 3);
  ok(host.last.players.length === 5, 'roster still remembers all five');
  host.emit('host:hub:select', { game: 'golpooch' });
  await until(() => host.last.activeGame === 'golpooch');
  let teamIds = G(host).teams.flatMap(t => t.members.map(m => m.id)).sort();
  ok(teamIds.join() === 'q0,q1,q2', `Gol ya Pooch teams only have the 3 online players (${teamIds})`);
  host.emit('host:golpooch:shuffle');
  await sleep(200);
  teamIds = G(host).teams.flatMap(t => t.members.map(m => m.id)).sort();
  ok(teamIds.join() === 'q0,q1,q2', 'shuffle only uses online players');
  host.emit('host:golpooch:start');
  await until(() => G(host).status === 'hiding');
  ok(G(host).hands.every(h => ['q0', 'q1', 'q2'].includes(h.pid)), 'no hands for absent players');
  // someone arrives mid-round
  const late = mk('player', { id: 'q9', name: 'Late' });
  await until(() => late.last && G(late));
  ok(G(late).myTeam === null, 'a mid-round arrival has no team yet (phone says "next round")');
  host.emit('host:golpooch:hideRandom');
  await until(() => G(host).status === 'guessing');
  const oldGuesser = G(host).guesser.id;
  host.emit('host:golpooch:newCaptain');
  await until(() => G(host).guesser.id !== oldGuesser);
  const guessTeam = G(host).teams.find(t => t.id !== G(host).hidingTeam);
  ok(G(host).guesser.id !== oldGuesser || guessTeam.members.length === 1, 'host can hand the call to another teammate');
  host.emit('host:golpooch:newGame');
  await until(() => G(host).status === 'lobby');
  teamIds = G(host).teams.flatMap(t => t.members.map(m => m.id)).sort();
  ok(teamIds.includes('q9'), 'the late arrival joins a team in the lobby');

  host.emit('host:hub:select', { game: 'pantomime' });
  await until(() => host.last.activeGame === 'pantomime');
  teamIds = G(host).teams.flatMap(t => t.members.map(m => m.id)).sort();
  ok(teamIds.join() === 'q0,q1,q2,q9', `Pantomime teams only have online players (${teamIds})`);
  host.emit('host:pantomime:start');
  await until(() => G(host).status === 'ready');
  ok(['q0', 'q1', 'q2', 'q9'].includes(G(host).actor.id), 'actor is someone who is here');

  console.log('\n# Esm-Famil: two players, reconnect mid-round, switch away mid-round');
  late.disconnect(); P[2].disconnect();
  await until(() => host.last.players.filter(p => p.connected).length === 2);
  host.emit('host:hub:select', { game: 'esmfamil' });
  await until(() => host.last.activeGame === 'esmfamil');
  host.emit('host:esmfamil:settings', { categories: ['name', 'city', 'food'], alphabet: 'en', stopGrace: 0, rounds: 2 });
  await until(() => G(host).settings.alphabet === 'en');
  host.emit('host:esmfamil:start', { letter: 'E' });
  await until(() => G(host).status === 'writing', 8000);
  P[0].emit('player:esmfamil:answer', { cat: 'name', text: 'Emma' });
  P[0].emit('player:esmfamil:answer', { cat: 'city', text: 'Écosse' });
  await until(() => G(host).answers.q0 && G(host).answers.q0.city === 'Écosse');
  // phone reloads: a brand-new socket for the same player
  P[0].disconnect();
  const back = mk('player', { id: 'q0', name: 'A' });
  await until(() => back.last && G(back) && G(back).mine);
  ok(G(back).mine.name === 'Emma' && G(back).mine.city === 'Écosse', 'a reloaded phone gets its answers back');
  back.emit('player:esmfamil:answer', { cat: 'food', text: 'Eggs' });
  P[1].emit('player:esmfamil:answer', { cat: 'name', text: 'Eric' });
  P[1].emit('player:esmfamil:answer', { cat: 'city', text: 'Essen' });
  P[1].emit('player:esmfamil:answer', { cat: 'food', text: 'Edamame' });
  await until(() => G(host).participants.every(p => p.filled === 3));
  back.emit('player:esmfamil:stop');
  await until(() => G(host).status === 'review');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(host).review.cat === 'city');
  ok(G(host).review.rows.find(r => r.id === 'q0').valid, '"Écosse" counts for E');
  P[1].emit('player:esmfamil:challenge', { target: 'q0' });
  await until(() => G(host).review.rows.find(r => r.id === 'q0').challenges === 1);
  ok(G(host).review.rows.find(r => r.id === 'q0').valid, 'two players: one 👎 only flags it, the host decides');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(host).review.cat === 'food');
  host.emit('host:esmfamil:reviewNav', { dir: 1 });
  await until(() => G(host).status === 'scores');
  host.emit('host:esmfamil:settings', { categories: ['name', 'animal', 'color'] });
  await sleep(200);
  ok(G(host).settings.categories.join() === 'name,city,food', 'categories are locked while a score sheet is up');
  host.emit('host:esmfamil:start');
  await until(() => G(host).status === 'spinning');
  host.emit('host:hub:select', { game: 'hub' });
  await until(() => host.last.activeGame === 'hub');
  await sleep(5000); // longer than the spin
  ok(host.last.activeGame === 'hub' && host.last.game === null, 'leaving mid-round: the round\'s timers don\'t fire into the hub');
  host.emit('host:hub:select', { game: 'esmfamil' });
  await until(() => host.last.activeGame === 'esmfamil');
  ok(G(host).status === 'lobby' && G(host).round === 0, 'coming back starts a fresh Esm-Famil');

  console.log('\n# Mafia: a dropped phone doesn\'t hold up the night');
  const extra = ['F', 'G'].map((n, i) => mk('player', { id: 'r' + i, name: n }));
  await until(() => host.last.players.filter(p => p.connected).length === 4);
  host.emit('host:hub:select', { game: 'mafia' });
  await until(() => host.last.activeGame === 'mafia');
  host.emit('host:mafia:settings', { introNight: false, nightSeconds: 0, daySeconds: 0, voteSeconds: 0, sniper: false, defense: false });
  host.emit('host:mafia:start');
  await until(() => G(host).status === 'roles');
  const roles = Object.fromEntries(G(host).players.map(p => [p.id, p.role]));
  const sockets = { q0: back, q1: P[1], r0: extra[0], r1: extra[1] };
  host.emit('host:mafia:advance');
  await until(() => G(host).status === 'night');
  // one citizen's phone dies
  const citizen = Object.keys(roles).find(k => roles[k] === 'citizen');
  sockets[citizen].disconnect();
  await until(() => host.last.players.find(p => p.id === citizen).connected === false);
  for (const [pid, s] of Object.entries(sockets)) {
    if (pid === citizen) continue;
    const r = roles[pid];
    const target = r === 'mafia' ? Object.keys(roles).find(k => roles[k] !== 'mafia' && k !== citizen) : r === 'doctor' ? pid : Object.keys(roles).find(k => k !== pid);
    s.emit('player:mafia:night', { target });
  }
  ok(await until(() => G(host).status === 'dawn', 4000), 'night resolves once everyone still connected has chosen');
  // the dropped phone comes back and still knows its role
  const again = mk('player', { id: citizen, name: 'back' });
  await until(() => again.last && G(again) && G(again).me);
  ok(G(again).me && G(again).me.role === roles[citizen], 'a reconnecting phone gets its role back');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

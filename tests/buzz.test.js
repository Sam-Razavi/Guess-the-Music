// Buzzer reliability: acks, buzzes made while a phone reconnects, held events
// still going through the role gate, team mode. npm test -- buzz
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(25); } return false; }
const mk = (role, o = {}) => {
  const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnectionDelay: 200, reconnectionDelayMax: 200 });
  s.on('state', p => { s.st = p; }); s.on('arcade', p => { s.ar = p; });
  if (role) s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, team: o.team, view: o.view }));
  return s;
};
const buzz = (s) => new Promise(res => s.timeout(3000).emit('player:buzz', {}, (err, r) => res(err ? { err: true } : r)));

(async () => {
  const ahost = mk('host', { view: 'arcade' });
  await until(() => ahost.ar);
  ahost.emit('host:hub:select', { game: 'music' });
  await until(() => ahost.ar.activeGame === 'music');
  const host = mk('host'), tv = mk('tv');
  const P = ['Ana', 'Ben', 'Cy'].map((n, i) => mk('player', { id: 'bz' + i, name: n }));
  await until(() => host.st && tv.st && P.every(p => p.st));
  host.emit('host:addSongs', [1, 2, 3, 4, 5, 6].map(i => ({ youtubeId: 'dQw4w9WgXc' + i, title: 'Song ' + i, artist: 'A' })));
  await until(() => host.st.playlist.length === 6);
  const songs = host.st.playlist;
  const start = async (i) => {
    host.emit('host:closeRound'); await until(() => host.st.roundStatus === 'idle');
    host.emit('host:startRound', { id: songs[i].id });
    await until(() => P[0].st.roundStatus === 'playing');
  };

  console.log('\n# acks');
  let r = await buzz(P[0]);
  ok(r.ok === false && r.reason === 'notOpen', `buzz with no round open: answered "notOpen" (${JSON.stringify(r)})`);
  await start(0);
  r = await buzz(P[0]);
  ok(r.ok === true && host.st && (await until(() => host.st.buzzOrder.some(b => b.id === 'bz0'))), 'buzz in an open round: answered ok and counted');
  host.emit('host:resetBuzzers');
  await until(() => host.st.roundStatus === 'playing');
  r = await buzz(P[0]);
  ok(r.ok === false && r.reason === 'already', `the same player again after a reset: "already" (${JSON.stringify(r)})`);
  P[1].emit('player:buzz'); // an old page: no payload, no callback
  ok(await until(() => host.st.buzzOrder.some(b => b.id === 'bz1')), 'a buzz without an ack callback (old page) still counts');

  console.log('\n# buzzing while the phone reconnects');
  await start(1);
  P[2].io.engine.close(); // WiFi blip / screen woke up
  await sleep(30);
  ok(!P[2].connected, 'phone is offline');
  P[2].emit('player:buzz'); // tapped while offline: socket.io queues it and sends it BEFORE re-registering
  ok(await until(() => P[2].connected, 4000), 'phone reconnects');
  ok(await until(() => host.st.buzzOrder.some(b => b.id === 'bz2'), 4000), 'the buzz tapped while offline is counted (it used to be dropped)');

  console.log('\n# held events still go through the role gate');
  await start(2);
  const raw = mk(null);
  await until(() => raw.connected);
  raw.emit('host:closeRound');           // sent before registering...
  raw.emit('register', { role: 'player', id: 'bzx', name: 'Sneaky' }); // ...then registers as a PLAYER
  await sleep(500);
  ok(host.st.roundStatus === 'playing', 'a host event sent before registering as a player is not run');
  const late = mk(null);
  await until(() => late.connected);
  late.emit('player:buzz');
  await sleep(5300);                    // held events expire after 5 s
  late.emit('register', { role: 'player', id: 'bzy', name: 'Late' });
  await sleep(500);
  ok(!host.st.buzzOrder.some(b => b.id === 'bzy'), 'an event held longer than 5 s is dropped, not replayed');
  const never = mk(null);
  await until(() => never.connected);
  never.emit('player:buzz');
  await sleep(400);
  ok(host.st.roundStatus === 'playing' && host.st.buzzOrder.length === 0, 'a socket that never registers buzzes nothing');

  console.log('\n# team mode');
  host.emit('host:updateSettings', { teamMode: true, stealMechanic: true });
  const T = [['bt0', 'Tia', 'Red'], ['bt1', 'Tom', 'Red'], ['bt2', 'Uma', 'Blue']].map(([id, name, team]) => mk('player', { id, name, team }));
  await until(() => T.every(t => t.st) && host.st.settings.teamMode);
  await start(3);
  r = await buzz(T[0]);
  ok(r.ok === true, 'Tia (Red) buzzes');
  host.emit('host:markWrong', { id: 'bt0' });
  await until(() => host.st.roundStatus === 'playing');
  r = await buzz(T[1]);
  ok(r.ok === false && r.reason === 'team', `her teammate Tom is refused with "team" (${JSON.stringify(r)})`);
  r = await buzz(T[2]);
  ok(r.ok === true, 'Uma (Blue) can steal');
  host.emit('host:updateSettings', { teamMode: false });

  console.log(`\n${pass} passed, ${fail} failed`);
  [ahost, host, tv, raw, late, never, ...P, ...T].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

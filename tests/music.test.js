// Music game still works with the hub wired in (register/view changes in server.js).
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(50); } return false; }
const mk = (role, o = {}) => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); s.on('state', p => { s.st = p; }); s.on('arcade', p => { s.ar = p; }); s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: o.view })); return s; };
(async () => {
  const ahost = mk('host', { view: 'arcade' });
  await until(() => ahost.ar);
  ahost.emit('host:hub:select', { game: 'music' });
  await until(() => ahost.ar.activeGame === 'music');
  const host = mk('host'); const tv = mk('tv'); const p = mk('player', { id: 'm1', name: 'Mu' });
  await until(() => host.st && tv.st && p.st);
  ok(host.st.activeGame === 'music' && Array.isArray(host.st.playlist), 'music host gets the full music payload');
  ok(!ahost.st, 'the arcade host never got the music payload');
  host.emit('host:addSongs', [{ youtubeId: 'dQw4w9WgXcQ', title: 'Test Song', artist: 'Tester' }]);
  await until(() => host.st.playlist.length === 1);
  host.emit('host:startRound', { id: host.st.playlist[0].id });
  await until(() => tv.st.roundStatus === 'playing');
  ok(tv.st.roundStatus === 'playing', 'round starts');
  ahost.emit('host:hub:select', { game: 'hub' });
  await sleep(300);
  ok(host.st.activeGame === 'music', 'cannot leave for the hub mid-round');
  p.emit('player:buzz');
  await until(() => tv.st.roundStatus === 'buzzed');
  ok(tv.st.roundStatus === 'buzzed' && tv.st.buzzOrder[0].id === 'm1', 'buzz works');
  host.emit('host:awardPoint', { id: 'm1', delta: 1 });
  await until(() => tv.st.roundStatus === 'revealed');
  ok(tv.st.players.find(x => x.id === 'm1').score === 1 && tv.st.roundStatus === 'revealed', 'correct → point + auto-reveal');
  ahost.emit('host:hub:select', { game: 'hub' });
  await until(() => host.st.activeGame === 'hub');
  ok(host.st.activeGame === 'hub', 'after the reveal the host can switch back to the hub');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

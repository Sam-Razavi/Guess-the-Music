// Only one TV screen plays sound (games/tv-screens.js). Run with: npm test -- tvs
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(30); } return false; }

// A TV page: role tv, music or hub view, with the screen info tv-sound.js sends.
function tv(screen, o = {}) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.sound = null; s.order = [];
  s.on('tvSound', d => { s.sound = d.sound; s.screens = d.screens; s.order.push('tvSound'); });
  s.on('state', () => s.order.push('state'));
  s.on('arcade', () => s.order.push('arcade'));
  s.on('connect', () => s.emit('register', { role: 'tv', screen, kiosk: !!o.kiosk, fullscreen: !!o.fullscreen, visible: o.visible !== false, ...(o.view ? { view: o.view } : {}) }));
  return s;
}
function host(view) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.on('state', p => { s.st = p; });
  s.on('arcade', p => { s.ar = p; });
  s.on('connect', () => s.emit('register', { role: 'host', ...(view ? { view } : {}) }));
  return s;
}

(async () => {
  const h = host();
  const ha = host('arcade');
  await until(() => h.st && ha.ar);

  console.log('\n# one screen');
  const a = tv('screen-aaaa');
  await until(() => a.sound !== null);
  ok(a.sound === true, 'a lone TV plays sound');
  ok(a.order[0] === 'tvSound', 'it hears about sound before its first state (no audible blip on a second TV)');
  ok(h.st.tvScreens && h.st.tvScreens.count === 1, 'host: 1 TV screen');

  console.log('\n# a second tab opens later');
  const b = tv('screen-bbbb');
  await until(() => b.sound !== null);
  ok(a.sound === true && b.sound === false, 'the first screen keeps the sound, the new one is muted');
  ok(b.order[0] === 'tvSound', 'the second screen is muted before it gets any state');
  ok(await until(() => h.st.tvScreens.count === 2), 'music host sees 2 TV screens');
  ok(await until(() => ha.ar.tvScreens && ha.ar.tvScreens.count === 2), 'hub host sees 2 TV screens');
  ok(a.screens === 2 && b.screens === 2, 'each TV knows there are 2 screens');

  console.log('\n# visible beats hidden');
  a.emit('tv:screen', { visible: false });
  ok(await until(() => b.sound === true && a.sound === false), 'a background tab loses the sound to a visible one');
  a.emit('tv:screen', { visible: true });
  ok(await until(() => a.sound === true && b.sound === false), 'back on show: the screen opened first has it again');

  console.log('\n# the kiosk wins');
  const k = tv('screen-kiosk', { kiosk: true });
  ok(await until(() => k.sound === true && a.sound === false && b.sound === false), 'a kiosk screen (tv.html?kiosk=1) takes the sound even when opened last');
  ok(await until(() => h.st.tvScreens.count === 3 && h.st.tvScreens.soundIsKiosk), 'host: 3 screens, sound on the kiosk');
  const f = tv('screen-full', { fullscreen: true });
  await until(() => f.sound !== null);
  ok(f.sound === false && k.sound === true, 'a full-screen tab ranks below the flagged kiosk');
  f.close();

  console.log('\n# "Play the sound here"');
  b.emit('tv:claimSound');
  ok(await until(() => b.sound === true && k.sound === false), 'clicking it on a muted screen moves the sound there');
  a.emit('tv:claimSound');
  ok(await until(() => a.sound === true && b.sound === false), 'the latest click wins');

  console.log('\n# page hand-off (music -> hub) keeps the screen');
  const before = h.st.tvScreens.count;
  const a2 = tv('screen-aaaa', { view: 'arcade' });
  await until(() => a2.sound !== null);
  a.close();
  await sleep(300);
  ok(a2.sound === true && b.sound === false && k.sound === false, 'same tab on the hub page keeps the sound; nobody else unmutes');
  ok(h.st.tvScreens.count === before, `same number of screens as before (${before}): the same tab is not counted twice`);

  console.log('\n# a screen closes');
  a2.close();
  await sleep(500);
  ok(k.sound === false, 'for a few seconds the sound waits for that tab to come back (page reloads)');
  ok(await until(() => k.sound === true, 10000), 'then it moves on: the kiosk has it again');
  ok(await until(() => h.st.tvScreens.count === 2, 3000), 'host: 2 screens');

  console.log('\n# playback reports');
  const statuses = [];
  h.on('playerStatus', p => statuses.push(p.status));
  b.emit('tv:playerStatus', { status: 'playing', songId: 'x' });
  k.emit('tv:playerStatus', { status: 'buffering', songId: 'x' });
  await sleep(400);
  ok(statuses.join() === 'buffering', 'only the screen with the sound reports playback to the host');

  console.log('\n# role gate and junk');
  const pl = io(BASE, { transports: ['websocket'], forceNew: true });
  pl.on('connect', () => pl.emit('register', { role: 'player', id: 'p1', name: 'P' }));
  await sleep(300);
  pl.emit('tv:claimSound');
  pl.emit('tv:screen', { visible: false });
  await sleep(300);
  ok(k.sound === true, 'a phone cannot grab the TV sound');
  const j = io(BASE, { transports: ['websocket'], forceNew: true });
  j.on('tvSound', d => { j.sound = d.sound; });
  j.on('connect', () => j.emit('register', { role: 'tv', screen: '<script>x</script>', kiosk: 'yes', visible: 'no' }));
  await until(() => j.sound !== undefined);
  ok(j.sound === false && k.sound === true, 'a junk screen id gets its own id; "kiosk: yes" is not a kiosk');
  k.emit('tv:screen', null); k.emit('tv:screen', 'x'); k.emit('tv:claimSound', null);
  await sleep(200);
  ok(k.connected && k.sound === true, 'junk updates are ignored');
  const old = io(BASE, { transports: ['websocket'], forceNew: true });
  old.on('tvSound', d => { old.sound = d.sound; });
  old.on('connect', () => old.emit('register', { role: 'tv' }));
  await until(() => old.sound !== undefined);
  ok(old.sound === false, 'an old TV page (no screen info) still counts as a screen, muted');

  console.log(`\n${pass} passed, ${fail} failed`);
  [h, ha, b, k, pl, j, old].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

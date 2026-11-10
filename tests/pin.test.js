// Run against an instance started with JOIN_PIN=4321.
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(60); } return false; }
function mk(reg) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.on('arcade', p => { s.last = p; });
  s.on('registerError', () => { s.rejected = true; });
  s.on('connect', () => s.emit('register', { view: 'arcade', ...reg }));
  return s;
}
(async () => {
  console.log('# join PIN on the hub pages');
  const h0 = mk({ role: 'host' });
  await until(() => h0.rejected || h0.last, 3000);
  ok(h0.rejected && !h0.last, 'host without the PIN gets nothing');
  h0.emit('host:hub:select', { game: 'mafia' });
  const tv = mk({ role: 'tv' });
  await until(() => tv.last);
  ok(tv.last && tv.last.activeGame === 'hub', 'TV needs no PIN — and the PIN-less host could not switch the game');
  const p0 = mk({ role: 'player', id: 'z1', name: 'Zed' });
  await until(() => p0.rejected || p0.last, 3000);
  ok(p0.rejected && !p0.last, 'player without the PIN gets nothing');
  ok(!(tv.last.players || []).some(p => p.id === 'z1'), 'and does not appear on the TV');
  const h1 = mk({ role: 'host', pin: '4321' });
  await until(() => h1.last);
  ok(!!h1.last, 'host with the PIN is in');

  console.log('# a stale socket closing does not mark a player offline');
  const a = mk({ role: 'player', id: 'z2', name: 'Two', pin: '4321' });
  await until(() => a.last);
  const b = mk({ role: 'player', id: 'z2', name: 'Two', pin: '4321' }); // the new page
  await until(() => b.last);
  a.disconnect(); // the old page's socket goes away after the new one registered
  await sleep(600);
  ok(h1.last.players.find(p => p.id === 'z2').connected === true, 'still online after the old socket closed');
  b.disconnect();
  await until(() => h1.last.players.find(p => p.id === 'z2').connected === false);
  ok(h1.last.players.find(p => p.id === 'z2').connected === false, 'goes offline when the current socket closes');

  console.log('# browser: PIN gates and the QR link');
  const browser = await launchBrowser();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await ctx.newPage();
  host.on('pageerror', e => errors.push(e.message));
  await host.goto(BASE + '/hub/host.html');
  ok(await until(async () => await host.locator('#pin-gate').isVisible()), 'hub host page shows the PIN gate');
  await host.fill('#pin-input', '1111');
  await host.click('#pin-submit');
  ok(await until(async () => (await host.textContent('#pin-error')).length > 0), 'wrong PIN → error message');
  await host.fill('#pin-input', '4321');
  await host.click('#pin-submit');
  ok(await until(async () => await host.locator('#pin-gate').isHidden() && await host.locator('[data-launch]').count() > 0), 'right PIN → host controls');
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pctx.addInitScript("localStorage.setItem('gtm_player_id','z3');localStorage.setItem('gtm_player_name','Qr');");
  const ph = await pctx.newPage();
  ph.on('pageerror', e => errors.push(e.message));
  await ph.goto(BASE + '/player.html?pin=4321'); // what the TV's QR code encodes
  ok(await until(() => ph.url().includes('/hub/player.html?pin=4321')), 'QR link with the PIN hands over to the hub page, PIN kept');
  ok(await until(() => h1.last.players.some(p => p.id === 'z3' && p.connected)), 'and the phone joins without typing anything');
  const tvctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tvp = await tvctx.newPage();
  await tvp.goto(BASE + '/tv.html');
  await until(() => tvp.url().includes('/hub/tv.html'));
  await sleep(2000);
  require('fs').mkdirSync(path.join(require('os').tmpdir(), 'gtm-test-shots'), { recursive: true });
  await tvp.screenshot({ path: path.join(require('os').tmpdir(), 'gtm-test-shots', 'tv-1080p-hub.png') });
  ok(!errors.length, `no page errors ${errors.join(' | ')}`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

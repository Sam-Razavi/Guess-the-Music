// Browser check: hub <-> music page hand-off (TV, phone, host), incl. the music host's "All games" button.
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(100); } return false; }

(async () => {
  const browser = await launchBrowser();
  const errors = [];
  const page = async (name, url, init) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
    await p.goto(BASE + url);
    return p;
  };
  const host = io(BASE, { transports: ['websocket'] });
  host.on('connect', () => host.emit('register', { role: 'host', view: 'arcade' }));
  host.on('arcade', s => { host.last = s; });
  await until(() => host.last);

  const tv = await page('tv', '/tv.html');
  const ph = await page('phone', '/player.html', "localStorage.setItem('gtm_player_id','sw1');localStorage.setItem('gtm_player_name','Switchy');");
  ok(await until(() => tv.url().endsWith('/hub/tv.html')), 'music TV page hands over to the hub page');
  ok(await until(() => ph.url().endsWith('/hub/player.html')), 'music phone page hands over to the hub page');
  ok(await until(async () => (await ph.locator('#ph-hello').textContent()).includes('Switchy')), 'phone kept its name across the hand-off (no re-join)');

  host.emit('host:hub:select', { game: 'music' });
  ok(await until(() => /\/tv\.html$/.test(tv.url()) && !tv.url().includes('/hub/')), 'selecting music sends the TV to the music page');
  ok(await until(() => /\/player\.html$/.test(ph.url()) && !ph.url().includes('/hub/')), '... and the phone to the buzzer page');
  ok(await until(async () => !(await ph.locator('#buzzer-screen').isHidden())), 'phone lands on the buzzer screen, already joined');

  const mh = await page('music-host', '/host.html');
  ok(await until(async () => await mh.locator('#hub-btn').isVisible()), 'music host shows the "All games" button');
  await mh.click('#hub-btn');
  ok(await until(() => tv.url().endsWith('/hub/tv.html')), '"All games" brings the TV back to the hub');
  ok(await until(() => mh.url().endsWith('/hub/host.html')), '... and the host page too');
  ok(await until(async () => (await tv.locator('.hub-card').count()) === 10), 'hub menu rendered (9 games + trophy shelf)');
  console.log('page errors:', errors.length ? errors : 'none');
  ok(!errors.length, 'no page errors');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

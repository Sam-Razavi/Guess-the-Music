// Browser checks on the real pages: clicks fire exactly once after many game
// switches, the leave-mid-game confirm, host padding, a fresh phone landing on
// the hub join screen, and a phone reload keeping typed answers.
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
// Screenshots for a human to look at, kept out of the repo.
const OUT = path.join(require('os').tmpdir(), 'gtm-test-shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(80); } return false; }

(async () => {
  const browser = await launchBrowser();
  const errors = [];
  const open = async (name, url, opts = {}) => {
    const ctx = await browser.newContext(opts.mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    if (opts.init) await ctx.addInitScript(opts.init);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
    await p.goto(BASE + url);
    return p;
  };
  const spy = io(BASE, { transports: ['websocket'] });
  spy.on('connect', () => spy.emit('register', { role: 'host', view: 'arcade' }));
  spy.on('arcade', s => { spy.last = s; });
  await until(() => spy.last);
  const G = () => spy.last.game;

  const host = await open('host', '/hub/host.html');
  const phone = await open('phone', '/hub/player.html', { mobile: true, init: "localStorage.setItem('gtm_player_id','u1');localStorage.setItem('gtm_player_name','Uma');" });
  const bots = ['Bo', 'Cy', 'Di'].map((n, i) => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); s.on('connect', () => s.emit('register', { role: 'player', id: 'b' + i, name: n, view: 'arcade' })); return s; });
  await until(() => spy.last.players.filter(p => p.connected).length === 4);

  const pad = await host.evaluate(() => getComputedStyle(document.getElementById('game-root')).paddingLeft);
  ok(pad === '16px', `host page keeps its side padding (${pad})`);

  // bounce through several games using the real host buttons
  const launch = async (game) => { await host.click(`[data-launch="${game}"]`); await until(() => spy.last.activeGame === game); await sleep(400); };
  const back = async () => { await host.click('#back-hub'); await until(() => spy.last.activeGame === 'hub'); await sleep(400); };
  for (const g of ['mostlikely', 'mafia', 'spy', 'golpooch']) { await launch(g); await back(); }
  ok(spy.last.activeGame === 'hub', 'switched games four times through the host page');

  // phone vote must register (a doubled listener would toggle it straight off)
  await sleep(2600); // let the game-change splash clear
  await phone.click('[data-vote="esmfamil"]');
  await until(() => spy.last.hub.votes.u1);
  await sleep(500);
  ok(spy.last.hub.votes.u1 === 'esmfamil', 'one tap = one vote after several game switches');

  // Gol ya Pooch team editor: one tap moves a player exactly once
  await launch('golpooch');
  const before = G().teams.find(t => t.members.some(m => m.id === 'b0')).id;
  await host.click('[data-move="b0"]');
  await until(() => G().teams.find(t => t.members.some(m => m.id === 'b0')).id !== before);
  await sleep(500);
  ok(G().teams.find(t => t.members.some(m => m.id === 'b0')).id !== before, 'one tap on a name moves them to the other team once');
  await back();

  // Esm-Famil via the host UI: Next category advances exactly one
  await launch('esmfamil');
  await host.click('[data-cat-toggle="fruit"]');
  await until(() => G().settings.categories.includes('fruit'));
  ok(G().settings.categories.length === 9, 'one tap adds one category');
  await host.click('[data-emit="host:esmfamil:start"]');
  await until(() => G().status === 'writing', 9000);
  await phone.waitForSelector('[data-cat="name"]');
  await phone.fill('[data-cat="name"]', 'Bahram');
  await phone.fill('[data-cat="city"]', 'Babol');
  await sleep(500);
  // reload the phone mid-round
  await phone.reload();
  await phone.waitForSelector('[data-cat="name"]');
  await until(async () => (await phone.inputValue('[data-cat="name"]')) === 'Bahram');
  ok((await phone.inputValue('[data-cat="name"]')) === 'Bahram' && (await phone.inputValue('[data-cat="city"]')) === 'Babol', 'a reloaded phone gets its typed answers back');
  await host.click('[data-emit="host:esmfamil:forceStop"]');
  await until(() => G().status === 'review');
  await sleep(300);
  await host.click('[data-emit="host:esmfamil:reviewNav"][data-args=\'{"dir":1}\']');
  await sleep(800);
  ok(G().reviewIndex === 1, `one tap on Next category moves one category (at ${G().reviewIndex})`);
  await host.screenshot({ path: path.join(OUT, 'host-desktop-ef-review.png'), fullPage: true });

  // leaving mid-game needs a second tap
  await host.click('#back-hub');
  await sleep(500);
  ok(spy.last.activeGame === 'esmfamil', 'leaving mid-game: the first tap only asks');
  ok((await host.textContent('#back-hub')).includes('Tap again'), 'the button says what will happen');
  await host.click('#back-hub');
  ok(await until(() => spy.last.activeGame === 'hub'), 'the second tap leaves');
  await host.screenshot({ path: path.join(OUT, 'host-desktop-hub.png'), fullPage: true });

  // a brand-new phone scanning the QR while the hub is on
  const fresh = await open('fresh', '/player.html', { mobile: true });
  ok(await until(() => fresh.url().includes('/hub/player.html')), 'a new phone opening /player.html lands on the hub page');
  ok(await until(async () => await fresh.locator('#join-screen').isVisible()), '... showing the Game Night join screen');
  ok(!(await fresh.locator('#name-screen').count()), '... not the music one');
  await fresh.fill('#join-name', 'Newbie');
  await fresh.click('#join-submit');
  ok(await until(() => spy.last.players.some(p => p.name === 'Newbie' && p.connected)), 'and can join from there');
  await fresh.screenshot({ path: path.join(OUT, 'phone-fresh-join.png') });

  // and the reverse: music on, a new phone sent to the hub link lands on the music join screen
  spy.emit('host:hub:select', { game: 'music' });
  await until(() => spy.last.activeGame === 'music');
  const fresh2 = await open('fresh2', '/hub/player.html', { mobile: true });
  ok(await until(() => /\/player\.html$/.test(fresh2.url()) && !fresh2.url().includes('/hub/')), 'with music on, a new phone on the hub link goes to the music join screen');
  spy.emit('host:hub:select', { game: 'hub' });
  await sleep(500);

  console.log('page errors:', errors.length ? errors : 'none');
  ok(!errors.length, 'no page errors');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

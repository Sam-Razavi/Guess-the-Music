// The phone's buzzer in a real browser: buzzes on finger-down (no release
// needed), a tap while the connection is down is sent once it's back, a buzz
// whose answer never comes forces a reconnect and is re-sent, and in team mode a
// teammate's phone doesn't show an armed buzzer the server would refuse.
// npm test -- buzzui
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(40); } return false; }
const mk = (role, o = {}) => {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.on('state', p => { s.st = p; }); s.on('arcade', p => { s.ar = p; });
  s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, team: o.team, view: o.view }));
  return s;
};

(async () => {
  const ahost = mk('host', { view: 'arcade' });
  await until(() => ahost.ar);
  ahost.emit('host:hub:select', { game: 'music' });
  await until(() => ahost.ar.activeGame === 'music');
  const host = mk('host');
  await until(() => host.st);
  host.emit('host:addSongs', [1, 2, 3, 4, 5].map(i => ({ youtubeId: 'dQw4w9WgXd' + i, title: 'Song ' + i, artist: 'A' })));
  await until(() => host.st.playlist.length === 5);
  const songs = host.st.playlist;
  const start = async (i) => {
    host.emit('host:closeRound'); await until(() => host.st.roundStatus === 'idle');
    host.emit('host:startRound', { id: songs[i].id });
    await until(() => host.st.roundStatus === 'playing');
  };

  const browser = await launchBrowser();
  const errors = [];
  const phone = async (id, name, team) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(([id, name, team]) => { localStorage.setItem('gtm_player_id', id); localStorage.setItem('gtm_player_name', name); localStorage.setItem('gtm_player_team', team || ''); }, [id, name, team]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/player.html');
    await until(() => host.st.players.some(x => x.id === id && x.connected));
    return p;
  };
  const press = (p) => p.dispatchEvent('#buzz-btn', 'pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });

  console.log('\n# buzzes on finger-down');
  const a = await phone('ui0', 'Ana');
  await start(0);
  await until(() => a.evaluate(() => !document.getElementById('buzz-btn').disabled));
  await press(a); // finger down, never lifted: no 'click' at all
  ok(await until(() => host.st.buzzOrder.some(b => b.id === 'ui0'), 3000), 'a press with no release counts (it used to wait for the finger to lift)');
  ok(await until(() => a.evaluate(() => document.getElementById('buzz-btn').classList.contains('locked'))), 'the phone shows "Locked in"');
  ok(await a.evaluate(() => !document.getElementById('buzz-btn').classList.contains('sending')), 'the pressed look clears once the server answered');

  console.log('\n# a tap while the connection is down');
  await start(1);
  await until(() => a.evaluate(() => !document.getElementById('buzz-btn').disabled));
  await a.evaluate(() => socket.io.engine.close()); // WiFi blip
  await press(a);
  const pillSeen = await until(() => a.evaluate(() => !document.getElementById('conn-pill').hidden), 1500);
  ok(pillSeen, 'the phone says it is reconnecting');
  ok(await until(() => host.st.buzzOrder.some(b => b.id === 'ui0'), 5000), 'the buzz is sent once the connection is back, and counts');
  ok(await until(() => a.evaluate(() => document.getElementById('conn-pill').hidden), 3000), 'the reconnecting note goes away');

  console.log('\n# a buzz whose answer never comes');
  await start(2);
  await until(() => a.evaluate(() => !document.getElementById('buzz-btn').disabled));
  // Lose the first buzz on the way (a half-dead connection): it goes out under a
  // name the server ignores, so no answer ever comes back.
  await a.evaluate(() => {
    const orig = socket.emit.bind(socket);
    let lost = false;
    socket.emit = (ev, ...args) => { if (ev === 'player:buzz' && !lost) { lost = true; return orig('player:lost', ...args); } return orig(ev, ...args); };
  });
  const t0 = Date.now();
  await press(a);
  ok(await until(() => host.st.buzzOrder.some(b => b.id === 'ui0'), 8000), `no answer within 2.5 s: the phone reconnects and re-sends, and the buzz counts (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  console.log('\n# team mode');
  host.emit('host:updateSettings', { teamMode: true, stealMechanic: true });
  const t1 = await phone('ui1', 'Tia', 'Red');
  const t2 = await phone('ui2', 'Tom', 'Red');
  await until(() => host.st.settings.teamMode);
  await start(3);
  await until(() => t1.evaluate(() => !document.getElementById('buzz-btn').disabled));
  await press(t1);
  await until(() => host.st.roundStatus === 'buzzed');
  host.emit('host:markWrong', { id: 'ui1' });
  await until(() => host.st.roundStatus === 'playing');
  await sleep(300);
  const tomState = await t2.evaluate(() => ({ disabled: document.getElementById('buzz-btn').disabled, label: document.getElementById('buzz-label').textContent }));
  ok(tomState.disabled && /team/i.test(tomState.label), `after a steal reopens buzzing, Tia's teammate sees "${tomState.label}" instead of an armed buzzer`);
  const anaState = await a.evaluate(() => document.getElementById('buzz-btn').disabled);
  ok(!anaState, 'a player with no team can still steal');
  host.emit('host:updateSettings', { teamMode: false });

  ok(!errors.length, `no page errors ${errors.join(' | ')}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); ahost.close(); host.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

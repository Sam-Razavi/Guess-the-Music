// "Lighter host updates" (settings.liteHostUpdates, slow-WiFi mode): the host's
// updates leave out an unchanged playlist and carry only changed songs, and the
// host page still ends up with exactly the server's playlist. npm test -- lite
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(30); } return false; }
const mk = (role, o = {}) => {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.log = [];
  s.on('state', p => { s.st = p; s.log.push(p); }); s.on('arcade', p => { s.ar = p; });
  s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: o.view }));
  return s;
};
// The same rebuild host.js does.
function follow(sock) {
  sock.copy = [];
  sock.on('state', (st) => {
    if (Array.isArray(st.playlist)) sock.copy = st.playlist;
    else if (st.playlistPatch) { const m = new Map(st.playlistPatch.upsert.map(s => [s.id, s])); sock.copy = sock.copy.map(s => m.get(s.id) || s); }
  });
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const ahost = mk('host', { view: 'arcade' });
  await until(() => ahost.ar);
  ahost.emit('host:hub:select', { game: 'music' });
  await until(() => ahost.ar.activeGame === 'music');
  const host = mk('host'); follow(host);
  const p = mk('player', { id: 'lp1', name: 'Lia' });
  await until(() => host.st && p.st);
  host.emit('host:addSongs', Array.from({ length: 400 }, (_, i) => ({ youtubeId: 'lite' + String(i).padStart(7, '0'), title: 'Song number ' + i, artist: 'Artist ' + (i % 37), category: 'Pop', year: 1980 + (i % 40) })));
  await until(() => host.st.playlist && host.st.playlist.length === 400);
  const truth = async () => { const f = mk('host'); await until(() => f.st); const l = f.st.playlist; f.close(); return l; };
  const size = (st) => JSON.stringify(st).length;

  console.log('\n# off (the default)');
  ok(host.st.settings.liteHostUpdates === false, 'the option is off by default');
  let n = host.log.length;
  p.emit('player:rename', { name: 'Lia2' });
  await until(() => host.log.length > n);
  ok(Array.isArray(host.log.at(-1).playlist) && host.log.at(-1).playlist.length === 400, 'off: every host update carries the full playlist');
  const fullSize = size(host.log.at(-1));

  console.log('\n# on');
  host.emit('host:updateSettings', { liteHostUpdates: true });
  await until(() => host.st.settings.liteHostUpdates === true);
  ok(Array.isArray(host.log.at(-1).playlist), 'the first update after switching on still has the full list');
  n = host.log.length;
  p.emit('player:rename', { name: 'Lia3' });
  await until(() => host.log.length > n);
  let last = host.log.at(-1);
  ok(last.playlist === undefined && !last.playlistPatch, 'nothing in the playlist changed: no playlist in the update');
  ok(size(last) < fullSize / 20, `that update is ${(size(last) / 1024).toFixed(1)} KB instead of ${(fullSize / 1024).toFixed(1)} KB`);
  const song = host.copy[5];
  n = host.log.length;
  host.emit('host:startRound', { id: song.id }); // marks the song played
  await until(() => host.log.length > n && host.st.roundStatus === 'playing');
  last = host.log.find((s, i) => i >= n && s.playlistPatch) || host.log.at(-1);
  ok(last.playlistPatch && last.playlistPatch.upsert.length === 1 && last.playlistPatch.upsert[0].id === song.id && last.playlistPatch.upsert[0].played === true, 'starting a round sends just that one song (now played)');
  p.emit('player:buzz');
  await until(() => host.st.roundStatus === 'buzzed');
  ok(host.st.playlist === undefined, 'a buzz: no playlist at all');
  host.emit('host:setSongPoints', { id: host.copy[9].id, points: 3 });
  await until(() => host.copy[9].points === 3);
  ok(host.copy[9].points === 3, 'a points change arrives as a patch');
  host.emit('host:setSongInfo', { id: host.copy[10].id, title: 'Renamed' });
  await until(() => host.copy[10].title === 'Renamed');
  ok(host.copy[10].title === 'Renamed', 'an edited song arrives as a patch');
  n = host.log.length;
  host.emit('host:addSong', { youtubeId: 'liteNEW0001', title: 'Brand new', artist: 'X' });
  await until(() => host.copy.length === 401);
  ok(host.log.slice(n).some(s => Array.isArray(s.playlist) && s.playlist.length === 401), 'adding a song sends the full list');
  host.emit('host:removeSong', { id: host.copy[0].id });
  await until(() => host.copy.length === 400);
  ok(host.copy.length === 400, 'removing a song sends the full list');
  ok(same(host.copy, await truth()), "after all that, the host's rebuilt playlist is exactly the server's");

  console.log('\n# a host that joins late');
  const late = mk('host'); follow(late);
  await until(() => late.st);
  ok(Array.isArray(late.log[0].playlist) && late.log[0].playlist.length === 400, 'a host page that (re)connects gets the full list straight away');
  host.emit('host:setSongPoints', { id: host.copy[20].id, points: 5 });
  await until(() => late.copy[20] && late.copy[20].points === 5);
  ok(same(late.copy, await truth()) && same(host.copy, late.copy), 'both hosts stay in step with the server');

  console.log('\n# off again');
  n = host.log.length;
  host.emit('host:updateSettings', { liteHostUpdates: false });
  await until(() => host.log.length > n);
  ok(Array.isArray(host.log.at(-1).playlist), 'switched off: full lists again');

  console.log('\n# the real host page');
  host.emit('host:closeRound');
  host.emit('host:updateSettings', { liteHostUpdates: true });
  await until(() => host.st.settings.liteHostUpdates && host.st.roundStatus === 'idle');
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/host.html');
  ok(await until(() => page.evaluate(() => document.querySelectorAll('#playlist-list .playlist-row').length > 50)), 'the playlist shows');
  const firstUnplayed = host.copy.find(s => !s.played);
  n = host.log.length;
  host.emit('host:startRound', { id: firstUnplayed.id });
  await until(() => host.st.roundStatus === 'playing');
  ok(await until(() => page.evaluate(() => /Played|Replay/i.test(document.getElementById('playlist-list').textContent) || !!document.querySelector('.playlist-row.current, .playlist-row.playing'))), 'the page picks up the patched song (played / current)');
  ok(await page.evaluate((t) => document.getElementById('current-song-title') ? document.getElementById('current-song-title').textContent.includes(t) : document.body.textContent.includes(t), firstUnplayed.title), 'the Current round card shows the right song');
  p.emit('player:buzz');
  await until(() => host.st.roundStatus === 'buzzed');
  ok(await until(() => page.evaluate(() => document.querySelectorAll('#playlist-list .playlist-row').length > 50)), 'an update without a playlist leaves the list on screen');
  ok(await page.locator('input[data-setting="liteHostUpdates"]').isChecked(), 'the switch shows as on');
  ok(!errors.length, `no page errors ${errors.join(' | ')}`);
  host.emit('host:updateSettings', { liteHostUpdates: false });

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); [ahost, host, p, late].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

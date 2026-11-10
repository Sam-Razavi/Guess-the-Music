// Editing a song's details: host:setSongInfo over the socket, then the host
// page's ✎ dialog and "＋ year" chip in a real browser. npm test -- songs
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const { launch: launchBrowser } = require('./lib/browser');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) return true; } catch (x) {} await sleep(40); } return false; }

(async () => {
  const host = io(BASE, { transports: ['websocket'], forceNew: true });
  host.on('state', s => { host.st = s; });
  host.on('connect', () => host.emit('register', { role: 'host' }));
  await until(() => host.st);
  // a fresh server starts on the game menu; the music host page needs the music game on
  host.emit('host:hub:select', { game: 'music' });
  await until(() => host.st.activeGame === 'music');
  host.emit('host:addSongs', [
    { youtubeId: 'aaaaaaaaaa1', title: 'Song One', artist: 'Ann', category: 'Pop', year: 1984 },
    { youtubeId: 'aaaaaaaaaa2', title: 'Song Two', artist: 'Bob', category: 'Rock' },
    { youtubeId: 'aaaaaaaaaa3', title: 'Old One', artist: 'Cat', category: 'Jazz', decade: '1950s' },
  ]);
  await until(() => host.st.playlist.length === 3);
  const song = (yt) => host.st.playlist.find(s => s.youtubeId === yt);
  const id1 = song('aaaaaaaaaa1').id, id2 = song('aaaaaaaaaa2').id, id3 = song('aaaaaaaaaa3').id;

  console.log('\n# host:setSongInfo');
  host.emit('host:setSongInfo', { id: id2, title: '  Song   Two (Live) ', artist: ' Bobby ', year: 1999, work: 'Some Film' });
  await until(() => song('aaaaaaaaaa2').year === 1999);
  let s2 = song('aaaaaaaaaa2');
  ok(s2.title === 'Song Two (Live)' && s2.artist === 'Bobby', 'title and artist are tidied and saved');
  ok(s2.year === 1999 && s2.decade === '1990s', 'a year sets the decade');
  ok(s2.work === 'Some Film', 'film / series saved');
  host.emit('host:setSongInfo', { id: id2, title: '   ', year: 1850 });
  host.emit('host:setSongInfo', { id: id2, year: 'soon' });
  host.emit('host:setSongInfo', { id: 'nope', title: 'X' });
  host.emit('host:setSongInfo', null);
  await sleep(300);
  s2 = song('aaaaaaaaaa2');
  ok(s2.title === 'Song Two (Live)' && s2.year === 1999, 'a blank title, a year out of range or not a number, an unknown id: ignored');
  host.emit('host:setSongInfo', { id: id2, year: '', work: '' });
  await until(() => !song('aaaaaaaaaa2').decade);
  s2 = song('aaaaaaaaaa2');
  ok(s2.year === null && s2.decade === '' && !('work' in s2), 'year "" clears the year and decade; work "" removes the film');
  host.emit('host:setSongInfo', { id: id3, artist: '' });
  await until(() => song('aaaaaaaaaa3').artist === '');
  ok(song('aaaaaaaaaa3').decade === '1950s', 'leaving the year out keeps a decade-only song\'s decade');
  const player = io(BASE, { transports: ['websocket'], forceNew: true });
  player.on('connect', () => player.emit('register', { role: 'player', id: 'p1', name: 'P' }));
  await sleep(300);
  player.emit('host:setSongInfo', { id: id1, title: 'Hacked' });
  await sleep(300);
  ok(song('aaaaaaaaaa1').title === 'Song One', 'a phone can\'t edit songs');
  player.close();

  console.log('\n# the host page');
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/host.html');
  await page.waitForSelector('#playlist-list .playlist-row');
  const row = (yt) => page.locator('.playlist-row', { has: page.locator(`[data-edit="${song(yt).id}"]`) }).first();
  ok(await row('aaaaaaaaaa2').locator('.decade-tag.missing').count() === 1, 'a song with no year shows a "＋ year" chip');
  await row('aaaaaaaaaa2').locator('.decade-tag.missing').click();
  ok(await page.locator('#song-edit').isVisible(), 'the chip opens the editor');
  ok(await page.inputValue('#se-title') === 'Song Two (Live)' && await page.inputValue('#se-artist') === 'Bobby', 'the editor is filled in');
  // a broadcast while typing must not wipe the dialog
  await page.fill('#se-year', '197');
  host.emit('host:setSongInfo', { id: id1, title: 'Song One!' });
  await until(() => song('aaaaaaaaaa1').title === 'Song One!');
  await sleep(300);
  await page.type('#se-year', '7');
  ok(await page.inputValue('#se-year') === '1977' && await page.locator('#se-decade').textContent() === '→ 1970s', 'typing survives a broadcast; it shows the decade the year gives');
  await page.fill('#se-work', 'Grease');
  await page.keyboard.press(' '); // inside an input: just a space, not "reveal"
  await page.click('#song-edit button[type="submit"]');
  ok(await until(() => song('aaaaaaaaaa2').year === 1977), 'Save sends it');
  s2 = song('aaaaaaaaaa2');
  ok(s2.decade === '1970s' && s2.work === 'Grease', 'year and film saved from the page (the stray space is trimmed)');
  ok(await page.locator('#song-edit').isHidden(), 'the dialog closes');
  await until(async () => (await row('aaaaaaaaaa2').locator('.decade-tag').textContent()) === '1970s');
  ok((await row('aaaaaaaaaa2').locator('.decade-tag').textContent()) === '1970s', 'the row now shows 1970s');
  await row('aaaaaaaaaa1').locator('.edit-btn').click();
  await page.fill('#se-year', '1700');
  await page.click('#song-edit button[type="submit"]');
  await sleep(300);
  ok(await page.locator('#song-edit').isVisible() && song('aaaaaaaaaa1').year === 1984, 'a year out of range is not sent (the dialog stays open)');
  await page.keyboard.press('Escape');
  ok(await page.locator('#song-edit').isHidden(), 'Escape closes it');
  await row('aaaaaaaaaa3').locator('.edit-btn').click();
  await page.fill('#se-title', 'Old One (1956 version)');
  await page.click('#song-edit button[type="submit"]');
  await until(() => song('aaaaaaaaaa3').title === 'Old One (1956 version)');
  ok(song('aaaaaaaaaa3').decade === '1950s', 'saving a decade-only song with the year box empty keeps its decade');
  // Space on a focused chip/button must not also press "Reveal" (it used to)
  let reveals = 0;
  host.on('state', st => { if (st.roundStatus === 'revealed') reveals++; });
  host.emit('host:startRound', { id: id1 });
  await until(() => host.st.roundStatus === 'playing');
  await row('aaaaaaaaaa2').locator('.diff-tag').focus();
  await page.keyboard.press(' ');
  await sleep(500);
  ok(host.st.roundStatus === 'playing' && reveals === 0, 'Space on a focused chip changes the chip, it doesn\'t reveal the song');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(' ');
  ok(await until(() => host.st.roundStatus === 'revealed'), 'Space with nothing focused still reveals');
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  host.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

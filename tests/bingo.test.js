// Music Bingo (games/bingo.js). Part 1 drives the module in-process with a fake
// ctx and hand-fired timers; part 2 plays over sockets on a fresh test server.
// npm test -- bingo
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const path = require('path');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(25); } return false; }

// A playlist: 40 Persian + 40 international, difficulties mixed, plus junk.
function makePlaylist() {
  const out = [];
  for (let i = 0; i < 80; i++) {
    const per = i < 40;
    out.push({ id: 's' + i, youtubeId: ('yt' + i).padEnd(11, 'x'), title: (per ? 'Ahang ' : 'Song ') + i, artist: 'Artist ' + (i % 9),
      category: per ? (i % 10 === 0 ? 'Bandari' : 'Persian Pop') : 'Pop', difficulty: ['easy', 'medium', 'hard', ''][i % 4] });
  }
  out.push({ id: 'dup', youtubeId: 'dupdupdupdu', title: 'Song 41', artist: 'Other', category: 'Pop', difficulty: 'easy' }); // same title as s41
  out.push({ id: 'broken', youtubeId: 'brokenbroke', title: 'Broken one', artist: 'X', category: 'Pop', difficulty: 'easy' });
  out.push({ id: 'notitle', youtubeId: 'notitlenoti', title: '', artist: 'X', category: 'Pop', difficulty: 'easy' });
  return out;
}

(async () => {
  console.log('\n# in-process');
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  let timers = new Map(), seq = 0;
  global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  const fire = (ms) => { for (const [id, x] of [...timers]) if (x.ms === ms) { timers.delete(id); x.fn(); return true; } return false; };
  const has = (ms) => [...timers.values()].some(x => x.ms === ms);
  let t = 1e6;
  const players = { a: 'Ana', b: 'Ben', c: 'Cy' };
  const online = new Set(['a', 'b', 'c']);
  let playlist = makePlaylist();
  const broken = new Set(['broken']);
  const sent = [], finished = [], marked = [];
  const ctx = {
    now: () => t, lang: () => 'en', exists: (p) => p in players, isConnected: (p) => online.has(p), name: (p) => players[p] || '?',
    connectedIds: () => Object.keys(players).filter(p => online.has(p)), allIds: () => Object.keys(players),
    playlist: () => playlist, isBroken: (id) => broken.has(id), markBroken: (id, m) => { broken.add(id); marked.push(id); },
    isSoundTv: (s) => !!(s && s.sound),
    broadcast() {}, broadcastSoon() {}, emitTo: (pid, ev, d) => sent.push({ pid, ev, d }), emitAll() {}, emitTv() {},
    finish: (game, groups) => finished.push({ game, groups }),
  };
  const mod = require(path.join(__dirname, '..', 'games', 'bingo'));
  let bm = mod(ctx);
  const H = (ev, d, who = {}) => bm.handlers[ev](who, d || {});
  const g = () => bm._debug();
  const TV = { socket: { sound: true } }, TV2 = { socket: { sound: false } };
  const hostSock = { emitted: [], emit(ev, d) { this.emitted.push({ ev, d }); } };
  const tvPlaying = () => H('tv:bingo:status', { songId: g().current, status: 'playing' }, TV);
  const cellOf = (pid, songId) => g().cards[pid].cells.indexOf(songId);

  // settings + pool
  ok(JSON.stringify(g().settings) === JSON.stringify({ pool: 'mix', level: 'medium', size: 4, clip: 30, prizes: 'all', help: true, auto: true, start: 'into' }), 'default settings');
  H('host:bingo:settings', { size: 7, clip: 1000, pool: 'nope', prizes: 'x', level: 'easy' });
  ok(g().settings.size === 4 && g().settings.clip === 90 && g().settings.pool === 'mix' && g().settings.level === 'easy', 'settings are validated (size 7 refused, clip clamped to 90)');
  H('host:bingo:settings', { level: 'medium', clip: 30 });
  const p0 = bm.payload('host');
  // medium = easy + medium + unrated (not hard); unique titles; no broken / untitled
  ok(p0.available === 60 && p0.needed === 16, `eligible songs counted for the host (${p0.available}, card needs ${p0.needed})`);
  H('host:bingo:settings', { pool: 'persian' });
  ok(bm.payload('host').available === 30, 'Persian-only pool (Bandari counts as Persian)');
  H('host:bingo:settings', { pool: 'mix' });

  H('host:bingo:start', {}, { socket: hostSock });
  ok(g().status === 'loading' && g().songs.size === 28, `4×4: a 28-song pool (${g().songs.size})`);
  ok(Object.keys(g().cards).length === 3 && Object.values(g().cards).every(c => c.cells.length === 16 && new Set(c.cells).size === 16 && c.cells.every(id => g().songs.has(id))), 'everyone gets 16 different songs from the pool');
  ok(![...g().songs.values()].some(s => s.id === 'broken' || s.id === 'notitle' || s.id === 'dup' && [...g().songs.values()].some(x => x.title === 'Song 41' && x.id !== 'dup')), 'no broken, untitled or same-title songs');

  // loading -> playing only on the SOUND TV's word (or the timeout)
  H('tv:bingo:status', { songId: g().current, status: 'playing' }, TV2);
  ok(g().status === 'loading', 'a muted (non-sound) TV saying "playing" is ignored');
  H('tv:bingo:status', { songId: 'other', status: 'playing' }, TV);
  ok(g().status === 'loading', 'a report about another song is ignored');
  tvPlaying();
  ok(g().status === 'playing' && g().calls.length === 1 && g().endsAt === t + 30000, 'the clip starts when the sound TV really plays it (30 s from then)');

  // privacy during the clip
  const cur = g().current, curTitle = g().songs.get(cur).title;
  const tvP = bm.payload('tv');
  ok(tvP.song === null && !JSON.stringify(tvP).includes(`"${curTitle}"`) && tvP.play.youtubeId, "the TV payload has the video id but never the current song's title");
  const holder = Object.keys(g().cards).find(id => g().cards[id].cells.includes(cur));
  const nonHolder = Object.keys(g().cards).find(id => !g().cards[id].cells.includes(cur));
  ok(bm.payload('player', 'a').claim === null && bm.payload('player', 'a').song === null, 'phones get no current song either (only their own card)');
  ok(!('play' in bm.payload('player', 'a')) && !('secret' in bm.payload('player', 'a')), 'phones never get the video id or the secret');
  ok(bm.payload('host').secret.title === curTitle, 'the host can peek');
  const aw0 = bm.payload('tv').board.map(b => b.away).join();

  // marking during the clip = sharp ear
  if (holder) H('player:bingo:mark', { cell: cellOf(holder, cur), on: true }, { playerId: holder });
  ok(!holder || g().ear[holder] === 1, 'marking the song while its clip plays counts for "sharpest ear"');
  ok(bm.payload('tv').board.map(b => b.away).join() === aw0, '"N away" on the TV does not move during the clip (it would give the song away)');
  fire(30000);
  ok(g().status === 'reveal' && bm.payload('tv').song.title === curTitle && bm.payload('player', 'a').song.title === curTitle, 'clip over: revealed everywhere');
  ok(bm.payload('player', 'a').history.length === 1, 'history lists revealed songs');
  ok(has(7000), 'auto: next song scheduled after the reveal');
  fire(7000);
  ok(g().status === 'loading' && g().callIdx === 1, 'next song loading');

  // the load timeout starts the clip without a TV
  fire(9000);
  ok(g().status === 'playing' && g().calls.length === 2, 'no word from the TV in 9 s: the clip starts anyway');
  fire(30000); fire(7000);

  // blocked: wait instead of a silent clip
  H('tv:bingo:status', { songId: g().current, status: 'blocked' }, TV);
  ok(!has(9000) && g().tv.status === 'blocked', 'TV autoplay blocked: no silent clip, the host sees it');
  tvPlaying();
  ok(g().status === 'playing', 'clicked on the TV: the clip starts');

  // a TV error skips the song and doesn't count it
  fire(30000); fire(7000);
  const bad = g().current;
  tvPlaying();
  H('tv:bingo:status', { songId: bad, status: 'error', code: 150 }, TV);
  ok(!g().calls.includes(bad) && g().skipped.includes(bad) && marked.includes(bad) && g().status === 'loading', 'a song the TV cannot play: skipped, not counted, flagged broken, next one loads');

  // pause / resume
  tvPlaying();
  t += 10000;
  H('host:bingo:pause');
  ok(g().paused && !has(30000) && g().endsAt === null, 'pause stops the clock');
  t += 60000;
  H('host:bingo:pause');
  ok(!g().paused && g().endsAt === t + 20000, 'resume picks up with the 20 s that were left');
  H('host:bingo:replay');
  ok(g().endsAt === t + 30000 && g().token > 0, 'replay restarts the clip');
  H('host:bingo:skip');
  ok(g().status === 'loading' && g().skipped.length === 2, 'host skip: the song does not count');

  // claims
  tvPlaying(); fire(30000);
  // give Ana a line made only of played songs, by hand
  const played = new Set(g().calls);
  const card = g().cards.a;
  const lines = bm._lines(4);
  const row = lines[0];
  card.cells = card.cells.slice();
  const playedList = [...played];
  row.forEach((i, k) => { card.cells[i] = playedList[k % playedList.length]; });
  // false claim first: mark the row but one cell isn't played yet
  const unplayed = [...g().songs.keys()].find(id => !played.has(id));
  const saved = card.cells[row[3]];
  card.cells[row[3]] = unplayed;
  row.forEach(i => H('player:bingo:mark', { cell: i, on: true }, { playerId: 'a' }));
  H('player:bingo:claim', {}, { playerId: 'a' });
  ok(sent.at(-1).d.ok === false && sent.at(-1).d.reason === 'false' && g().notice.kind === 'false' && g().falses.a === 1, 'a line with an unplayed song: false bingo');
  H('player:bingo:claim', {}, { playerId: 'a' });
  ok(sent.at(-1).d.reason === 'sitout', 'and Ana sits out until the next song');
  card.cells[row[3]] = saved;
  fire(7000); tvPlaying();
  // make Ben a valid line too, so he can join the claim
  const bc = g().cards.b; bc.cells = bc.cells.slice();
  const playedNow = [...new Set(g().calls)];
  lines[1].forEach((i, k) => { bc.cells[i] = playedNow[k % playedNow.length]; });
  lines[1].forEach(i => H('player:bingo:mark', { cell: i, on: true }, { playerId: 'b' }));
  H('player:bingo:claim', {}, { playerId: 'a' });
  ok(sent.at(-1).d.ok === true && g().status === 'claim' && g().claim.prize === 'line', 'next song: the same line now checks out: BINGO');
  ok(bm.payload('tv').claim.winners[0].cells.filter(c => c.hit).length === 4, "the TV gets Ana's card with the 4 winning cells");
  t += 2000;
  H('player:bingo:claim', {}, { playerId: 'b' });
  ok(g().claim.pids.join() === 'a,b', 'Ben claims within the window: they share the prize');
  fire(7500);
  ok(g().points.a === 1 && g().points.b === 1 && g().prizeIdx === 1 && g().status === 'reveal', 'both get the line (1 point); the interrupted clip is revealed; on to two lines');
  // too late for a claim that already closed
  H('player:bingo:claim', {}, { playerId: 'c' });
  ok(sent.at(-1).d.ok === false, "Cy's claim for two lines without them: refused");

  // late joiner + removal
  players.d = 'Dee'; online.add('d');
  const pd = bm.payload('player', 'd');
  ok(pd.me && pd.me.cells.length === 16, 'someone joining mid-game gets a card');
  // play the rest out
  let guard = 0;
  while (g().status !== 'final' && guard++ < 200) {
    if (g().status === 'loading') tvPlaying();
    else if (g().status === 'playing') fire(30000);
    else if (g().status === 'reveal') fire(7000);
    else if (g().status === 'claim') fire(7500);
  }
  ok(g().status === 'final', 'the pool runs out: game over');
  ok(finished.length === 1 && finished[0].groups[0].includes('a') && finished[0].groups[0].includes('b'), 'Ana and Ben go on the trophy shelf');
  ok(bm.payload('tv').awards.ear !== undefined, 'final screen has awards');

  // second game prefers songs not played tonight
  const firstPool = new Set(g().songs.keys());
  H('host:bingo:start', {}, { socket: hostSock });
  const overlap = [...g().songs.keys()].filter(id => firstPool.has(id)).length;
  ok(overlap <= 28 - Math.min(28, 60 - 28 - 2), `the next game picks songs not played yet tonight first (${overlap} repeats)`);

  // full house on a 3x3 + free middle on 5x5
  bm.leave(); bm = mod(ctx);
  H('host:bingo:settings', { size: 5, prizes: 'line' });
  H('host:bingo:start', {}, { socket: hostSock });
  ok(g().songs.size === 38 && Object.values(g().cards).every(c => c.cells.length === 25 && c.cells[12] === null && c.cells.filter(Boolean).length === 24), '5×5: a 38-song pool, 24 songs + a free middle');
  bm.leave(); bm = mod(ctx);
  H('host:bingo:settings', { size: 3, prizes: 'lineFull' });
  H('host:bingo:start', {}, { socket: hostSock });
  ok(g().songs.size === 16 && Object.values(g().cards).every(c => c.cells.length === 9), '3×3: a 16-song pool, 9 songs a card');
  // too few songs
  bm.leave(); bm = mod(ctx);
  playlist = makePlaylist().slice(0, 10);
  H('host:bingo:start', {}, { socket: hostSock });
  ok(g().status === 'lobby' && hostSock.emitted.some(e => e.ev === 'hubError' && /Only/.test(e.d.message)), 'too few songs for a card: stays in the lobby and tells the host why');
  playlist = makePlaylist();
  // removing the only winner during the BINGO moment
  bm.leave(); bm = mod(ctx);
  H('host:bingo:start', {}, { socket: hostSock });
  tvPlaying();
  const ec = g().cards.c; ec.cells = ec.cells.slice();
  const p1 = g().calls[0];
  bm._lines(4)[0].forEach(i => { ec.cells[i] = p1; ec.marks.add(i); });
  H('player:bingo:claim', {}, { playerId: 'c' });
  ok(g().status === 'claim', 'Cy calls BINGO');
  bm.onPlayerRemoved('c');
  ok(g().status === 'reveal' && !g().claim, 'Cy is removed during the moment: the claim is off and the game carries on');
  bm.leave();
  global.setTimeout = realSet; global.clearTimeout = realClear;

  console.log('\n# live server');
  const mk = (role, o = {}) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true });
    s.ev = [];
    s.on('arcade', p => { s.last = p; }); s.on('state', p => { s.st = p; });
    for (const e of ['bingo:result', 'hubError']) s.on(e, d => s.ev.push({ e, d }));
    s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: o.view || 'arcade', screen: o.screen, kiosk: o.kiosk }));
    return s;
  };
  const G = (s) => s.last && s.last.game;
  const mhost = mk('host', { view: 'music' });
  await until(() => mhost.st);
  mhost.emit('host:addSongs', makePlaylist().filter(x => x.title).map(x => ({ youtubeId: x.youtubeId, title: x.title, artist: x.artist, category: x.category, difficulty: x.difficulty || undefined })));
  await until(() => mhost.st.playlist.length >= 80);
  const host = mk('host'), tv = mk('tv', { screen: 'tv-test-1', kiosk: true });
  const P = ['Ana', 'Ben'].map((n, i) => mk('player', { id: 'lb' + i, name: n }));
  await until(() => host.last && tv.last && P.every(p => p.last));
  host.emit('host:hub:select', { game: 'bingo' });
  ok(await until(() => G(tv) && tv.last.activeGame === 'bingo' && G(tv).status === 'lobby'), 'the hub switches to Music Bingo');
  ok(G(host).available >= 50, `the host sees how many songs match (${G(host).available})`);
  host.emit('host:bingo:settings', { clip: 10 });
  await until(() => G(host).settings.clip === 10);
  host.emit('host:bingo:start');
  ok(await until(() => G(P[0]) && G(P[0]).me && G(P[0]).me.cells.length === 16), 'phones get their cards');
  ok(await until(() => G(tv).status === 'loading' && G(tv).play && G(tv).upNext), 'the TV gets the song to play and the next one to preload');
  tv.emit('tv:bingo:status', { songId: G(tv).play.songId, status: 'playing' });
  ok(await until(() => G(tv).status === 'playing'), "the kiosk TV's report starts the clip");
  const me0 = G(P[0]).me;
  P[0].emit('player:bingo:mark', { cell: 2, on: true });
  ok(await until(() => G(P[0]).me.marks.includes(2)), 'a mark is saved');
  P[0].emit('player:bingo:mark', { cell: 2, on: false });
  ok(await until(() => !G(P[0]).me.marks.includes(2)), 'and can be undone');
  P[0].emit('player:bingo:claim');
  ok(await until(() => P[0].ev.some(x => x.e === 'bingo:result' && x.d.ok === false)), 'an empty-card BINGO is refused with a reason');
  ok(me0.cells.every(c => typeof c.title === 'string' && c.title), 'card cells carry titles');
  P[1].emit('host:bingo:end');
  await sleep(200);
  ok(G(tv).status === 'playing', 'a player cannot end the game');
  host.emit('host:bingo:end');
  ok(await until(() => G(tv).status === 'final'), 'the host can end it');
  host.emit('host:hub:select', { game: 'hub' });
  await until(() => tv.last.activeGame === 'hub');

  console.log(`\n${pass} passed, ${fail} failed`);
  [mhost, host, tv, ...P].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

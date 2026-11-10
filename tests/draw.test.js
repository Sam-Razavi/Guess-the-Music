// Draw It! (games/draw.js). Part 1 drives the module in-process with a fake ctx
// and captured timers; part 2 runs against a fresh test server. npm test -- draw
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const path = require('path');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(30); } console.log('    (timeout)', fn.toString().slice(0, 90)); return false; }
const WORDS = require(path.join(__dirname, '..', 'games', 'data', 'draw-words'));

(async () => {
  console.log('\n# word bank');
  for (const L of ['fa', 'en']) {
    const all = [...WORDS[L].easy, ...WORDS[L].hard];
    ok(WORDS[L].easy.length >= 80 && WORDS[L].hard.length >= 60, `${L}: ${WORDS[L].easy.length} easy + ${WORDS[L].hard.length} hard words`);
    ok(new Set(all).size === all.length, `${L}: no duplicates`);
    ok(all.every(w => w === w.trim() && !w.includes('//') && !w.startsWith('/') && !w.endsWith('/')), `${L}: clean entries`);
  }

  console.log('\n# in-process: matching, hints, timers');
  // Capture the module's timers so they can be fired by hand.
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  let timers = new Map(), seq = 0;
  global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  const fire = (ms) => { for (const [id, x] of [...timers]) if (x.ms === ms) { timers.delete(id); x.fn(); return true; } return false; };
  let lang = 'en', t = 1e6;
  const players = { a: 'Ali', b: 'Bita', c: 'Cyrus' };
  const online = new Set(['a', 'b', 'c']);
  const sent = [];
  const ctx = {
    now: () => t, lang: () => lang, exists: (p) => p in players, isConnected: (p) => online.has(p), name: (p) => players[p] || '?',
    players: () => Object.keys(players).map(id => ({ id, name: players[id], connected: online.has(id) })),
    connectedIds: () => Object.keys(players).filter(p => online.has(p)), allIds: () => Object.keys(players),
    broadcast() {}, broadcastSoon() {}, emitTo: (pid, ev, d) => sent.push({ pid, ev, d }), emitTv() {}, emitAll() {}, finish() {},
  };
  const mod = require(path.join(__dirname, '..', 'games', 'draw'));
  let dm = mod(ctx);
  const H = (ev, d, pid) => dm.handlers[ev]({ playerId: pid }, d || {});
  const g = () => dm._debug();
  const startWith = (word, hard, l = 'en') => {
    lang = l;
    dm.leave(); dm = mod(ctx); timers.clear();
    H('host:draw:settings', { choice: false });
    H('host:draw:start');
    // replace the dealt word with a known one
    const w = String(word).split('/');
    g().word = { raw: word, text: w[0], keys: w.map(x => require(path.join(__dirname, '..', 'games', 'common')).answerKey(x)), hard: !!hard };
    return g().drawer;
  };
  const guessers = () => Object.keys(players).filter(p => p !== g().drawer);
  const lastResult = (pid) => [...sent].reverse().find(x => x.pid === pid && x.ev === 'draw:result');

  let d = startWith('Cat', false);
  let [x, y] = guessers();
  H('player:draw:guess', { text: 'the cats' }, x);
  ok(g().guessed.length === 1 && g().guessed[0].pid === x, 'English: "the cats" counts for Cat (article and plural)');
  t += 1000;
  H('player:draw:guess', { text: 'Kat' }, y);
  ok(lastResult(y).d.ok === false, '"Kat" for Cat is just wrong (no "so close" hints on 3-letter words)');
  t += 200;
  H('player:draw:guess', { text: 'dog' }, y);
  ok(g().guessed.length === 1, 'a guess within 0.5 s of the last one is ignored');
  t += 600;
  H('player:draw:guess', { text: 'category' }, y);
  ok(g().guessed.length === 1 && g().feed.some(f => f.text === 'category'), '"category" is not "cat"; wrong guesses go on the TV feed');

  d = startWith('Pizza', false);
  [x, y] = guessers();
  H('player:draw:guess', { text: 'piza' }, y);
  ok(lastResult(y).d.close === true && !g().feed.some(f => f.text === 'piza'), '"piza" is "so close" for that player only, never on the TV feed');
  t += 1000;
  H('player:draw:guess', { text: 'pasta' }, x);
  ok(lastResult(x).d.ok === false && g().feed.some(f => f.text === 'pasta'), '"pasta" is two letters off: plain wrong');

  d = startWith('هندونه/هندوانه', false, 'fa');
  [x, y] = guessers();
  H('player:draw:guess', { text: 'یه هندوانه' }, x);
  ok(g().guessed.some(q => q.pid === x), 'Persian: the written spelling and "یه ..." both count');
  t += 1000;
  H('player:draw:guess', { text: 'هندونه‌ها' }, y);
  ok(g().guessed.some(q => q.pid === y), 'Persian plural with a half-space counts');

  d = startWith('کیک تولد', false, 'fa');
  [x] = guessers();
  H('player:draw:guess', { text: 'كيك‌تولد' }, x);
  ok(g().guessed.some(q => q.pid === x), 'Arabic-keyboard ك/ي and a half-space instead of a space still count');

  d = startWith('در', false, 'fa');
  [x] = guessers();
  H('player:draw:guess', { text: 'دریا' }, x);
  ok(!g().guessed.length, 'a short word is not matched inside a longer one (در vs دریا)');

  console.log('\n# in-process: scoring and hints');
  d = startWith('Roller coaster', true);
  [x, y] = guessers();
  const pat = g().word.text;
  fire(80000 * 0.5);
  fire(80000 * 0.75);
  const shown = g().revealed.length;
  ok(shown === 2, 'two letters are uncovered (half time and three quarters)');
  H('player:draw:guess', { text: 'roller coaster' }, x);
  t += 1000;
  H('player:draw:guess', { text: 'rollercoaster' }, y);
  ok(g().scores[x] === 6 && g().scores[y] === 4 && g().scores[d] === 4, `hard word: 1st 3×2, 2nd 2×2, artist 2×2 (${g().scores[x]}/${g().scores[y]}/${g().scores[d]})`);
  ok(timers.size && [...timers.values()].some(v => v.ms === 1500), 'everyone guessed: the reveal is 1.5 s away');
  fire(1500);
  ok(g().status === 'reveal' && g().gallery.length === 0, 'reveal (no strokes: nothing for the gallery)');

  d = startWith('Ox', false);
  fire(40000); fire(60000);
  ok(g().revealed.length === 0, 'a 2-letter word gets no letter hints');
  d = startWith('Pig', false);
  fire(40000); fire(60000);
  ok(g().revealed.length === 1, 'a 3-letter word gets one hint at most');

  console.log('\n# in-process: choosing, skipping, no repeats');
  lang = 'en';
  dm.leave(); dm = mod(ctx); timers.clear();
  H('host:draw:start');
  ok(g().status === 'choosing' && g().offer.length === 3 && !g().offer[0].hard && !g().offer[1].hard && g().offer[2].hard, 'word choice: two easy words and one hard');
  fire(15000);
  ok(g().status === 'drawing' && !g().word.hard, 'nobody picked in 15 s: an easy word is drawn');
  online.delete(g().queue[0]);
  const skipped = g().queue[0];
  H('host:draw:endTurn');
  H('host:draw:next');
  ok(g().drawer !== skipped && g().totalTurns === 2, 'a player who left is skipped and the turn count shrinks');
  online.add(skipped);
  // no repeats across games tonight
  const seenWords = new Set();
  let repeats = 0;
  for (let i = 0; i < 25; i++) {
    H('host:draw:end'); H('host:draw:start');
    if (g().status !== 'choosing') break;
    H('player:draw:choose', { index: i % 3 }, g().drawer);
    if (seenWords.has(g().word.raw)) repeats++;
    seenWords.add(g().word.raw);
  }
  ok(repeats === 0 && seenWords.size === 25, `no word drawn twice in 25 games (${seenWords.size} words)`);
  dm.leave();
  global.setTimeout = realSet; global.clearTimeout = realClear;

  console.log('\n# live server');
  const mk = (role, o = {}) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true });
    s.events = [];
    s.on('arcade', p => { s.last = p; });
    for (const ev of ['draw:pts', 'draw:all', 'draw:sync', 'draw:result', 'draw:gallery']) s.on(ev, d => s.events.push({ ev, d }));
    s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: 'arcade' }));
    return s;
  };
  const host = mk('host'), tv = mk('tv');
  const P = ['Ali', 'Bita', 'Cyrus', 'Dara'].map((n, i) => mk('player', { id: 'd' + i, name: n }));
  const byId = Object.fromEntries(P.map((s, i) => ['d' + i, s]));
  await until(() => host.last && host.last.players.filter(p => p.connected).length === 4);
  host.emit('host:setLanguage', 'en');
  host.emit('host:hub:select', { game: 'draw' });
  await until(() => tv.last && tv.last.activeGame === 'draw' && tv.last.game);
  const G = (s) => s.last.game;
  ok(G(host).settings.choice === true && G(host).settings.seconds === 80, 'defaults: word choice on, 80 seconds');
  host.emit('host:draw:settings', { seconds: 9999, turns: 7, autoNext: 0 });
  await until(() => G(host).settings.autoNext === 0);
  ok(G(host).settings.seconds === 240 && G(host).settings.turns === 3, 'settings are clamped');
  host.emit('host:draw:settings', { seconds: 60, turns: 1 });
  host.emit('host:draw:start');
  await until(() => G(host).status === 'choosing');
  const artistId = G(host).drawer.id;
  const artist = byId[artistId];
  const others = P.filter(s => s !== artist);
  ok(G(artist).offer && G(artist).offer.length === 3, 'the artist gets three words to pick from');
  ok(!G(tv).offer && !G(host).offer && others.every(s => !G(s).offer), 'nobody else sees them (TV, host, other phones)');
  others[0].emit('player:draw:choose', { index: 2 });
  await sleep(200);
  ok(G(host).status === 'choosing', 'only the artist can pick');
  artist.emit('player:draw:choose', { index: 2 });
  await until(() => G(tv).status === 'drawing');
  const word = G(artist).word;
  ok(word && G(tv).word === null && G(host).word === null && others.every(s => G(s).word === null), 'the word: artist only (not the TV, host or guessers)');
  ok(G(tv).hard === true && G(tv).pattern.filter(c => c === '_').length === [...word].filter(c => !/[\s‌-]/.test(c)).length, 'TV gets the ×2 flag and one blank per letter');

  console.log('\n# strokes');
  artist.emit('player:draw:stroke', { i: 0, c: 1, w: 2, p: [10, 20, 30, 40] });
  artist.emit('player:draw:stroke', { i: 0, c: 1, w: 2, p: [50, 60, 5000, -9] });
  artist.emit('player:draw:stroke', { i: 5, c: 1, w: 2, p: [1, 1] });
  others[0].emit('player:draw:stroke', { i: 1, c: 0, w: 0, p: [1, 1, 2, 2] });
  artist.emit('player:draw:stroke', { i: 1, c: 99, w: 'x', p: [100, 100, 'a', 2, 200, 200] });
  await until(() => tv.events.filter(e => e.ev === 'draw:pts').length >= 3);
  const pts = tv.events.filter(e => e.ev === 'draw:pts').map(e => e.d);
  ok(pts.length === 3 && pts[0].i === 0 && pts[1].p.join() === '50,60,1000,0', 'batches reach the TV; points are clamped to the paper');
  ok(pts[2].c === 9 && pts[2].w === 1 && pts[2].p.join() === '100,100,200,200', 'a bad colour/size is clamped, junk points dropped');
  ok(others[1].events.some(e => e.ev === 'draw:pts'), 'guessers\' phones get the drawing too');
  tv.emit('hub:sync');
  await until(() => tv.events.some(e => e.ev === 'draw:sync'));
  const synced = tv.events.find(e => e.ev === 'draw:sync').d;
  ok(synced.strokes.length === 2 && synced.strokes[0].p.length === 8, 'hub:sync returns the whole drawing (2 strokes, 4 points in the first)');
  const late = mk('tv');
  await until(() => late.last && late.last.game);
  late.emit('hub:sync');
  ok(await until(() => late.events.some(e => e.ev === 'draw:sync' && e.d.strokes.length === 2)), 'a TV opened mid-drawing catches up');
  late.close();
  artist.emit('player:draw:undo');
  ok(await until(() => tv.events.some(e => e.ev === 'draw:all' && e.d.strokes.length === 1)), 'undo sends the drawing minus its last stroke');
  others[0].emit('player:draw:clear');
  await sleep(200);
  ok(!tv.events.some(e => e.ev === 'draw:all' && e.d.strokes.length === 0), 'a guesser cannot clear the drawing');
  artist.emit('player:draw:stroke', { i: 1, c: 2, w: 0, p: 'nope' });
  artist.emit('player:draw:stroke', null);
  others[0].emit('player:draw:undo', 'x');

  console.log('\n# guesses');
  const [g1, g2, g3] = others;
  g1.emit('player:draw:guess', { text: 'definitely-not-it' });
  ok(await until(() => G(tv).feed.some(f => f.text === 'definitely-not-it' && f.name)), 'a wrong guess shows on the TV with the name');
  g1.emit('player:draw:guess', { text: word.toUpperCase() });
  await sleep(150);
  ok(!G(host).guessed.length, 'too soon after the last guess: ignored');
  await sleep(450);
  g1.emit('player:draw:guess', { text: word.toUpperCase() });
  ok(await until(() => G(host).guessed.length === 1), 'right guess (any case)');
  ok(G(g1).word === word && G(g1).iGuessed && G(g2).word === null, 'whoever got it now sees the word; the others still don\'t');
  ok(g1.events.some(e => e.ev === 'draw:result' && e.d.ok && e.d.pts === 6), 'first right guess on a hard word: +6');
  artist.emit('player:draw:guess', { text: word });
  g1.emit('player:draw:guess', { text: word });
  await sleep(600);
  ok(G(host).guessed.length === 1, 'the artist and someone who already got it can\'t guess');
  g2.emit('player:draw:guess', { text: ' ' + word.toLowerCase() + ' ' });
  g3.emit('player:draw:guess', { text: word });
  ok(await until(() => G(tv).status === 'reveal', 4000), 'everyone got it: reveal');
  ok(G(tv).word === word && G(tv).turnPoints[artistId] === 6, 'TV shows the word; the artist got 2 per right guess (×2 hard)');
  ok(JSON.stringify(G(tv).guessed.map(q => q.pts)) === '[6,4,2]', 'guessers: 6, 4, 2');

  console.log('\n# next turns, leaving, the end');
  host.emit('host:draw:next');
  await until(() => G(host).status === 'choosing');
  ok(G(host).drawer.id !== artistId && G(host).turnNo === 2, 'next artist');
  tv.emit('hub:sync');
  ok(await until(() => tv.events.filter(e => e.ev === 'draw:sync').pop().d.strokes.length === 0), 'a new turn starts with blank paper');
  const second = G(host).drawer.id;
  host.emit('host:removePlayer', { id: second });
  ok(await until(() => G(host).drawer && G(host).drawer.id !== second && G(host).turnNo === 2), 'the artist removed mid-turn: the next one is up');
  host.emit('host:draw:skip');
  await until(() => G(host).turnNo === 2 && G(host).drawer && G(host).status === 'choosing');
  host.emit('host:draw:end');
  ok(await until(() => G(tv).status === 'final'), 'end game: final');
  ok(await until(() => tv.events.some(e => e.ev === 'draw:gallery')), 'the gallery arrives at the end');
  const gal = tv.events.find(e => e.ev === 'draw:gallery').d;
  ok(gal.length === 1 && gal[0].word === word && gal[0].strokes.length === 1, 'gallery: the one drawing, with its word');
  // only turn 1 had right guesses: its first guesser is the sharpest eye, unless they were the one removed above
  ok(G(tv).awards && G(tv).awards.artist && (G(tv).awards.eye || second === g1.last.me.id), 'awards: best artist and sharpest eye');
  host.emit('host:hub:select', { game: 'hub' });
  ok(await until(() => tv.last.activeGame === 'hub' && tv.last.hub.trophies.some(x => x.game === 'draw')), 'the winner goes on the trophy shelf');

  console.log(`\n${pass} passed, ${fail} failed`);
  [host, tv, ...P].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

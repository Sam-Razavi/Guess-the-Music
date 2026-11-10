// Pantomime's 🔞 18+ category. Part 1 drives the game module in-process with a fake
// ctx (so the whole deck can be inspected); part 2 runs against a fresh test server (npm test).
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const path = require('path');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(40); } console.log('    (timeout)', fn.toString().slice(0, 90)); return false; }
const REPO = path.join(__dirname, '..', 'games');
const ADULT = require(path.join(REPO, 'data/pantomime-adult'));
const WORDS = require(path.join(REPO, 'data/pantomime-words'));
const adultSet = new Set([...ADULT.fa.easy, ...ADULT.fa.hard, ...ADULT.en.easy, ...ADULT.en.hard]);

(async () => {
  console.log('\n# word lists');
  for (const L of ['fa', 'en']) {
    const all = [...ADULT[L].easy, ...ADULT[L].hard];
    ok(ADULT[L].easy.length >= 60 && ADULT[L].hard.length >= 45, `${L}: ${ADULT[L].easy.length} easy + ${ADULT[L].hard.length} hard 18+ words`);
    ok(new Set(all).size === all.length, `${L}: no duplicates`);
    ok(all.every(w => typeof w === 'string' && w.trim() === w && w.length && w.length <= 40), `${L}: clean strings (no stray spaces, ≤ 40 chars)`);
    ok(!all.some(w => w.includes('·')), `${L}: no middle dots`);
  }
  ok(!Object.values(WORDS).some(b => Object.values(b).some(list => list.some(w => adultSet.has(w)))), 'no 18+ word sits in the clean bank (which Spy also uses)');
  ok(!('adult' in WORDS.en) && !('adult' in WORDS.fa), 'the clean bank has no adult category');

  console.log('\n# game module with a fake ctx');
  let lang = 'fa', t = 1e6;
  const players = { a: 'Ali', b: 'Bita', c: 'Cyrus', d: 'Dara' };
  const ctx = {
    now: () => t, lang: () => lang, exists: (p) => p in players, isConnected: (p) => p in players, name: (p) => players[p] || '?',
    connectedIds: () => Object.keys(players), allIds: () => Object.keys(players), broadcast() {}, broadcastSoon() {}, emitTo() {}, emitTv() {}, emitAll() {}, finish() {},
  };
  const mod = require(path.join(REPO, 'pantomime'));
  let pm = mod(ctx);
  const H = (ev, d, pid) => pm.handlers[ev]({ playerId: pid }, d || {});
  const g = () => pm._debug();
  // a brand-new game module (nothing played tonight yet)
  const fresh = () => { pm.leave(); pm = mod(ctx); };
  ok(mod.CATEGORIES.includes('adult'), 'adult is in the category list');
  ok(!g().settings.categories.includes('adult'), 'adult is OFF by default');
  ok(pm.payload('host').categoriesAll.includes('adult'), 'host picker offers it');

  const deckOf = (cats, l) => {
    fresh();
    lang = l;
    H('host:pantomime:settings', { categories: cats, choice: false });
    H('host:pantomime:start'); // builds a fresh deck on the first draw
    H('host:pantomime:go');
    const words = [g().word, ...g().deck];
    H('host:pantomime:end'); H('host:pantomime:newGame');
    return words;
  };
  const clean = deckOf(mod.DEFAULT_CATEGORIES, 'fa');
  ok(clean.length > 300 && !clean.some(w => w.cat === 'adult' || adultSet.has(w.text)), `default deck: ${clean.length} words, none 18+`);
  const onlyFa = deckOf(['adult'], 'fa');
  ok(onlyFa.length === ADULT.fa.easy.length + ADULT.fa.hard.length && onlyFa.every(w => w.cat === 'adult'), `18+ only (fa): the whole deck is the ${onlyFa.length} Persian 18+ words`);
  ok(onlyFa.every(w => w.points === (ADULT.fa.hard.includes(w.text) ? 2 : 1)), 'easy cards are 1 point, hard ones 2');
  const onlyEn = deckOf(['adult'], 'en');
  ok(onlyEn.every(w => ADULT.en.easy.includes(w.text) || ADULT.en.hard.includes(w.text)), '18+ only (en): English words when the TV is in English');
  const mixed = deckOf([...mod.DEFAULT_CATEGORIES, 'adult'], 'fa');
  ok(mixed.filter(w => w.cat === 'adult').length === onlyFa.length && mixed.length === clean.length + onlyFa.length, 'mixed deck = clean words + 18+ words');
  H('host:pantomime:settings', { categories: ['adult', 'bogus'] });
  ok(g().settings.categories.join() === 'adult', 'unknown categories are dropped');
  H('host:pantomime:settings', { categories: ['bogus'] });
  ok(g().settings.categories.join() === 'adult', 'a patch with nothing valid changes nothing');

  // choice mode with only 18+ on: still one easy (1) and one hard (2) card
  fresh();
  lang = 'fa';
  H('host:pantomime:settings', { categories: ['adult'], choice: true, customWords: false });
  H('host:pantomime:start'); H('host:pantomime:go');
  let fine = true;
  for (let i = 0; i < 12; i++) {
    const o = g().offer;
    if (!o || o[0].points !== 1 || o[1].points !== 2 || o.some(w => w.cat !== 'adult')) fine = false;
    t += 1000; H('player:pantomime:choose', { index: i % 2 }, g().actor);
    t += 1000; H('player:pantomime:correct', {}, g().actor);
  }
  ok(fine, 'choice mode with only 18+: every pick is an easy 18+ card vs a hard one');
  ok(g().scores[g().team] === 6 * 1 + 6 * 2, `scores follow the card (${g().scores[g().team]} = 6×1 + 6×2)`);
  H('host:pantomime:end');

  // choice off + the other categories: points still follow the card, not the category
  H('host:pantomime:newGame');
  H('host:pantomime:settings', { categories: ['adult', 'movie'], choice: true });
  H('host:pantomime:start'); H('host:pantomime:go');
  let split = true;
  for (let i = 0; i < 10; i++) {
    const o = g().offer;
    if (!o || o[0].points !== 1 || o[1].points !== 2 || o[0].cat !== 'adult') split = false; // the only 1-pt cards are 18+ easy ones
    t += 1000; H('player:pantomime:choose', { index: 0 }, g().actor);
    t += 1000; H('player:pantomime:skip', {}, g().actor);
    if (g().skipsUsed >= g().settings.skips) break;
  }
  ok(split, '18+ + films: the easy card comes from 18+, the hard one from either');

  console.log('\n# no repeats tonight');
  fresh();
  lang = 'fa';
  const total = ADULT.fa.easy.length + ADULT.fa.hard.length;
  H('host:pantomime:settings', { categories: ['adult'], choice: false, customWords: false });
  const games = [];
  const playGame = (n) => {
    H('host:pantomime:start'); H('host:pantomime:go');
    const words = [g().word.text];
    while (words.length < n) { t += 1000; H('host:pantomime:correct'); words.push(g().word.text); }
    H('host:pantomime:end'); H('host:pantomime:newGame');
    return words;
  };
  const per = Math.floor(total / 4);
  for (let i = 0; i < 4; i++) games.push(playGame(i < 3 ? per : total - 3 * per));
  const allPlayed = games.flat();
  ok(new Set(games[0]).size === games[0].length, 'no word twice within a game');
  ok(!games[1].some(w => games[0].includes(w)), 'the second 18+ game deals different words from the first');
  ok(new Set(allPlayed).size === total, `four games in a row used all ${total} words exactly once`);
  const g5 = playGame(5);
  ok(g5.length === 5 && g5.every(w => adultSet.has(w)), 'after that the cycle starts over (no running out)');
  // a category that only has hard cards keeps its memory too
  fresh();
  H('host:pantomime:settings', { categories: ['movie'], choice: false });
  const m1 = playGame(10), m2 = playGame(10);
  ok(!m2.some(w => m1.includes(w)), 'films (all hard cards) do not repeat between games either');
  // 18+ words played tonight don't block the clean categories
  fresh();
  H('host:pantomime:settings', { categories: ['adult', 'food'], choice: true });
  H('host:pantomime:start'); H('host:pantomime:go');
  ok(g().offer && g().offer[0].points === 1 && g().offer[1].points === 2, 'choice mode still offers easy + hard with seen-words memory');
  pm.leave();

  console.log('\n# live instance');
  const mk = (role, o = {}) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true });
    s.on('arcade', p => { s.last = p; });
    s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: 'arcade' }));
    return s;
  };
  const host = mk('host'), tv = mk('tv');
  const P = ['Ali', 'Bita', 'Cyrus', 'Dara'].map((n, i) => mk('player', { id: 'x' + i, name: n }));
  const byId = Object.fromEntries(P.map((s, i) => ['x' + i, s]));
  await until(() => host.last && host.last.players.filter(p => p.connected).length === 4);
  host.emit('host:setLanguage', 'fa');
  host.emit('host:hub:select', { game: 'pantomime' });
  await until(() => host.last.activeGame === 'pantomime' && tv.last && tv.last.game);
  const G = (s) => s.last.game;
  ok(!G(tv).settings.categories.includes('adult') && G(host).categoriesAll.includes('adult'), 'fresh server: 18+ offered but off');
  host.emit('host:pantomime:settings', { categories: ['adult'], choice: true, customWords: false, seconds: 60 });
  await until(() => G(tv).settings.categories.join() === 'adult');
  ok(P.every(s => G(s).settings.categories.join() === 'adult'), 'phones learn that 18+ is on (for the lobby notice)');
  host.emit('host:pantomime:start');
  await until(() => G(host).status === 'ready');
  host.emit('host:pantomime:go');
  await until(() => G(host).status === 'acting' && G(host).offer);
  const actor = G(host).actor.id;
  const actorTeam = G(host).team;
  ok(G(byId[actor]).offer.every(w => w.cat === 'adult' && ADULT.fa.easy.concat(ADULT.fa.hard).includes(w.text)), 'actor is offered two Persian 18+ cards');
  ok(!G(tv).offer && !G(tv).word, 'TV never gets the words');
  const teammate = P.find(s => s.last.me.id !== actor && G(s).myTeam === actorTeam);
  if (teammate) ok(!G(teammate).offer && !G(teammate).word, 'the actor\'s own team does not see them');
  await sleep(700);
  byId[actor].emit('player:pantomime:choose', { index: 1 });
  await until(() => G(tv).wordCat);
  ok(G(tv).wordCat === 'adult' && G(tv).wordPoints === 2 && !G(tv).word, 'TV shows the 18+ category and 2 points, not the word');
  host.emit('host:pantomime:end');
  await until(() => G(host).status === 'final');
  host.emit('host:pantomime:newGame');
  await until(() => G(host).status === 'lobby');
  ok(G(host).settings.categories.join() === 'adult', 'the choice stays for the next game tonight');
  host.emit('host:pantomime:settings', { categories: ['movie', 'proverb', 'job', 'animal', 'action', 'object', 'sport', 'food', 'famous'] });
  ok(await until(() => !G(tv).settings.categories.includes('adult')), 'host can switch back to the clean categories');

  console.log(`\n${pass} passed, ${fail} failed`);
  [host, tv, ...P].forEach(s => s.close());
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

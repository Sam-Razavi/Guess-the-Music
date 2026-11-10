// String parity + Esm-Famil late-answer window. Needs a fresh test server (npm test).
const BASE = process.env.TEST_URL || 'http://localhost:3999';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { io } = require('socket.io-client');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const e = Date.now() + ms; while (Date.now() < e) { try { if (fn()) return true; } catch (x) {} await sleep(40); } return false; }

console.log('# strings');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'hub', 'js', 'strings.js'), 'utf8'), ctx);
const S = ctx.window.HUB_STRINGS;
const en = Object.keys(S.en), fa = Object.keys(S.fa);
const missingFa = en.filter(k => !(k in S.fa)), missingEn = fa.filter(k => !(k in S.en));
ok(!missingFa.length, `every English key has a Farsi one ${missingFa.join(',')}`);
ok(!missingEn.length, `every Farsi key has an English one ${missingEn.join(',')}`);
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const badPh = en.filter(k => k in S.fa && ph(S.en[k]) !== ph(S.fa[k]));
ok(!badPh.length, `placeholders match in both languages ${badPh.join(',')}`);
// every key the views use exists
const used = new Set();
for (const f of fs.readdirSync(path.join(__dirname, '..', 'public', 'hub', 'js'))) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'hub', 'js', f), 'utf8');
  for (const m of src.matchAll(/'((?:core|hub|ef|gp|pm|ml|mf|spy|team|game)\.[a-zA-Z0-9.]+)'/g)) used.add(m[1]);
}
for (const f of fs.readdirSync(path.join(__dirname, '..', 'public', 'hub'))) if (f.endsWith('.html')) {
  for (const m of fs.readFileSync(path.join(__dirname, '..', 'public', 'hub', f), 'utf8').matchAll(/data-t(?:-placeholder)?="([^"]+)"/g)) used.add(m[1]);
}
const dyn = [];
for (const g of ['music', 'esmfamil', 'golpooch', 'pantomime', 'mostlikely', 'mafia', 'spy']) dyn.push(`game.${g}.name`, `game.${g}.tag`);
for (const g of ['esmfamil', 'golpooch', 'pantomime', 'mostlikely', 'mafia', 'spy']) for (const i of [1, 2, 3]) dyn.push(`${g}.how${i}`);
for (const c of ['name', 'family', 'city', 'country', 'food', 'animal', 'color', 'object', 'fruit', 'flower', 'car', 'job', 'sport', 'movie', 'singer', 'brand', 'body', 'celebrity']) dyn.push(`ef.cat.${c}`);
for (const r of ['empty', 'letter', 'voted', 'host']) dyn.push(`ef.reason.${r}`);
for (const t of ['red', 'blue', 'green', 'gold']) dyn.push(`team.${t}`);
for (const r of ['poochedGol', 'wrongGol', 'found', 'bullseye', 'elimination']) dyn.push(`gp.res.${r}`);
for (const c of ['movie', 'proverb', 'job', 'animal', 'action', 'object', 'sport', 'food', 'famous']) dyn.push(`pm.cat.${c}`);
for (const r of ['godfather', 'mafia', 'doctor', 'detective', 'sniper', 'citizen']) dyn.push(`mf.role.${r}`, `mf.desc.${r}`, `mf.night.${r}`);
for (const c of ['place', 'food', 'job', 'animal', 'sport', 'object']) dyn.push(`spy.cat.${c}`);
const missing = [...used, ...dyn].filter(k => !(k in S.en));
ok(!missing.length, `every key used by the pages is defined (${used.size + dyn.length} keys) ${missing.join(',')}`);

(async () => {
  console.log('# esmfamil late answers');
  const mk = (role, o = {}) => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); s.on('arcade', p => { s.last = p; }); s.on('connect', () => s.emit('register', { role, id: o.id, name: o.name, view: 'arcade' })); return s; };
  const host = mk('host'); const a = mk('player', { id: 'x1', name: 'A' }); const b = mk('player', { id: 'x2', name: 'B' });
  await until(() => host.last && host.last.players.length >= 2);
  host.emit('host:hub:select', { game: 'esmfamil' });
  await until(() => host.last.activeGame === 'esmfamil');
  host.emit('host:esmfamil:settings', { categories: ['name', 'city', 'food'], alphabet: 'en', stopGrace: 0 });
  await until(() => host.last.game.settings.alphabet === 'en');
  host.emit('host:esmfamil:start', { letter: 'B' });
  await until(() => host.last.game.status === 'writing', 8000);
  a.emit('player:esmfamil:answer', { cat: 'name', text: 'Bob' });
  await sleep(200);
  host.emit('host:esmfamil:forceStop');
  await until(() => host.last.game.status === 'review');
  b.emit('player:esmfamil:answer', { cat: 'name', text: 'Ben' }); // arrives ~instantly after the lock
  await until(() => host.last.game.answers.x2 && host.last.game.answers.x2.name === 'Ben', 2000);
  ok(host.last.game.answers.x2.name === 'Ben', 'answer arriving right after pens-down still counts');
  await sleep(1700);
  b.emit('player:esmfamil:answer', { cat: 'city', text: 'Bonn' });
  await sleep(300);
  ok(!host.last.game.answers.x2.city, 'but not once the grace window has passed');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

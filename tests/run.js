// Runs the test suites. Each suite gets its own fresh server (the real server.js)
// on a throwaway data folder, so the tests never touch the real playlist, players
// or settings, and one suite's leftovers can't affect the next.
//
//   npm test                     every suite
//   npm test -- hub pin          only these (file name without .test.js)
//   npm test -- --no-browser     skip the suites that drive a real browser
//   npm test -- -v               print every check, not just failures
//
// Needs port 3999 free (the live game uses 3000, so it can keep running).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT) || 3999;
const BASE = `http://localhost:${PORT}`;

const SUITES = [
  { name: 'misc' },                       // EN/FA string parity + late answers
  { name: 'hub' },                        // hub + every party game over sockets
  { name: 'expand' },                     // the Phase 34 expansions
  { name: 'edge' },                       // absent players, reconnects, leaving mid-round
  { name: 'adult' },                      // Pantomime's 18+ category
  { name: 'music' },                      // the music game still works next to the hub
  { name: 'switch', browser: true },      // music <-> hub page hand-off
  { name: 'ui', browser: true },          // real clicks on host/phone pages
  { name: 'pin', browser: true, env: { JOIN_PIN: '4321' } },
];

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const noBrowser = args.includes('--no-browser');
const only = args.filter(a => !a.startsWith('-'));
const unknown = only.filter(n => !SUITES.some(s => s.name === n));
if (unknown.length) { console.error(`Unknown suite(s): ${unknown.join(', ')}. Known: ${SUITES.map(s => s.name).join(', ')}`); process.exit(2); }
const chosen = SUITES.filter(s => (!only.length || only.includes(s.name)) && !(noBrowser && s.browser));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const answers = () => new Promise((resolve) => {
  const req = http.get(BASE + '/join-info', (res) => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.setTimeout(1500, () => { req.destroy(); resolve(false); });
});

async function startServer(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-test-'));
  const log = [];
  // cwd = the empty folder, so dotenv finds no .env (no real API keys or PIN).
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: dir,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: dir, NO_MDNS: '1',
      JOIN_PIN: '', YOUTUBE_API_KEY: '', ANTHROPIC_API_KEY: '', PLAYBACK_REGION: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => log.push(String(d)));
  child.stderr.on('data', d => log.push(String(d)));
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) break;
    if (await answers()) return { child, dir, log };
    await sleep(250);
  }
  child.kill();
  throw new Error('test server did not start:\n' + log.join(''));
}

async function stopServer({ child, dir }) {
  if (child.exitCode === null) {
    child.kill();
    await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
  }
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(300); }
  }
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const file = path.join(__dirname, suite.name + '.test.js');
    const p = spawn(process.execPath, [file], { cwd: __dirname, env: { ...process.env, TEST_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { out += '\n(timed out after 5 minutes)\n'; p.kill(); }, 5 * 60 * 1000);
    const show = (chunk) => {
      out += chunk;
      if (verbose) process.stdout.write(chunk);
    };
    p.stdout.on('data', d => show(String(d)));
    p.stderr.on('data', d => show(String(d)));
    p.on('exit', (code) => {
      clearTimeout(timer);
      const m = out.match(/(\d+) passed, (\d+) failed/);
      resolve({ code, out, passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : 0 });
    });
  });
}

(async () => {
  if (await answers()) {
    console.error(`Something is already answering on port ${PORT}. Stop it first (or set TEST_PORT).`);
    process.exit(2);
  }
  const rows = [];
  for (const suite of chosen) {
    const t0 = Date.now();
    process.stdout.write(`▶ ${suite.name} `);
    let srv;
    try { srv = await startServer(suite.env); } catch (e) { console.log('\n' + e.message); rows.push({ suite, code: 1, passed: 0, failed: 1 }); continue; }
    const r = await runSuite(suite);
    await stopServer(srv);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const okay = r.code === 0;
    console.log(`${okay ? '✓' : '✗'} ${r.passed} passed${r.failed ? `, ${r.failed} failed` : ''} (${secs}s)`);
    if (!okay && !verbose) {
      const lines = r.out.split('\n').filter(l => /✗|Error|error|timed out|timeout/.test(l));
      console.log(lines.slice(0, 30).map(l => '    ' + l.trim()).join('\n') || r.out.slice(-1500));
    }
    const serverErrors = srv.log.join('').split('\n').filter(l => /Error|exception/i.test(l));
    if (serverErrors.length) console.log('    server said:\n' + serverErrors.slice(0, 8).map(l => '      ' + l).join('\n'));
    rows.push({ suite, ...r });
  }
  const passed = rows.reduce((a, r) => a + r.passed, 0);
  const bad = rows.filter(r => r.code !== 0);
  console.log(`\n${bad.length ? '✗' : '✓'} ${passed} checks passed in ${rows.length} suites${bad.length ? `; failing: ${bad.map(r => r.suite.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
})();

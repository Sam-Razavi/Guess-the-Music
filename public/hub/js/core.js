// Shared runtime for the three hub pages (hub/tv.html, hub/player.html,
// hub/host.html). Each game registers one view per role with
// Hub.register(id, { tv, player, host }); a view is
//   { mount(root, state), update(state, prev), tick(state)?, unmount()?, events?: {name: fn} }
// The core keeps the socket, follows activeGame (redirecting to the music
// pages when the music game is on), mounts the right view, and offers small
// helpers: translations, avatars, a server-synced clock, sounds, confetti.

window.Hub = (function () {
  const role = document.body.dataset.role; // 'tv' | 'player' | 'host'
  const socket = io();
  const views = {};
  const root = document.getElementById('game-root');
  const rootClass = root.className; // e.g. 'game-root host-root' — kept when the game class changes
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = null;
  let current = null; // { id, view }
  let clockOffset = 0;
  let lang = 'en';

  // ---------- identity / registration ----------
  let pin = new URLSearchParams(location.search).get('pin') || localStorage.getItem('gtm_pin') || '';
  function playerId() {
    let id = localStorage.getItem('gtm_player_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2));
      localStorage.setItem('gtm_player_id', id);
    }
    return id;
  }
  const myId = role === 'player' ? playerId() : null;
  let myName = role === 'player' ? (localStorage.getItem('gtm_player_name') || '') : '';

  function register() {
    if (role === 'player') {
      if (!myName) { showJoin(); return; }
      socket.emit('register', { role, id: myId, name: myName, pin, view: 'arcade' });
    } else {
      socket.emit('register', { role, pin, view: 'arcade' });
    }
  }
  socket.on('connect', register);
  socket.on('disconnect', () => document.body.classList.add('offline'));
  socket.on('connect', () => document.body.classList.remove('offline'));

  socket.on('registerError', () => {
    localStorage.removeItem('gtm_pin');
    pin = '';
    const gate = document.getElementById('pin-gate');
    if (gate) { gate.hidden = false; document.getElementById('pin-error').textContent = t('core.badPin'); }
  });
  const pinBtn = document.getElementById('pin-submit');
  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      const v = document.getElementById('pin-input').value.trim();
      if (!v) return;
      pin = v;
      register();
    });
  }

  // Player join screen (only shown until a name is saved on this phone).
  const joinEl = document.getElementById('join-screen');
  function showJoin() {
    if (!joinEl) return;
    joinEl.hidden = false;
    const input = document.getElementById('join-name');
    input.value = myName;
    setTimeout(() => input.focus(), 50);
  }
  if (joinEl) {
    const submit = () => {
      const v = document.getElementById('join-name').value.trim().slice(0, 24);
      if (!v) return;
      myName = v;
      localStorage.setItem('gtm_player_name', v);
      joinEl.hidden = true;
      register();
      renderMeChip();
    };
    document.getElementById('join-submit').addEventListener('click', submit);
    document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }
  fetch('/join-info').then(r => r.json()).then(info => {
    // A phone that hasn't joined yet gets no game state — if the music game is
    // on, its join screen is the music one.
    if (role === 'player' && !myName && info.activeGame === 'music') { location.replace(musicPage()); return; }
    if (info.language) setLanguage(info.language);
    if (info.theme) document.documentElement.dataset.theme = info.theme;
    joinUrl = (info.url || '').replace(/^https?:\/\//, '');
    document.querySelectorAll('[data-join-url]').forEach(el => { el.textContent = joinUrl; });
  }).catch(() => {});
  let joinUrl = '';

  // ---------- translations ----------
  function t(key, vars) {
    const dict = HUB_STRINGS[lang] || HUB_STRINGS.en;
    // "{n} round" vs "{n} rounds": a key may have a '.one' form for n = 1 (vars.n can be Persian digits).
    if (vars && vars.n != null && (key + '.one') in dict && String(vars.n).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) === '1') key += '.one';
    let s = key in dict ? dict[key] : (key in HUB_STRINGS.en ? HUB_STRINGS.en[key] : key);
    if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }
  // Both languages at once — used for game names, which look great bilingual.
  function tOther(key) {
    const other = lang === 'fa' ? 'en' : 'fa';
    return (HUB_STRINGS[other] || {})[key] || '';
  }
  // The host page stays English (like the music host page); the TV and
  // phones follow the language the host picked.
  function setLanguage(l) {
    lang = role === 'host' ? 'en' : (l === 'fa' ? 'fa' : 'en');
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-placeholder]').forEach(el => { el.placeholder = t(el.dataset.tPlaceholder); });
  }
  // Persian digits on the Farsi screens.
  function num(n) {
    const s = String(n);
    return lang === 'fa' ? s.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/-/g, '−') : s;
  }

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function avatar(name, cls) { return avatarHtml(name || '?', cls); }
  function now() { return Date.now() + clockOffset; }
  function secondsLeft(endsAt) { return endsAt ? Math.max(0, Math.ceil((endsAt - now()) / 1000)) : 0; }
  function emit(event, data) { socket.emit(event, data || {}); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  // A signed score ("+10") that keeps its sign in front on the Farsi screens.
  function signed(n) { return `<bdi class="num" dir="ltr">${n > 0 ? '+' : ''}${num(n)}</bdi>`; }
  function playerName(id) {
    const p = state && state.players.find(x => x.id === id);
    return p ? p.name : '?';
  }

  // Replaces an element's content only when `key` changes — so entrance
  // animations play on real changes, not on every broadcast.
  // Also re-renders if something else replaced the element's content since
  // (a view drawing another state with plain innerHTML) — otherwise coming back
  // to a key drawn earlier would leave the other state's content on screen.
  function screen(el, key, html) {
    if (!el) return false;
    if (el.dataset.k === key && el.firstChild === el.__hubFirst) return false;
    el.innerHTML = typeof html === 'function' ? html() : html;
    el.dataset.k = key;
    el.__hubFirst = el.firstChild;
    return true;
  }

  // Countdown ring markup; the ticker keeps every [data-ends] element up to date.
  function ring(endsAt, totalSeconds, extraClass) {
    return `<div class="ring ${extraClass || ''}" data-ends="${endsAt || 0}" data-total="${totalSeconds || 0}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="45"></circle><circle class="ring-bar" cx="50" cy="50" r="45" pathLength="100"></circle></svg>
      <span class="ring-num"></span></div>`;
  }
  function updateTimers() {
    document.querySelectorAll('[data-ends]').forEach(el => {
      const ends = Number(el.dataset.ends);
      const total = Number(el.dataset.total) || 0;
      const left = ends ? Math.max(0, (ends - now()) / 1000) : 0;
      const secs = Math.ceil(left);
      const numEl = el.classList.contains('ring') ? el.querySelector('.ring-num') : el;
      const text = el.dataset.format === 'clock' ? clock(secs) : num(secs);
      if (numEl.textContent !== text) numEl.textContent = text;
      el.classList.toggle('urgent', ends > 0 && secs <= 10 && secs > 0);
      if (el.classList.contains('ring') && total) {
        const bar = el.querySelector('.ring-bar');
        bar.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, (left / total) * 100)));
      }
    });
  }
  function clock(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return num(`${m}:${String(s).padStart(2, '0')}`);
  }

  // ---------- sound (Web Audio, no files) ----------
  let ctx = null;
  function audio() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  // Phones only allow sound after a tap.
  window.addEventListener('pointerdown', () => audio(), { capture: true, passive: true });
  function tones(notes, type = 'sine', peak = 0.2) {
    const c = audio();
    if (!c || c.state !== 'running') return;
    notes.forEach(([freq, at, len, f2]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      const start = c.currentTime + at;
      osc.frequency.setValueAtTime(freq, start);
      if (f2) osc.frequency.exponentialRampToValueAtTime(f2, start + len);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + len + 0.05);
    });
  }
  function noise(len = 0.3, peak = 0.15, from = 1800, to = 300) {
    const c = audio();
    if (!c || c.state !== 'running') return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, c.currentTime);
    filter.frequency.exponentialRampToValueAtTime(to, c.currentTime + len);
    const gain = c.createGain();
    gain.gain.setValueAtTime(peak, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + len);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
  }
  const sfx = {
    pop: () => tones([[660, 0, 0.09, 990]], 'triangle', 0.16),
    tick: () => tones([[1200, 0, 0.04]], 'square', 0.05),
    tock: () => tones([[800, 0, 0.05]], 'square', 0.05),
    whoosh: () => noise(0.45, 0.12, 400, 3200),
    chime: () => tones([[523.25, 0, 0.35], [659.25, 0.1, 0.35], [783.99, 0.2, 0.6]], 'sine', 0.2),
    fanfare: () => tones([[523.25, 0, 0.18], [659.25, 0.16, 0.18], [783.99, 0.32, 0.18], [1046.5, 0.5, 0.7]], 'triangle', 0.18),
    buzzer: () => tones([[150, 0, 0.5, 110], [155, 0, 0.5, 112]], 'sawtooth', 0.09),
    alarm: () => tones([[880, 0, 0.12], [660, 0.14, 0.12], [880, 0.28, 0.12], [660, 0.42, 0.16]], 'square', 0.08),
    gong: () => tones([[98, 0, 2.4], [147, 0, 1.8], [196, 0.02, 1.2]], 'sine', 0.22),
    sparkle: () => tones([[1318.5, 0, 0.12], [1568, 0.06, 0.12], [2093, 0.12, 0.3]], 'sine', 0.1),
    drumroll: (ms = 1500) => {
      const n = Math.floor(ms / 45);
      for (let i = 0; i < n; i++) setTimeout(() => noise(0.05, 0.05 + (i / n) * 0.08, 900, 400), i * 45);
    },
    night: () => tones([[392, 0, 0.6], [311.1, 0.35, 0.6], [261.6, 0.7, 1.2]], 'sine', 0.16),
    dawn: () => tones([[261.6, 0, 0.5], [329.6, 0.25, 0.5], [392, 0.5, 0.5], [523.3, 0.75, 1.1]], 'sine', 0.16),
  };

  // ---------- visual flourishes ----------
  function addFx(el, ms) {
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }
  function confetti(count = 110) {
    if (reduceMotion) return;
    const colors = ['#ffc24b', '#ff7a50', '#f0458f', '#8b5cf6', '#22d3ee', '#34d399', '#ffffff'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('i');
      piece.className = 'confetti ' + ['', 'round', 'ribbon'][i % 3];
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--t', (2.2 + Math.random() * 1.8).toFixed(2) + 's');
      piece.style.setProperty('--delay', (Math.random() * 0.5).toFixed(2) + 's');
      piece.style.setProperty('--dx', ((Math.random() - 0.5) * 30).toFixed(1) + 'vw');
      piece.style.setProperty('--r0', Math.floor(Math.random() * 360) + 'deg');
      piece.addEventListener('animationend', () => piece.remove());
      frag.appendChild(piece);
    }
    document.body.appendChild(frag);
  }
  // Big stamped word across the screen ("STOP!", "GOL!", "Correct!").
  function stamp(text, variant, sub) {
    const el = document.createElement('div');
    el.className = 'fx-stamp ' + (variant || '');
    el.innerHTML = `<span class="fx-stamp-word">${esc(text)}</span>${sub ? `<span class="fx-stamp-sub">${esc(sub)}</span>` : ''}`;
    return addFx(el, 2600);
  }
  function flash(color) {
    if (reduceMotion) return;
    const el = document.createElement('div');
    el.className = 'fx-flash';
    if (color) el.style.setProperty('--flash', color);
    addFx(el, 900);
  }
  function toast(text, variant) {
    const el = document.createElement('div');
    el.className = 'fx-toast ' + (variant || '');
    el.textContent = text;
    addFx(el, 3200);
  }

  // Full-screen "here comes the next game" splash when the game changes.
  function splash(id) {
    const meta = HUB_GAMES.find(g => g.id === id);
    if (!meta || reduceMotion) return;
    const el = document.createElement('div');
    el.className = 'game-splash';
    el.style.setProperty('--g1', meta.grad[0]);
    el.style.setProperty('--g2', meta.grad[1]);
    el.innerHTML = `<div class="splash-art">${meta.art.map((a, i) => `<span class="sa sa${i}">${a}</span>`).join('')}</div>
      <div class="splash-title">${esc(t(`game.${id}.name`))}</div>
      <div class="splash-sub"><bdi>${esc(tOther(`game.${id}.name`))}</bdi></div>`;
    addFx(el, 2300);
    if (role === 'tv') sfx.whoosh();
  }

  // ---------- page chrome ----------
  function renderMeChip() {
    const chip = document.getElementById('me-chip');
    if (!chip || !myName) return;
    const shown = (state && state.me && state.me.name) || myName;
    chip.innerHTML = avatar(shown) + `<span>${esc(shown)}</span>`;
  }
  const meChip = document.getElementById('me-chip');
  if (meChip) meChip.addEventListener('click', showJoin);

  function renderHeader() {
    const id = state.activeGame;
    const chip = document.getElementById('game-chip');
    if (chip) {
      if (id === 'hub') chip.hidden = true;
      else {
        chip.hidden = false;
        const meta = HUB_GAMES.find(g => g.id === id);
        chip.innerHTML = `<span>${meta ? meta.art[0] : ''}</span> ${esc(t(`game.${id}.name`))}`;
      }
    }
    document.querySelectorAll('[data-player-count]').forEach(el => {
      const n = state.players.filter(p => p.connected).length;
      el.textContent = t('core.joined', { n: num(n) });
    });
  }

  function musicPage() {
    const page = role === 'tv' ? '/tv.html' : role === 'host' ? '/host.html' : '/player.html';
    return page + location.search;
  }

  // ---------- the main loop ----------
  socket.on('arcade', (s) => {
    if (s.buildId) {
      if (window.__buildId && window.__buildId !== s.buildId) { location.reload(); return; }
      window.__buildId = s.buildId;
    }
    if (s.activeGame === 'music') { location.replace(musicPage()); return; }
    clockOffset = s.serverNow - Date.now();
    if (pin) localStorage.setItem('gtm_pin', pin);
    const gate = document.getElementById('pin-gate');
    if (gate) gate.hidden = true;

    const prev = state;
    state = s;
    if ((role === 'host' ? 'en' : s.language) !== lang) setLanguage(s.language);
    document.documentElement.dataset.theme = s.theme;
    document.body.classList.toggle('fx', !!s.fx);
    document.body.dataset.game = s.activeGame;

    const id = s.activeGame;
    if (!current || current.id !== id) {
      if (current && current.view.unmount) current.view.unmount();
      const def = views[id];
      const view = def && def[role];
      // Each view gets a brand-new element: views attach their click/input
      // listeners to it, and replacing it is what throws those away. (Reusing
      // #game-root stacked a fresh set of listeners on every game switch, so
      // one tap on the host page fired several times.)
      root.innerHTML = '';
      root.className = `${rootClass} g-${id}`;
      const viewRoot = document.createElement('div');
      viewRoot.className = 'view-root';
      root.appendChild(viewRoot);
      current = { id, view: view || { mount() {}, update() {} } };
      if (prev && id !== 'hub' && role !== 'host') splash(id);
      current.view.mount(viewRoot, s);
      current.view.update(s, null);
    } else {
      current.view.update(s, prev);
    }
    renderHeader();
    renderMeChip();
    updateTimers();
  });

  socket.onAny((event, data) => {
    if (event === 'arcade') return;
    const h = current && current.view.events && current.view.events[event];
    if (h) h(data, state);
  });

  socket.on('hubError', ({ message }) => toast(message, 'bad'));

  setInterval(() => {
    updateTimers();
    if (current && current.view.tick && state) current.view.tick(state);
  }, 200);

  return {
    role, socket, myId, register: (id, def) => { views[id] = def; },
    get state() { return state; }, get lang() { return lang; }, get joinUrl() { return joinUrl; },
    SEP: '<span class="sep" aria-hidden="true"></span>', signed,
    t, tOther, num, esc, avatar, now, secondsLeft, emit, vibrate, screen, ring, clock, playerName,
    sfx, confetti, stamp, flash, toast, reduceMotion,
  };
})();

// Draw It! (نقاشی‌بازی) — TV, phone and host views. Server: games/draw.js.
// The drawing itself travels outside the game payload: 'draw:pts' batches while
// someone draws, 'draw:all' after an undo/clear, 'draw:sync' when a page asks
// ('hub:sync') because it (re)loaded mid-turn, 'draw:gallery' at the end.
(function () {
  const { t, num, esc, avatar } = Hub;
  const W = 1000, H = 750;
  const COLORS = ['#1f2937', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#ffffff'];
  const SIZES = [5, 13, 32];
  const FLUSH_MS = 40;

  // What this page knows about the current drawing (kept apart from the DOM,
  // which is rebuilt whenever the screen changes).
  const art = { turn: null, strokes: [], gallery: null, galleryAsked: false };
  let paper = null; // the canvas on screen right now, if any

  // ---------- paper: draws strokes on a canvas, at whatever size it is ----------
  function makePaper(canvas) {
    const c2d = canvas.getContext('2d');
    let k = 1;
    let raf = 0;
    const p = {
      canvas,
      fit() {
        const r = canvas.getBoundingClientRect();
        if (!r.width) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(r.width * dpr);
        const h = Math.round((w * H) / W);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        k = canvas.width / W;
        if (!raf) p.redraw();
      },
      blank() { c2d.fillStyle = '#fff'; c2d.fillRect(0, 0, canvas.width, canvas.height); },
      // Points [from, to) of a stroke (coordinate indexes), joined to the point before `from`.
      seg(s, from = 0, to = s.p.length) {
        const pts = s.p;
        if (!pts.length || to <= from) return;
        c2d.strokeStyle = COLORS[s.c] || COLORS[0];
        c2d.lineWidth = (SIZES[s.w] || SIZES[1]) * k;
        c2d.lineCap = 'round';
        c2d.lineJoin = 'round';
        const start = Math.max(0, from - 2);
        c2d.beginPath();
        c2d.moveTo(pts[start] * k, pts[start + 1] * k);
        if (to - start === 2) c2d.lineTo(pts[start] * k + 0.01, pts[start + 1] * k); // a dot
        for (let i = start + 2; i < to; i += 2) c2d.lineTo(pts[i] * k, pts[i + 1] * k);
        c2d.stroke();
      },
      redraw(strokes = art.strokes) { p.blank(); for (const s of strokes) p.seg(s); },
      // Time-lapse of the whole drawing (the reveal).
      replay(ms = 2600) {
        cancelAnimationFrame(raf);
        const strokes = art.strokes.slice();
        const total = strokes.reduce((a, s) => a + s.p.length / 2, 0);
        if (!total || Hub.reduceMotion) { raf = 0; p.redraw(); return; }
        p.blank();
        let si = 0, pi = 0, done = 0;
        const t0 = performance.now();
        const step = (now) => {
          const target = Math.min(total, Math.ceil((total * (now - t0)) / ms));
          while (done < target && si < strokes.length) {
            const s = strokes[si];
            const take = Math.min((s.p.length - pi) / 2, target - done);
            p.seg(s, pi, pi + take * 2);
            pi += take * 2;
            done += take;
            if (pi >= s.p.length) { si += 1; pi = 0; }
          }
          raf = done < total ? requestAnimationFrame(step) : 0;
        };
        raf = requestAnimationFrame(step);
      },
      stop() { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); },
    };
    const ro = new ResizeObserver(() => p.fit());
    ro.observe(canvas);
    p.fit();
    return p;
  }
  function attachPaper(el) {
    if (paper) paper.stop();
    const canvas = el.querySelector('canvas.dr-canvas');
    paper = canvas ? makePaper(canvas) : null;
    return paper;
  }
  // A still thumbnail (the final gallery).
  function thumb(canvas, strokes) {
    const w = 480;
    canvas.width = w;
    canvas.height = (w * H) / W;
    const c2d = canvas.getContext('2d');
    const k = w / W;
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      if (!s.p.length) continue;
      c2d.strokeStyle = COLORS[s.c] || COLORS[0];
      c2d.lineWidth = Math.max(1, (SIZES[s.w] || SIZES[1]) * k);
      c2d.lineCap = 'round';
      c2d.lineJoin = 'round';
      c2d.beginPath();
      c2d.moveTo(s.p[0] * k, s.p[1] * k);
      if (s.p.length === 2) c2d.lineTo(s.p[0] * k + 0.01, s.p[1] * k);
      for (let i = 2; i < s.p.length; i += 2) c2d.lineTo(s.p[i] * k, s.p[i + 1] * k);
      c2d.stroke();
    }
  }

  // A new turn (or a page that just opened mid-turn): start a blank drawing and,
  // if the server already has strokes for it, ask for them.
  function syncTurn(g) {
    if (g.turnId === art.turn) return;
    art.turn = g.turnId;
    art.strokes = [];
    if (paper) paper.redraw();
    if (g.strokeCount > 0 && (g.status === 'drawing' || g.status === 'reveal')) Hub.socket.emit('hub:sync');
  }
  function askGallery(g) {
    if (g.status !== 'final' || art.gallery || art.galleryAsked || !g.gallerySize) return;
    art.galleryAsked = true;
    setTimeout(() => { if (!art.gallery) Hub.socket.emit('hub:sync'); }, 1200); // usually it arrives by itself
  }
  const iAmArtist = (s) => Hub.role === 'player' && s.game.drawer && s.game.drawer.id === Hub.myId && s.game.status === 'drawing';

  // The events every role listens to.
  function events(onGallery) {
    return {
      'draw:pts': (d, s) => {
        if (!d || (s && s.game && iAmArtist(s))) return; // the artist has these already
        if (d.t !== art.turn) { if (art.turn !== null && d.t < art.turn) return; art.turn = d.t; art.strokes = []; if (paper) paper.redraw(); }
        const n = art.strokes.length;
        if (d.i === n) { art.strokes.push({ c: d.c, w: d.w, p: d.p.slice() }); if (paper) paper.seg(art.strokes[n]); }
        else if (d.i === n - 1) { const st = art.strokes[n - 1]; const from = st.p.length; st.p.push(...d.p); if (paper) paper.seg(st, from); }
        else Hub.socket.emit('hub:sync'); // missed a batch: get the whole drawing
      },
      'draw:all': (d, s) => {
        if (!d || (s && s.game && iAmArtist(s)) || d.t < art.turn) return;
        art.turn = d.t;
        art.strokes = d.strokes.map(x => ({ c: x.c, w: x.w, p: x.p.slice() }));
        if (paper) paper.redraw();
      },
      'draw:sync': (d) => {
        if (!d) return;
        art.turn = d.t;
        art.strokes = d.strokes.map(x => ({ c: x.c, w: x.w, p: x.p.slice() }));
        if (paper) paper.redraw();
      },
      'draw:gallery': (items) => { art.gallery = Array.isArray(items) ? items : []; if (onGallery) onGallery(); },
    };
  }

  // The hint: one box per letter, spaces kept.
  function hintHtml(pattern) {
    return pattern.map(ch => (ch === ' ' ? '<i class="dr-gap"></i>' : ch === '‌' ? '<i class="dr-zw"></i>' : ch === '_' ? '<span class="dr-slot"></span>' : `<span class="dr-slot open">${esc(ch)}</span>`)).join('');
  }
  const x2 = (g) => (g.hard ? `<span class="dr-x2" title="${esc(t('dr.double'))}">×${num(2)}</span>` : '');

  function guessedList(g, withPts) {
    if (!g.guessed.length) return `<p class="muted dr-none">${esc(t('dr.nobodyYet'))}</p>`;
    return g.guessed.map((x, i) => `<div class="dr-got" style="--i:${i}">${i === 0 ? '<span class="dr-first">🥇</span>' : ''}${avatar(x.name)}<b>${esc(x.name)}</b>${withPts ? Hub.signed(x.pts) : ''}</div>`).join('');
  }

  // =============== TV ===============
  const seenGuessed = new Set();
  const tv = {
    mount(root) { root.innerHTML = '<div class="dr-tv" id="dr-tv"></div>'; },
    unmount() { if (paper) { paper.stop(); paper = null; } },
    events: events(() => { const el = document.getElementById('dr-tv'); if (el && Hub.state && Hub.state.game.status === 'final') renderTvGallery(); }),
    update(s) {
      const g = s.game;
      const el = document.getElementById('dr-tv');
      syncTurn(g);
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.settings), () => UI.tvLobby('draw', `
          <p class="lobby-meta">🎨 ${esc(t('dr.drawingsEach', { n: num(g.settings.turns) }))} ${Hub.SEP} ⏱ ${num(g.settings.seconds)}″</p>
          <p class="lobby-meta">🥇 ${esc(t('dr.scoring'))}</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'choosing') {
        if (Hub.screen(el, 'c' + g.turnId, `<div class="dr-choosing">
            <p class="eyebrow">${esc(t('dr.turnOf', { n: num(g.turnNo), of: num(g.totalTurns) }))}</p>
            <div class="dr-artist-big">${avatar(g.drawer.name, 'dr-big-av')}<span class="dr-pencil">✏️</span></div>
            <h1>${esc(t('dr.isChoosing', { name: g.drawer.name }))}</h1>
            ${Hub.ring(g.endsAt, 15, 'dr-ring')}
          </div>`)) { Hub.sfx.whoosh(); if (paper) { paper.stop(); paper = null; } }
        return;
      }
      if (st === 'drawing') {
        if (Hub.screen(el, 'd' + g.turnId, `<div class="dr-stage">
            <section class="dr-main">
              <div class="dr-head">
                <p class="eyebrow">${esc(t('dr.turnOf', { n: num(g.turnNo), of: num(g.totalTurns) }))} ${Hub.SEP} ✏️ ${esc(t('dr.isDrawing', { name: g.drawer.name }))}</p>
                <div class="dr-hint" id="dr-hint"></div>
              </div>
              <div class="dr-frame"><canvas class="dr-canvas"></canvas></div>
            </section>
            <aside class="dr-side">
              ${Hub.ring(g.endsAt, g.settings.seconds, 'dr-ring')}
              <h3>✅ ${esc(t('dr.guessedTitle'))} <small id="dr-count"></small></h3>
              <div class="dr-gots" id="dr-gots"></div>
              <h3>💬 ${esc(t('dr.guesses'))}</h3>
              <div class="dr-feed" id="dr-feed"></div>
            </aside>
          </div>`)) {
          attachPaper(el);
          seenGuessed.clear();
          Hub.sfx.chime();
        }
        const hk = g.pattern.join('') + g.hard;
        const hint = document.getElementById('dr-hint');
        if (hint.dataset.k !== hk) { hint.dataset.k = hk; hint.innerHTML = hintHtml(g.pattern) + x2(g); }
        document.getElementById('dr-count').textContent = `${num(g.guessed.length)}/${num(g.guesserCount)}`;
        const gots = document.getElementById('dr-gots');
        const gk = g.guessed.map(x => x.id).join();
        if (gots.dataset.k !== gk) {
          gots.dataset.k = gk;
          gots.innerHTML = guessedList(g, true);
          for (const x of g.guessed) if (!seenGuessed.has(x.id)) { seenGuessed.add(x.id); Hub.sfx.chime(); }
        }
        const feed = document.getElementById('dr-feed');
        const fk = g.feed.map(f => f.id).join();
        if (feed.dataset.k !== fk) {
          const last = Number(feed.dataset.last || 0);
          feed.dataset.k = fk;
          feed.dataset.last = String(g.feed.length ? g.feed[g.feed.length - 1].id : 0);
          feed.innerHTML = g.feed.map(f => `<div class="dr-bubble ${f.id > last ? 'new' : ''}"><b>${esc(f.name)}</b><span dir="auto">${esc(f.text)}</span></div>`).join('');
          if (g.feed.length && g.feed[g.feed.length - 1].id > last) Hub.sfx.tick();
        }
        return;
      }
      if (st === 'reveal') {
        const everyone = g.guessed.length && g.guessed.length >= g.guesserCount;
        const artistPts = g.turnPoints[g.drawer.id] || 0;
        if (Hub.screen(el, 'r' + g.turnId, `<div class="dr-stage reveal">
            <section class="dr-main">
              <div class="dr-head"><p class="eyebrow">${esc(t('dr.turnOf', { n: num(g.turnNo), of: num(g.totalTurns) }))} ${Hub.SEP} 🎨 ${esc(t('dr.byArtist', { name: g.drawer.name }))}</p></div>
              <div class="dr-frame"><canvas class="dr-canvas"></canvas></div>
            </section>
            <aside class="dr-side dr-answer">
              <p class="eyebrow">${esc(t('dr.itWas'))}</p>
              <h1 class="dr-word-big" dir="auto">${esc(g.word || '')}${x2(g)}</h1>
              <p class="dr-verdict">${esc(!g.guessed.length ? t('dr.nobodyGot') : everyone ? t('dr.everyoneGotIt') : t('dr.rightN', { n: num(g.guessed.length) }))}</p>
              <div class="dr-gots">${g.guessed.length ? guessedList(g, true) : ''}</div>
              ${artistPts ? `<div class="dr-got artist">🎨 ${avatar(g.drawer.name)}<b>${esc(g.drawer.name)}</b>${Hub.signed(artistPts)}</div>` : ''}
              ${g.nextAt ? `<p class="dr-next">${esc(t('dr.nextIn'))} <span data-ends="${g.nextAt}"></span></p>` : ''}
            </aside>
          </div>`)) {
          attachPaper(el).replay();
          if (g.guessed.length) { Hub.sfx.fanfare(); Hub.confetti(everyone ? 90 : 40); } else Hub.sfx.buzzer();
        }
        return;
      }
      if (st === 'final') {
        askGallery(g);
        if (Hub.screen(el, 'final' + Hub.lang, `<div class="final-screen dr-final">
            <section class="dr-final-left">
              <p class="eyebrow">${esc(t('core.gameOver'))}</p>
              ${UI.podium(g.standings, r => r.points, r => r.name)}
              <div class="dr-awards">${awardsHtml(g)}</div>
            </section>
            <section class="dr-final-right">
              <h2>🖼️ ${esc(t('dr.gallery'))}</h2>
              <div class="dr-gallery" id="dr-gallery"></div>
            </section>
          </div>`)) {
          if (paper) { paper.stop(); paper = null; }
          Hub.confetti(150);
          Hub.sfx.fanfare();
          renderTvGallery();
        }
      }
    },
  };
  function awardsHtml(g) {
    const a = g.awards || {};
    const list = Hub.lang === 'fa' ? '، ' : ', ';
    return [
      a.artist ? `<span class="dr-award">🎨 <b>${esc(t('dr.bestArtist'))}</b> ${esc(a.artist.names.join(list))} <small>${esc(t('dr.rightN', { n: num(a.artist.n) }))}</small></span>` : '',
      a.eye ? `<span class="dr-award">👁️ <b>${esc(t('dr.sharpEye'))}</b> ${esc(a.eye.names.join(list))} <small>${esc(t('dr.firstsN', { n: num(a.eye.n) }))}</small></span>` : '',
    ].join('');
  }
  function renderTvGallery() {
    const box = document.getElementById('dr-gallery');
    if (!box || !art.gallery) return;
    const items = art.gallery.slice(-8);
    box.innerHTML = items.map((x, i) => `<figure class="dr-thumb" style="--i:${i};--r:${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg">
        <canvas></canvas><figcaption><b dir="auto">${esc(x.word)}</b><small>${esc(t('dr.byArtist', { name: x.by }))}</small></figcaption></figure>`).join('');
    box.querySelectorAll('canvas').forEach((c, i) => thumb(c, items[i].strokes));
  }

  // =============== phone ===============
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('gtm_draw_tools') || '{}'); } catch (e) { return {}; } })();
  const tool = { c: Number.isInteger(prefs.c) ? prefs.c : 0, w: Number.isInteger(prefs.w) ? prefs.w : 1 };
  const saveTool = () => { try { localStorage.setItem('gtm_draw_tools', JSON.stringify(tool)); } catch (e) {} };
  let pending = null;   // the batch of points not sent yet
  let flushTimer = null;
  let drawingStroke = null;

  function flush() {
    if (!pending || !pending.p.length) return;
    Hub.emit('player:draw:stroke', { i: pending.i, c: pending.c, w: pending.w, p: pending.p });
    pending.p = [];
  }
  function toPoint(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  }
  function bindCanvas(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || !paper) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = toPoint(e, canvas);
      drawingStroke = { c: tool.c, w: tool.w, p: [x, y] };
      art.strokes.push(drawingStroke);
      paper.seg(drawingStroke);
      pending = { i: art.strokes.length - 1, c: tool.c, w: tool.w, p: [x, y] };
      clearInterval(flushTimer);
      flushTimer = setInterval(flush, FLUSH_MS);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawingStroke || !e.isPrimary) return;
      e.preventDefault();
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const from = drawingStroke.p.length;
      for (const ev of (list.length ? list : [e])) {
        const [x, y] = toPoint(ev, canvas);
        const lx = drawingStroke.p[drawingStroke.p.length - 2], ly = drawingStroke.p[drawingStroke.p.length - 1];
        if (Math.abs(x - lx) + Math.abs(y - ly) < 3) continue;
        drawingStroke.p.push(x, y);
        pending.p.push(x, y);
      }
      if (drawingStroke.p.length > from) paper.seg(drawingStroke, from);
    });
    const end = () => {
      if (!drawingStroke) return;
      drawingStroke = null;
      flush();
      clearInterval(flushTimer);
      pending = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
  function setFeedback(text, cls) {
    const fb = document.getElementById('dr-feedback');
    if (!fb) return;
    fb.textContent = text;
    fb.className = 'dr-feedback ' + (cls || '');
    void fb.offsetWidth;
    fb.classList.add('show');
  }

  const player = {
    mount(root) {
      root.innerHTML = '<div class="dr-ph" id="dr-ph"></div>';
      root.addEventListener('click', (e) => {
        const ch = e.target.closest('[data-choose]');
        if (ch) { Hub.emit('player:draw:choose', { index: Number(ch.dataset.choose) }); Hub.vibrate(20); return; }
        const col = e.target.closest('[data-color]');
        if (col) {
          tool.c = Number(col.dataset.color);
          if (tool.c === 9 && tool.w === 0) tool.w = 2; // the eraser wants a big tip
          saveTool(); markTools(); Hub.vibrate(8); return;
        }
        const sz = e.target.closest('[data-size]');
        if (sz) { tool.w = Number(sz.dataset.size); saveTool(); markTools(); Hub.vibrate(8); return; }
        if (e.target.closest('[data-undo]')) {
          if (!art.strokes.length) return;
          flush();
          art.strokes.pop();
          if (paper) paper.redraw();
          Hub.emit('player:draw:undo');
          Hub.vibrate(10);
          return;
        }
        const clr = e.target.closest('[data-clear]');
        if (clr) {
          if (!clr.classList.contains('armed')) {
            clr.classList.add('armed');
            const label = clr.textContent;
            clr.textContent = t('dr.clearSure');
            setTimeout(() => { clr.classList.remove('armed'); clr.textContent = label; }, 2200);
            return;
          }
          art.strokes = [];
          if (paper) paper.redraw();
          Hub.emit('player:draw:clear');
          Hub.vibrate([10, 40, 10]);
        }
      });
      root.addEventListener('submit', (e) => {
        if (!e.target.matches('#dr-form')) return;
        e.preventDefault();
        const input = document.getElementById('dr-input');
        const v = input.value.trim();
        if (!v) return;
        Hub.emit('player:draw:guess', { text: v });
        input.value = '';
      });
    },
    unmount() { if (paper) { paper.stop(); paper = null; } clearInterval(flushTimer); },
    events: Object.assign(events(), {
      'draw:result': (d) => {
        if (!d) return;
        if (d.ok) { Hub.vibrate([40, 30, 90]); Hub.sfx.chime(); return; } // the screen flips to "you got it"
        if (d.close) { setFeedback(t('dr.close', { text: d.text }), 'close'); Hub.vibrate([20, 30, 20]); return; }
        setFeedback(t('dr.nope', { text: d.text }), 'nope');
        Hub.vibrate(30);
      },
    }),
    update(s) {
      const g = s.game;
      const el = document.getElementById('dr-ph');
      syncTurn(g);
      const st = g.status;
      const me = Hub.myId;
      const artist = g.drawer && g.drawer.id === me;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('draw', `<p class="muted small dr-lobby-note">🥇 ${esc(t('dr.scoring'))}</p>`));
        return;
      }
      if (st === 'choosing') {
        if (artist) {
          if (Hub.screen(el, 'c' + g.turnId + 'me', `<div class="dr-pick">
              <div class="ph-top-row"><span class="eyebrow">🎨 ${esc(t('dr.yourTurn'))}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
              <h2>${esc(t('dr.pickWord'))}</h2>
              <div class="dr-offers">${(g.offer || []).map((w, i) => `<button class="dr-offer ${w.hard ? 'hard' : 'easy'}" data-choose="${i}" style="--i:${i}">
                <b dir="auto">${esc(w.text)}</b><small>${w.hard ? `${esc(t('dr.hard'))} ${Hub.SEP} ${esc(t('dr.double'))}` : esc(t('dr.easy'))}</small></button>`).join('')}</div>
              <p class="muted small">${esc(t('dr.noLetters'))}</p>
            </div>`)) Hub.vibrate([30, 40, 30]);
        } else {
          Hub.screen(el, 'c' + g.turnId, `<div class="ph-result dr-wait">${avatar(g.drawer.name, 'dr-big-av')}
            <h2>${esc(t('dr.isChoosing', { name: g.drawer.name }))}</h2><p class="muted">${esc(t('dr.watch'))}</p></div>`);
        }
        return;
      }
      if (st === 'drawing') {
        if (artist) {
          if (Hub.screen(el, 'd' + g.turnId + 'me', `<div class="dr-artist">
              <div class="dr-ph-top"><span class="dr-word-label">${esc(t('dr.draw'))}</span><b class="dr-word" dir="auto">${esc(g.word || '')}</b>${x2(g)}<span class="pill" data-ends="${g.endsAt}"></span></div>
              <div class="dr-frame ph"><canvas class="dr-canvas"></canvas></div>
              <div class="dr-tools">
                <div class="dr-colors">${COLORS.map((c, i) => `<button class="dr-swatch ${i === 9 ? 'eraser' : ''}" data-color="${i}" style="--c:${c}" aria-label="${i === 9 ? 'Eraser' : 'Color'}">${i === 9 ? '🧽' : ''}</button>`).join('')}</div>
                <div class="dr-row2">
                  <div class="dr-sizes">${SIZES.map((sz, i) => `<button class="dr-size" data-size="${i}" aria-label="Size ${i + 1}"><i style="--s:${6 + i * 7}px"></i></button>`).join('')}</div>
                  <button class="dr-act" data-undo>↶ ${esc(t('dr.undo'))}</button>
                  <button class="dr-act" data-clear>🗑 ${esc(t('dr.clear'))}</button>
                </div>
              </div>
              <p class="dr-artist-status" id="dr-astatus"></p>
            </div>`)) {
            attachPaper(el);
            bindCanvas(paper.canvas);
            markTools();
            Hub.vibrate([30, 40, 30]);
          }
          document.getElementById('dr-astatus').innerHTML = `✅ ${num(g.guessed.length)}/${num(g.guesserCount)} ${g.guessed.length ? Hub.SEP + ' ' + g.guessed.map(x => esc(x.name)).join(Hub.lang === 'fa' ? '، ' : ', ') : ''}`;
          return;
        }
        if (g.iGuessed) {
          const mine = g.guessed.find(x => x.id === me);
          if (Hub.screen(el, 'd' + g.turnId + 'got', `<div class="dr-guesser got">
              <div class="dr-ph-top"><span class="eyebrow">✏️ ${esc(t('dr.isDrawing', { name: g.drawer.name }))}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
              <div class="dr-gotit"><span class="dr-big-ok">✅</span><div><b>${esc(t('dr.gotIt'))}</b> ${mine ? Hub.signed(mine.pts) : ''}<p class="dr-word" dir="auto">${esc(g.word || '')}</p></div></div>
              <div class="dr-frame ph"><canvas class="dr-canvas"></canvas></div>
              <p class="muted small">${esc(t('dr.waitOthers'))}</p>
            </div>`)) attachPaper(el);
          return;
        }
        if (Hub.screen(el, 'd' + g.turnId, `<div class="dr-guesser">
            <div class="dr-ph-top"><span class="eyebrow">✏️ ${esc(t('dr.isDrawing', { name: g.drawer.name }))}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
            <div class="dr-hint small" id="dr-hint"></div>
            <div class="dr-frame ph"><canvas class="dr-canvas"></canvas></div>
            <form class="dr-form" id="dr-form" autocomplete="off">
              <input id="dr-input" type="text" maxlength="40" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" placeholder="${esc(t('dr.guessPh'))}">
              <button class="primary" type="submit">${esc(t('dr.send'))}</button>
            </form>
            <p class="dr-feedback" id="dr-feedback"></p>
          </div>`)) attachPaper(el);
        const hint = document.getElementById('dr-hint');
        const hk = g.pattern.join('') + g.hard;
        if (hint.dataset.k !== hk) { hint.dataset.k = hk; hint.innerHTML = hintHtml(g.pattern) + x2(g); }
        return;
      }
      if (st === 'reveal') {
        const mine = g.turnPoints[me] || 0;
        Hub.screen(el, 'r' + g.turnId, `<div class="ph-result dr-ph-reveal">
            <p class="eyebrow">${esc(t('dr.itWas'))}</p>
            <h1 dir="auto">${esc(g.word || '')}${x2(g)}</h1>
            <div class="dr-frame ph"><canvas class="dr-canvas"></canvas></div>
            ${mine ? `<p class="gain">${esc(t('dr.thisTurn'))} ${Hub.signed(mine)}</p>` : artist ? `<p class="gain miss">${esc(t('dr.nobodyGot'))}</p>` : ''}
            ${g.nextAt ? `<p class="muted small">${esc(t('dr.nextIn'))} <span data-ends="${g.nextAt}"></span></p>` : ''}
          </div>`) && attachPaper(el);
        return;
      }
      if (st === 'final') {
        if (paper) { paper.stop(); paper = null; }
        const rows = g.standings;
        const i = rows.findIndex(r => r.id === me);
        const mine = rows[i];
        Hub.screen(el, 'final' + Hub.lang, `<div class="ph-result">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <div class="big-rank">${i === 0 && mine.points > 0 ? '🏆' : '🎨'}</div>
            <p class="big-score">${num(mine ? mine.points : 0)} <small>${esc(t('core.pts'))}</small></p>
            <div class="dr-awards ph">${awardsHtml(g)}</div>
            <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
      }
    },
  };
  function markTools() {
    document.querySelectorAll('.dr-swatch').forEach(b => b.classList.toggle('on', Number(b.dataset.color) === tool.c));
    document.querySelectorAll('.dr-size').forEach(b => b.classList.toggle('on', Number(b.dataset.size) === tool.w));
    document.querySelectorAll('.dr-size i').forEach(i => { i.style.background = COLORS[tool.c] === '#ffffff' ? '#cbd5e1' : COLORS[tool.c]; });
  }

  // =============== host ===============
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="dr-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:draw:settings');
    },
    events: events(),
    update(s) {
      const g = s.game;
      const el = document.getElementById('dr-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        const online = s.players.filter(p => p.connected).length;
        Hub.screen(el, st + JSON.stringify(g.settings) + s.players.map(p => p.id + p.connected).join(), `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '🎨 Draw It!'}</h2>
            <p class="muted small">Players take turns drawing a secret word on their phone; it appears live on the TV and everyone else types guesses. 1st right guess 3 points, 2nd 2, then 1; the artist gets 1 for every right guess. With <b>word choice</b> the artist picks from two easy words and one hard one (hard = double points). <b>Letter hints</b> uncover a letter at half time and at three quarters. Words follow the TV language and don't repeat tonight. Wrong guesses scroll by on the TV (near misses stay private).</p>
            <button class="primary big-btn" data-emit="host:draw:start" ${online >= 2 ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
            ${online < 2 ? '<p class="muted small">Needs at least 2 players (3+ is more fun).</p>' : ''}
            <div class="roster">${UI.hostRoster(s.players)}</div>
          </section>
          <section class="h-card"><h2>Settings</h2><div class="h-fields">
            ${UI.hostField('Seconds per drawing', UI.numberInput('seconds', g.settings.seconds, 30, 240, 10))}
            ${UI.hostField('Drawings per player', UI.numberInput('turns', g.settings.turns, 1, 3))}
            ${UI.hostField('Auto-next after reveal (sec, 0 = off)', UI.numberInput('autoNext', g.settings.autoNext, 0, 60))}
          </div>
          ${UI.toggle('choice', g.settings.choice, 'Word choice', 'The artist picks: two easy words or a hard one for double points')}
          ${UI.toggle('hints', g.settings.hints, 'Letter hints', 'Uncover a letter at half time and at three quarters')}</section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const head = `Drawing ${g.turnNo} of ${g.totalTurns} · artist: ${esc(g.drawer ? g.drawer.name : '?')}`;
      const status = st === 'choosing' ? `Picking a word… <span data-ends="${g.endsAt}"></span>s`
        : st === 'drawing' ? `${g.guessed.length} of ${g.guesserCount} guessed · <span data-ends="${g.endsAt}"></span>s left${g.hard ? ' · hard word (×2)' : ''}`
          : `It was <b dir="auto">${esc(g.word || '')}</b> · ${g.guessed.length} guessed`;
      el.innerHTML = `<section class="h-card span2 h-hero">
          <p class="eyebrow">${head}</p>
          <h2>${st === 'reveal' ? '🎉 Reveal' : st === 'choosing' ? '🤔 Choosing' : '✏️ Drawing'}</h2>
          <p class="h-status">${status}</p>
          <div class="h-btns">
            ${st === 'drawing' ? '<button class="primary" data-emit="host:draw:endTurn">Stop drawing &amp; reveal</button>' : ''}
            ${st === 'choosing' || st === 'drawing' ? '<button data-emit="host:draw:skip">Skip this artist</button>' : ''}
            ${st === 'reveal' ? `<button class="primary" data-emit="host:draw:next">${g.queueLeft ? 'Next drawing ▶' : 'Show results 🏆'}</button>` : ''}
            <button class="danger" data-emit="host:draw:end" data-confirm="Tap again to end">End game</button>
          </div></section>
        <section class="h-card"><h2>Points</h2>${g.standings.map(r => `<div class="trophy-row">${avatar(r.name)} <b>${esc(r.name)}</b> ${r.points} pts</div>`).join('') || '<p class="muted small">No points yet.</p>'}</section>`;
    },
  };

  Hub.register('draw', { tv, player, host });
})();

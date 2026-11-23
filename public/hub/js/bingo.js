// Music Bingo (بینگوی موسیقی) — TV, phone and host views. Server: games/bingo.js.
//
// The TV plays the clips with two YouTube players: one plays the current song,
// the other preloads the next one (frozen, muted) so a call starts without a
// load stall — same idea as the music game's TV. Only the screen that has the
// sound (TvSound) ever unmutes, and only that one reports playback to the server.
(function () {
  const { t, num, esc, avatar } = Hub;
  const PRIZE_ICON = { line: '➖', two: '🟰', full: '🟦' };
  const prizeName = (p) => t(`bg.prize.${p}`);

  // ======================= TV: the two players =======================
  const Deck = (function () {
    let slots = [];     // [{ p, el, vid, token, ready, preloaded, reported, faded }]
    let cur = 0;        // index of the slot that plays the current call
    let last = null;    // latest game payload
    let apiPromise = null;
    let watchdog = null;
    let gateEl = null;
    let preloadAfter = 0;
    let fadeTimers = new Map();

    const soundOn = () => !window.TvSound || TvSound.on();
    const ok = (s) => s && s.p && s.ready && typeof s.p.getPlayerState === 'function';

    function loadApi() {
      if (window.YT && window.YT.Player) return Promise.resolve();
      if (apiPromise) return apiPromise;
      apiPromise = new Promise((resolve) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(); };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          document.head.appendChild(s);
        }
        // The API sometimes never calls back (seen on the music TV): poll as a backstop.
        const iv = setInterval(() => { if (window.YT && window.YT.Player) { clearInterval(iv); resolve(); } }, 400);
      });
      return apiPromise;
    }

    function report(status, extra) {
      if (!soundOn() || !last || !last.play) return;
      Hub.emit('tv:bingo:status', { songId: last.play.songId, status, ...(extra || {}) });
    }

    // Volume ramps: setVolume steps on a quarter-cosine, like the music TV.
    function fade(slot, to, ms, then) {
      clearInterval(fadeTimers.get(slot));
      if (!ok(slot)) { if (then) then(); return; }
      const from = slot.p.getVolume ? slot.p.getVolume() : 100;
      const t0 = Date.now();
      const iv = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        const v = Math.round(from + (to - from) * (1 - Math.cos(k * Math.PI / 2)));
        try { slot.p.setVolume(v); } catch (e) {}
        if (k >= 1) { clearInterval(iv); fadeTimers.delete(slot); if (then) then(); }
      }, 60);
      fadeTimers.set(slot, iv);
    }
    function audible(slot) {
      if (!ok(slot)) return;
      if (!soundOn()) { slot.p.mute(); return; }
      if (slot.p.isMuted()) { slot.p.setVolume(0); slot.p.unMute(); }
      fade(slot, 100, 900);
    }
    function silence(slot, ms, andPause) {
      if (!ok(slot)) return;
      fade(slot, 0, ms, () => { try { if (andPause) slot.p.pauseVideo(); slot.p.mute(); slot.p.setVolume(100); } catch (e) {} });
    }

    function make(el, i) {
      const slot = { el, p: null, vid: null, token: null, ready: false, preloaded: false, reported: false };
      slot.p = new YT.Player(el.querySelector('.bg-yt'), {
        width: '100%', height: '100%',
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, iv_load_policy: 3, fs: 0, disablekb: 1, playsinline: 1 },
        events: {
          onReady: () => { slot.ready = true; slot.p.mute(); sync(last); },
          onStateChange: (e) => onState(slot, e.data),
          onError: (e) => onError(slot, e.data),
        },
      });
      return slot;
    }

    function mount(container) {
      gateEl = container.querySelector('.bg-gate');
      const els = container.querySelectorAll('.bg-slot');
      loadApi().then(() => {
        if (!gateEl || !gateEl.isConnected) return; // unmounted meanwhile
        slots = [make(els[0], 0), make(els[1], 1)];
        cur = 0;
      });
      document.addEventListener('pointerdown', unlock, true);
      document.addEventListener('keydown', unlock, true);
    }
    function unmount() {
      clearTimeout(watchdog);
      for (const iv of fadeTimers.values()) clearInterval(iv);
      fadeTimers = new Map();
      for (const s of slots) { try { s.p.destroy(); } catch (e) {} }
      slots = [];
      gateEl = null;
      last = null;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    }

    // Autoplay blocked (a plain Chrome window, not the kiosk): one click fixes it.
    function setGate(on) { if (gateEl) gateEl.hidden = !on; }
    function unlock() {
      if (!gateEl || gateEl.hidden) return;
      const s = slots[cur];
      if (ok(s)) { s.p.playVideo(); setTimeout(() => { if (ok(s) && s.p.getPlayerState() !== 1 && last && last.play) { s.p.loadVideoById({ videoId: last.play.youtubeId, startSeconds: last.play.start }); } }, 1200); }
    }
    function watch(startedAt = Date.now()) {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        const s = slots[cur];
        if (!ok(s) || !last || !['loading', 'playing'].includes(last.status) || last.paused) return;
        const st = s.p.getPlayerState();
        if (st === 1) return;
        if (st === -1 || st === 5 || st === 2) { setGate(true); report('blocked'); return; }
        if (Date.now() - startedAt < 20000) watch(startedAt); // still buffering: look again
      }, 3000);
    }

    function onState(slot, st) {
      const isCur = slot === slots[cur];
      if (!isCur) {
        // The spare: once the preload actually plays, freeze it on its first frame.
        if (st === 1 && !slot.preloaded) { slot.preloaded = true; try { slot.p.pauseVideo(); slot.p.mute(); } catch (e) {} }
        return;
      }
      if (st === 1) {
        if (last && ['claim'].includes(last.status) || (last && last.paused)) { slot.p.pauseVideo(); return; }
        if (slot.p.isMuted() || slot.p.getVolume() < 100) audible(slot);
        // Report "playing" only once the SOUND really plays: a browser that blocks
        // autoplay still lets a muted video start, then pauses it the moment it is
        // unmuted — reporting at the first frame started silent clips.
        if (!slot.reported && !slot.confirming) {
          slot.confirming = true;
          setTimeout(() => {
            slot.confirming = false;
            if (slot !== slots[cur] || !ok(slot)) return;
            const playing = slot.p.getPlayerState() === 1;
            if (playing && (!soundOn() || !slot.p.isMuted())) {
              setGate(false);
              slot.reported = true;
              report('playing');
              preloadAfter = Date.now() + 1500;
            } else if (!playing && !(last && (last.paused || last.status === 'claim'))) {
              setGate(true);
              report('blocked');
            }
          }, 700);
        }
      }
      // A short video that ends mid-clip: go round again from the start point.
      if (st === 0 && last && last.status === 'playing') { slot.p.seekTo(last.play ? last.play.start : 0, true); slot.p.playVideo(); }
    }
    function onError(slot, code) {
      if (slot === slots[cur]) { report('error', { code }); return; }
      slot.vid = null; slot.preloaded = false; // a bad preload: the call will load it the normal way (and fail there)
    }

    function load(slot, play) {
      clearInterval(fadeTimers.get(slot));
      slot.vid = play.youtubeId;
      slot.token = play.token;
      slot.reported = false;
      slot.preloaded = false;
      try { slot.p.mute(); slot.p.setVolume(100); slot.p.loadVideoById({ videoId: play.youtubeId, startSeconds: play.start }); } catch (e) {}
      watch();
    }

    function sync(g) {
      last = g;
      if (!slots.length || !slots.every(ok)) return;
      const play = g && g.play;
      const s = slots[cur];
      if (!play || g.status === 'lobby' || g.status === 'final') {
        for (const x of slots) if (x.vid) silence(x, 600, true);
        setGate(false);
        return;
      }
      if (s.token !== play.token) {
        if (s.vid === play.youtubeId) {
          // Same song, new token: the host replayed the clip (or it resumed after a BINGO).
          s.token = play.token;
          s.reported = false;
          try { s.p.seekTo(play.start, true); s.p.playVideo(); } catch (e) {}
          watch();
        } else {
          const spare = slots[1 - cur];
          const old = s;
          if (spare.vid === play.youtubeId && spare.preloaded) {
            // The preload is ready: swap roles, start it.
            cur = 1 - cur;
            spare.token = play.token;
            spare.reported = false;
            try { spare.p.playVideo(); } catch (e) {}
            watch();
          } else {
            const target = old.vid ? spare : old; // keep the old song fading out on its own player
            if (target !== old) cur = 1 - cur;
            load(target, play);
          }
          if (old !== slots[cur] && old.vid) silence(old, 900, true);
        }
      }
      const c = slots[cur];
      // Pause for a BINGO moment or the host's pause; play otherwise.
      if (g.paused || g.status === 'claim') {
        if (c.p.getPlayerState() === 1) silence(c, 400, true);
      } else if (c.reported && c.p.getPlayerState() === 2) {
        c.p.playVideo();
      }
      // Preload the next song once this one has settled.
      const spare = slots[1 - cur];
      if (g.upNext && Date.now() > preloadAfter && c.reported && spare.vid !== g.upNext.youtubeId) {
        clearInterval(fadeTimers.get(spare));
        spare.vid = g.upNext.youtubeId;
        spare.preloaded = false;
        spare.token = null;
        try { spare.p.mute(); spare.p.loadVideoById({ videoId: g.upNext.youtubeId, startSeconds: g.upNext.start }); } catch (e) {}
      }
      // Only the revealed song's player is ever visible, and only on the reveal
      // (by CSS). The slot switches only then: switching when the next call
      // starts showed the next song's first frame while the frame faded out.
      if (g.status === 'reveal') slots.forEach((x, i) => x.el.classList.toggle('on', i === cur));
    }
    // The sound moved to another screen: go quiet. (Moving it here is picked up
    // on the next clip; the playing one stays muted rather than jumping in.)
    setInterval(() => { const s = slots[cur]; if (ok(s) && !soundOn() && !s.p.isMuted()) s.p.mute(); }, 1000);
    return { mount, unmount, sync };
  })();

  // ======================= shared bits =======================
  function prizeLadder(g) {
    return `<ol class="bg-ladder">${g.prizes.map((p, i) => {
      const w = g.winners.find(x => x.prize === p);
      const now = g.prize === p;
      return `<li class="${w ? 'won' : ''} ${now ? 'now' : ''}"><span class="bg-ladder-ico">${w ? '✅' : PRIZE_ICON[p]}</span><span><b>${esc(prizeName(p))}</b>${w ? `<small>${esc(w.names.join(' & '))}</small>` : now ? `<small>${esc(t('bg.playingFor'))}</small>` : ''}</span></li>`;
    }).join('')}</ol>`;
  }
  function miniCard(cells, size) {
    return `<div class="bg-mini" style="--n:${size}">${cells.map(c => `<span class="${c.free ? 'free' : ''} ${c.hit ? 'hit' : ''}" dir="auto">${c.free ? '⭐' : esc(c.title)}</span>`).join('')}</div>`;
  }

  // ======================= TV =======================
  let lastNoticeAt = 0;
  let lastClaimKey = '';
  const tv = {
    mount(root) {
      root.innerHTML = `<div class="bg-tv">
        <div class="bg-stage" id="bg-stage"></div>
        <div class="bg-videos" aria-hidden="true">
          <div class="bg-slot"><div class="bg-yt"></div></div>
          <div class="bg-slot"><div class="bg-yt"></div></div>
        </div>
        <div class="bg-gate" hidden><span>🔊</span><b>${esc(t('bg.clickForSound'))}</b></div>
      </div>`;
      Deck.mount(root);
      lastNoticeAt = Date.now();
    },
    unmount() { Deck.unmount(); },
    update(s) {
      const g = s.game;
      const el = document.getElementById('bg-stage');
      document.body.dataset.bg = g.status;
      Deck.sync(g);
      if (g.notice && g.notice.at > lastNoticeAt) {
        lastNoticeAt = g.notice.at;
        if (g.notice.kind === 'false') { Hub.stamp(t('bg.falseBingo'), 'stop', t('bg.sitsOut', { name: g.notice.name })); Hub.sfx.buzzer(); }
        else if (g.notice.kind === 'skip') Hub.toast(t('bg.skipped'));
      }
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.settings), () => UI.tvLobby('bingo', `<div class="bg-lobby-chips">
            <span class="bg-chip">🃏 ${num(g.settings.size)}×${num(g.settings.size)}</span>
            <span class="bg-chip">🎶 ${esc(t(`bg.pool.${g.settings.pool}`))}</span>
            <span class="bg-chip">⏱ ${esc(t('bg.secs', { n: num(g.settings.clip) }))}</span>
          </div>${prizeLadder({ ...g, prize: null, winners: [] })}`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'final') {
        const a = g.awards || {};
        if (Hub.screen(el, 'final' + Hub.lang + JSON.stringify(g.standings), `<div class="final-screen bg-final">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p><h1>🎵 ${esc(t('game.bingo.name'))}</h1>
            ${UI.podium(g.standings.filter(r => r.points > 0), r => r.points, r => r.name)}
            <div class="bg-awards">
              ${g.winners.map(w => `<span class="bg-award">${PRIZE_ICON[w.prize]} <b>${esc(prizeName(w.prize))}</b> ${esc(w.names.join(' & '))}</span>`).join('')}
              ${a.ear ? `<span class="bg-award">👂 <b>${esc(t('bg.award.ear'))}</b> ${esc(a.ear.names.join(' & '))} <small>(${num(a.ear.n)})</small></span>` : ''}
            </div></div>`)) { Hub.confetti(150); Hub.sfx.fanfare(); }
        return;
      }
      if (st === 'claim' && g.claim) {
        const key = 'claim' + g.claim.winners.map(w => w.id).join(',') + Hub.lang;
        const first = !lastClaimKey; // the BINGO itself; later changes are someone joining it
        if (Hub.screen(el, key, `<div class="bg-claim">
            <p class="bg-claim-prize">${PRIZE_ICON[g.claim.prize]} ${esc(prizeName(g.claim.prize))}</p>
            <h1 class="bg-claim-title ${g.claim.auto ? 'auto' : ''}" dir="auto">${esc(g.claim.auto ? t('bg.closestTitle') : t('bg.bingoWord'))}</h1>
            ${g.claim.auto ? `<p class="bg-claim-sub">${esc(t('bg.closestWins', { prize: prizeName(g.claim.prize) }))}</p>` : ''}
            <div class="bg-claim-wins ${g.claim.winners.length > 1 ? 'many' : ''}">${g.claim.winners.map(w => `<div class="bg-claim-win">
                <div class="bg-claim-who">${avatar(w.name, 'bg-claim-av')}<b>${esc(w.name)}</b></div>
                ${miniCard(w.cells, g.size)}</div>`).join('')}</div>
          </div>`)) {
          if (first) { Hub.confetti(140); Hub.sfx.fanfare(); } else Hub.sfx.chime();
        }
        lastClaimKey = key;
        return;
      }
      lastClaimKey = '';
      if (st === 'reveal' && g.song) {
        Hub.screen(el, 'reveal' + g.callNo + Hub.lang, `<div class="bg-reveal">
            <div class="bg-reveal-text">
              <p class="eyebrow">${esc(t('bg.songOf', { n: num(g.callNo), of: num(g.total) }))}</p>
              <h1 class="bg-song-title" dir="auto">${esc(g.song.title)}</h1>
              <p class="bg-song-artist" dir="auto">${esc(g.song.artist)}</p>
              <p class="bg-oncards">${esc(g.onCards ? t('bg.onCards', { n: num(g.onCards) }) : t('bg.onNoCards'))}${g.onCards ? ` <span class="bg-gotit">${esc(t('bg.gotIt', { n: num(g.gotIt) }))}</span>` : ''}</p>
              <p class="bg-next" id="bg-next"></p>
            </div>
            <div class="bg-reveal-video"></div>
          </div>`);
        placeVideo();
        const nx = document.getElementById('bg-next');
        if (nx) nx.textContent = g.paused ? `⏸ ${t('bg.paused')}` : g.nextAt ? t('bg.nextIn', { n: num(Hub.secondsLeft(g.nextAt)) }) : t('bg.waitHost');
        renderSide(g);
        return;
      }
      // loading / playing
      const listening = st === 'playing';
      Hub.screen(el, 'listen' + g.callNo + st + g.paused + Hub.lang, `<div class="bg-listen">
          <div class="bg-listen-main">
            <p class="eyebrow">${esc(t('bg.songOf', { n: num(listening ? g.callNo : g.callNo + 1), of: num(g.total) }))}</p>
            <div class="bg-disc-wrap">
              <div class="record ${listening && !g.paused ? 'spin' : ''} bg-disc"></div>
              ${listening && !g.paused ? Hub.ring(g.endsAt, g.settings.clip, 'bg-ring') : ''}
            </div>
            <h1 class="bg-listen-title">${esc(g.paused ? `⏸ ${t('bg.paused')}` : listening ? t('bg.listen') : t('bg.loading'))}</h1>
            <p class="bg-listen-sub">${esc(listening ? t('bg.listenSub') : '')}</p>
          </div>
          <aside class="bg-side" id="bg-side"></aside>
        </div>`);
      renderSide(g);
    },
    tick(s) {
      const nx = document.getElementById('bg-next');
      const g = s.game;
      if (nx && g.status === 'reveal' && g.nextAt && !g.paused) nx.textContent = t('bg.nextIn', { n: num(Hub.secondsLeft(g.nextAt)) });
    },
  };
  // The video frame lives outside the re-rendered stage (the players must not be
  // rebuilt); on the reveal it is laid exactly over the empty frame in the
  // layout — which side that is depends on the language (RTL flips the grid).
  function placeVideo() {
    const ph = document.querySelector('.bg-reveal-video');
    const box = document.querySelector('.bg-videos');
    const tvEl = document.querySelector('.bg-tv');
    if (!ph || !box || !tvEl) return;
    const put = () => {
      if (!ph.isConnected) return;
      const r = ph.getBoundingClientRect(), o = tvEl.getBoundingClientRect();
      if (!r.width) return;
      Object.assign(box.style, { left: (r.left - o.left) + 'px', top: (r.top - o.top) + 'px', width: r.width + 'px', right: 'auto', transform: 'none' });
    };
    put();
    setTimeout(put, 700); // after the panel's entrance animation
  }
  window.addEventListener('resize', () => { if (document.body.dataset.bg === 'reveal') placeVideo(); });

  function renderSide(g) {
    const side = document.getElementById('bg-side');
    const key = JSON.stringify([g.board.slice(0, 6), g.history, g.prize, g.winners, Hub.lang]);
    if (side && side.dataset.k !== key) {
      side.dataset.k = key;
      side.innerHTML = `${prizeLadder(g)}
        <div class="bg-closest"><p class="eyebrow">${esc(t('bg.closest'))}</p>${g.board.slice(0, 6).map(b => `<div class="bg-close-row ${b.away === 1 ? 'hot' : ''} ${b.away === null ? 'out' : ''}">${avatar(b.name)}<bdi>${esc(b.name)}</bdi><span class="bg-away">${esc(b.away === null ? t('bg.out') : b.away === 0 ? t('bg.check') : t('bg.away', { n: num(b.away) }))}</span></div>`).join('')}</div>
        ${g.history.length ? `<div class="bg-history"><p class="eyebrow">${esc(t('bg.justPlayed'))}</p>${g.history.slice(0, 4).map(h => `<p class="bg-hist" dir="auto"><b>${esc(h.title)}</b> <span>${esc(h.artist)}</span></p>`).join('')}</div>` : ''}`;
    }
  }

  // ======================= phone =======================
  let pending;             // this clip's pick while the tap is on its way (undefined = the server's)
  let pendingCall = -1;
  let cardKey = '';
  let lastResultAt = 0;
  const player = {
    mount(root) {
      root.innerHTML = '<div class="bg-ph" id="bg-ph"></div>';
      pending = undefined;
      cardKey = '';
      root.addEventListener('click', (e) => {
        const c = e.target.closest('[data-cell]');
        if (c && !c.classList.contains('free')) {
          const i = Number(c.dataset.cell);
          const g = Hub.state && Hub.state.game;
          const me = g && g.me;
          if (!me || c.classList.contains('got') || c.classList.contains('missed')) return;
          if (!pickOpen(g)) { flashNote(me.sitOut && g.status === 'playing' ? t('bg.sittingOut') : t('bg.waitClip')); return; }
          const was = pending !== undefined ? pending : me.pick;
          pending = was === i ? null : i;
          Hub.vibrate(12);
          if (pending !== null) Hub.sfx.pop();
          Hub.emit('player:bingo:mark', { cell: i, on: pending !== null });
          paintCells(g);
          updateClaimBtn(g);
          return;
        }
        if (e.target.closest('#bg-claim-btn')) {
          const b = e.target.closest('#bg-claim-btn');
          if (b.disabled) return;
          Hub.vibrate([30, 30, 60]);
          b.classList.add('sending');
          Hub.emit('player:bingo:claim');
        }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('bg-ph');
      const st = g.status;
      if (st === 'lobby') { Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('bingo', `<p class="muted small">🃏 ${esc(t('bg.cardNote', { n: num(g.settings.size) }))}</p>`)); cardKey = ''; return; }
      if (st === 'final') {
        cardKey = '';
        const mine = g.standings.find(r => r.id === Hub.myId);
        const rank = mine ? 1 + g.standings.filter(r => r.points > mine.points).length : null;
        Hub.screen(el, 'final' + Hub.lang + JSON.stringify(g.standings), `<div class="ph-result"><p class="eyebrow">${esc(t('core.gameOver'))}</p>
          <div class="big-rank">${rank === 1 && mine.points > 0 ? '🏆' : rank && rank <= 3 && mine.points > 0 ? ['🥇', '🥈', '🥉'][rank - 1] : '🎵'}</div>
          <p class="big-score">${num(mine ? mine.points : 0)} <small>${esc(t('core.pts'))}</small></p>
          <div class="bg-ph-winners">${g.winners.map(w => `<p><span>${PRIZE_ICON[w.prize]}</span> <b>${esc(prizeName(w.prize))}</b> <bdi>${esc(w.names.join(' & '))}</bdi></p>`).join('') || `<p class="muted">${esc(t('bg.noWinner'))}</p>`}</div>
          <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
        return;
      }
      const me = g.me;
      if (!me) { Hub.screen(el, 'nocard' + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">🃏</div><h2>${esc(t('bg.dealing'))}</h2></div>`); return; }
      // The card is built once; updates only change classes, so taps never flicker.
      const key = me.cells.map(c => c.free ? '*' : c.title).join('|') + Hub.lang;
      if (key !== cardKey) {
        cardKey = key;
        pending = undefined;
        el.innerHTML = `<div class="bg-ph-top" id="bg-ph-top"></div>
          <div class="bg-card n${g.size}" style="--n:${g.size}">${me.cells.map((c, i) => c.free
            ? `<div class="bg-cell free" data-cell="${i}"><span class="bg-free">⭐</span><small>${esc(t('bg.free'))}</small></div>`
            : `<button class="bg-cell" data-cell="${i}"><b dir="auto">${esc(c.title)}</b><small dir="auto">${esc(c.artist)}</small><i class="bg-daub" aria-hidden="true"></i></button>`).join('')}</div>
          <button class="bg-claim-btn" id="bg-claim-btn" dir="auto">${esc(t('bg.bingoWord'))}</button>
          <p class="bg-ph-note" id="bg-ph-note"></p>`;
      }
      // A tap on its way: shown until the server's payload agrees (or a new clip starts).
      if (pendingCall !== me.call || !me.canPick) { pending = undefined; pendingCall = me.call; }
      else if (pending !== undefined && pending === me.pick) pending = undefined;
      paintCells(g);
      renderTop(g);
      renderResult(g);
      updateClaimBtn(g);
    },
    events: {
      'bingo:result': (r) => {
        const b = document.getElementById('bg-claim-btn');
        if (b) b.classList.remove('sending');
        const note = document.getElementById('bg-ph-note');
        lastResultAt = Date.now();
        if (r && r.ok) { Hub.confetti(90); Hub.sfx.fanfare(); Hub.vibrate([60, 40, 60, 40, 160]); if (note) note.textContent = '🎉 ' + t('bg.youWon'); return; }
        if (b) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
        Hub.sfx.buzzer();
        Hub.vibrate([80, 60, 80]);
        if (note) note.textContent = r && r.reason === 'sitout' ? t('bg.sittingOut') : r && r.reason === 'false' ? t('bg.notYet') : t('bg.tooLate');
      },
    },
  };
  const myPick = (g) => (pending !== undefined ? pending : g.me.pick);
  // Picking is open while the clip plays — also judged by this phone's own clock,
  // so a tap after the timer hit 0 isn't even sent.
  const pickOpen = (g) => !!(g && g.me && g.me.canPick && g.status === 'playing' && (!g.endsAt || Date.now() < g.endsAt + 150));
  function paintCells(g) {
    const me = g.me;
    const card = document.querySelector('.bg-card');
    if (!card) return;
    const pick = g.status === 'playing' ? myPick(g) : null;
    card.classList.toggle('open', pickOpen(g));
    card.querySelectorAll('.bg-cell').forEach((c, i) => {
      const x = me.cells[i];
      if (x.free) return;
      c.classList.toggle('got', x.state === 'got');
      c.classList.toggle('missed', x.state === 'missed');
      c.classList.toggle('picked', pick === i && !x.state);
    });
  }
  let noteUntil = 0;
  function flashNote(text) {
    const note = document.getElementById('bg-ph-note');
    if (!note) return;
    note.textContent = text;
    noteUntil = Date.now() + 3000;
  }
  // After each clip: how did my pick do?
  let resultKey = '';
  function renderResult(g) {
    const last = g.me.last;
    const key = last && (g.status === 'reveal' || g.status === 'claim') ? last.call + last.result : '';
    if (key === resultKey) return;
    resultKey = key;
    if (!key) return;
    if (last.result === 'got') { Hub.sfx.chime(); Hub.vibrate([20, 40, 20]); flashNote('✅ ' + t('bg.gotIt1')); }
    else if (last.result === 'wrong') flashNote('❌ ' + t(last.cell >= 0 ? 'bg.wrongOnCard' : 'bg.wrongPick'));
    else if (last.result === 'missed') flashNote('😬 ' + t('bg.missedIt'));
    else flashNote(t('bg.notOnCard'));
    const card = document.querySelector('.bg-card');
    if (card && last.cell >= 0) {
      const c = card.querySelectorAll('.bg-cell')[last.cell];
      if (c) { c.classList.remove('just'); void c.offsetWidth; c.classList.add('just'); }
    }
  }

  function renderTop(g) {
    const top = document.getElementById('bg-ph-top');
    if (!top) return;
    const st = g.status;
    let line = '';
    if (g.paused) line = `⏸ ${esc(t('bg.paused'))}`;
    else if (st === 'loading') line = `⏳ ${esc(t('bg.loading'))}`;
    else if (st === 'playing') line = `🎧 ${esc(g.me && g.me.sitOut ? t('bg.sittingOut') : t('bg.listenPhone'))}`;
    else if (st === 'reveal' && g.song) line = `🎵 <b dir="auto">${esc(g.song.title)}</b> <span dir="auto">${esc(g.song.artist)}</span>`;
    else if (st === 'claim' && g.claim) line = `🎉 ${esc(t(g.claim.auto ? 'bg.closestPhone' : 'bg.gotBingo', { names: g.claim.winners.map(w => w.name).join(' & ') }))}`;
    const key = st + g.paused + (g.me && g.me.sitOut) + g.callNo + (g.song ? g.song.title : '') + (g.claim ? g.claim.winners.length : '') + g.prize + Hub.lang;
    if (top.dataset.k === key) return;
    top.dataset.k = key;
    top.innerHTML = `<div class="bg-ph-bar"><span class="pill">${esc(t('bg.songShort', { n: num(Math.max(1, g.callNo)), of: num(g.total) }))}</span>
        ${g.prize ? `<span class="pill gold">${PRIZE_ICON[g.prize]} ${esc(prizeName(g.prize))}</span>` : ''}
        ${st === 'playing' && !g.paused ? `<span class="pill" data-ends="${g.endsAt}"></span>` : ''}</div>
      <p class="bg-ph-line ${st}">${line}</p>`;
    if (st === 'claim' && g.claim && !g.claim.winners.some(w => w.id === Hub.myId)) Hub.sfx.chime();
  }
  function updateClaimBtn(g) {
    const b = document.getElementById('bg-claim-btn');
    const me = g && g.me;
    if (!b || !me) return;
    // Light the button when your daubed songs (+ this clip's pick, if it's
    // right — the server checks) make the prize.
    const pick = g.status === 'playing' ? myPick(g) : null;
    const n = g.size;
    const has = (i) => me.cells[i].free || me.cells[i].state === 'got' || i === pick;
    const L = [];
    for (let r = 0; r < n; r++) L.push([...Array(n)].map((_, c) => r * n + c));
    for (let c = 0; c < n; c++) L.push([...Array(n)].map((_, r) => r * n + c));
    L.push([...Array(n)].map((_, i) => i * n + i), [...Array(n)].map((_, i) => i * n + (n - 1 - i)));
    const lines = L.filter(l => l.every(has)).length;
    const ready = g.prize === 'full' ? me.cells.every((_, i) => has(i)) : lines >= (g.prize === 'two' ? 2 : 1);
    const open = !!g.prize && ['loading', 'playing', 'reveal', 'claim'].includes(g.status) && !g.paused;
    b.disabled = !open || me.sitOut || (g.status === 'claim' && g.claim && g.claim.winners.some(w => w.id === Hub.myId));
    b.classList.toggle('ready', ready && !b.disabled);
    const note = document.getElementById('bg-ph-note');
    if (note && Date.now() - lastResultAt > 4000 && Date.now() > noteUntil) {
      note.textContent = me.sitOut ? t('bg.sittingOut') : ready && !b.disabled ? t('bg.tapBingo')
        : pickOpen(g) ? t('bg.pickHint') : g.prize ? t('bg.needFor', { prize: prizeName(g.prize) }) : '';
    }
  }

  // ======================= host =======================
  let peek = false;
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="bg-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:bingo:settings');
      root.addEventListener('click', (e) => { if (e.target.closest('#bg-peek')) { peek = !peek; host.update(Hub.state); } });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('bg-host');
      const st = g.status;
      const online = s.players.filter(p => p.connected).length;
      if (st === 'lobby' || st === 'final') {
        const enough = g.available >= g.needed;
        const sel = (key, opts) => `<select data-setting="${key}">${opts.map(([v, label]) => `<option value="${v}" ${String(g.settings[key]) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
        Hub.screen(el, st + JSON.stringify(g.settings) + online + g.available, `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '🎵 Music Bingo'}</h2>
            <p class="muted small">Every phone gets a card of songs from your playlist. The TV plays short clips without saying what they are. While a clip plays, players tap the song on their card if they recognise it (one pick per clip): right = daubed. Once the clip is over the song is gone — one you didn't recognise in time is missed. BINGO for a line, then two lines, then a full house. If the songs run out first, the closest card wins the prize being played for.</p>
            <p class="bg-host-count ${enough ? '' : 'bad'}">${enough ? `✅ ${g.available} songs match these settings — ${g.needed} go on each card.` : `⚠️ Only ${g.available} songs match — a card needs ${g.needed}. Pick a wider pool or a smaller card.`}</p>
            <button class="primary big-btn" data-emit="host:bingo:start" ${enough && online ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
            <div class="roster">${UI.hostRoster(s.players)}</div></section>
          <section class="h-card"><h2>Songs</h2><div class="h-fields">
            ${UI.hostField('Song pool', sel('pool', [['mix', 'Persian + international'], ['persian', 'Persian only'], ['intl', 'International only']]))}
            ${UI.hostField('How well-known', sel('level', [['easy', 'Easy only'], ['medium', 'Easy + medium'], ['all', 'All, hard ones too']]))}
            ${UI.hostField('Clip starts', sel('start', [['into', '35 s in (skips intros)'], ['intro', 'From the start']]))}
            ${UI.hostField('Clip length (seconds)', UI.numberInput('clip', g.settings.clip, 10, 90, 5))}
          </div></section>
          <section class="h-card"><h2>Card & prizes</h2><div class="h-fields">
            ${UI.hostField('Card', sel('size', [[3, '3×3 · ~9 min'], [4, '4×4 · ~17 min'], [5, '5×5 + free middle · ~23 min']]))}
            ${UI.hostField('Prizes', sel('prizes', [['all', 'Line → 2 lines → full'], ['lineFull', 'Line → full house'], ['line', 'One line only']]))}
          </div>
          ${UI.toggle('auto', g.settings.auto, 'Next song automatically', 'A few seconds after each reveal. Off: you press Next song.')}
          </section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const tvLine = { loading: '⏳ TV is loading the song…', playing: '🔊 Playing on the TV', blocked: '🔇 The TV needs one click to start sound', error: '❌ The TV couldn\'t play it — skipping', idle: '' }[g.tv && g.tv.status] || '';
      const statusTitle = g.paused ? '⏸ Paused' : { loading: 'Loading the next song', playing: 'Clip playing', reveal: 'Revealed', claim: 'BINGO!' }[st] || st;
      el.innerHTML = `<section class="h-card span2 h-hero">
          <p class="eyebrow">Song ${Math.max(1, g.callNo)} of ${g.total} · playing for: ${esc(prizeName(g.prize || 'full'))}</p>
          <h2>${esc(statusTitle)} ${st === 'playing' && !g.paused ? `<span class="h-timer" data-ends="${g.endsAt}" data-format="clock"></span>` : ''}</h2>
          <p class="h-status ${g.tv && (g.tv.status === 'blocked' || g.tv.status === 'error') ? 'bad' : ''}">${esc(tvLine)}</p>
          ${st === 'claim' && g.claim ? `<p class="h-status">🎉 ${esc(g.claim.winners.map(w => w.name).join(' & '))} — ${esc(prizeName(g.claim.prize))}</p>` : ''}
          <div class="h-btns">
            <button class="primary big-btn" data-emit="host:bingo:pause" ${['loading', 'playing', 'reveal'].includes(st) ? '' : 'disabled'}>${g.paused ? '▶ Resume' : '⏸ Pause'}</button>
            ${st === 'reveal' ? `<button data-emit="host:bingo:next" ${g.paused ? 'disabled' : ''}>⏭ Next song</button>` : `<button data-emit="host:bingo:reveal" ${st === 'playing' && !g.paused ? '' : 'disabled'}>👁 Reveal now</button>`}
            <button data-emit="host:bingo:replay" ${st === 'playing' && !g.paused ? '' : 'disabled'}>↺ Replay clip</button>
            <button data-emit="host:bingo:skip" ${['loading', 'playing', 'reveal'].includes(st) && !g.paused ? '' : 'disabled'}>Skip song</button>
            <button id="bg-peek">${peek ? '🙈 Hide song' : '👁 Peek (only if you\'re not playing)'}</button>
            <button class="danger" data-emit="host:bingo:end" data-confirm="Tap again to end">End game</button>
          </div>
          ${peek && g.secret ? `<p class="h-secret">Now: <b dir="auto">${esc(g.secret.title)}</b> — <span dir="auto">${esc(g.secret.artist)}</span></p>` : ''}
        </section>
        <section class="h-card"><h2>Prizes</h2>${prizeLadder(g)}</section>
        <section class="h-card"><h2>Closest</h2>${g.board.map(b => `<div class="trophy-row">${avatar(b.name)} <b>${esc(b.name)}</b> <span class="muted small">${b.away === null ? 'out of reach' : b.away === 0 ? 'can call BINGO' : `${b.away} away`} · ${b.got} ✓</span></div>`).join('') || '<p class="muted small">No cards yet.</p>'}
          <h3>Points</h3>${g.standings.filter(r => r.points).map(r => `<div class="trophy-row">${avatar(r.name)} <b>${esc(r.name)}</b> ${r.points}</div>`).join('') || '<p class="muted small">No prizes yet.</p>'}</section>`;
    },
  };

  Hub.register('bingo', { tv, player, host });
})();

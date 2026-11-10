// Shared by the music TV (tv.html) and the hub TV (hub/tv.html): "only one TV
// screen plays sound". The server picks the screen (see games/tv-screens.js);
// this file says which browser tab this is and shows the note on the others.
(function () {
  const store = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
  const get = (k) => { try { return store && store.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { if (store) store.setItem(k, v); } catch (e) { /* private mode */ } };

  // One id per browser tab. sessionStorage survives the music <-> hub page
  // hand-off within the tab, but a different tab or window gets its own.
  let screenId = get('gtm_tv_screen');
  if (!screenId) {
    screenId = 'tv-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    set('gtm_tv_screen', screenId);
  }
  // launch-kiosk.ps1 opens tv.html?kiosk=1; remember it for the hub page too.
  let kiosk = new URLSearchParams(location.search).get('kiosk') === '1';
  if (kiosk) set('gtm_tv_kiosk', '1'); else kiosk = get('gtm_tv_kiosk') === '1';
  // A kiosk window fills the whole display; an ordinary Chrome tab doesn't
  // (its toolbar takes space). Catches a kiosk launched without ?kiosk=1.
  const fullscreen = () => Math.abs(screen.width - window.innerWidth) < 4 && Math.abs(screen.height - window.innerHeight) < 4;
  const info = () => ({ screen: screenId, kiosk, fullscreen: fullscreen(), visible: document.visibilityState === 'visible' });

  let soundOn = true; // until the server says otherwise (it does so before the first state)
  let sock = null;
  let opts = { onChange() {}, text: () => ({ note: 'Another TV screen is playing the sound.', button: 'Play the sound here' }) };
  let note = null;

  function render() {
    if (soundOn) { if (note) note.hidden = true; return; }
    if (!note) {
      note = document.createElement('div');
      note.className = 'tv-sound-note';
      note.setAttribute('role', 'status');
      note.innerHTML = '<span class="tv-sound-ico" aria-hidden="true">🔇</span><span class="tv-sound-text"></span><button type="button" class="tv-sound-btn"></button>';
      note.querySelector('button').addEventListener('click', () => { if (sock) sock.emit('tv:claimSound'); });
      document.body.appendChild(note);
    }
    const tx = opts.text();
    note.querySelector('.tv-sound-text').textContent = tx.note;
    note.querySelector('.tv-sound-btn').textContent = tx.button;
    note.hidden = false;
  }

  function attach(socket, o) {
    sock = socket;
    opts = { ...opts, ...o };
    socket.on('tvSound', (d) => {
      const next = !(d && d.sound === false);
      const changed = next !== soundOn;
      soundOn = next;
      render();
      if (changed) opts.onChange(soundOn);
    });
    let resizeTimer = null;
    const report = () => { if (socket.connected) socket.emit('tv:screen', { visible: info().visible, fullscreen: info().fullscreen }); };
    document.addEventListener('visibilitychange', report);
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(report, 500); });
  }

  const css = document.createElement('style');
  css.textContent = `
    .tv-sound-note { position: fixed; left: 1.2rem; bottom: 1.2rem; z-index: 9999; display: flex; align-items: center; gap: .7em;
      max-width: min(46rem, 80vw); padding: .7em .8em .7em 1em; border-radius: 999px; font-size: max(14px, 1.05rem);
      background: rgba(10, 10, 20, .82); color: #fff; border: 1px solid rgba(255, 255, 255, .18);
      box-shadow: 0 .5em 1.6em rgba(0, 0, 0, .35); backdrop-filter: blur(6px); }
    html[dir="rtl"] .tv-sound-note { left: auto; right: 1.2rem; }
    .tv-sound-note[hidden] { display: none; }
    .tv-sound-ico { font-size: 1.3em; line-height: 1; }
    .tv-sound-text { line-height: 1.3; }
    .tv-sound-btn { flex: none; font: inherit; font-weight: 700; color: #111; background: #ffd166; border: 0; border-radius: 999px;
      padding: .45em 1em; cursor: pointer; }
    .tv-sound-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }`;
  document.head.appendChild(css);

  window.TvSound = { info, attach, refresh: render, on: () => soundOn };
})();

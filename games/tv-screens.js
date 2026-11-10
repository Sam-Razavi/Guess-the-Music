// "Only one TV plays sound."
//
// If a second TV page is open (the classic case: a forgotten tv.html tab in
// the everyday Chrome, next to the kiosk), every song and sound effect played
// twice, slightly out of step. Every TV page (music or hub) now tells the
// server which browser tab it is (a per-tab id kept in sessionStorage, so it
// survives the music <-> hub page hand-off), whether it is the kiosk, whether
// it fills the screen and whether it is visible. The server picks exactly one
// "sound screen" and the others mute themselves and say so.
//
// Who gets the sound, in order:
//   1. a screen where someone clicked "Play the sound here" (latest click wins)
//   2. the kiosk (launch-kiosk.ps1 opens tv.html?kiosk=1)
//   3. a screen that fills the whole display (the kiosk launched the old way)
//   4. a visible screen (a background tab is never picked over one on show)
//   5. the screen that was opened first
const GRACE_MS = 8000; // a page change (music <-> hub) briefly has no socket

module.exports = function createTvScreens({ io, onChange }) {
  const screens = new Map(); // screenId -> screen
  const bySocket = new Map(); // socket.id -> screenId
  let seq = 0;
  let lastSummary = '';
  let pruneTimer = null;

  const cleanId = (v, socket) => (typeof v === 'string' && /^[A-Za-z0-9_-]{6,48}$/.test(v) ? v : 'sock-' + socket.id);

  function present(now = Date.now()) {
    return [...screens.values()].filter(s => s.sockets.size > 0 || now - s.goneAt < GRACE_MS);
  }

  function rank(s) {
    return [s.claimedAt, s.kiosk ? 1 : 0, s.fullscreen ? 1 : 0, s.visible ? 1 : 0, -s.order];
  }
  function better(a, b) {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
    return false;
  }

  function soundScreen() {
    let best = null;
    for (const s of present()) if (!best || better(s, best)) best = s;
    return best;
  }

  function summary() {
    const list = present();
    const sound = soundScreen();
    return {
      count: list.length,
      soundIsKiosk: !!(sound && (sound.kiosk || sound.fullscreen)),
      soundVisible: !!(sound && sound.visible),
    };
  }

  // Tells every TV socket whether it plays sound; refreshes the host pages
  // when the picture changed (number of screens / who has the sound).
  function sync() {
    const now = Date.now();
    for (const [id, s] of screens) if (s.sockets.size === 0 && now - s.goneAt >= GRACE_MS) screens.delete(id);
    const sound = soundScreen();
    const count = present(now).length;
    for (const s of screens.values()) {
      for (const sid of s.sockets) io.to(sid).emit('tvSound', { sound: s === sound, screens: count });
    }
    const sum = JSON.stringify(summary());
    if (sum !== lastSummary) { lastSummary = sum; onChange(); }
    // Wake up again when the oldest "just left" screen stops counting.
    clearTimeout(pruneTimer);
    const gone = [...screens.values()].filter(s => s.sockets.size === 0);
    if (gone.length) {
      const next = Math.min(...gone.map(s => s.goneAt + GRACE_MS)) - now;
      pruneTimer = setTimeout(sync, Math.max(50, next + 20));
    }
  }

  function apply(s, info) {
    if (!info || typeof info !== 'object') return;
    if (typeof info.visible === 'boolean') s.visible = info.visible;
    if (typeof info.fullscreen === 'boolean') s.fullscreen = info.fullscreen;
  }

  // A TV page registered (role 'tv', music or hub view).
  function add(socket, info = {}) {
    remove(socket, { quiet: true }); // re-register on the same socket
    const id = cleanId(info.screen, socket);
    let s = screens.get(id);
    if (!s) {
      s = { id, sockets: new Set(), kiosk: false, fullscreen: false, visible: true, claimedAt: 0, order: ++seq, goneAt: 0 };
      screens.set(id, s);
    }
    if (info.kiosk === true) s.kiosk = true;
    apply(s, info);
    s.sockets.add(socket.id);
    bySocket.set(socket.id, id);
    sync();
  }

  function update(socket, info) {
    const s = screens.get(bySocket.get(socket.id));
    if (!s) return;
    apply(s, info);
    sync();
  }

  function claim(socket) {
    const s = screens.get(bySocket.get(socket.id));
    if (!s) return;
    // A click moves the sound; it doesn't stack. Once this screen goes away the
    // normal order (kiosk, full screen, visible, first opened) decides again.
    for (const other of screens.values()) other.claimedAt = 0;
    s.claimedAt = Date.now();
    sync();
  }

  function remove(socket, { quiet } = {}) {
    const id = bySocket.get(socket.id);
    if (!id) return;
    bySocket.delete(socket.id);
    const s = screens.get(id);
    if (s) {
      s.sockets.delete(socket.id);
      if (s.sockets.size === 0) s.goneAt = Date.now();
    }
    if (!quiet) sync();
  }

  // Playback reports (tv:playerStatus) only count from the screen with the sound.
  function isSoundSocket(socket) {
    const s = soundScreen();
    return !!(s && s.sockets.has(socket.id));
  }

  return { add, update, claim, remove, summary, isSoundSocket };
};

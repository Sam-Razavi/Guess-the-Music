// Keeps a phone's screen from locking or dimming while a page is open.
//
// Two mechanisms, chosen by the vendored NoSleep library: the Screen Wake Lock
// API, which browsers only expose on secure (https / localhost) pages — and
// this game is served over plain http on the home WiFi, so on a phone it is
// NOT available — and, as the fallback that actually does the work here, a
// tiny hidden looping video (a playing video keeps the screen on).
//
// Browsers only allow either one to start from a user gesture, so this arms
// itself on the first tap/click. It also re-acquires after the page comes back
// from being hidden (switching apps releases both). `status` is one of:
//   'off' (not started) | 'on' | 'failed' (the phone refused, e.g. Low Power Mode)
//   | 'unsupported' (library missing).
window.KeepAwake = (function () {
  const api = { status: 'off', onChange: null };
  const noSleep = typeof NoSleep === 'function' ? new NoSleep() : null;
  let wanted = false;

  function set(status) {
    if (api.status === status) return;
    api.status = status;
    if (typeof api.onChange === 'function') api.onChange(status);
  }

  async function tryEnable() {
    if (!noSleep) { set('unsupported'); return false; }
    try {
      await noSleep.enable();
      set(noSleep.isEnabled ? 'on' : 'failed');
    } catch (e) {
      set('failed');
    }
    return api.status === 'on';
  }

  api.start = function () { wanted = true; return tryEnable(); };

  // Start from the first gesture, and keep retrying on later taps until it works
  // (a refusal — e.g. before a gesture, or Low Power Mode — shouldn't be final).
  api.arm = function () {
    const onGesture = () => { if (api.status !== 'on') api.start(); };
    ['click', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, onGesture, { passive: true }));
    // Leaving the page (app switch / lock) releases the screen lock; coming back
    // needs re-acquiring. May be refused without a fresh tap — the handler above
    // then picks it up on the next touch.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !wanted) return;
      set('off'); // whatever we held is gone
      tryEnable();
    });
  };

  return api;
})();

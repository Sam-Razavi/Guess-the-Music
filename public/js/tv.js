const socket = io();
// See host.js for why this re-registers on every 'connect' rather than once.
socket.on('connect', () => socket.emit('register', { role: 'tv' }));

const stageEl = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const panels = {
  idle: document.getElementById('panel-idle'),
  playing: document.getElementById('panel-playing'),
  wagering: document.getElementById('panel-wagering'),
  buzzed: document.getElementById('panel-buzzed'),
  revealed: document.getElementById('panel-revealed'),
  results: document.getElementById('panel-results'),
};
const scoreboardEl = document.getElementById('scoreboard');
const buzzTakeoverEl = document.getElementById('buzz-takeover');
const buzzedAvatarEl = document.getElementById('buzzed-avatar');
const buzzedNameEl = document.getElementById('buzzed-name');
const buzzedTeaseEl = document.getElementById('buzzed-tease');
const revealTitleEl = document.getElementById('reveal-title');
const revealArtistEl = document.getElementById('reveal-artist');
const playingSubtext = document.getElementById('playing-subtext');
const hintTextEl = document.getElementById('hint-text');
const snippetHintEl = document.getElementById('snippet-hint');
const timerRingEl = document.getElementById('timer-ring');
const timerProgressEl = document.getElementById('timer-progress');
const resultsListEl = document.getElementById('results-list');
const sessionStatsEl = document.getElementById('session-stats');
const achievementBadgesEl = document.getElementById('achievement-badges');
const autoAdvanceHintEl = document.getElementById('auto-advance-hint');
const revealCaptionEl = document.getElementById('reveal-caption');
const captionTitleEl = document.getElementById('caption-title');
const captionArtistEl = document.getElementById('caption-artist');
const captionWorkEl = document.getElementById('caption-work');
const captionLabelEl = document.querySelector('#reveal-caption .lt-label');
const mysteryBannerEl = document.getElementById('mystery-banner');
const wagerBannerEl = document.getElementById('wager-banner');
const wageringSubtextEl = document.getElementById('wagering-subtext');
const categoryVotePanelEl = document.getElementById('category-vote-panel');
const idleWaitingBlockEl = document.getElementById('idle-waiting-block');
const pausedOverlayEl = document.getElementById('paused-overlay');
const voteHeadingEl = document.getElementById('vote-heading');
const voteOptionsTvEl = document.getElementById('vote-options-tv');
const voteTvStatusEl = document.getElementById('vote-tv-status');
const joinCountEl = document.getElementById('join-count');
const buzzedVerdictEl = document.getElementById('buzzed-verdict');
const headerJoinChipEl = document.getElementById('header-join-chip');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fxOn(state) {
  return !!(state && state.settings && state.settings.extraAnimations);
}

// ---- visualizer rings around the record (built once) ----
document.querySelectorAll('.viz-ring').forEach(ring => {
  const small = ring.parentElement.classList.contains('record-stage-sm');
  const count = small ? 36 : 56;
  let html = '';
  for (let i = 0; i < count; i++) {
    const dur = (0.4 + Math.random() * 0.75).toFixed(2);
    const delay = (-Math.random() * 1.2).toFixed(2);
    html += `<span class="viz-bar" style="--r:${((360 / count) * i).toFixed(2)}deg;--t:${dur}s;--d:${delay}s"><i></i></span>`;
  }
  ring.innerHTML = html;
});

// ---- join QR ----
let joinHost = '';
fetch('/join-info').then(r => r.json()).then(({ url }) => {
  document.getElementById('join-url').textContent = url.replace(/^https?:\/\//, '');
  document.getElementById('qr').src = '/qr.png';
  joinHost = url.replace(/^https?:\/\//, '').replace(/\/player\.html$/, '');
  if (latestState) updateHeaderJoinChip(latestState);
});

// ---- YouTube player ----
let player = null;
let loadedRoundKey = null; // which ROUND's song is loaded — see roundKeyOf()
let latestState = null;

// ---- YouTube players: two of them ----
// `player` is always the one the current round plays on; `spare` is the other. While a
// round plays, the spare preloads the song coming up next (the server sends it as
// state.upNext): loaded muted, frozen on its first frame at the right start point. When
// that round starts the two swap roles — nothing left to load, so the music starts the
// moment the countdown ends — and the previous song fades out on the old one. If the
// host starts some other song, it's loaded on the spare the normal way (still with the
// countdown hold below). If the second player never comes up, everything still works on
// one player, just without the preloading.
let spare = null;
let spareSong = null;    // what the spare holds: { youtubeId, offset, frozen, ready, failed }
let ducked = null;       // the previous round's player, playing quietly under the countdown until GO
let lastReleaseAt = 0;   // when the current round's music was let go — preloading waits a moment after it

function isReady(p) { return !!(p && p.__ready && typeof p.loadVideoById === 'function'); }
function isSounding(p) { if (!isReady(p)) return false; const s = p.getPlayerState(); return s === 1 || s === 3; }

function showOnly(p) {
  const frame = isReady(p) && typeof p.getIframe === 'function' ? p.getIframe() : null;
  if (!frame) return;
  document.querySelectorAll('.yt-slot').forEach(slot => slot.classList.toggle('is-active', slot === frame.parentElement));
}

// ---- fades (the "Fade out between songs" game option) ----
const fades = new Map(); // player -> interval
function fadeOn(state) { return !!(state && state.settings && state.settings.fadeBetweenSongs); }
function cancelFade(p) { const h = fades.get(p); if (h) { clearInterval(h); fades.delete(p); } }
// Ramps p's volume to `to` (0–100) over `ms` along a quarter-cosine (sounds smoother than a
// straight line), then calls `then`.
function fadeVolume(p, to, ms, then) {
  cancelFade(p);
  if (!isReady(p)) { if (then) then(); return; }
  const from = typeof p.getVolume === 'function' ? p.getVolume() : 100;
  const t0 = Date.now();
  const h = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    p.setVolume(Math.round(to + (from - to) * Math.cos(k * Math.PI / 2)));
    if (k >= 1) { clearInterval(h); fades.delete(p); if (then) then(); }
  }, 60);
  fades.set(p, h);
}

// Done with a player's song: fade it out over `ms` (0 = right away), stop it, and put its
// volume back for whatever it plays next. Freeing the spare is also the cue to preload.
function retire(p, ms) {
  if (!isReady(p)) return;
  const done = () => {
    try { p.stopVideo(); p.setVolume(100); } catch (e) { /* player torn down */ }
    if (p === spare) setTimeout(() => maybePreload(latestState), 300);
  };
  if (ms > 0 && isSounding(p)) fadeVolume(p, 0, ms, done);
  else { cancelFade(p); done(); }
}

// The previous round's player when a new round takes over: with fading on it ducks to a
// quiet bed under the countdown and finishes fading as the new song comes in (see
// prerollRelease); without a countdown it crossfades; with fading off it just stops.
function letGoOf(p, state) {
  if (!isReady(p) || p === player) return;
  if (!fadeOn(state) || !isSounding(p)) { retire(p, 0); return; }
  if (preroll.active) { fadeVolume(p, 25, 1700); ducked = p; }
  else retire(p, 2500);
}

// Preload state.upNext on the spare — muted, frozen on its first frame at the start point.
function maybePreload(state) {
  if (!state || !state.upNext || !isReady(spare) || fades.has(spare) || spare === ducked) return;
  if (preroll.active) return; // the current round is still getting its own song ready
  const since = Date.now() - lastReleaseAt;
  if (state.roundStatus === 'playing' && since < 1500) { setTimeout(() => maybePreload(latestState), 1600 - since); return; }
  const want = { youtubeId: state.upNext.youtubeId, offset: state.upNext.startOffsetSeconds || 0 };
  if (spareSong && spareSong.youtubeId === want.youtubeId && (spareSong.offset === want.offset || spareSong.failed)) return;
  if (!spareSong && isSounding(spare)) return; // something audible is still on it
  spareSong = { ...want, frozen: false, ready: false, failed: false };
  spare.mute();
  spare.setVolume(100);
  spare.loadVideoById({ videoId: want.youtubeId, startSeconds: want.offset });
}

function onSpareState(p, e) {
  if (p !== spare || !spareSong || spareSong.ready || spareSong.failed) return;
  if (e.data === 1 && !spareSong.frozen) {
    spareSong.frozen = true;
    p.pauseVideo();
    p.seekTo(spareSong.offset, true);
  } else if (e.data === 2 && spareSong.frozen) {
    spareSong.ready = true;
  }
}

// A round's identity: its song AND when it started. Keying on the song alone meant
// that starting the same song again (a replay, or re-testing a start offset) looked
// like "already loaded" and carried on from wherever the player was.
function roundKeyOf(state) {
  return state.currentSong ? state.currentSong.youtubeId + '|' + (state.roundStartedAt || 0) : null;
}

// ---- start of a round: the song is buffered silently during the 3-2-1 countdown
// and released on "GO!", so the music starts the instant the countdown ends instead
// of a few seconds later (the load used to begin only when the countdown did, and a
// slow load meant sound well after "GO!"). If the song isn't ready when the countdown
// reaches GO, the countdown waits on "1" — up to PREROLL_MAX_WAIT_MS — rather than
// saying GO to silence. ----
const PREROLL_MAX_WAIT_MS = 8000;
const preroll = { active: false, frozen: false, ready: false, onReady: null, timer: null };
let snippetArmed = false; // snippet mode counts its seconds from when the sound actually starts

function prerollBegin() {
  clearTimeout(preroll.timer);
  const stale = preroll.onReady; // an older countdown still waiting on "1" — let it finish its graphic
  Object.assign(preroll, { active: true, frozen: false, ready: false, onReady: null, timer: null });
  if (stale) stale();
}

// Called when the countdown reaches "GO!" (or the round moves on / fails before then).
// Idempotent: the first caller wins, later ones are no-ops.
function prerollRelease() {
  if (!preroll.active) return;
  clearTimeout(preroll.timer);
  preroll.active = false;
  const waiting = preroll.onReady; // a countdown still waiting on "1" — let it finish
  preroll.onReady = null;
  if (player && typeof player.unMute === 'function') {
    cancelFade(player);
    player.setVolume(100);
    player.unMute();
    if (!(latestState && latestState.paused)) { // while paused the overlay owns playback; resuming plays it
      player.playVideo();
      ensurePlaybackStarted();
      watchPlaybackStart();
    }
  }
  // The previous song, kept quietly under the countdown, bows out as this one comes in.
  if (ducked) { retire(ducked, 900); ducked = null; }
  lastReleaseAt = Date.now();
  setTimeout(() => maybePreload(latestState), 1600);
  if (waiting) waiting();
}

// Runs cb once the held song is buffered (immediately if it already is, or if there's
// nothing being held). Gives up after PREROLL_MAX_WAIT_MS so a song that never loads
// can't leave the countdown stuck on "1".
function whenSongReady(cb) {
  if (!preroll.active || preroll.ready) { cb(); return; }
  preroll.onReady = cb;
  preroll.timer = setTimeout(() => { preroll.onReady = null; cb(); }, PREROLL_MAX_WAIT_MS);
}

// The IFrame API loads asynchronously and can finish after a 'state' event
// has already arrived (or after a round is already 'playing' when this page
// loads) — so syncing on the socket event alone can miss it forever. Sync
// from both the socket event and player-ready callback, whichever is last.
function syncVideo(state) {
  if (!state || !player || typeof player.loadVideoById !== 'function') return;

  // Not only 'playing': a TV that (re)loads mid-round — kiosk relaunch, PC reboot,
  // a crash-resume — can open straight into 'buzzed' or 'revealed' and must still
  // pick the song up. In the normal flow loadedRoundKey already matches, so this
  // is a no-op and the song just keeps playing through a buzz-in and the reveal.
  if (state.currentSong && state.currentSong.youtubeId && ['playing', 'buzzed', 'revealed'].includes(state.roundStatus)
      && roundKeyOf(state) !== loadedRoundKey) {
    loadedRoundKey = roundKeyOf(state);
    const videoId = state.currentSong.youtubeId;
    const offset = state.startOffsetSeconds || 0;
    // The new round comes in on the spare — which may already hold exactly this song —
    // and the previous song is let go on the other player (faded, or stopped).
    let held = null;
    if (isReady(spare)) {
      held = spareSong && spareSong.youtubeId === videoId && !spareSong.failed ? spareSong : null;
      const outgoing = player;
      cancelFade(spare);
      if (ducked) { retire(ducked, 0); ducked = null; }
      player = spare;
      spare = outgoing;
      spareSong = null;
      // Don't switch the visible slot yet: the video box is still fading out from the
      // previous reveal, and the new player is frozen on the NEXT song's first frame —
      // showing it now would give the answer away. showPanel('revealed') switches it.
      if (state.roundStatus === 'revealed') showOnly(player);
      letGoOf(outgoing, state);
    }
    if (held) {
      // Preloaded: nothing to load. Hand over how far it got, so a countdown can say GO
      // straight away (or, with no countdown, just play).
      if (held.offset !== offset) player.seekTo(offset, true);
      if (preroll.active) {
        preroll.frozen = held.frozen;
        preroll.ready = held.ready;
      } else {
        player.setVolume(100);
        player.unMute();
        player.playVideo();
        ensurePlaybackStarted();
        watchPlaybackStart();
        lastReleaseAt = Date.now();
      }
    } else {
      // A held start (see "start of a round" above) loads muted — muted autoplay is
      // always allowed — and is frozen at its first frame in onStateChange; anything
      // else loads and plays straight away.
      cancelFade(player);
      player.setVolume(100);
      if (preroll.active) player.mute(); else player.unMute();
      // Object form — startSeconds is how the "start at N seconds in" option
      // actually skips the intro, per the IFrame API.
      player.loadVideoById({ videoId, startSeconds: offset });
      if (!preroll.active) {
        player.playVideo();
        ensurePlaybackStarted();
        watchPlaybackStart();
        lastReleaseAt = Date.now();
      }
    }
  }

  if (state.roundStatus === 'idle') {
    loadedRoundKey = null;
    clearTimeout(snippetTimeout);
    if (ducked) { retire(ducked, 0); ducked = null; }
    // Closing a round fades the song out instead of cutting it (with the option on).
    if (!fades.has(player)) retire(player, fadeOn(state) ? 3000 : 0);
  }
}

// ---- snippet mode: auto-pause after a set number of seconds so guessing
// happens from a short hook instead of the whole track. Piggybacks on the
// same "new song actually started" detection the 3-2-1-GO flash uses. ----
let snippetTimeout = null;
let snippetEnded = false; // this round's snippet already paused the song on purpose
function scheduleSnippetPause(state) {
  clearTimeout(snippetTimeout);
  snippetEnded = false;
  if (!state.snippetSeconds || state.snippetSeconds <= 0) return;
  // With fading on, the snippet fades out over its last second instead of stopping dead.
  const fadeMs = fadeOn(state) ? 900 : 0;
  snippetTimeout = setTimeout(() => {
    snippetEnded = true;
    const p = player;
    if (!isReady(p)) return;
    if (fadeMs) fadeVolume(p, 0, fadeMs, () => { p.pauseVideo(); p.setVolume(100); });
    else p.pauseVideo();
  }, Math.max(0, state.snippetSeconds * 1000 - fadeMs));
}

// The YouTube IFrame API is flaky about actually starting playback on the
// first call — even with autoplay explicitly allowed, playVideo() sometimes
// silently leaves the player in an unstarted/cued state with no error.
// Retry a few times if it hasn't actually started shortly after we asked.
function ensurePlaybackStarted(attempt = 0) {
  setTimeout(() => {
    if (!player || typeof player.getPlayerState !== 'function') return;
    if (preroll.active) return; // a held song is paused on purpose until "GO!"
    const PLAYING = 1, BUFFERING = 3;
    const ytState = player.getPlayerState();
    if (ytState === PLAYING || ytState === BUFFERING) return;
    if (attempt >= 5) return;
    player.playVideo();
    ensurePlaybackStarted(attempt + 1);
  }, 700);
}

// ---- autoplay gate ----
// Chrome refuses to start sound on a page nobody has clicked yet unless it was
// launched with --autoplay-policy=no-user-gesture-required (scripts/launch-kiosk.ps1
// does; an ordinary Chrome window does not). A blocked player raises no error —
// it just sits "unstarted" — which from the couch looks like a song that loads
// forever. So: if a round that should be playing never reaches PLAYING, say what
// is wrong and ask for one click. That click marks the page user-activated for
// good, so every later song starts by itself with no gate.
const soundGateEl = document.getElementById('sound-gate');
let playWatchdog = null;
const WATCHDOG_MS = 2500;
const WATCHDOG_GIVE_UP_MS = 20000; // a genuinely slow connection can sit in 'buffering' a while — don't nag forever

function setSoundGate(on) {
  if (soundGateEl.hidden === !on) return;
  soundGateEl.hidden = !on;
  if (on) reportPlayerStatus('blocked', 'Autoplay is blocked on the TV — click the TV screen once (or press any key) to start the sound');
}

function watchPlaybackStart(startedAt = Date.now()) {
  clearTimeout(playWatchdog);
  playWatchdog = setTimeout(() => {
    if (!player || typeof player.getPlayerState !== 'function') return;
    if (!latestState || latestState.roundStatus !== 'playing' || latestState.paused) return;
    const s = player.getPlayerState();
    if (s === 1) return;                                // PLAYING — all good
    // UNSTARTED / CUED: it never began, i.e. blocked. PAUSED counts too, now that a
    // song starts muted and is unmuted on "GO!": a browser that blocks sound autoplay
    // pauses it at that moment (unless the snippet pause did it on purpose).
    if (s === -1 || s === 5 || (s === 2 && !snippetEnded && !preroll.active)) { setSoundGate(true); return; }
    if (preroll.active) return; // still held for the countdown — the watchdog restarts on "GO!"
    if (Date.now() - startedAt < WATCHDOG_GIVE_UP_MS) watchPlaybackStart(startedAt); // still buffering — look again
  }, WATCHDOG_MS);
}

// The unlocking gesture. The IFrame API gives no hook for "the user clicked", so
// listen on the page itself. Capture phase + never stopPropagation: this must not
// swallow a click that something else on the TV wants.
function unlockSound() {
  if (soundGateEl.hidden || !player || typeof player.playVideo !== 'function') return;
  player.playVideo();
  // playVideo() on a player that already gave up isn't always enough — if it still
  // hasn't started a moment later, load the song fresh now that we have a gesture.
  setTimeout(() => {
    if (soundGateEl.hidden || !latestState || !latestState.currentSong) return;
    const s = player.getPlayerState();
    if (s !== 1 && s !== 3) {
      player.loadVideoById({ videoId: latestState.currentSong.youtubeId, startSeconds: latestState.startOffsetSeconds || 0 });
      player.playVideo();
    }
  }, 1200);
}
['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, unlockSound, true));

// Lets the host see whether a song is *actually* playing, not just that the
// round's game-state is 'playing' — the two can disagree (silently stuck
// loading, or a video that flat-out can't play here). Includes which song
// this is about so a real playback error can be attributed to it.
function reportPlayerStatus(status, message) {
  socket.emit('tv:playerStatus', {
    status,
    message: message || null,
    songId: latestState && latestState.currentSong ? latestState.currentSong.id : null,
  });
}

const YT_STATE_NAMES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

// YouTube error codes: https://developers.google.com/youtube/iframe_api_reference#onError
const YT_ERROR_MESSAGES = {
  2: 'Invalid video ID',
  5: "This video can't be played here (HTML5 player error)",
  100: 'Video not found — it may have been removed or made private',
  101: 'Embedding disabled by the video owner — pick a different upload',
  150: 'Embedding disabled by the video owner — pick a different upload',
};

function makePlayer(elementId) {
  const p = new YT.Player(elementId, {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      fs: 0,
      disablekb: 1,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        p.__ready = true;
        if (p === player) {
          if (latestState && latestState.roundStatus === 'revealed') showOnly(player);
          syncVideo(latestState);
        }
        maybePreload(latestState);
      },
      // Events from the spare only matter for its preload; only the round's own player
      // drives the countdown hold and reports its status to the host.
      onStateChange: (e) => (p === player ? onRoundPlayerState(e) : onSpareState(p, e)),
      // Fires when the browser itself says it blocked playback (newer API builds);
      // the watchdog above covers builds/browsers that stay silent.
      onAutoplayBlocked: () => { if (p === player && latestState && latestState.roundStatus === 'playing') setSoundGate(true); },
      onError: (e) => {
        if (p !== player) { if (p === spare && spareSong) spareSong.failed = true; return; }
        reportPlayerStatus('error', YT_ERROR_MESSAGES[e.data] || `Playback error (code ${e.data})`);
        // A song that can't play must not hold the countdown on "1" for 8 seconds.
        prerollRelease();
      },
    },
  });
  return p;
}

function createPlayer() {
  if (player) return;
  player = makePlayer('yt-player');
  if (document.getElementById('yt-player-b')) spare = makePlayer('yt-player-b');
}

function onRoundPlayerState(e) {
  if (preroll.active) {
    // A held song: freeze it on its first frame (it started muted, so nothing was
    // heard), put it back on its start point and wait for "GO!". None of this is
    // reported — to the host it's still just "loading" until the sound is released.
    if (e.data === 1 && !preroll.frozen) {
      preroll.frozen = true;
      player.pauseVideo();
      player.seekTo((latestState && latestState.startOffsetSeconds) || 0, true);
    } else if (e.data === 2 && preroll.frozen && !preroll.ready) {
      preroll.ready = true;
      clearTimeout(preroll.timer);
      const cb = preroll.onReady;
      preroll.onReady = null;
      if (cb) cb();
    }
    return;
  }
  if (e.data === 1) {
    // A load that stalled and only completes after the round was closed would
    // otherwise start playing into an idle screen.
    if (loadedRoundKey === null) { player.stopVideo(); return; }
    setSoundGate(false); // it's playing — whatever blocked it is cleared
    if (snippetArmed) { snippetArmed = false; scheduleSnippetPause(latestState); }
  }
  reportPlayerStatus(YT_STATE_NAMES[e.data] || 'unknown');
}

window.onYouTubeIframeAPIReady = createPlayer;

// The API script doesn't always invoke onYouTubeIframeAPIReady even once
// window.YT is fully loaded (observed: YT.loaded === 1 but the callback
// never fires) — poll briefly as a backstop.
const ytReadyPoll = setInterval(() => {
  if (player) { clearInterval(ytReadyPoll); return; }
  if (window.YT && typeof window.YT.Player === 'function') {
    clearInterval(ytReadyPoll);
    createPlayer();
  }
}, 300);

function showPanel(name) {
  Object.entries(panels).forEach(([key, el]) => { el.hidden = key !== name; });
  overlay.classList.toggle('hide', name === 'revealed');
  stageEl.dataset.status = name;
  if (name === 'revealed') showOnly(player);
}

// ---- sound (one shared AudioContext — browsers cap how many can exist) ----
let audioCtx = null;
function getAudioCtx() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

function playTones(notes, type = 'sine', peak = 0.25) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  notes.forEach(([freq, at, len]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = ctx.currentTime + at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + len + 0.05);
  });
}

function playChime() {
  playTones([[523.25, 0, 0.35], [659.25, 0.1, 0.35], [783.99, 0.2, 0.5]], 'sine', 0.22);
}
function playBuzzIn() {
  playTones([[880, 0, 0.12], [1174.66, 0.08, 0.22]], 'triangle', 0.18);
}

// ---- scoreboard footer: avatars, FLIP re-ordering, count-up scores ----
const prevScores = new Map();
let currentSoleLeaderId = null;
let lastScoreboardIds = new Set();

function animateCount(el, from, to) {
  if (reduceMotion || typeof from !== 'number' || typeof to !== 'number') return;
  const start = performance.now();
  const dur = 650;
  const step = (now) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderScoreboard(state) {
  const players = state.players;
  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = sorted.length ? (sorted[0].score || 0) : -1;
  const teamModeOn = state.settings && state.settings.teamMode;
  const currentBuzz = state.roundStatus === 'buzzed' && state.buzzOrder.length
    ? state.buzzOrder[state.buzzOrder.length - 1].id : null;

  // FLIP: remember where every chip was before the re-render...
  const before = new Map();
  scoreboardEl.querySelectorAll('.sb-chip').forEach(el => before.set(el.dataset.id, el.getBoundingClientRect()));

  scoreboardEl.innerHTML = sorted.map(p => {
    const isLead = p.score !== null && p.score === top && top > 0;
    const [a1] = playerColors(p.name);
    const classes = ['sb-chip'];
    if (isLead) classes.push('lead');
    if (p.id === currentBuzz) classes.push('buzzing');
    if (p.connected === false) classes.push('offline');
    if (!lastScoreboardIds.has(p.id)) classes.push('enter');
    return `
      <div class="${classes.join(' ')}" data-id="${escapeHtml(p.id)}" style="--a1:${a1}">
        ${avatarHtml(p.name)}
        ${isLead ? '<span class="crown-mini" aria-hidden="true">👑</span>' : ''}
        <span class="sb-name">${escapeHtml(p.name)}</span>${teamModeOn && p.team ? ` <span class="team-tag">${escapeHtml(p.team)}</span>` : ''}
        <span class="score" data-score-id="${escapeHtml(p.id)}">${p.score === null ? '🔒' : p.score}</span>
      </div>`;
  }).join('');
  lastScoreboardIds = new Set(sorted.map(p => p.id));

  // ...then slide each one from its old spot to its new one.
  if (!reduceMotion) {
    scoreboardEl.querySelectorAll('.sb-chip').forEach(el => {
      const prev = before.get(el.dataset.id);
      if (!prev) return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (!dx && !dy) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.transition = 'none';
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
      });
    });
  }

  sorted.forEach(p => {
    const prev = prevScores.get(p.id);
    if (prev !== undefined && prev !== p.score) {
      const el = scoreboardEl.querySelector(`[data-score-id="${CSS.escape(p.id)}"]`);
      if (el) {
        el.classList.add('score-pulse');
        animateCount(el, prev, p.score);
      }
    }
    prevScores.set(p.id, p.score);
  });

  // "Takes the lead" banner — only for SOLE possession of 1st (not a tie),
  // and only on an actual change, so it doesn't fire on every re-render.
  const tiedForTop = sorted.filter(p => p.score === top).length;
  const soleLeader = top > 0 && tiedForTop === 1 ? sorted[0] : null;
  if (soleLeader && soleLeader.id !== currentSoleLeaderId && fxOn(state) && state.roundStatus !== 'results') {
    spawnSlab(t('takesTheLead', currentLang).replace('{name}', soleLeader.name), '');
  }
  currentSoleLeaderId = soleLeader ? soleLeader.id : null;
}

// ---- idle screen hints ----
let currentLang = 'en';
const idleHintEl = document.getElementById('idle-hint');
let idleHintIndex = 0;
setInterval(() => {
  if (panels.idle.hidden) return;
  idleHintEl.classList.add('swap');
  setTimeout(() => {
    const hints = t('idleHints', currentLang);
    idleHintIndex = (idleHintIndex + 1) % hints.length;
    idleHintEl.textContent = hints[idleHintIndex];
    idleHintEl.classList.remove('swap');
  }, 400);
}, 6000);
idleHintEl.textContent = t('idleHints', currentLang)[0];
// The first hint is set before the game's language is known, and a language
// switch would otherwise leave the old-language hint up until the next
// rotation 6 seconds later.
let hintLang = currentLang;
function refreshIdleHintLanguage() {
  if (hintLang === currentLang) return;
  hintLang = currentLang;
  const hints = t('idleHints', currentLang);
  idleHintEl.textContent = hints[idleHintIndex % hints.length];
}

function updateLobby(state) {
  const n = state.players.length;
  joinCountEl.hidden = n === 0;
  joinCountEl.textContent = '● ' + t('playersJoined', currentLang).replace('{n}', n);
}

function updateHeaderJoinChip(state) {
  const show = !!joinHost && state.roundStatus !== 'idle';
  headerJoinChipEl.hidden = !show;
  if (show) headerJoinChipEl.innerHTML = `${escapeHtml(t('joinEyebrow', currentLang))} · <strong dir="ltr">${escapeHtml(joinHost)}</strong>`;
}

// ---- one-shot effects ----
function addToStage(el, removeOnEnd = true) {
  stageEl.appendChild(el);
  if (removeOnEnd) el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
  return el;
}

function spawnScreenGlow(color) {
  if (reduceMotion) return;
  const glow = document.createElement('div');
  glow.className = 'screen-glow';
  glow.style.setProperty('--glow', color);
  addToStage(glow);
}

function spawnStamp(text, tags, kind) {
  const stamp = document.createElement('div');
  stamp.className = 'correct-stamp' + (kind === 'wrong' ? ' wrong' : '');
  stamp.innerHTML = '<span class="stamp-main">' + escapeHtml(text) + '</span>' +
    tags.map(tag => '<span class="stamp-tag">' + escapeHtml(tag) + '</span>').join('');
  addToStage(stamp);
}

function spawnSlab(text, variant) {
  if (reduceMotion) return;
  const slab = document.createElement('div');
  slab.className = 'slab' + (variant ? ' ' + variant : '');
  slab.innerHTML = `<span>${escapeHtml(text)}</span>`;
  addToStage(slab);
}

function spawnConfetti(count = 90) {
  if (reduceMotion) return;
  const colors = ['#ffc24b', '#ff7a50', '#f0458f', '#8b5cf6', '#22d3ee', '#34d399', '#ffffff'];
  const shapes = ['', 'round', 'ribbon'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece ' + shapes[i % shapes.length];
    piece.style.left = (Math.random() * 100) + 'vw';
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--t', (2.2 + Math.random() * 1.8).toFixed(2) + 's');
    piece.style.setProperty('--delay', (Math.random() * 0.6).toFixed(2) + 's');
    piece.style.setProperty('--dx', ((Math.random() - 0.5) * 30).toFixed(1) + 'vw');
    piece.style.setProperty('--r0', Math.floor(Math.random() * 360) + 'deg');
    piece.addEventListener('animationend', () => piece.remove());
    frag.appendChild(piece);
  }
  document.body.appendChild(frag);
}

// A bigger flourish than confetti, for the results screen (extraAnimations).
// Each particle's end offset is computed here with plain Math.cos/sin rather
// than CSS trig functions, which are too recent to bet a kiosk on.
function spawnFireworks() {
  if (reduceMotion) return;
  const colors = ['#ffc24b', '#f0458f', '#22d3ee', '#34d399'];
  const origins = [{ x: 22, y: 30 }, { x: 78, y: 26 }, { x: 50, y: 18 }];
  origins.forEach((origin, i) => {
    setTimeout(() => {
      const particleCount = 16;
      const color = colors[i % colors.length];
      for (let j = 0; j < particleCount; j++) {
        const particle = document.createElement('div');
        particle.className = 'firework-particle';
        const angle = (Math.PI * 2 * j) / particleCount + Math.random() * 0.2;
        const distance = 90 + Math.random() * 70;
        particle.style.left = origin.x + 'vw';
        particle.style.top = origin.y + 'vh';
        particle.style.background = color;
        particle.style.color = color; // box-shadow glow reads currentColor
        particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
        document.body.appendChild(particle);
        particle.addEventListener('animationend', () => particle.remove());
      }
    }, i * 380);
  });
}

function celebrate({ speedBonus } = {}, extraTags = []) {
  spawnScreenGlow('rgba(52, 211, 153, 0.38)');
  const tags = [...extraTags];
  if (speedBonus) tags.push(t('speedBonusTag', currentLang));
  spawnStamp(t('correctStamp', currentLang), tags);
  spawnConfetti();
  playChime();
}

socket.on('correct', (data) => celebrate(data));

// The host pressed Wrong (or Reset buzzers on an unjudged buzz): a red stamp
// naming who missed, a low buzzer, and a shake of the buzz-in screen.
function playWrongSound() {
  playTones([[196, 0, 0.2], [147, 0.18, 0.4]], 'sawtooth', 0.16);
}
socket.on('wrong', ({ name, penalty } = {}) => {
  spawnScreenGlow('rgba(244, 63, 94, 0.42)');
  // "Sara −1": who missed and what it cost them.
  spawnStamp(t('wrongStamp', currentLang), name ? [name + (penalty > 0 ? ' \u2212' + penalty : '')] : [], 'wrong');
  playWrongSound();
  if (!reduceMotion) {
    overlay.classList.remove('shake');
    void overlay.offsetWidth;
    overlay.classList.add('shake');
  }
});
overlay.addEventListener('animationend', (e) => { if (e.animationName === 'verdict-shake') overlay.classList.remove('shake'); });

// Steal mechanic: a wrong answer reopened buzzing, and whoever stole it got
// it right. The stamp/confetti/chime always play (same baseline as a normal
// correct answer); the "stole it!" tag on the stamp is the extraAnimations
// flourish.
socket.on('steal', (data) => {
  const tags = fxOn(latestState) ? ['🔥 ' + t('stoleIt', currentLang).replace('{name}', data.name)] : [];
  celebrate(data, tags);
});

// ---- 3-2-1-GO the moment a new song starts (extraAnimations) ----
// onGo runs the instant "GO!" appears — that's what releases the held song, so the
// music starts with the word. "GO!" itself waits (on "1") until the song is buffered.
function spawnGoFlash(onGo) {
  if (reduceMotion) return;
  const el = document.createElement('div');
  el.className = 'go-flash';
  addToStage(el, false);
  stageEl.classList.add('counting');
  const steps = ['3', '2', '1', 'GO!'];
  let i = 0;
  const show = () => { el.innerHTML = `<span class="go-ring"></span><span class="go-num">${steps[i]}</span>`; };
  const finish = () => setTimeout(() => { el.remove(); stageEl.classList.remove('counting'); }, 600);
  const step = () => {
    if (i === steps.length - 1) {
      whenSongReady(() => {
        if (onGo) onGo();
        // "GO!" appears the moment the music is actually audible (normally a fraction
        // of a second after it's let go), so the word and the sound land together.
        const t0 = Date.now();
        const tick = () => {
          if (Date.now() - t0 >= 450 || (isReady(player) && player.getPlayerState() === 1)) { show(); finish(); }
          else setTimeout(tick, 25);
        };
        tick();
      });
      return;
    }
    show();
    i++;
    setTimeout(step, 600);
  };
  step();
}

// ---- buzzed: color takeover + kinetic name ----
let lastBuzzKey = null;

function setKineticName(name) {
  const chars = Array.from(name);
  const size = Math.max(2.6, Math.min(5.5, 60 / (0.85 * Math.max(chars.length, 1))));
  buzzedNameEl.style.setProperty('--name-size', size.toFixed(2) + 'rem');
  // Per-letter animation splits the word into inline-block spans — that
  // would break the letter-joining of Persian/Arabic script, so those
  // animate as one whole word instead.
  const joinedScript = /[֐-ࣿיִ-ﻼ]/.test(name);
  buzzedNameEl.classList.toggle('whole', joinedScript);
  // Explicit direction: on the Farsi (RTL) page, per-letter spans of a
  // Latin name would otherwise be laid out right-to-left — "Sara" → "araS".
  buzzedNameEl.dir = joinedScript ? 'rtl' : 'ltr';
  if (joinedScript || reduceMotion) {
    buzzedNameEl.textContent = name;
  } else {
    buzzedNameEl.innerHTML = chars.map((c, i) => `<span class="ch" style="--i:${i}">${escapeHtml(c)}</span>`).join('');
  }
}

function updateBuzzed(state) {
  const buzzed = state.roundStatus === 'buzzed' && state.buzzOrder.length;
  if (!buzzed) {
    buzzTakeoverEl.classList.remove('show');
    buzzedVerdictEl.hidden = true;
    lastBuzzKey = null;
    return;
  }
  // The *current* buzzer is whoever buzzed most recently, not the first
  // person to buzz this round — those differ after a reset + a second,
  // different buzzer.
  const latestBuzz = state.buzzOrder[state.buzzOrder.length - 1];
  const key = latestBuzz.id + ':' + state.buzzOrder.length;
  buzzedTeaseEl.hidden = !latestBuzz.tease;
  buzzedTeaseEl.textContent = latestBuzz.tease || '';
  // The host's verdict on this buzz (set by the Correct / Wrong buttons) stays
  // on screen under the name — it updates in place, without replaying the
  // takeover animation below.
  const verdict = latestBuzz.verdict;
  buzzedVerdictEl.hidden = !verdict;
  buzzedVerdictEl.className = 'verdict ' + (verdict || '');
  buzzedVerdictEl.textContent = verdict === 'correct' ? t('verdictCorrect', currentLang) : verdict === 'wrong' ? t('verdictWrong', currentLang) : '';
  if (key === lastBuzzKey) return; // re-rendering would restart the entrance animations
  lastBuzzKey = key;

  const [a1, a2] = playerColors(latestBuzz.name);
  buzzTakeoverEl.style.setProperty('--p1', a1);
  buzzTakeoverEl.style.setProperty('--p2', a2);
  buzzTakeoverEl.classList.remove('show');
  void buzzTakeoverEl.offsetWidth; // restart the takeover wipe
  buzzTakeoverEl.classList.add('show');
  buzzedAvatarEl.innerHTML = avatarHtml(latestBuzz.name);
  setKineticName(latestBuzz.name);
  playBuzzIn();
}

// ---- round timer: ring around the record + subtext (soft cutoff — purely
// a display, the server enforces the actual buzz lockout) ----
const TIMER_CRITICAL_SECONDS = 5;
let timerInterval = null;
let timerRaf = null;

function updatePlayingSubtext(state) {
  if (state.buzzingLocked) {
    playingSubtext.textContent = t('timesUp', currentLang);
    playingSubtext.classList.remove('timer-critical');
    return;
  }
  if (!state.roundTimer) {
    playingSubtext.textContent = state.stealOpen ? t('stealOpen', currentLang) : t('buzzInPhone', currentLang);
    playingSubtext.classList.remove('timer-critical');
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.roundTimer.endsAt - Date.now()) / 1000));
  playingSubtext.textContent = state.stealOpen ? t('stealOpen', currentLang) + ' (' + remaining + ')' : t('buzzInPhoneTimer', currentLang).replace('{s}', remaining);
  const critical = fxOn(state) && remaining > 0 && remaining <= TIMER_CRITICAL_SECONDS;
  playingSubtext.classList.toggle('timer-critical', critical);
}

function updateTimerRing(state) {
  cancelAnimationFrame(timerRaf);
  const show = state.roundStatus === 'playing' && !!state.roundTimer;
  // An <svg> has no .hidden property (that's HTMLElement-only) — toggling
  // the attribute is what actually shows/hides it.
  timerRingEl.toggleAttribute('hidden', !show);
  if (!show) return;
  const running = !state.buzzingLocked && !state.paused;
  const total = Math.max(1, (state.roundTimer.seconds || 0) * 1000);
  const tick = () => {
    const remaining = state.buzzingLocked ? 0 : Math.max(0, state.roundTimer.endsAt - Date.now());
    const frac = Math.min(1, remaining / total);
    timerProgressEl.style.strokeDashoffset = String(100 * (1 - frac));
    timerProgressEl.style.opacity = frac > 0 ? '1' : '0';
    timerRingEl.classList.toggle('critical', remaining <= TIMER_CRITICAL_SECONDS * 1000);
    if (running && remaining > 0) timerRaf = requestAnimationFrame(tick);
  };
  tick();
}

let autoAdvanceInterval = null;

function updateAutoAdvanceHint(state) {
  if (!state.autoAdvance) {
    autoAdvanceHintEl.textContent = '';
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.autoAdvance.endsAt - Date.now()) / 1000));
  autoAdvanceHintEl.textContent = t('nextSongIn', currentLang).replace('{s}', remaining);
}

// ---- mystery modifier round banner ----
// Only ever present in state once the flagged song is actually the one
// playing (see server.js payloadFor) — so this is the surprise reveal
// itself. Stays up for the round's whole life, which is why it lives
// outside .overlay.
function updateMysteryBanner(state) {
  const active = !!state.mysteryRound && state.roundStatus !== 'idle' && state.roundStatus !== 'results';
  mysteryBannerEl.hidden = !active;
  if (active) mysteryBannerEl.textContent = t('mysteryRound', currentLang).replace('{label}', t('mystery_' + state.mysteryRound.modifier, currentLang));
}

// ---- wager round (Daily Double) ----
function updateWagerBanner(state) {
  const active = !!state.wager && state.wager.amount !== null && state.roundStatus !== 'idle';
  wagerBannerEl.hidden = !active;
  if (active) wagerBannerEl.textContent = t('wagerBanner', currentLang).replace('{name}', state.wager.playerName || t('they', currentLang)).replace('{n}', state.wager.amount);
  if (state.roundStatus === 'wagering' && state.wager) {
    wageringSubtextEl.textContent = t('wagerDeciding', currentLang).replace('{name}', state.wager.playerName || t('someone', currentLang));
  }
}

// ---- category vote: live bars that fill as votes come in ----
function renderCategoryVoteTV(state) {
  const vote = state.categoryVote;
  const active = state.roundStatus === 'idle' && !!vote;
  categoryVotePanelEl.hidden = !active;
  idleWaitingBlockEl.hidden = active;
  if (!active) {
    voteOptionsTvEl.dataset.key = '';
    return;
  }

  const counts = vote.counts || {};
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  const key = vote.options.join('\u0001') + '|' + vote.closed;
  const rebuilt = voteOptionsTvEl.dataset.key !== key;
  if (rebuilt) {
    voteOptionsTvEl.dataset.key = key;
    voteOptionsTvEl.innerHTML = vote.options.map((c, i) => `
      <div class="vote-option-tv" data-cat="${escapeHtml(c)}" style="--i:${i}">
        <span class="vote-avatar">${categoryAvatar(c)}</span>
        <span class="vote-name">${escapeHtml(c)}</span>
        <span class="count">0</span>
      </div>
    `).join('');
  }
  const apply = () => {
    voteOptionsTvEl.querySelectorAll('.vote-option-tv').forEach(row => {
      const c = row.dataset.cat;
      const n = counts[c] || 0;
      row.querySelector('.count').textContent = n;
      row.style.setProperty('--pct', totalVotes ? `${(n / totalVotes) * 100}%` : '0%');
      row.classList.toggle('winner', vote.closed && c === vote.result);
      row.classList.toggle('loser', vote.closed && c !== vote.result);
    });
  };
  // A freshly built row needs one frame at 0% first, or the bar has
  // nothing to transition from.
  if (rebuilt) requestAnimationFrame(apply); else apply();

  if (!vote.closed) {
    voteHeadingEl.textContent = t('voteHeading', currentLang);
    voteTvStatusEl.textContent = t(totalVotes === 1 ? 'votesSoFar1' : 'votesSoFarN', currentLang).replace('{n}', totalVotes);
  } else {
    voteHeadingEl.textContent = t('voteWinner', currentLang).replace('{name}', vote.result);
    voteTvStatusEl.textContent = '';
  }
}

// ---- results: podium + the rest ----
let lastResultsKey = null;

function renderResults(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const key = sorted.map(p => `${p.id}:${p.score}:${p.name}`).join('|');
  if (key === lastResultsKey) return; // rebuilding would replay the whole podium reveal
  lastResultsKey = key;

  if (!sorted.length) {
    resultsListEl.innerHTML = `<p class="results-empty muted">${escapeHtml(t('noOnePlayed', currentLang))}</p>`;
    return;
  }
  const rankOf = (p) => 1 + sorted.filter(q => q.score > p.score).length;
  const top3 = sorted.slice(0, 3);
  // Reveal order: 3rd, then 2nd, then 1st — the winner lands last.
  const delays = [1.3, 0.7, 0.1];
  const visualOrder = [1, 0, 2].filter(i => i < top3.length);
  const podium = visualOrder.map(i => {
    const p = top3[i];
    const rank = rankOf(p);
    // Height/color follow the real (competition) rank, so a tie for 2nd
    // gets two equal silver blocks instead of a silver and a bronze.
    return `
      <div class="podium-slot place-${Math.min(rank, 3)}" style="--d:${delays[i]}s">
        <div class="podium-player">
          ${rank === 1 ? '<span class="podium-crown" aria-hidden="true">👑</span>' : ''}
          ${avatarHtml(p.name)}
          <span class="podium-name">${escapeHtml(p.name)}</span>
          <span class="podium-score">${p.score}</span>
        </div>
        <div class="podium-block">${rank}</div>
      </div>`;
  }).join('');

  const MAX_REST = 6;
  const rest = sorted.slice(3);
  const restHtml = rest.slice(0, MAX_REST).map((p, i) => `
    <div class="rest-row" style="--i:${i}">
      <span class="rank">${rankOf(p)}</span>
      ${avatarHtml(p.name)}
      <span>${escapeHtml(p.name)}</span>
      <span class="rscore">${p.score}</span>
    </div>`).join('') + (rest.length > MAX_REST ? `<div class="rest-row" style="--i:${MAX_REST}"><span class="muted">+${rest.length - MAX_REST}</span></div>` : '');

  resultsListEl.innerHTML = `<div class="podium">${podium}</div>${rest.length ? `<div class="results-rest">${restHtml}</div>` : ''}`;
}

// The results screen's height depends on player count, badges, stats and
// the language's font — shrink it to fit the stage rather than clip it.
// zoom (not transform) because .panel's entrance animation owns transform.
function fitResultsPanel() {
  const panel = panels.results;
  if (panel.hidden) return;
  panel.style.zoom = '';
  const available = stageEl.clientHeight * 0.96;
  const needed = panel.scrollHeight;
  if (needed > available) panel.style.zoom = String(Math.max(0.6, available / needed));
}
window.addEventListener('resize', fitResultsPanel);

// Badge text is built here from the badge's key + raw value (the server sends
// English labels too, but those can't follow the language toggle).
function badgeLabel(b) { return t('badge_' + b.key, currentLang); }
function badgeDetail(b) {
  if (b.key === 'fastest') return t('badgeFastest', currentLang).replace('{v}', b.value);
  if (b.key === 'steals') return t(Number(b.value) === 1 ? 'badgeSteals1' : 'badgeStealsN', currentLang).replace('{v}', b.value);
  if (b.key === 'sharpshooter') return t('badgeCorrect', currentLang).replace('{v}', b.value);
  return t('badgeComeback', currentLang);
}

function renderAchievementBadges(state) {
  const badges = state.badges;
  if (!badges || !badges.length) {
    achievementBadgesEl.hidden = true;
    return;
  }
  achievementBadgesEl.hidden = false;
  achievementBadgesEl.innerHTML = badges.map(b => `
    <div class="badge-row">
      <span class="badge-icon">${b.icon}</span>
      <span class="badge-text"><strong>${escapeHtml(badgeLabel(b))}</strong> · ${escapeHtml(b.name)} <span class="muted">(${escapeHtml(badgeDetail(b))})</span></span>
    </div>
  `).join('');
}

function renderSessionStats(state) {
  const stats = state.stats;
  const lines = [];
  if (!state.settings || !state.settings.sessionStats || !stats) {
    sessionStatsEl.hidden = true;
    return;
  }
  if (stats.fastestBuzz) {
    lines.push(t('fastestBuzzEver', currentLang).replace('{name}', '<strong>' + escapeHtml(stats.fastestBuzz.name) + '</strong>').replace('{s}', (stats.fastestBuzz.ms / 1000).toFixed(2)));
  }
  if (stats.mostPointsInRound) {
    lines.push(t('biggestRoundEver', currentLang).replace('{name}', '<strong>' + escapeHtml(stats.mostPointsInRound.name) + '</strong>').replace('{n}', stats.mostPointsInRound.points));
  }
  if (!lines.length) {
    sessionStatsEl.hidden = true;
    return;
  }
  sessionStatsEl.innerHTML = lines.map(l => `<span>${l}</span>`).join('');
  sessionStatsEl.hidden = false;
}

let resultsShown = false;
let lastPlayingKey = null;
let wasPaused = false;

socket.on('state', (state) => {
  // The site files changed since this page loaded (a deploy while it was open):
  // reload to pick up the new scripts instead of running stale ones.
  if (state.buildId) {
    if (window.__buildId && window.__buildId !== state.buildId) { location.reload(); return; }
    window.__buildId = state.buildId;
  }
  latestState = state;
  currentLang = state.language || 'en';
  applyTranslations(currentLang);
  refreshIdleHintLanguage();
  document.documentElement.dataset.theme = state.theme || 'dark';
  document.body.classList.toggle('fx', fxOn(state));

  showPanel(state.roundStatus);
  renderScoreboard(state);
  updateLobby(state);
  updateHeaderJoinChip(state);
  updateMysteryBanner(state);
  updateWagerBanner(state);
  renderCategoryVoteTV(state);
  updateBuzzed(state);

  if (state.currentSong && state.currentSong.hint) {
    hintTextEl.textContent = state.currentSong.hint;
    hintTextEl.hidden = false;
  } else {
    hintTextEl.hidden = true;
  }

  if (state.roundStatus === 'playing' && state.snippetSeconds > 0) {
    snippetHintEl.textContent = t('snippetHint', currentLang).replace('{s}', state.snippetSeconds);
    snippetHintEl.hidden = false;
  } else {
    snippetHintEl.hidden = true;
  }

  // "3...2...1...GO" the moment a NEW song actually starts playing —
  // tracked separately from syncVideo's own loadedRoundKey so this fires
  // exactly once per round start regardless of video-loading timing.
  // 'buzzed' is deliberately excluded from the reset below: a
  // host:resetBuzzers bounces roundStatus buzzed -> playing on the SAME
  // song, and that must not look like a new song starting.
  const roundKey = roundKeyOf(state);
  if (state.roundStatus === 'playing' && roundKey && roundKey !== lastPlayingKey) {
    lastPlayingKey = roundKey;
    clearTimeout(snippetTimeout);
    snippetEnded = false;
    snippetArmed = state.snippetSeconds > 0; // counted from when the sound actually starts — see onStateChange
    if (fxOn(state) && !reduceMotion) {
      // The song loads silently now and is let go on "GO!". The guard stops an older,
      // slower countdown from releasing a newer round's song.
      prerollBegin();
      spawnGoFlash(() => { if (lastPlayingKey === roundKey) prerollRelease(); });
    } else {
      prerollRelease(); // nothing to wait for: plain start, as soon as it loads
    }
  } else if (state.roundStatus !== 'playing' && state.roundStatus !== 'buzzed') {
    lastPlayingKey = null; // replaying the same song later should flash again
  }
  // The round moved on (a buzz-in, the reveal, closed) before "GO!": never leave the song silenced.
  if (preroll.active && state.roundStatus !== 'playing') prerollRelease();

  if (state.roundStatus === 'revealed' && state.currentSong) {
    // The reveal is the payoff — resume full playback even if snippet mode
    // paused it earlier this round. Harmless when already playing.
    clearTimeout(snippetTimeout);
    if (isReady(player)) {
      if (fades.has(player)) { cancelFade(player); player.setVolume(100); } // a snippet fading out — the reveal brings it back
      player.playVideo();
    }
    const title = state.currentSong.title || t('unknown', currentLang);
    const artist = state.currentSong.artist || '';
    revealTitleEl.textContent = title;
    revealArtistEl.textContent = artist;
    captionTitleEl.textContent = title;
    captionTitleEl.classList.toggle('shimmer', fxOn(state));
    captionArtistEl.textContent = artist;
    // Soundtracks: which film or series it's from (only sent once the song is revealed).
    captionWorkEl.textContent = state.currentSong.work ? t('fromWork', currentLang).replace('{work}', state.currentSong.work) : '';
    revealCaptionEl.hidden = false;
    // After a ✅ Correct the lower-third names who got it, instead of the plain
    // "The song was" label.
    const winner = [...state.buzzOrder].reverse().find(b => b.verdict === 'correct');
    captionLabelEl.textContent = winner ? t('gotIt', currentLang).replace('{name}', winner.name) : t('theSongWas', currentLang);
  } else {
    revealCaptionEl.hidden = true;
  }

  if (state.roundStatus === 'results') {
    renderResults(state.players);
    renderAchievementBadges(state);
    renderSessionStats(state);
    fitResultsPanel();
    if (!resultsShown) {
      resultsShown = true;
      // Timed to land with the winner's podium block, not the screen switch.
      setTimeout(() => { spawnConfetti(140); playChime(); }, 1700);
      if (fxOn(state)) setTimeout(spawnFireworks, 2000);
    }
  } else {
    resultsShown = false;
    lastResultsKey = null;
  }

  clearInterval(timerInterval);
  updatePlayingSubtext(state);
  updateTimerRing(state);
  if (state.roundStatus === 'playing' && state.roundTimer && !state.buzzingLocked) {
    timerInterval = setInterval(() => updatePlayingSubtext(state), 500);
  }

  clearInterval(autoAdvanceInterval);
  updateAutoAdvanceHint(state);
  if (state.roundStatus === 'revealed' && state.autoAdvance) {
    autoAdvanceInterval = setInterval(() => updateAutoAdvanceHint(state), 500);
  }

  // ---- pause/resume: covers the whole screen and actually pauses playback,
  // not just a visual overlay. ----
  pausedOverlayEl.hidden = !state.paused;
  if (state.roundStatus !== 'playing' || state.paused) setSoundGate(false); // only ever relevant while a song is meant to be playing
  if (player && typeof player.pauseVideo === 'function' && typeof player.playVideo === 'function') {
    if (state.paused) {
      player.pauseVideo();
    } else if (wasPaused && state.roundStatus === 'playing' && !preroll.active) {
      player.playVideo(); // only resume actual playback if a round was live when paused
    }
  }
  wasPaused = state.paused;

  syncVideo(state);
  maybePreload(state);
});

const socket = io();
// See host.js for why this re-registers on every 'connect' rather than once.
socket.on('connect', () => socket.emit('register', { role: 'tv' }));

const overlay = document.getElementById('overlay');
const panels = {
  idle: document.getElementById('panel-idle'),
  playing: document.getElementById('panel-playing'),
  buzzed: document.getElementById('panel-buzzed'),
  revealed: document.getElementById('panel-revealed'),
  results: document.getElementById('panel-results'),
};
const scoreboardEl = document.getElementById('scoreboard');
const buzzedNameEl = document.getElementById('buzzed-name');
const revealTitleEl = document.getElementById('reveal-title');
const revealArtistEl = document.getElementById('reveal-artist');
const playingSubtext = document.getElementById('playing-subtext');
const resultsListEl = document.getElementById('results-list');

// ---- join QR ----
fetch('/join-info').then(r => r.json()).then(({ url }) => {
  document.getElementById('join-url').textContent = url;
  document.getElementById('qr').src = '/qr.png';
});

// ---- YouTube player ----
let player = null;
let loadedYoutubeId = null;
let latestState = null;

// The IFrame API loads asynchronously and can finish after a 'state' event
// has already arrived (or after a round is already 'playing' when this page
// loads) — so syncing on the socket event alone can miss it forever. Sync
// from both the socket event and player-ready callback, whichever is last.
function syncVideo(state) {
  if (!state || !player || typeof player.loadVideoById !== 'function') return;

  if (state.currentSong && state.currentSong.youtubeId && state.roundStatus === 'playing'
      && state.currentSong.youtubeId !== loadedYoutubeId) {
    loadedYoutubeId = state.currentSong.youtubeId;
    player.loadVideoById(state.currentSong.youtubeId);
    player.playVideo();
    ensurePlaybackStarted();
  }

  if (state.roundStatus === 'idle') {
    loadedYoutubeId = null;
    if (typeof player.stopVideo === 'function') player.stopVideo();
  }
}

// The YouTube IFrame API is flaky about actually starting playback on the
// first call — even with autoplay explicitly allowed, playVideo() sometimes
// silently leaves the player in an unstarted/cued state with no error
// (observed in testing: intermittent, not tied to a specific video). Retry
// a few times if it hasn't actually started shortly after we asked it to.
function ensurePlaybackStarted(attempt = 0) {
  setTimeout(() => {
    if (!player || typeof player.getPlayerState !== 'function') return;
    const PLAYING = 1, BUFFERING = 3;
    const state = player.getPlayerState();
    if (state === PLAYING || state === BUFFERING) return;
    if (attempt >= 5) return;
    player.playVideo();
    ensurePlaybackStarted(attempt + 1);
  }, 700);
}

function createPlayer() {
  if (player) return;
  player = new YT.Player('yt-player', {
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
      onReady: () => syncVideo(latestState),
    },
  });
}

window.onYouTubeIframeAPIReady = createPlayer;

// The API script doesn't always invoke onYouTubeIframeAPIReady even once
// window.YT is fully loaded (observed in testing: YT.loaded === 1 but the
// callback silently never fires, leaving the player permanently
// uninitialized with no error) — poll briefly as a backstop.
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
}

function renderScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top = sorted.length ? sorted[0].score : -1;
  scoreboardEl.innerHTML = sorted.map(p => `
    <div class="pill ${p.score === top && top > 0 ? 'lead' : ''}">
      <span>${escapeHtml(p.name)}</span>
      <span class="score">${p.score}</span>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- idle screen hints ----
let currentLang = 'en';
const idleHintEl = document.getElementById('idle-hint');
let idleHintIndex = 0;
setInterval(() => {
  if (panels.idle.hidden) return;
  idleHintEl.style.opacity = 0;
  setTimeout(() => {
    const hints = t('idleHints', currentLang);
    idleHintIndex = (idleHintIndex + 1) % hints.length;
    idleHintEl.textContent = hints[idleHintIndex];
    idleHintEl.style.opacity = 1;
  }, 400);
}, 5000);
idleHintEl.textContent = t('idleHints', currentLang)[0];

// ---- confetti + chime on a correct answer ----
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function spawnConfetti() {
  if (reduceMotion) return;
  const colors = ['#f5b942', '#ff6b5b', '#74c69d', '#f4efe6'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = (1.5 + Math.random() * 1.2) + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(piece);
    piece.addEventListener('animationend', () => piece.remove());
  }
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
  } catch (e) { /* Web Audio unavailable — silently skip the chime */ }
}

socket.on('correct', () => {
  spawnConfetti();
  playChime();
});

// ---- round timer countdown (soft cutoff — purely a display, the server
// enforces the actual buzz lockout) ----
let timerInterval = null;

function updatePlayingSubtext(state) {
  if (state.buzzingLocked) {
    playingSubtext.textContent = t('timesUp', currentLang);
    return;
  }
  if (!state.roundTimer) {
    playingSubtext.textContent = t('buzzInPhone', currentLang);
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.roundTimer.endsAt - Date.now()) / 1000));
  playingSubtext.textContent = t('buzzInPhoneTimer', currentLang).replace('{s}', remaining);
}

let resultsShown = false;

function renderResults(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  if (!sorted.length) {
    resultsListEl.innerHTML = `<p class="muted">${t('noOnePlayed', currentLang)}</p>`;
    return;
  }
  const topScore = sorted[0].score;
  resultsListEl.innerHTML = sorted.map((p, i) => `
    <div class="results-row ${p.score === topScore ? 'first' : ''}">
      <span class="rank">${p.score === topScore ? '🏆' : i + 1}</span>
      <span class="rname">${escapeHtml(p.name)}</span>
      <span class="rscore">${p.score}</span>
    </div>
  `).join('');
}

socket.on('state', (state) => {
  latestState = state;
  currentLang = state.language || 'en';
  applyTranslations(currentLang);
  renderScoreboard(state.players);
  showPanel(state.roundStatus);

  if (state.roundStatus === 'buzzed' && state.buzzOrder.length) {
    // The *current* buzzer is whoever buzzed most recently, not the first
    // person to buzz this round — those differ after a reset + a second,
    // different buzzer.
    buzzedNameEl.textContent = state.buzzOrder[state.buzzOrder.length - 1].name;
  }

  if (state.roundStatus === 'revealed' && state.currentSong) {
    revealTitleEl.textContent = state.currentSong.title || t('unknown', currentLang);
    revealArtistEl.textContent = state.currentSong.artist || '';
  }

  if (state.roundStatus === 'results') {
    renderResults(state.players);
    if (!resultsShown) {
      resultsShown = true;
      spawnConfetti();
    }
  } else {
    resultsShown = false;
  }

  clearInterval(timerInterval);
  updatePlayingSubtext(state);
  if (state.roundStatus === 'playing' && state.roundTimer && !state.buzzingLocked) {
    timerInterval = setInterval(() => updatePlayingSubtext(state), 500);
  }

  syncVideo(state);
});

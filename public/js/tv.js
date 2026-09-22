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
const sessionStatsEl = document.getElementById('session-stats');
const autoAdvanceHintEl = document.getElementById('auto-advance-hint');
const revealCaptionEl = document.getElementById('reveal-caption');
const captionTitleEl = document.getElementById('caption-title');
const captionArtistEl = document.getElementById('caption-artist');

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

// Lets the host see whether a song is *actually* playing, not just that
// the round's game-state is 'playing' — the two can disagree (silently
// stuck loading, or a video that flat-out can't play here).
function reportPlayerStatus(status, message) {
  socket.emit('tv:playerStatus', { status, message: message || null });
}

const YT_STATE_NAMES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

// YouTube error codes: https://developers.google.com/youtube/iframe_api_reference#onError
const YT_ERROR_MESSAGES = {
  2: "Invalid video ID",
  5: "This video can't be played here (HTML5 player error)",
  100: 'Video not found — it may have been removed or made private',
  101: 'Embedding disabled by the video owner — pick a different upload',
  150: 'Embedding disabled by the video owner — pick a different upload',
};

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
      onStateChange: (e) => reportPlayerStatus(YT_STATE_NAMES[e.data] || 'unknown'),
      onError: (e) => reportPlayerStatus('error', YT_ERROR_MESSAGES[e.data] || `Playback error (code ${e.data})`),
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

const prevScores = new Map();
let currentSoleLeaderId = null;

function renderScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top = sorted.length ? sorted[0].score : -1;
  scoreboardEl.innerHTML = sorted.map(p => `
    <div class="pill ${p.score === top && top > 0 ? 'lead' : ''}">
      <span>${escapeHtml(p.name)}</span>
      <span class="score" data-score-id="${p.id}">${p.score === null ? '🔒' : p.score}</span>
    </div>
  `).join('');

  sorted.forEach(p => {
    const prev = prevScores.get(p.id);
    if (prev !== undefined && prev !== p.score) {
      const el = scoreboardEl.querySelector(`[data-score-id="${p.id}"]`);
      if (el) el.classList.add('score-pulse');
    }
    prevScores.set(p.id, p.score);
  });

  // "Takes the lead" banner — only for SOLE possession of 1st (not a tie),
  // and only on an actual change, so it doesn't fire on every re-render
  // while the same player stays in front.
  const tiedForTop = sorted.filter(p => p.score === top).length;
  const soleLeader = top > 0 && tiedForTop === 1 ? sorted[0] : null;
  if (soleLeader && soleLeader.id !== currentSoleLeaderId
      && latestState && latestState.settings && latestState.settings.extraAnimations) {
    spawnLeadBanner(soleLeader.name);
  }
  currentSoleLeaderId = soleLeader ? soleLeader.id : null;
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

// ---- buzz-in screen flash (the shockwave ring around the name is pure CSS,
// restarting automatically like every other panel — this is the one part
// that needs a fresh element each time, same as confetti below) ----
function spawnBuzzFlash() {
  if (reduceMotion) return;
  const flash = document.createElement('div');
  flash.className = 'buzz-flash';
  document.getElementById('stage').appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

// ---- idle screen: gently floating notes for ambient life between rounds ----
function spawnIdleNote() {
  if (reduceMotion || panels.idle.hidden) return;
  const note = document.createElement('div');
  note.className = 'idle-note';
  note.textContent = ['♪', '♫', '♬'][Math.floor(Math.random() * 3)];
  note.style.left = (10 + Math.random() * 80) + '%';
  note.style.animationDuration = (4 + Math.random() * 2) + 's';
  document.getElementById('stage').appendChild(note);
  note.addEventListener('animationend', () => note.remove());
}
setInterval(spawnIdleNote, 2200);

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

// ---- steal mechanic: a wrong answer reopened buzzing, and whoever stole it
// got it right ---- confetti/chime always play (same baseline as a normal
// correct answer); the extra banner is the "extra animations" flourish.
function spawnStealBanner(name) {
  if (reduceMotion) return;
  const banner = document.createElement('div');
  banner.className = 'steal-banner';
  banner.textContent = `🔥 ${name} stole it!`;
  document.getElementById('stage').appendChild(banner);
  banner.addEventListener('animationend', () => banner.remove());
}

socket.on('steal', ({ name }) => {
  spawnConfetti();
  playChime();
  if (latestState && latestState.settings && latestState.settings.extraAnimations) spawnStealBanner(name);
});

// ---- round timer countdown (soft cutoff — purely a display, the server
// enforces the actual buzz lockout) ----
let timerInterval = null;

const TIMER_CRITICAL_SECONDS = 5;

function updatePlayingSubtext(state) {
  if (state.buzzingLocked) {
    playingSubtext.textContent = t('timesUp', currentLang);
    playingSubtext.classList.remove('timer-critical');
    return;
  }
  if (!state.roundTimer) {
    playingSubtext.textContent = t('buzzInPhone', currentLang);
    playingSubtext.classList.remove('timer-critical');
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.roundTimer.endsAt - Date.now()) / 1000));
  playingSubtext.textContent = t('buzzInPhoneTimer', currentLang).replace('{s}', remaining);
  const critical = state.settings && state.settings.extraAnimations && remaining > 0 && remaining <= TIMER_CRITICAL_SECONDS;
  playingSubtext.classList.toggle('timer-critical', critical);
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

let wasBuzzed = false;
let resultsShown = false;
let lastPlayingSongId = null;

function spawnGoFlash() {
  if (reduceMotion) return;
  const el = document.createElement('div');
  el.className = 'go-flash';
  document.getElementById('stage').appendChild(el);
  const steps = ['3', '2', '1', 'GO!'];
  let i = 0;
  function showStep() {
    el.textContent = steps[i];
    el.classList.remove('go-flash-pop');
    void el.offsetWidth; // force reflow so the pop animation restarts each step
    el.classList.add('go-flash-pop');
    i++;
    if (i < steps.length) setTimeout(showStep, 500);
    else setTimeout(() => el.remove(), 500);
  }
  showStep();
}

function spawnLeadBanner(name) {
  if (reduceMotion) return;
  const banner = document.createElement('div');
  banner.className = 'lead-banner';
  banner.textContent = `🏆 ${name} takes the lead!`;
  document.getElementById('stage').appendChild(banner);
  banner.addEventListener('animationend', () => banner.remove());
}

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

function renderSessionStats(state) {
  const stats = state.stats;
  const lines = [];
  if (!state.settings || !state.settings.sessionStats || !stats) {
    sessionStatsEl.hidden = true;
    return;
  }
  if (stats.fastestBuzz) {
    lines.push(`🏃 Fastest buzz: <strong>${escapeHtml(stats.fastestBuzz.name)}</strong> (${(stats.fastestBuzz.ms / 1000).toFixed(2)}s)`);
  }
  if (stats.mostPointsInRound) {
    lines.push(`💯 Biggest round: <strong>${escapeHtml(stats.mostPointsInRound.name)}</strong> (+${stats.mostPointsInRound.points})`);
  }
  if (!lines.length) {
    sessionStatsEl.hidden = true;
    return;
  }
  sessionStatsEl.innerHTML = lines.join('<br>');
  sessionStatsEl.hidden = false;
}

socket.on('state', (state) => {
  latestState = state;
  currentLang = state.language || 'en';
  applyTranslations(currentLang);
  renderScoreboard(state.players);
  showPanel(state.roundStatus);

  // "3...2...1...GO" flash the moment a NEW song actually starts playing —
  // tracked separately from syncVideo's own loadedYoutubeId so this fires
  // exactly once per round start regardless of video-loading timing.
  if (state.roundStatus === 'playing' && state.currentSong && state.currentSong.youtubeId !== lastPlayingSongId) {
    lastPlayingSongId = state.currentSong.youtubeId;
    if (state.settings && state.settings.extraAnimations) spawnGoFlash();
  } else if (state.roundStatus !== 'playing') {
    lastPlayingSongId = null; // replaying the same song later should flash again
  }

  if (state.roundStatus === 'buzzed' && state.buzzOrder.length) {
    // The *current* buzzer is whoever buzzed most recently, not the first
    // person to buzz this round — those differ after a reset + a second,
    // different buzzer.
    buzzedNameEl.textContent = state.buzzOrder[state.buzzOrder.length - 1].name;
    if (!wasBuzzed) spawnBuzzFlash();
    wasBuzzed = true;
  } else {
    wasBuzzed = false;
  }

  if (state.roundStatus === 'revealed' && state.currentSong) {
    const title = state.currentSong.title || t('unknown', currentLang);
    const artist = state.currentSong.artist || '';
    revealTitleEl.textContent = title;
    revealArtistEl.textContent = artist;
    // The big center reveal (above) fades out with .overlay almost right
    // away so the real video shows through — too quick to actually read.
    // This persistent caption lives outside .overlay and stays up for the
    // whole 'revealed' state instead.
    captionTitleEl.textContent = title;
    captionArtistEl.textContent = artist;
    revealCaptionEl.hidden = false;
  } else {
    revealCaptionEl.hidden = true;
  }

  if (state.roundStatus === 'results') {
    renderResults(state.players);
    renderSessionStats(state);
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

  clearInterval(autoAdvanceInterval);
  updateAutoAdvanceHint(state);
  if (state.roundStatus === 'revealed' && state.autoAdvance) {
    autoAdvanceInterval = setInterval(() => updateAutoAdvanceHint(state), 500);
  }

  syncVideo(state);
});

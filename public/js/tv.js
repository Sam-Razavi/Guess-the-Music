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
    // Object form — startSeconds is how the "start at N seconds in" option
    // actually skips the intro, per the IFrame API.
    player.loadVideoById({ videoId: state.currentSong.youtubeId, startSeconds: state.startOffsetSeconds || 0 });
    player.playVideo();
    ensurePlaybackStarted();
  }

  if (state.roundStatus === 'idle') {
    loadedYoutubeId = null;
    clearTimeout(snippetTimeout);
    if (typeof player.stopVideo === 'function') player.stopVideo();
  }
}

// ---- snippet mode: auto-pause after a set number of seconds so guessing
// happens from a short hook instead of the whole track. Piggybacks on the
// same "new song actually started" detection the 3-2-1-GO flash uses. ----
let snippetTimeout = null;
function scheduleSnippetPause(state) {
  clearTimeout(snippetTimeout);
  if (!state.snippetSeconds || state.snippetSeconds <= 0) return;
  snippetTimeout = setTimeout(() => {
    if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
  }, state.snippetSeconds * 1000);
}

// The YouTube IFrame API is flaky about actually starting playback on the
// first call — even with autoplay explicitly allowed, playVideo() sometimes
// silently leaves the player in an unstarted/cued state with no error.
// Retry a few times if it hasn't actually started shortly after we asked.
function ensurePlaybackStarted(attempt = 0) {
  setTimeout(() => {
    if (!player || typeof player.getPlayerState !== 'function') return;
    const PLAYING = 1, BUFFERING = 3;
    const ytState = player.getPlayerState();
    if (ytState === PLAYING || ytState === BUFFERING) return;
    if (attempt >= 5) return;
    player.playVideo();
    ensurePlaybackStarted(attempt + 1);
  }, 700);
}

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
function spawnGoFlash() {
  if (reduceMotion) return;
  const el = document.createElement('div');
  el.className = 'go-flash';
  addToStage(el, false);
  stageEl.classList.add('counting');
  const steps = ['3', '2', '1', 'GO!'];
  let i = 0;
  const step = () => {
    el.innerHTML = `<span class="go-ring"></span><span class="go-num">${steps[i]}</span>`;
    i++;
    if (i < steps.length) {
      setTimeout(step, 600);
    } else {
      setTimeout(() => { el.remove(); stageEl.classList.remove('counting'); }, 600);
    }
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
let lastPlayingSongId = null;
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
  // tracked separately from syncVideo's own loadedYoutubeId so this fires
  // exactly once per round start regardless of video-loading timing.
  // 'buzzed' is deliberately excluded from the reset below: a
  // host:resetBuzzers bounces roundStatus buzzed -> playing on the SAME
  // song, and that must not look like a new song starting.
  if (state.roundStatus === 'playing' && state.currentSong && state.currentSong.youtubeId !== lastPlayingSongId) {
    lastPlayingSongId = state.currentSong.youtubeId;
    if (fxOn(state)) spawnGoFlash();
    scheduleSnippetPause(state);
  } else if (state.roundStatus !== 'playing' && state.roundStatus !== 'buzzed') {
    lastPlayingSongId = null; // replaying the same song later should flash again
  }

  if (state.roundStatus === 'revealed' && state.currentSong) {
    // The reveal is the payoff — resume full playback even if snippet mode
    // paused it earlier this round. Harmless when already playing.
    clearTimeout(snippetTimeout);
    if (player && typeof player.playVideo === 'function') player.playVideo();
    const title = state.currentSong.title || t('unknown', currentLang);
    const artist = state.currentSong.artist || '';
    revealTitleEl.textContent = title;
    revealArtistEl.textContent = artist;
    captionTitleEl.textContent = title;
    captionTitleEl.classList.toggle('shimmer', fxOn(state));
    captionArtistEl.textContent = artist;
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
  if (player && typeof player.pauseVideo === 'function' && typeof player.playVideo === 'function') {
    if (state.paused) {
      player.pauseVideo();
    } else if (wasPaused && state.roundStatus === 'playing') {
      player.playVideo(); // only resume actual playback if a round was live when paused
    }
  }
  wasPaused = state.paused;

  syncVideo(state);
});

const socket = io();
// See host.js for why this re-registers on every 'connect' rather than once.
socket.on('connect', () => socket.emit('register', { role: 'tv' }));

const overlay = document.getElementById('overlay');
const panels = {
  idle: document.getElementById('panel-idle'),
  playing: document.getElementById('panel-playing'),
  buzzed: document.getElementById('panel-buzzed'),
  revealed: document.getElementById('panel-revealed'),
};
const scoreboardEl = document.getElementById('scoreboard');
const buzzedNameEl = document.getElementById('buzzed-name');
const revealTitleEl = document.getElementById('reveal-title');
const revealArtistEl = document.getElementById('reveal-artist');

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

socket.on('state', (state) => {
  latestState = state;
  renderScoreboard(state.players);
  showPanel(state.roundStatus);

  if (state.roundStatus === 'buzzed' && state.buzzOrder.length) {
    buzzedNameEl.textContent = state.buzzOrder[0].name;
  }

  if (state.roundStatus === 'revealed' && state.currentSong) {
    revealTitleEl.textContent = state.currentSong.title || 'Unknown';
    revealArtistEl.textContent = state.currentSong.artist || '';
  }

  syncVideo(state);
});

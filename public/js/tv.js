const socket = io();
socket.emit('register', { role: 'tv' });

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
  }

  if (state.roundStatus === 'idle') {
    loadedYoutubeId = null;
    if (typeof player.stopVideo === 'function') player.stopVideo();
  }
}

window.onYouTubeIframeAPIReady = function () {
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
};

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

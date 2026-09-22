const socket = io();
// Re-registering on every 'connect' (not just once at load) matters because
// Socket.IO fires 'connect' again after any auto-reconnect (network blip,
// screen lock) — without this, a reconnected socket silently stops
// receiving 'state' broadcasts until the page is manually reloaded.
socket.on('connect', () => socket.emit('register', { role: 'host' }));

const connPill = document.getElementById('conn-pill');
const roundStatusPill = document.getElementById('round-status-pill');
const timerPill = document.getElementById('timer-pill');
const currentSongInfo = document.getElementById('current-song-info');
const buzzOrderList = document.getElementById('buzz-order-list');
const playlistList = document.getElementById('playlist-list');
const hostScoreboard = document.getElementById('host-scoreboard');
const addError = document.getElementById('add-error');
const importInput = document.getElementById('import-input');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');
const timerInput = document.getElementById('timer-input');

let latestState = null;

// ---------- connection status ----------
socket.on('connect', () => { connPill.textContent = 'connected'; connPill.className = 'pill online'; });
socket.on('disconnect', () => { connPill.textContent = 'disconnected'; connPill.className = 'pill offline'; });

// ---------- join info ----------
fetch('/join-info').then(r => r.json()).then(({ url }) => {
  document.getElementById('join-url').textContent = url;
  document.getElementById('qr').src = '/qr.png';
});

// ---------- youtube id parsing ----------
function parseYoutubeId(raw) {
  const input = raw.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1) || null;
    const v = url.searchParams.get('v');
    if (v) return v;
    const m = url.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    if (m) return m[2];
  } catch (e) { /* not a URL */ }
  return null;
}

document.getElementById('add-song-btn').addEventListener('click', () => {
  const ytRaw = document.getElementById('yt-input').value;
  const title = document.getElementById('title-input').value.trim();
  const artist = document.getElementById('artist-input').value.trim();
  const youtubeId = parseYoutubeId(ytRaw);

  if (!youtubeId) {
    addError.textContent = "Couldn't find a YouTube video ID in that — try pasting the full link.";
    return;
  }
  if (!title) {
    addError.textContent = 'Give the song a title so you can pick it later.';
    return;
  }
  addError.textContent = '';
  socket.emit('host:addSong', { youtubeId, title, artist });
  document.getElementById('yt-input').value = '';
  document.getElementById('title-input').value = '';
  document.getElementById('artist-input').value = '';
});

importBtn.addEventListener('click', async () => {
  const url = importInput.value.trim();
  if (!url) return;
  importStatus.textContent = 'Importing…';
  importBtn.disabled = true;
  try {
    const r = await fetch('/api/import-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) {
      importStatus.textContent = data.error || 'Import failed.';
      return;
    }
    const existingIds = new Set((latestState ? latestState.playlist : []).map(s => s.youtubeId));
    const newCount = data.songs.filter(s => !existingIds.has(s.youtubeId)).length;
    const dupeCount = data.songs.length - newCount;
    socket.emit('host:addSongs', data.songs);
    importStatus.textContent = `Added ${newCount} song${newCount === 1 ? '' : 's'}` +
      (dupeCount ? ` (${dupeCount} already in the playlist)` : '') + '.';
    importInput.value = '';
  } catch (e) {
    importStatus.textContent = 'Could not reach the server — try again.';
  } finally {
    importBtn.disabled = false;
  }
});

// ---------- round controls ----------
document.getElementById('reveal-btn').addEventListener('click', () => socket.emit('host:revealAnswer'));
document.getElementById('reset-buzzers-btn').addEventListener('click', () => socket.emit('host:resetBuzzers'));
document.getElementById('close-round-btn').addEventListener('click', () => socket.emit('host:closeRound'));
document.getElementById('reset-game-btn').addEventListener('click', () => {
  if (confirm('Reset all scores and mark every song unplayed?')) {
    socket.emit('host:resetGame');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- rendering ----------
let timerInterval = null;

function updateTimerPill(state) {
  if (state.buzzingLocked) {
    timerPill.hidden = false;
    timerPill.textContent = "⏰ Time's up";
    return;
  }
  if (!state.roundTimer) {
    timerPill.hidden = true;
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.roundTimer.endsAt - Date.now()) / 1000));
  timerPill.hidden = false;
  timerPill.textContent = `⏱ ${remaining}s`;
}

function renderRound(state) {
  roundStatusPill.textContent = state.roundStatus;

  clearInterval(timerInterval);
  updateTimerPill(state);
  if (state.roundTimer && !state.buzzingLocked) {
    timerInterval = setInterval(() => updateTimerPill(state), 500);
  }

  if (state.currentSong) {
    currentSongInfo.innerHTML = `<strong>${escapeHtml(state.currentSong.title)}</strong>` +
      (state.currentSong.artist ? ` — ${escapeHtml(state.currentSong.artist)}` : '');
    currentSongInfo.classList.remove('muted');
  } else {
    currentSongInfo.textContent = 'No round started — pick a song from the playlist below.';
    currentSongInfo.classList.add('muted');
  }

  buzzOrderList.innerHTML = state.buzzOrder.map((b, i) => `
    <div class="buzz-row">
      <div><span class="order">#${i + 1}</span>${escapeHtml(b.name)}</div>
      <div class="actions">
        <button class="good" data-award="${b.id}:1">+1</button>
        <button data-award="${b.id}:-1">-1</button>
      </div>
    </div>
  `).join('');

  buzzOrderList.querySelectorAll('[data-award]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, delta] = btn.dataset.award.split(':');
      socket.emit('host:awardPoint', { id, delta: Number(delta) });
    });
  });
}

function renderPlaylist(state) {
  playlistList.innerHTML = state.playlist.map(song => `
    <div class="playlist-row ${song.played ? 'played' : ''}" draggable="true" data-id="${song.id}">
      <span class="grip" title="Drag to reorder">⠿</span>
      <div class="info">
        <div class="t">${escapeHtml(song.title)}</div>
        <div class="a">${escapeHtml(song.artist || '')}</div>
      </div>
      <div class="actions">
        <button class="primary" data-play="${song.id}" ${state.currentIndex >= 0 && state.playlist[state.currentIndex].id === song.id ? 'disabled' : ''}>
          ${song.played ? 'Replay' : 'Play'}
        </button>
        <button class="danger" data-remove="${song.id}">✕</button>
      </div>
    </div>
  `).join('') || '<p class="muted">No songs yet — add one above.</p>';

  playlistList.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', () => {
      const timerSeconds = Number(timerInput.value) || 0;
      socket.emit('host:startRound', { id: btn.dataset.play, timerSeconds });
    });
  });
  playlistList.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Remove this song from the playlist?')) socket.emit('host:removeSong', { id: btn.dataset.remove });
    });
  });

  // ---- drag-to-reorder ----
  let dragSrcId = null;
  playlistList.querySelectorAll('.playlist-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragSrcId = row.dataset.id; });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId || !latestState) return;
      const ids = latestState.playlist.map(s => s.id);
      const from = ids.indexOf(dragSrcId);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      socket.emit('host:reorderPlaylist', { ids });
    });
  });
}

function renderScoreboard(state) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  hostScoreboard.innerHTML = sorted.map(p => `
    <div class="score-row">
      <div class="name"><span class="dot ${p.connected ? 'connected' : ''}"></span>${escapeHtml(p.name)}</div>
      <div class="actions">
        <button data-adjust="${p.id}:-1">−</button>
        <span class="pts">${p.score}</span>
        <button data-adjust="${p.id}:1">+</button>
      </div>
    </div>
  `).join('') || '<p class="muted">No one has joined yet.</p>';

  hostScoreboard.querySelectorAll('[data-adjust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, delta] = btn.dataset.adjust.split(':');
      socket.emit('host:awardPoint', { id, delta: Number(delta) });
    });
  });
}

socket.on('state', (state) => {
  latestState = state;
  renderRound(state);
  renderPlaylist(state);
  renderScoreboard(state);
});

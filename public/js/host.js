const socket = io();
// Re-registering on every 'connect' (not just once at load) matters because
// Socket.IO fires 'connect' again after any auto-reconnect (network blip,
// screen lock) — without this, a reconnected socket silently stops
// receiving 'state' broadcasts until the page is manually reloaded.
socket.on('connect', () => socket.emit('register', { role: 'host' }));

const connPill = document.getElementById('conn-pill');
const roundStatusPill = document.getElementById('round-status-pill');
const playbackPill = document.getElementById('playback-pill');
const timerPill = document.getElementById('timer-pill');
const autoAdvancePill = document.getElementById('auto-advance-pill');
const autoAdvanceInput = document.getElementById('auto-advance-input');
const currentSongInfo = document.getElementById('current-song-info');
const buzzOrderList = document.getElementById('buzz-order-list');
const playlistList = document.getElementById('playlist-list');
const hostScoreboard = document.getElementById('host-scoreboard');
const addError = document.getElementById('add-error');
const importInput = document.getElementById('import-input');
const importCategoryInput = document.getElementById('import-category-input');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');
const timerInput = document.getElementById('timer-input');
const categoryFilterEl = document.getElementById('category-filter');
const playlistSearchInput = document.getElementById('playlist-search');
const addSongCard = document.getElementById('add-song-card');
const addSongCollapsedHint = document.getElementById('add-song-collapsed-hint');

let latestState = null;
let categoryFilter = 'All';
let searchQuery = '';

playlistSearchInput.addEventListener('input', () => {
  searchQuery = playlistSearchInput.value.trim().toLowerCase();
  renderPlaylist(latestState);
});

// ---------- connection status ----------
socket.on('connect', () => { connPill.textContent = 'connected'; connPill.className = 'pill online'; });
socket.on('disconnect', () => { connPill.textContent = 'disconnected'; connPill.className = 'pill offline'; });

// ---------- playback status (what the TV's player is *actually* doing) ----------
function setPlaybackPill(text, cls) {
  playbackPill.hidden = false;
  playbackPill.textContent = text;
  playbackPill.className = 'pill ' + cls;
}

socket.on('addSongWarning', ({ message }) => {
  addError.textContent = message;
  addError.classList.add('warn');
});

socket.on('playerStatus', ({ status, message }) => {
  if (status === 'error') setPlaybackPill('❌ ' + (message || 'Playback error'), 'error');
  else if (status === 'playing') setPlaybackPill('🔊 Playing', 'ok');
  else if (status === 'buffering') setPlaybackPill('⏳ Buffering…', 'pending');
  else if (status === 'paused') setPlaybackPill('⏸ Paused', 'pending');
  else if (status === 'unstarted' || status === 'cued') setPlaybackPill('⏳ Loading…', 'pending');
  else playbackPill.hidden = true;
});

// ---------- language toggle ----------
document.querySelectorAll('#lang-toggle [data-lang]').forEach(btn => {
  btn.addEventListener('click', () => socket.emit('host:setLanguage', btn.dataset.lang));
});

function renderLangToggle(state) {
  document.querySelectorAll('#lang-toggle [data-lang]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === state.language);
  });
}

// ---------- join info ----------
fetch('/join-info').then(r => r.json()).then(({ url, mdnsUrl }) => {
  document.getElementById('join-url').textContent = url;
  document.getElementById('qr').src = '/qr.png';
  if (mdnsUrl) document.getElementById('mdns-url').textContent = `or try: ${mdnsUrl}`;
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
  const category = document.getElementById('category-input').value.trim();
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
  addError.classList.remove('warn');
  socket.emit('host:addSong', { youtubeId, title, artist, category });
  document.getElementById('yt-input').value = '';
  document.getElementById('title-input').value = '';
  document.getElementById('artist-input').value = '';
  document.getElementById('category-input').value = '';
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
    const category = importCategoryInput.value.trim();
    const songs = category ? data.songs.map(s => ({ ...s, category })) : data.songs;
    const existingIds = new Set((latestState ? latestState.playlist : []).map(s => s.youtubeId));
    const newCount = songs.filter(s => !existingIds.has(s.youtubeId)).length;
    const dupeCount = songs.length - newCount;
    socket.emit('host:addSongs', songs);
    importStatus.textContent = `Added ${newCount} song${newCount === 1 ? '' : 's'}` +
      (dupeCount ? ` (${dupeCount} already in the playlist)` : '') +
      (data.skipped ? ` (${data.skipped} skipped — not embeddable)` : '') + '.';
    importInput.value = '';
    importCategoryInput.value = '';
  } catch (e) {
    importStatus.textContent = 'Could not reach the server — try again.';
  } finally {
    importBtn.disabled = false;
  }
});

// ---------- round controls ----------
document.getElementById('reveal-btn').addEventListener('click', () => {
  const autoAdvanceSeconds = Number(autoAdvanceInput.value) || 0;
  socket.emit('host:revealAnswer', { autoAdvanceSeconds });
});
document.getElementById('reset-buzzers-btn').addEventListener('click', () => socket.emit('host:resetBuzzers'));
document.getElementById('close-round-btn').addEventListener('click', () => socket.emit('host:closeRound'));
document.getElementById('reset-game-btn').addEventListener('click', () => {
  if (confirm('Reset all scores and mark every song unplayed?')) {
    socket.emit('host:resetGame');
  }
});
document.getElementById('show-results-btn').addEventListener('click', () => socket.emit('host:showResults'));

// ---------- keyboard shortcuts (desktop hosting) ----------
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't hijack typing in search/add-song fields
  if (e.key === ' ') {
    e.preventDefault(); // avoid scrolling the page
    document.getElementById('reveal-btn').click();
  } else if (e.key.toLowerCase() === 'r') {
    document.getElementById('reset-buzzers-btn').click();
  } else if (e.key.toLowerCase() === 'c') {
    document.getElementById('close-round-btn').click();
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- rendering ----------
let timerInterval = null;
let autoAdvanceInterval = null;

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

function updateAutoAdvancePill(state) {
  if (!state.autoAdvance) {
    autoAdvancePill.hidden = true;
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.autoAdvance.endsAt - Date.now()) / 1000));
  autoAdvancePill.hidden = false;
  autoAdvancePill.textContent = `⏭ Next song in ${remaining}s`;
}

function renderRound(state) {
  roundStatusPill.textContent = state.roundStatus;

  clearInterval(timerInterval);
  updateTimerPill(state);
  if (state.roundTimer && !state.buzzingLocked) {
    timerInterval = setInterval(() => updateTimerPill(state), 500);
  }

  clearInterval(autoAdvanceInterval);
  updateAutoAdvancePill(state);
  if (state.autoAdvance) {
    autoAdvanceInterval = setInterval(() => updateAutoAdvancePill(state), 500);
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

function renderCategoryFilter(state) {
  const categories = [...new Set(state.playlist.map(s => s.category).filter(Boolean))].sort();
  if (categoryFilter !== 'All' && !categories.includes(categoryFilter)) categoryFilter = 'All';
  if (!categories.length) {
    categoryFilterEl.innerHTML = '';
    return;
  }
  const chips = ['All', ...categories];
  categoryFilterEl.innerHTML = chips.map(c => `
    <button class="${c === categoryFilter ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>
  `).join('');
  categoryFilterEl.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      categoryFilter = btn.dataset.category;
      renderPlaylist(latestState);
      renderCategoryFilter(latestState);
    });
  });
}

function renderPlaylist(state) {
  let songs = categoryFilter === 'All' ? state.playlist : state.playlist.filter(s => s.category === categoryFilter);
  if (searchQuery) {
    songs = songs.filter(s =>
      s.title.toLowerCase().includes(searchQuery) || (s.artist || '').toLowerCase().includes(searchQuery));
  }
  playlistList.innerHTML = songs.map(song => `
    <div class="playlist-row ${song.played ? 'played' : ''}" data-id="${song.id}">
      <span class="grip" title="Drag to reorder">⠿</span>
      <div class="info">
        <div class="t">${escapeHtml(song.title)}</div>
        <div class="a">${escapeHtml(song.artist || '')}</div>
        ${song.category ? `<span class="cat">${escapeHtml(song.category)}</span>` : ''}
      </div>
      <div class="actions">
        <button class="primary" data-play="${song.id}" ${state.currentIndex >= 0 && state.playlist[state.currentIndex].id === song.id ? 'disabled' : ''}>
          ${song.played ? 'Replay' : 'Play'}
        </button>
        <button class="danger" data-remove="${song.id}">✕</button>
      </div>
    </div>
  `).join('') || `<p class="muted">${state.playlist.length ? 'No songs match.' : 'No songs yet — add one above.'}</p>`;

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
}

// ---- drag-to-reorder (mouse + touch, via SortableJS) ----
// Initialized once: renderPlaylist() only replaces playlistList's children
// via innerHTML, and Sortable reads children live, so one instance keeps
// working across every re-render.
Sortable.create(playlistList, {
  handle: '.grip',
  animation: 150,
  delay: 150,
  delayOnTouchOnly: true, // avoids mistaking a scroll-through-the-grip for a drag on touch, no delay added for mouse
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  onEnd: (evt) => {
    if (!latestState) return;
    const draggedId = evt.item.dataset.id;
    const rows = [...playlistList.querySelectorAll('.playlist-row')];
    const nextRow = rows[rows.indexOf(evt.item) + 1];
    const anchorId = nextRow ? nextRow.dataset.id : null;

    const ids = latestState.playlist.map(s => s.id);
    const from = ids.indexOf(draggedId);
    if (from === -1) return;
    ids.splice(from, 1);
    const to = anchorId ? ids.indexOf(anchorId) : ids.length;
    ids.splice(to, 0, draggedId);
    socket.emit('host:reorderPlaylist', { ids });
  },
});

const prevScores = new Map();

function renderScoreboard(state) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  hostScoreboard.innerHTML = sorted.map(p => `
    <div class="score-row">
      <div class="name"><span class="dot ${p.connected ? 'connected' : ''}"></span>${escapeHtml(p.name)}</div>
      <div class="actions">
        <button data-adjust="${p.id}:-1">−</button>
        <span class="pts" data-score-id="${p.id}">${p.score}</span>
        <button data-adjust="${p.id}:1">+</button>
        <button class="danger" data-remove-player="${p.id}" title="Remove player">✕</button>
      </div>
    </div>
  `).join('') || '<p class="muted">No one has joined yet.</p>';

  sorted.forEach(p => {
    const prev = prevScores.get(p.id);
    if (prev !== undefined && prev !== p.score) {
      const el = hostScoreboard.querySelector(`[data-score-id="${p.id}"]`);
      if (el) el.classList.add('score-pulse');
    }
    prevScores.set(p.id, p.score);
  });

  hostScoreboard.querySelectorAll('[data-adjust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, delta] = btn.dataset.adjust.split(':');
      socket.emit('host:awardPoint', { id, delta: Number(delta) });
    });
  });
  hostScoreboard.querySelectorAll('[data-remove-player]').forEach(btn => {
    btn.addEventListener('click', () => {
      const player = state.players.find(p => p.id === btn.dataset.removePlayer);
      if (confirm(`Remove ${player ? player.name : 'this player'} from the game?`)) {
        socket.emit('host:removePlayer', { id: btn.dataset.removePlayer });
      }
    });
  });
}

function renderAddSongCollapse(state) {
  // Nothing to do in "Add a song" while a round is actively live — free
  // up visual priority for the Current Round card and Scoreboard.
  const collapsed = state.roundStatus === 'playing' || state.roundStatus === 'buzzed';
  addSongCard.classList.toggle('collapsed', collapsed);
  addSongCollapsedHint.hidden = !collapsed;
}

socket.on('state', (state) => {
  latestState = state;
  renderRound(state);
  renderCategoryFilter(state);
  renderPlaylist(state);
  renderScoreboard(state);
  renderLangToggle(state);
  renderAddSongCollapse(state);
});

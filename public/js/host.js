const socket = io();
// Re-registering on every 'connect' (not just once at load) matters because
// Socket.IO fires 'connect' again after any auto-reconnect (network blip,
// screen lock) — without this, a reconnected socket silently stops
// receiving 'state' broadcasts until the page is manually reloaded.
socket.on('connect', () => socket.emit('register', { role: 'host' }));

const connPill = document.getElementById('conn-pill');
const roundStatusPill = document.getElementById('round-status-pill');
const playbackPill = document.getElementById('playback-pill');
const openYoutubeFallbackBtn = document.getElementById('open-youtube-fallback-btn');
const findReplacementLiveBtn = document.getElementById('find-replacement-live-btn');
const findReplacementLiveResult = document.getElementById('find-replacement-live-result');
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
const checkPlaylistBtn = document.getElementById('check-playlist-btn');
const checkPlaylistStatus = document.getElementById('check-playlist-status');
const brokenVideosList = document.getElementById('broken-videos-list');
const addSongCard = document.getElementById('add-song-card');
const addSongCollapsedHint = document.getElementById('add-song-collapsed-hint');
const mysteryPill = document.getElementById('mystery-pill');
const pauseBtn = document.getElementById('pause-btn');
const pausedPill = document.getElementById('paused-pill');
const categoryVoteCard = document.getElementById('category-vote-card');
const voteSetupEl = document.getElementById('vote-setup');
const voteCategoryChecksEl = document.getElementById('vote-category-checks');
const voteTimerInput = document.getElementById('vote-timer-input');
const startVoteBtn = document.getElementById('start-vote-btn');
const voteStatusEl = document.getElementById('vote-status');
const voteLiveEl = document.getElementById('vote-live');
const voteCountdownEl = document.getElementById('vote-countdown');
const voteTallyEl = document.getElementById('vote-tally');
const voteResultEl = document.getElementById('vote-result');
const voteWinnerTextEl = document.getElementById('vote-winner-text');
const actionLogCard = document.getElementById('action-log-card');
const actionLogList = document.getElementById('action-log-list');
const clearActionLogBtn = document.getElementById('clear-action-log-btn');
const preflightCard = document.getElementById('preflight-card');
const preflightBtn = document.getElementById('preflight-btn');
const preflightResults = document.getElementById('preflight-results');

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
roundStatusPill.addEventListener('animationend', () => roundStatusPill.classList.remove('status-flash'));

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
  openYoutubeFallbackBtn.hidden = status !== 'error';
  findReplacementLiveBtn.hidden = status !== 'error';
  if (status !== 'error') findReplacementLiveResult.innerHTML = '';
  if (status === 'error') setPlaybackPill('❌ ' + (message || 'Playback error'), 'error');
  else if (status === 'playing') setPlaybackPill('🔊 Playing', 'ok');
  else if (status === 'buffering') setPlaybackPill('⏳ Buffering…', 'pending');
  else if (status === 'paused') setPlaybackPill('⏸ Paused', 'pending');
  else if (status === 'unstarted' || status === 'cued') setPlaybackPill('⏳ Loading…', 'pending');
  else playbackPill.hidden = true;
});

openYoutubeFallbackBtn.addEventListener('click', () => socket.emit('host:openOnYoutube'));

// ---------- find a replacement for a non-embeddable video ----------
// Shared by the live "playback error" button and every broken-video scan
// row below — same lookup (/api/find-replacement), same found/apply/dismiss
// UI, just rendered into whichever container element is passed in.
async function runFindReplacement(songId, containerEl) {
  containerEl.innerHTML = '<p class="muted small">🔍 Searching for a replacement…</p>';
  try {
    const r = await fetch('/api/find-replacement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: songId }),
    });
    const data = await r.json();
    if (!r.ok) {
      containerEl.innerHTML = `<p class="muted small">${escapeHtml(data.error || 'Search failed.')}</p>`;
      return;
    }
    if (!data.replacement) {
      containerEl.innerHTML = '<p class="muted small">No embeddable copy found.</p>';
      return;
    }
    const { youtubeId, title, channelTitle } = data.replacement;
    containerEl.innerHTML = `
      <div class="replacement-found">
        <span class="info">Found: ${escapeHtml(title)}${channelTitle ? ` — ${escapeHtml(channelTitle)}` : ''}</span>
        <div class="actions">
          <button class="primary" data-apply-replacement>✅ Use this</button>
          <button data-dismiss-replacement>✕</button>
        </div>
      </div>
    `;
    containerEl.querySelector('[data-apply-replacement]').addEventListener('click', () => {
      socket.emit('host:replaceSongVideo', { id: songId, youtubeId });
      containerEl.innerHTML = '<p class="muted small">✅ Swapped in.</p>';
    });
    containerEl.querySelector('[data-dismiss-replacement]').addEventListener('click', () => {
      containerEl.innerHTML = '';
    });
  } catch (e) {
    containerEl.innerHTML = '<p class="muted small">Could not reach the server — try again.</p>';
  }
}

findReplacementLiveBtn.addEventListener('click', () => {
  if (!latestState || !latestState.currentSong) return;
  runFindReplacement(latestState.currentSong.id, findReplacementLiveResult);
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

// ---------- check playlist for broken (non-embeddable) videos ----------
checkPlaylistBtn.addEventListener('click', async () => {
  checkPlaylistBtn.disabled = true;
  checkPlaylistStatus.textContent = 'Checking…';
  brokenVideosList.innerHTML = '';
  try {
    const r = await fetch('/api/check-playlist', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) {
      checkPlaylistStatus.textContent = data.error || 'Check failed.';
      return;
    }
    renderBrokenVideos(data.broken);
    checkPlaylistStatus.textContent = data.broken.length
      ? `Found ${data.broken.length} that won't play.`
      : 'All songs check out.';
  } catch (e) {
    checkPlaylistStatus.textContent = 'Could not reach the server — try again.';
  } finally {
    checkPlaylistBtn.disabled = false;
  }
});

function renderBrokenVideos(broken) {
  if (!broken || !broken.length) {
    brokenVideosList.innerHTML = '';
    return;
  }
  brokenVideosList.innerHTML = `
    <div class="broken-videos">
      <div class="broken-header">
        <strong>❌ ${broken.length} won't play (embedding disabled)</strong>
        <button class="danger" id="remove-all-broken-btn">Remove all</button>
      </div>
      ${broken.map(s => `
        <div class="broken-row" data-id="${s.id}">
          <div class="broken-row-main">
            <span class="info">${escapeHtml(s.title)}${s.artist ? ` — ${escapeHtml(s.artist)}` : ''}</span>
            <div class="actions">
              <button data-find-replacement="${s.id}">🔁 Find replacement</button>
              <button class="danger" data-remove-broken="${s.id}">✕</button>
            </div>
          </div>
          <div class="replacement-result" data-replacement-result="${s.id}"></div>
        </div>
      `).join('')}
    </div>
  `;
  brokenVideosList.querySelectorAll('[data-remove-broken]').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('host:removeSong', { id: btn.dataset.removeBroken });
      btn.closest('.broken-row').remove();
      if (!brokenVideosList.querySelector('.broken-row')) brokenVideosList.innerHTML = '';
    });
  });
  brokenVideosList.querySelectorAll('[data-find-replacement]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.findReplacement;
      runFindReplacement(id, brokenVideosList.querySelector(`[data-replacement-result="${id}"]`));
    });
  });
  const removeAllBtn = document.getElementById('remove-all-broken-btn');
  if (removeAllBtn) {
    removeAllBtn.addEventListener('click', () => {
      if (!confirm(`Remove all ${broken.length} broken videos from the playlist?`)) return;
      broken.forEach(s => socket.emit('host:removeSong', { id: s.id }));
      brokenVideosList.innerHTML = '';
      checkPlaylistStatus.textContent = 'Removed.';
    });
  }
}

// ---------- pre-flight check ----------
preflightBtn.addEventListener('click', async () => {
  preflightBtn.disabled = true;
  preflightResults.innerHTML = '<p class="muted small">Checking…</p>';
  try {
    const r = await fetch('/api/preflight', { method: 'POST' });
    const data = await r.json();
    preflightResults.innerHTML = `
      <p class="preflight-verdict ${data.ready ? 'ok' : 'bad'}">${data.ready ? '✅ Ready to go!' : '⚠️ Not quite ready'}</p>
      <ul class="preflight-checks">
        ${data.checks.map(c => `
          <li class="${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'skip'}">
            <span class="icon">${c.ok === true ? '✅' : c.ok === false ? '❌' : '➖'}</span>
            <span>${escapeHtml(c.label)} — <span class="muted small">${escapeHtml(c.detail)}</span></span>
          </li>
        `).join('')}
      </ul>
    `;
  } catch (e) {
    preflightResults.innerHTML = '<p class="muted small">Could not reach the server — try again.</p>';
  } finally {
    preflightBtn.disabled = false;
  }
});

// ---------- round controls ----------
document.getElementById('reveal-btn').addEventListener('click', () => {
  const autoAdvanceSeconds = Number(autoAdvanceInput.value) || 0;
  socket.emit('host:revealAnswer', { autoAdvanceSeconds });
});
document.getElementById('reset-buzzers-btn').addEventListener('click', () => socket.emit('host:resetBuzzers'));
pauseBtn.addEventListener('click', () => socket.emit('host:togglePause'));
document.getElementById('close-round-btn').addEventListener('click', () => socket.emit('host:closeRound'));
const revealHintBtn = document.getElementById('reveal-hint-btn');
revealHintBtn.addEventListener('click', () => socket.emit('host:revealHintLetter'));
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

let prevRoundStatus = null;

function renderRound(state) {
  roundStatusPill.textContent = state.roundStatus;
  if (prevRoundStatus !== null && prevRoundStatus !== state.roundStatus) {
    roundStatusPill.classList.add('status-flash');
  }
  prevRoundStatus = state.roundStatus;

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

  // Only appears once the mystery song is actually the one playing — see
  // server.js payloadFor(), which withholds it until then on purpose.
  if (state.mysteryRound) {
    mysteryPill.hidden = false;
    mysteryPill.textContent = `🎭 Mystery Round: ${state.mysteryRound.label}`;
  } else {
    mysteryPill.hidden = true;
  }

  revealHintBtn.hidden = !(state.settings && state.settings.karaokeHint && state.roundStatus === 'playing')
    || (state.mysteryRound && state.mysteryRound.modifier === 'noHint');

  pauseBtn.hidden = !(state.settings && state.settings.pauseGame);
  pauseBtn.textContent = state.paused ? '▶ Resume game' : '⏸ Pause game';
  pausedPill.hidden = !state.paused;
  // Freeze every other round control while paused — the whole point is a
  // clean break, not a state where a stray tap can still change anything.
  ['reveal-btn', 'reset-buzzers-btn', 'close-round-btn', 'reveal-hint-btn'].forEach(id => {
    document.getElementById(id).disabled = state.paused;
  });

  // With "Point values per song" on, awarding a correct buzz gives that
  // song's assigned value instead of a flat point — defaults to 1, so this
  // is a no-op when the setting's off or a song has no value set.
  const songPoints = (state.currentSong && state.currentSong.points) || 1;
  buzzOrderList.innerHTML = state.buzzOrder.map((b, i) => `
    <div class="buzz-row">
      <div><span class="order">#${i + 1}</span>${escapeHtml(b.name)}</div>
      <div class="actions">
        <button class="good" data-award="${b.id}:${songPoints}" ${state.paused ? 'disabled' : ''}>+${songPoints}</button>
        <button data-award="${b.id}:${-songPoints}" ${state.paused ? 'disabled' : ''}>-${songPoints}</button>
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
  const pointValuesOn = state.settings && state.settings.pointValues;
  playlistList.innerHTML = songs.map(song => `
    <div class="playlist-row ${song.played ? 'played' : ''}" data-id="${song.id}">
      <span class="grip" title="Drag to reorder">⠿</span>
      <div class="info">
        <div class="t">${song.id === state.mysterySongId ? '<span class="mystery-badge" title="This game\'s Mystery Round song — modifier stays secret until it plays">🎭</span> ' : ''}${escapeHtml(song.title)}</div>
        <div class="a">${escapeHtml(song.artist || '')}</div>
        ${song.category ? `<span class="cat">${escapeHtml(song.category)}</span>` : ''}
      </div>
      <div class="actions">
        ${pointValuesOn ? `<input type="number" class="points-input" min="1" step="1" value="${song.points || 1}" data-points="${song.id}" title="Points this song is worth">` : ''}
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
  playlistList.querySelectorAll('[data-points]').forEach(input => {
    input.addEventListener('change', () => {
      socket.emit('host:setSongPoints', { id: input.dataset.points, points: input.value });
    });
  });
}

// ---- drag-to-reorder (mouse + touch, via SortableJS) ----
// Initialized once: renderPlaylist() only replaces playlistList's children
// via innerHTML, and Sortable reads children live, so one instance keeps
// working across every re-render.
//
// Guarded: this loads from a CDN (see host.html), and everything below this
// point in the file — including the socket.on('state', ...) registration
// that drives the entire rest of the page — used to sit after an unguarded
// top-level Sortable.create() call. A blocked/offline CDN threw here and
// silently killed every handler registered after it, taking down the whole
// control panel (playlist, scoreboard, settings, voting — not just
// reordering) over what should have been a purely cosmetic loss. Drag-to-
// reorder degrades gracefully now; nothing else should ever depend on it.
if (typeof Sortable !== 'undefined') {
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
} else {
  console.error('SortableJS failed to load — drag-to-reorder is unavailable, everything else still works.');
}

const prevScores = new Map();

function renderScoreboard(state) {
  // Deliberately NOT sorted by score (unlike the TV/player boards) — this is
  // a control panel the host is actively tapping, not a public leaderboard.
  // Re-sorting on every score change used to shuffle row positions the
  // instant you tapped +1, so a quick second tap (natural when awarding
  // several points fast) could land on whichever player's row had just
  // slid into that screen position, awarding THEM the point instead.
  const players = state.players;
  const teamModeOn = state.settings && state.settings.teamMode;
  hostScoreboard.innerHTML = players.map(p => `
    <div class="score-row">
      <div class="name">
        <span class="dot ${p.connected ? 'connected' : ''}"></span>${escapeHtml(p.name)}
        ${teamModeOn && p.team ? `<span class="team-tag">${escapeHtml(p.team)}</span>` : ''}
      </div>
      <div class="actions">
        <div class="score-adjust">
          <button data-adjust="${p.id}:-1">−</button>
          <span class="pts" data-score-id="${p.id}">${p.score}</span>
          <button data-adjust="${p.id}:1">+</button>
        </div>
        <button class="danger" data-remove-player="${p.id}" title="Remove player">✕</button>
      </div>
    </div>
  `).join('') || '<p class="muted">No one has joined yet.</p>';

  players.forEach(p => {
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

// ---------- game options ----------
document.querySelectorAll('#options-card [data-setting]').forEach(input => {
  input.addEventListener('change', () => {
    socket.emit('host:updateSettings', { [input.dataset.setting]: input.checked });
  });
});

function renderSettings(state) {
  document.querySelectorAll('[data-setting]').forEach(input => {
    const key = input.dataset.setting;
    if (state.settings && key in state.settings) input.checked = state.settings[key];
  });
}

// ---------- category vote ----------
startVoteBtn.addEventListener('click', () => {
  const categories = [...voteCategoryChecksEl.querySelectorAll('input:checked')].map(el => el.value);
  const seconds = Number(voteTimerInput.value) || 0;
  socket.emit('host:startCategoryVote', { categories, seconds });
});
document.getElementById('close-vote-btn').addEventListener('click', () => socket.emit('host:closeCategoryVote'));
document.getElementById('apply-vote-filter-btn').addEventListener('click', () => {
  if (!latestState || !latestState.categoryVote || !latestState.categoryVote.result) return;
  categoryFilter = latestState.categoryVote.result;
  renderPlaylist(latestState);
  renderCategoryFilter(latestState);
});

let voteInterval = null;
function updateVoteCountdown(state) {
  const vote = state.categoryVote;
  if (!vote || vote.closed || !vote.endsAt) {
    voteCountdownEl.hidden = true;
    return;
  }
  const remaining = Math.max(0, Math.ceil((vote.endsAt - Date.now()) / 1000));
  voteCountdownEl.hidden = false;
  voteCountdownEl.textContent = `⏳ ${remaining}s left`;
}

function renderCategoryVote(state) {
  const enabled = state.settings && state.settings.categoryVoting;
  categoryVoteCard.hidden = !enabled;
  clearInterval(voteInterval);
  if (!enabled) return;

  const vote = state.categoryVote;

  if (!vote) {
    voteSetupEl.hidden = false;
    voteLiveEl.hidden = true;
    voteResultEl.hidden = true;
    const available = [...new Set(state.playlist.filter(s => !s.played && s.category).map(s => s.category))].sort();
    voteCategoryChecksEl.innerHTML = available.length
      ? available.map(c => `
          <label class="option-row"><input type="checkbox" value="${escapeHtml(c)}" checked><span>${categoryAvatar(c)} ${escapeHtml(c)}</span></label>
        `).join('')
      : `<p class="muted small">Tag at least 2 categories on unplayed songs first.</p>`;
    const notIdle = state.roundStatus !== 'idle';
    startVoteBtn.disabled = notIdle || available.length < 2;
    voteStatusEl.textContent = notIdle ? "Voting only runs between rounds — close or finish the current round first." : '';
    return;
  }

  if (!vote.closed) {
    voteSetupEl.hidden = true;
    voteLiveEl.hidden = false;
    voteResultEl.hidden = true;
    const totalVotes = Object.values(vote.counts).reduce((a, b) => a + b, 0);
    voteTallyEl.innerHTML = vote.options.map(c => `
      <div class="vote-row"><span>${categoryAvatar(c)} ${escapeHtml(c)}</span><span>${vote.counts[c] || 0}</span></div>
    `).join('') + `<p class="muted small">${totalVotes} vote${totalVotes === 1 ? '' : 's'} so far</p>`;
    updateVoteCountdown(state);
    if (vote.endsAt) voteInterval = setInterval(() => updateVoteCountdown(state), 500);
  } else {
    voteSetupEl.hidden = true;
    voteLiveEl.hidden = true;
    voteResultEl.hidden = false;
    voteWinnerTextEl.textContent = vote.result;
  }
}

clearActionLogBtn.addEventListener('click', () => socket.emit('host:clearActionLog'));

function renderActionLog(state) {
  const enabled = state.settings && state.settings.actionLog;
  actionLogCard.hidden = !enabled;
  if (!enabled) return;
  const log = state.actionLog || [];
  actionLogList.innerHTML = log.length
    ? log.map(entry => `
        <div class="action-log-row">
          <span class="time">${new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>${escapeHtml(entry.text)}</span>
        </div>
      `).join('')
    : '<p class="muted small">Nothing logged yet.</p>';
}

function renderPreflightCard(state) {
  preflightCard.hidden = !(state.settings && state.settings.preflightCheck);
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
  renderSettings(state);
  renderCategoryVote(state);
  renderPreflightCard(state);
  renderActionLog(state);
});

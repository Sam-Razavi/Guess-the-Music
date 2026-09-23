function getPlayerId() {
  let id = localStorage.getItem('gtm_player_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2));
    localStorage.setItem('gtm_player_id', id);
  }
  return id;
}

const myId = getPlayerId();
const socket = io();

let currentName = null;
let currentTeam = '';
function sendRegister() {
  if (currentName) socket.emit('register', { role: 'player', id: myId, name: currentName, team: currentTeam });
}
// See host.js for why this re-registers on every 'connect' rather than once
// — otherwise a phone that locks/drops WiFi mid-game stops getting updates
// until the page is manually reloaded.
socket.on('connect', sendRegister);

const nameScreen = document.getElementById('name-screen');
const buzzerScreen = document.getElementById('buzzer-screen');
const nameInput = document.getElementById('name-input');
const teamInput = document.getElementById('team-input');
const nameChip = document.getElementById('name-chip');
const myScoreEl = document.getElementById('my-score');
const buzzBtn = document.getElementById('buzz-btn');
const buzzLabel = document.getElementById('buzz-label');
const statusText = document.getElementById('status-text');
const mysteryNoteEl = document.getElementById('mystery-note');
const wagerBlockEl = document.getElementById('wager-block');
const wagerWaitingBlockEl = document.getElementById('wager-waiting-block');
const wagerInputEl = document.getElementById('wager-input');
const wagerMaxHintEl = document.getElementById('wager-max-hint');
const wagerSubmitBtn = document.getElementById('wager-submit-btn');
const wagerPlayerNameEl = document.getElementById('wager-player-name');
const voteBlockEl = document.getElementById('vote-block');
const voteHeadingEl = document.getElementById('vote-heading');
const voteOptionsPlayerEl = document.getElementById('vote-options-player');
const votePlayerStatusEl = document.getElementById('vote-player-status');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function join(name, team) {
  currentName = name;
  currentTeam = (team || '').trim();
  localStorage.setItem('gtm_player_name', name);
  localStorage.setItem('gtm_player_team', currentTeam);
  nameChip.textContent = name;
  nameScreen.hidden = true;
  buzzerScreen.hidden = false;
  sendRegister();
}

document.getElementById('name-submit').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (name) join(name, teamInput.value);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-submit').click();
});
teamInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-submit').click();
});

nameChip.addEventListener('click', () => {
  nameInput.value = localStorage.getItem('gtm_player_name') || '';
  teamInput.value = localStorage.getItem('gtm_player_team') || '';
  nameScreen.hidden = false;
  buzzerScreen.hidden = true;
});

// ---- buzz feedback: sound + vibration ----
// Created lazily inside the click handler (a real user gesture) so the
// browser doesn't block audio autoplay, and reused across buzzes.
let audioCtx = null;

function playBuzzSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) { /* Web Audio unavailable — silently skip the sound */ }
}

buzzBtn.addEventListener('click', () => {
  playBuzzSound();
  if (navigator.vibrate) navigator.vibrate(80); // no-op on iOS Safari, which doesn't support it
  socket.emit('player:buzz');
});

// Targeted at this player specifically (server emits it only to whoever's
// socket just got the wrong-answer reset) — a distinct double-pulse and a
// descending tone so it reads as clearly different from the buzz-in sound.
function playWrongSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) { /* Web Audio unavailable — silently skip the sound */ }
}

socket.on('wrong', () => {
  playWrongSound();
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  buzzBtn.classList.add('shake');
});
buzzBtn.addEventListener('animationend', (e) => {
  if (e.animationName === 'buzz-shake') buzzBtn.classList.remove('shake');
  if (e.animationName === 'buzz-armed') buzzBtn.classList.remove('armed');
});
myScoreEl.addEventListener('animationend', () => myScoreEl.classList.remove('score-pulse'));

const savedName = localStorage.getItem('gtm_player_name');
if (savedName) {
  join(savedName, localStorage.getItem('gtm_player_team') || '');
} else {
  nameInput.focus();
}

// Only ever present once this game's flagged mystery song is actually the
// one playing (see server.js payloadFor) — so this doubles as the reveal.
function renderMysteryNote(state) {
  const active = !!state.mysteryRound && state.roundStatus !== 'idle' && state.roundStatus !== 'results';
  mysteryNoteEl.hidden = !active;
  if (active) mysteryNoteEl.textContent = `🎭 Mystery Round: ${state.mysteryRound.label}`;
}

function renderCategoryVote(state) {
  const vote = state.categoryVote;
  const active = state.roundStatus === 'idle' && !!vote;
  voteBlockEl.hidden = !active;
  buzzBtn.hidden = active;
  statusText.hidden = active;
  if (!active) return;

  const myVote = vote.votes[myId];
  if (!vote.closed) {
    voteHeadingEl.textContent = '🗳️ Vote for the next category!';
    voteOptionsPlayerEl.innerHTML = vote.options.map(c => `
      <button class="vote-option-btn ${c === myVote ? 'selected' : ''}" data-vote="${escapeHtml(c)}">
        <span class="vote-avatar">${categoryAvatar(c)}</span>${escapeHtml(c)}
      </button>
    `).join('');
    voteOptionsPlayerEl.querySelectorAll('[data-vote]').forEach(btn => {
      btn.addEventListener('click', () => socket.emit('player:voteCategory', { category: btn.dataset.vote }));
    });
    votePlayerStatusEl.textContent = myVote ? `You voted: ${myVote}` : 'Tap a category to vote!';
  } else {
    voteHeadingEl.textContent = `🏆 Winner: ${vote.result}!`;
    voteOptionsPlayerEl.innerHTML = '';
    votePlayerStatusEl.textContent = '';
  }
}

// ---- wager round (Daily Double) ----
wagerSubmitBtn.addEventListener('click', () => {
  const amount = Math.round(Number(wagerInputEl.value));
  if (!Number.isFinite(amount) || amount < 0) return;
  socket.emit('player:submitWager', { amount });
});

function renderWager(state) {
  const wager = state.wager;
  const choosing = !!wager && wager.amount === null;
  const isMe = wager && wager.playerId === myId;
  wagerBlockEl.hidden = !(choosing && isMe);
  wagerWaitingBlockEl.hidden = !(choosing && !isMe);
  if (choosing) {
    // No racing for the buzzer during this phase — hide the normal buzz UI
    // entirely rather than just disabling it.
    buzzBtn.hidden = true;
    statusText.hidden = true;
    if (isMe) {
      const me = state.players.find(p => p.id === myId);
      const max = me ? me.score : 0;
      wagerMaxHintEl.textContent = `You have ${max} point${max === 1 ? '' : 's'} to risk.`;
      wagerInputEl.max = max;
    } else {
      wagerPlayerNameEl.textContent = wager.playerName || 'Someone';
    }
  } else {
    buzzBtn.hidden = false;
    statusText.hidden = false;
  }
}

let prevMyScore = null;
let wasArmed = false;

socket.on('state', (state) => {
  const lang = state.language || 'en';
  applyTranslations(lang);
  renderMysteryNote(state);
  renderCategoryVote(state);
  renderWager(state);

  const me = state.players.find(p => p.id === myId);
  if (me) {
    myScoreEl.textContent = me.score;
    if (prevMyScore !== null && prevMyScore !== me.score) myScoreEl.classList.add('score-pulse');
    prevMyScore = me.score;
  }

  const buzzed = state.buzzOrder.some(b => b.id === myId);
  // The *current* buzzer is whoever buzzed most recently, not the first
  // person to buzz this round — those differ after a reset + a second,
  // different buzzer.
  const current = state.buzzOrder[state.buzzOrder.length - 1];

  buzzBtn.classList.remove('locked', 'beaten');

  if (state.paused) {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('gamePaused', lang);
    statusText.textContent = '';
    return;
  }

  // "Armed" = this player can buzz right now — pop the button so the exact
  // moment buzzing opens up is obvious, not just an instant disabled->enabled
  // flip. Only fires on the actual transition into that state, not every
  // re-render while it's already armed.
  const armed = state.roundStatus === 'playing' && !buzzed && !state.buzzingLocked;
  if (armed && !wasArmed) buzzBtn.classList.add('armed');
  wasArmed = armed;

  if (state.roundStatus === 'idle') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('getReady', lang);
    statusText.textContent = t('waitingHostStart', lang);
  } else if (state.roundStatus === 'playing') {
    const wagerLockout = state.wager && state.wager.playerId !== myId;
    if (wagerLockout) {
      buzzBtn.disabled = true;
      buzzLabel.textContent = '💰 Daily Double';
      statusText.textContent = `Only ${state.wager.playerName || 'they'} can buzz on this one.`;
    } else if (buzzed) {
      buzzBtn.disabled = true;
      buzzBtn.classList.add('beaten');
      buzzLabel.textContent = t('alreadyBuzzed', lang);
      statusText.textContent = t('someoneElsesTurn', lang);
    } else if (state.buzzingLocked) {
      buzzBtn.disabled = true;
      buzzLabel.textContent = t('timesUp', lang);
      statusText.textContent = t('waitingHost', lang);
    } else {
      buzzBtn.disabled = false;
      buzzLabel.textContent = t('buzzBtnLabel', lang);
      statusText.textContent = t('buzzInAsap', lang);
    }
  } else if (state.roundStatus === 'buzzed') {
    buzzBtn.disabled = true;
    if (current && current.id === myId) {
      buzzBtn.classList.add('locked');
      buzzLabel.textContent = t('lockedIn', lang);
      statusText.textContent = t('sayAnswerHostChecking', lang);
    } else {
      buzzBtn.classList.add('beaten');
      const name = current ? current.name : t('someone', lang);
      buzzLabel.textContent = t('buzzedFirst', lang).replace('{name}', name);
      statusText.textContent = t('betterLuck', lang);
    }
  } else if (state.roundStatus === 'revealed') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('roundOver', lang);
    statusText.textContent = t('waitingRound', lang);
  } else if (state.roundStatus === 'results') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('gameOver', lang);
    statusText.textContent = t('yourFinalScore', lang).replace('{n}', me ? me.score : 0);
  }
});

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

let prevMyScore = null;
let wasArmed = false;

socket.on('state', (state) => {
  const lang = state.language || 'en';
  applyTranslations(lang);

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
    if (buzzed) {
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

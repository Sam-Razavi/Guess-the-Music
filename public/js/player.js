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

// Keep the phone's screen on while playing (see keepawake.js). It can only start
// from a tap, so it arms itself on the first one — joining or buzzing counts.
const awakeNoteEl = document.getElementById('awake-note');
function renderAwakeNote() {
  const s = KeepAwake.status;
  awakeNoteEl.hidden = s !== 'on' && s !== 'failed';
  awakeNoteEl.classList.toggle('fail', s === 'failed');
  awakeNoteEl.textContent = s === 'on' ? t('awakeOn', lastLang) : s === 'failed' ? t('awakeFail', lastLang) : '';
}
KeepAwake.onChange = renderAwakeNote;
KeepAwake.arm();

// Join-PIN gate (optional — see .env.example's JOIN_PIN). A URL param wins
// over a remembered one so a freshly-shared/QR'd link always takes
// precedence over a stale value from a previous game that used a different
// PIN. Blank everywhere just means the server isn't requiring one, and
// nothing below ever shows.
let currentPin = new URLSearchParams(location.search).get('pin') || localStorage.getItem('gtm_pin') || '';
// Only set once a 'state' broadcast actually arrives — there's no language
// context at all before that, including on a failed-PIN registration.
let lastLang = 'en';

let currentName = null;
let currentTeam = '';
function sendRegister() {
  if (currentName) socket.emit('register', { role: 'player', id: myId, name: currentName, team: currentTeam, pin: currentPin });
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
const wagerWaitingEl = document.getElementById('wager-waiting-text');
const voteBlockEl = document.getElementById('vote-block');
const voteHeadingEl = document.getElementById('vote-heading');
const voteOptionsPlayerEl = document.getElementById('vote-options-player');
const votePlayerStatusEl = document.getElementById('vote-player-status');
const pinRow = document.getElementById('pin-row');
const pinInput = document.getElementById('pin-input');
const pinError = document.getElementById('pin-error');

// Only shows the PIN field at all when the server is actually configured
// with one — otherwise this stays hidden and nothing about joining changes.
fetch('/join-info').then(r => r.json()).then(({ pinRequired, language, theme }) => {
  // The join screen is shown before the first game 'state' arrives, so take
  // the language/theme from here — otherwise it is always English.
  if (language) { lastLang = language; applyTranslations(language); }
  if (theme) document.documentElement.dataset.theme = theme;
  if (pinRequired) {
    pinRow.hidden = false;
    if (currentPin) pinInput.value = currentPin;
  }
}).catch(() => { /* worst case the PIN field just doesn't show pre-filled; register() still enforces it */ });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function join(name, team) {
  currentName = name;
  currentTeam = (team || '').trim();
  const pinVal = pinInput.value.trim();
  if (pinVal) currentPin = pinVal;
  localStorage.setItem('gtm_player_name', name);
  localStorage.setItem('gtm_player_team', currentTeam);
  nameChip.innerHTML = avatarHtml(name) + `<span>${escapeHtml(name)}</span>`;
  pinError.textContent = '';
  nameScreen.hidden = true;
  buzzerScreen.hidden = false;
  sendRegister();
}

// A wrong/missing PIN means the server never actually joined this socket to
// the 'player' room (see server.js's register handler) — bounce back to the
// name screen with the PIN field visible and an error, same screen the user
// was just on, rather than leaving them stranded on a buzzer screen that
// will never receive a single update.
socket.on('registerError', () => {
  localStorage.removeItem('gtm_pin');
  currentPin = '';
  buzzerScreen.hidden = true;
  nameScreen.hidden = false;
  pinRow.hidden = false;
  pinError.textContent = t('incorrectPin', lastLang);
  pinInput.focus();
});

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
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-submit').click();
});

nameChip.addEventListener('click', () => {
  nameInput.value = localStorage.getItem('gtm_player_name') || '';
  teamInput.value = localStorage.getItem('gtm_player_team') || '';
  if (currentPin) pinInput.value = currentPin;
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

let wrongFlashTimeout = null;
socket.on('wrong', () => {
  playWrongSound();
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  buzzBtn.classList.add('shake');
  // Brief red wash behind the buzzer — see .flash-wrong in player.css.
  document.body.classList.add('flash-wrong');
  clearTimeout(wrongFlashTimeout);
  wrongFlashTimeout = setTimeout(() => document.body.classList.remove('flash-wrong'), 900);
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
  if (active) mysteryNoteEl.textContent = t('mysteryRound', lastLang).replace('{label}', t('mystery_' + state.mysteryRound.modifier, lastLang));
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
    voteHeadingEl.textContent = t('voteHeading', lastLang);
    voteOptionsPlayerEl.innerHTML = vote.options.map(c => `
      <button class="vote-option-btn ${c === myVote ? 'selected' : ''}" data-vote="${escapeHtml(c)}">
        <span class="vote-avatar">${categoryAvatar(c)}</span>${escapeHtml(c)}
      </button>
    `).join('');
    voteOptionsPlayerEl.querySelectorAll('[data-vote]').forEach(btn => {
      btn.addEventListener('click', () => socket.emit('player:voteCategory', { category: btn.dataset.vote }));
    });
    votePlayerStatusEl.textContent = myVote ? t('youVoted', lastLang).replace('{name}', myVote) : t('tapToVote', lastLang);
  } else {
    voteHeadingEl.textContent = t('voteWinner', lastLang).replace('{name}', vote.result);
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
      wagerMaxHintEl.textContent = t(max === 1 ? 'wagerHint1' : 'wagerHintN', lastLang).replace('{n}', max);
      wagerInputEl.max = max;
    } else {
      wagerWaitingEl.textContent = t('wagerWaiting', lastLang).replace('{name}', wager.playerName || t('someone', lastLang));
    }
  } else {
    // Must respect an open category vote — renderCategoryVote() runs first
    // and hides the buzzer for it, and unconditionally un-hiding it here
    // used to put the buzzer back underneath the vote list.
    const voteActive = state.roundStatus === 'idle' && !!state.categoryVote;
    buzzBtn.hidden = voteActive;
    statusText.hidden = voteActive;
  }
}

let prevMyScore = null;
let wasArmed = false;
let wasLocked = false;

// Drives the full-screen color wash behind the buzzer (body[data-state] in
// player.css): armed / locked / beaten / results / idle.
function setScreenState(name) {
  document.body.dataset.state = name;
}

socket.on('state', (state) => {
  // The site files changed since this page loaded (a deploy while it was open):
  // reload to pick up the new scripts instead of running stale ones.
  if (state.buildId) {
    if (window.__buildId && window.__buildId !== state.buildId) { location.reload(); return; }
    window.__buildId = state.buildId;
  }
  const lang = state.language || 'en';
  lastLang = lang;
  if (currentPin) localStorage.setItem('gtm_pin', currentPin);
  applyTranslations(lang);
  document.documentElement.dataset.theme = state.theme || 'dark';
  renderAwakeNote();
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
    setScreenState('idle');
    return;
  }

  const lockedNow = state.roundStatus === 'buzzed' && !!current && current.id === myId;
  if (lockedNow && !wasLocked && navigator.vibrate) navigator.vibrate([30, 50, 30]);
  wasLocked = lockedNow;

  // "Armed" = this player can buzz right now — pop the button so the exact
  // moment buzzing opens up is obvious, not just an instant disabled->enabled
  // flip. Only fires on the actual transition into that state, not every
  // re-render while it's already armed.
  const armed = state.roundStatus === 'playing' && !buzzed && !state.buzzingLocked;
  if (armed && !wasArmed) buzzBtn.classList.add('armed');
  wasArmed = armed;

  setScreenState('idle');
  if (state.roundStatus === 'idle') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('getReady', lang);
    statusText.textContent = t('waitingHostStart', lang);
  } else if (state.roundStatus === 'playing') {
    const wagerLockout = state.wager && state.wager.playerId !== myId;
    if (wagerLockout) {
      buzzBtn.disabled = true;
      buzzLabel.textContent = t('dailyDoubleShort', lang);
      statusText.textContent = t('onlyThey', lang).replace('{name}', state.wager.playerName || t('they', lang));
    } else if (buzzed) {
      buzzBtn.disabled = true;
      buzzBtn.classList.add('beaten');
      setScreenState('beaten');
      // My own buzz was judged wrong (steal reopened buzzing for the others): say so.
      const mine = state.buzzOrder.find(b => b.id === myId);
      buzzLabel.textContent = mine && mine.verdict === 'wrong' ? t('verdictWrong', lang) : t('alreadyBuzzed', lang);
      statusText.textContent = t('someoneElsesTurn', lang);
    } else if (state.buzzingLocked) {
      buzzBtn.disabled = true;
      buzzLabel.textContent = t('timesUp', lang);
      statusText.textContent = t('waitingHost', lang);
    } else {
      buzzBtn.disabled = false;
      buzzLabel.textContent = state.stealOpen ? t('stealBtn', lang) : t('buzzBtnLabel', lang);
      statusText.textContent = state.stealOpen ? t('stealStatus', lang) : t('buzzInAsap', lang);
      setScreenState('armed');
    }
  } else if (state.roundStatus === 'buzzed') {
    buzzBtn.disabled = true;
    if (current && current.id === myId) {
      buzzBtn.classList.add('locked');
      buzzLabel.textContent = t('lockedIn', lang);
      statusText.textContent = t('sayAnswerHostChecking', lang);
      setScreenState('locked');
      if (current.verdict === 'correct') {
        buzzLabel.textContent = t('verdictCorrect', lang);
        statusText.textContent = '';
      } else if (current.verdict === 'wrong') {
        buzzBtn.classList.remove('locked');
        buzzBtn.classList.add('beaten');
        buzzLabel.textContent = t('verdictWrong', lang);
        statusText.textContent = '';
        setScreenState('beaten');
      }
    } else {
      buzzBtn.classList.add('beaten');
      setScreenState('beaten');
      const name = current ? current.name : t('someone', lang);
      buzzLabel.textContent = t('buzzedFirst', lang).replace('{name}', name);
      statusText.textContent = t('betterLuck', lang);
    }
  } else if (state.roundStatus === 'revealed') {
    buzzBtn.disabled = true;
    // If my answer was the right one, keep celebrating through the reveal.
    const iWon = state.buzzOrder.some(b => b.id === myId && b.verdict === 'correct');
    buzzLabel.textContent = iWon ? t('verdictCorrect', lang) : t('roundOver', lang);
    if (iWon) { buzzBtn.classList.add('locked'); setScreenState('locked'); }
    statusText.textContent = t('waitingRound', lang);
  } else if (state.roundStatus === 'results') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('gameOver', lang);
    statusText.textContent = t('yourFinalScore', lang).replace('{n}', me ? me.score : 0);
    setScreenState('results');
  }
});

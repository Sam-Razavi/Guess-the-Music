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
function sendRegister() {
  if (currentName) socket.emit('register', { role: 'player', id: myId, name: currentName });
}
// See host.js for why this re-registers on every 'connect' rather than once
// — otherwise a phone that locks/drops WiFi mid-game stops getting updates
// until the page is manually reloaded.
socket.on('connect', sendRegister);

const nameScreen = document.getElementById('name-screen');
const buzzerScreen = document.getElementById('buzzer-screen');
const nameInput = document.getElementById('name-input');
const nameChip = document.getElementById('name-chip');
const myScoreEl = document.getElementById('my-score');
const buzzBtn = document.getElementById('buzz-btn');
const buzzLabel = document.getElementById('buzz-label');
const statusText = document.getElementById('status-text');

function join(name) {
  currentName = name;
  localStorage.setItem('gtm_player_name', name);
  nameChip.textContent = name;
  nameScreen.hidden = true;
  buzzerScreen.hidden = false;
  sendRegister();
}

document.getElementById('name-submit').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (name) join(name);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-submit').click();
});

nameChip.addEventListener('click', () => {
  nameInput.value = localStorage.getItem('gtm_player_name') || '';
  nameScreen.hidden = false;
  buzzerScreen.hidden = true;
});

buzzBtn.addEventListener('click', () => {
  socket.emit('player:buzz');
});

const savedName = localStorage.getItem('gtm_player_name');
if (savedName) {
  join(savedName);
} else {
  nameInput.focus();
}

socket.on('state', (state) => {
  const lang = state.language || 'en';
  applyTranslations(lang);

  const me = state.players.find(p => p.id === myId);
  if (me) myScoreEl.textContent = me.score;

  const buzzed = state.buzzOrder.some(b => b.id === myId);
  const first = state.buzzOrder[0];

  buzzBtn.classList.remove('locked', 'beaten');

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
    if (first && first.id === myId) {
      buzzBtn.classList.add('locked');
      buzzLabel.textContent = t('lockedIn', lang);
      statusText.textContent = t('sayAnswerHostChecking', lang);
    } else {
      buzzBtn.classList.add('beaten');
      const name = first ? first.name : t('someone', lang);
      buzzLabel.textContent = t('buzzedFirst', lang).replace('{name}', name);
      statusText.textContent = t('betterLuck', lang);
    }
  } else if (state.roundStatus === 'revealed') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = t('roundOver', lang);
    statusText.textContent = t('waitingRound', lang);
  }
});

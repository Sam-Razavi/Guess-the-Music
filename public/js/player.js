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

const nameScreen = document.getElementById('name-screen');
const buzzerScreen = document.getElementById('buzzer-screen');
const nameInput = document.getElementById('name-input');
const nameChip = document.getElementById('name-chip');
const myScoreEl = document.getElementById('my-score');
const buzzBtn = document.getElementById('buzz-btn');
const buzzLabel = document.getElementById('buzz-label');
const statusText = document.getElementById('status-text');

function join(name) {
  localStorage.setItem('gtm_player_name', name);
  nameChip.textContent = name;
  nameScreen.hidden = true;
  buzzerScreen.hidden = false;
  socket.emit('register', { role: 'player', id: myId, name });
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
  const me = state.players.find(p => p.id === myId);
  if (me) myScoreEl.textContent = me.score;

  const buzzed = state.buzzOrder.some(b => b.id === myId);
  const first = state.buzzOrder[0];

  buzzBtn.classList.remove('locked', 'beaten');

  if (state.roundStatus === 'idle') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = 'Get ready…';
    statusText.textContent = 'Waiting for the host to start a round…';
  } else if (state.roundStatus === 'playing') {
    if (buzzed) {
      buzzBtn.disabled = true;
      buzzBtn.classList.add('beaten');
      buzzLabel.textContent = 'Already buzzed';
      statusText.textContent = "It's someone else's turn now.";
    } else {
      buzzBtn.disabled = false;
      buzzLabel.textContent = 'BUZZ';
      statusText.textContent = 'Buzz in as soon as you know it!';
    }
  } else if (state.roundStatus === 'buzzed') {
    buzzBtn.disabled = true;
    if (first && first.id === myId) {
      buzzBtn.classList.add('locked');
      buzzLabel.textContent = '🔒 Locked in!';
      statusText.textContent = 'Say your answer out loud — the host is checking.';
    } else {
      buzzBtn.classList.add('beaten');
      buzzLabel.textContent = (first ? first.name : 'Someone') + ' buzzed first';
      statusText.textContent = 'Better luck next round!';
    }
  } else if (state.roundStatus === 'revealed') {
    buzzBtn.disabled = true;
    buzzLabel.textContent = 'Round over';
    statusText.textContent = 'Waiting for the next round…';
  }
});

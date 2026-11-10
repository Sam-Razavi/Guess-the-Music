// Building blocks shared by the game views: lobby screens, the podium,
// team badges, host-page form controls, and the page chrome that isn't part
// of any one game (host header buttons, the phone's keep-awake note).

window.UI = (function () {
  const { t, num, esc, avatar } = Hub;

  const TEAM_ART = { red: '🍎', blue: '💎', green: '🌿', gold: '🌼' };
  const teamName = (id) => t(`team.${id}`);
  const teamBadge = (id) => `<span class="team-badge team-${id}"><span>${TEAM_ART[id] || ''}</span>${esc(teamName(id))}</span>`;

  function gameMeta(id) { return HUB_GAMES.find(g => g.id === id) || HUB_GAMES[0]; }

  function art(id, cls) {
    const m = gameMeta(id);
    return `<div class="game-art ${cls || ''}" style="--g1:${m.grad[0]};--g2:${m.grad[1]}">${m.art.map((a, i) => `<span class="ga ga${i}">${a}</span>`).join('')}</div>`;
  }

  // TV lobby: title + 3-step how-to on the left, QR join card + who's here on the right.
  // extra: below the how-to steps; side: under the players in the join column (more room there).
  function tvLobby(id, extra, side) {
    const m = gameMeta(id);
    const steps = [1, 2, 3].map(i => `<li class="how-step" style="--i:${i}"><span class="how-num">${num(i)}</span><span>${esc(t(`${id}.how${i}`))}</span></li>`).join('');
    return `<div class="tv-lobby" style="--g1:${m.grad[0]};--g2:${m.grad[1]}">
      <section class="lobby-main">
        ${art(id, 'big')}
        <h1 class="lobby-title">${esc(t(`game.${id}.name`))}</h1>
        <p class="lobby-alt"><bdi dir="${Hub.lang === 'fa' ? 'ltr' : 'rtl'}">${esc(Hub.tOther(`game.${id}.name`))}</bdi></p>
        <ol class="how">${steps}</ol>
        ${extra || ''}
      </section>
      <aside class="lobby-side">
        <div class="qr-card">
          <img src="/qr.png" alt="" class="qr">
          <div><span class="eyebrow">${esc(t('core.scan'))}</span><p class="qr-url" dir="ltr" data-join-url>${esc(Hub.joinUrl)}</p></div>
        </div>
        <div class="who" data-who></div>
        ${side || ''}
        <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p>
      </aside>
    </div>`;
  }
  function renderWho(el, players) {
    if (!el) return;
    const online = players.filter(p => p.connected);
    const key = online.map(p => p.id + p.name).join(',');
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.innerHTML = online.length
      ? online.map((p, i) => `<span class="who-chip" style="--i:${i}">${avatar(p.name)}<span>${esc(p.name)}</span></span>`).join('')
      : `<p class="muted">${esc(t('core.nobodyYet'))}</p>`;
  }

  function phoneLobby(id, extra) {
    return `<div class="ph-lobby">
      ${art(id, 'mid')}
      <h1>${esc(t(`game.${id}.name`))}</h1>
      <ol class="how small-how">${[1, 2, 3].map(i => `<li class="how-step" style="--i:${i}"><span class="how-num">${num(i)}</span><span>${esc(t(`${id}.how${i}`))}</span></li>`).join('')}</ol>
      ${extra || ''}
      <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p>
    </div>`;
  }

  // Ranked list → podium for the top three (2nd, 1st, 3rd) and chips for the rest.
  // Ties share a step: rank follows "competition" numbering (1, 1, 3).
  function podium(rows, valueOf, labelOf) {
    if (!rows.length) return `<p class="muted">${esc(t('core.noScores'))}</p>`;
    let rank = 0;
    let last = null;
    const ranked = rows.map((r, i) => {
      const v = valueOf(r);
      if (v !== last) { rank = i + 1; last = v; }
      return { ...r, rank, v };
    });
    const top = ranked.slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean);
    const steps = order.map(r => `<div class="pod pod-${Math.min(r.rank, 3)}" style="--d:${r.rank === 1 ? 2 : r.rank === 2 ? 1 : 0}">
        <div class="pod-who">${r.rank === 1 ? '<span class="crown">👑</span>' : ''}${avatar(labelOf(r), 'pod-av')}<span class="pod-name">${esc(labelOf(r))}</span><span class="pod-score">${num(r.v)}</span></div>
        <div class="pod-step"><span>${num(r.rank)}</span></div>
      </div>`).join('');
    const rest = ranked.slice(3).map(r => `<span class="rest-chip"><b>${num(r.rank)}</b>${avatar(labelOf(r))}${esc(labelOf(r))} <em>${num(r.v)}</em></span>`).join('');
    return `<div class="podium">${steps}</div>${rest ? `<div class="podium-rest">${rest}</div>` : ''}`;
  }

  // ---------- host-page form helpers ----------
  function hostField(label, inner, hint) {
    return `<label class="h-field"><span class="h-label">${esc(label)}</span>${inner}${hint ? `<span class="h-hint">${esc(hint)}</span>` : ''}</label>`;
  }
  function numberInput(key, value, min, max, step) {
    return `<input type="number" data-setting="${key}" value="${value}" min="${min}" max="${max}" step="${step || 1}">`;
  }
  function toggle(key, on, label, hint) {
    return `<label class="h-toggle"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''}><span class="sw"></span><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
  }
  // Wires every [data-setting] input inside `el` to emit a settings patch.
  function bindSettings(el, event) {
    el.addEventListener('change', (e) => {
      const input = e.target.closest('[data-setting]');
      if (!input) return;
      const key = input.dataset.setting;
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      Hub.emit(event, { [key]: value });
    });
  }
  // Keep inputs in step with the server without stomping on one being edited.
  function syncSettings(el, settings) {
    el.querySelectorAll('[data-setting]').forEach(input => {
      if (document.activeElement === input) return;
      const v = settings[input.dataset.setting];
      if (v === undefined) return;
      if (input.type === 'checkbox') input.checked = !!v;
      else if (String(input.value) !== String(v)) input.value = v;
    });
  }

  // Host team editor: tap a player to move them to the next team.
  function teamEditor(teams, gameId) {
    return `<div class="team-editor">${teams.map(tm => `<div class="te-col team-${tm.id}">
      <div class="te-head">${TEAM_ART[tm.id]} ${esc(t(`team.${tm.id}`))} <small>(${tm.members.length})</small></div>
      ${tm.members.map(m => `<button class="te-member" data-move="${esc(m.id)}" data-from="${tm.id}">${avatar(m.name)} ${esc(m.name)} <span class="te-arrow">⇄</span></button>`).join('') || '<p class="muted small">—</p>'}
    </div>`).join('')}</div>`;
  }
  function bindTeamEditor(el, gameId) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-move]');
      if (!b) return;
      const s = Hub.state.game;
      const ids = s.teams.map(x => x.id);
      const next = ids[(ids.indexOf(b.dataset.from) + 1) % ids.length];
      Hub.emit(`host:${gameId}:move`, { id: b.dataset.move, team: next });
    });
  }

  // Host: generic "click [data-emit] → emit that event" wiring.
  function bindEmits(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-emit]');
      if (!b || b.disabled) return;
      if (b.dataset.confirm && !b.classList.contains('armed')) {
        // Two-tap confirm instead of a browser dialog.
        b.classList.add('armed');
        const label = b.textContent;
        b.textContent = b.dataset.confirm;
        setTimeout(() => { b.classList.remove('armed'); b.textContent = label; }, 2500);
        return;
      }
      b.classList.remove('armed');
      let data = {};
      try { data = b.dataset.args ? JSON.parse(b.dataset.args) : {}; } catch (err) {}
      Hub.emit(b.dataset.emit, data);
    });
  }

  function hostRoster(players) {
    return players.map(p => `<span class="roster-chip ${p.connected ? '' : 'off'}">${avatar(p.name)} ${esc(p.name)}</span>`).join('') || '<span class="muted small">No one has joined yet.</span>';
  }

  // ---------- page chrome ----------
  if (Hub.role === 'host') {
    const back = document.getElementById('back-hub');
    // Leaving mid-game throws that game away, so it takes a second tap then.
    back.addEventListener('click', () => {
      const g = Hub.state && Hub.state.game;
      const midGame = g && !['lobby', 'final', 'end'].includes(g.status);
      if (midGame && !back.classList.contains('armed')) {
        back.classList.add('armed');
        back.textContent = 'Tap again — this game will end';
        setTimeout(() => { back.classList.remove('armed'); back.textContent = '⬅ All games'; }, 3000);
        return;
      }
      back.classList.remove('armed');
      back.textContent = '⬅ All games';
      Hub.emit('host:hub:select', { game: 'hub' });
    });
    document.getElementById('lang-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (b) Hub.socket.emit('host:setLanguage', b.dataset.lang);
    });
    document.getElementById('theme-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]');
      if (b) Hub.socket.emit('host:setTheme', b.dataset.theme);
    });
    const conn = document.getElementById('conn-pill');
    Hub.socket.on('connect', () => { conn.textContent = '● live'; conn.classList.add('ok'); });
    Hub.socket.on('disconnect', () => { conn.textContent = 'reconnecting…'; conn.classList.remove('ok'); });
    Hub.socket.on('arcade', (s) => {
      back.hidden = s.activeGame === 'hub';
      document.querySelectorAll('#lang-seg button').forEach(b => b.classList.toggle('active', b.dataset.lang === s.language));
      document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('active', b.dataset.theme === s.theme));
      const name = s.activeGame === 'hub' ? '' : (HUB_STRINGS.en[`game.${s.activeGame}.name`] || '');
      document.getElementById('host-game-name').textContent = name ? `· ${name}` : '';
      // The host page is English-only, whatever the TV is set to.
      document.documentElement.dir = 'ltr';
    });
    if (window.KeepAwake) KeepAwake.arm();
  }
  if (Hub.role === 'player' && window.KeepAwake) {
    const note = document.getElementById('awake-note');
    const render = () => {
      const s = KeepAwake.status;
      note.hidden = s !== 'failed';
      note.textContent = s === 'failed' ? t('core.awakeFail') : '';
    };
    KeepAwake.onChange = render;
    KeepAwake.arm();
  }

  return {
    TEAM_ART, teamName, teamBadge, gameMeta, art, tvLobby, renderWho, phoneLobby, podium,
    hostField, numberInput, toggle, bindSettings, syncSettings, teamEditor, bindTeamEditor, bindEmits, hostRoster,
  };
})();

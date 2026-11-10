// Mafia (مافیا) — TV, phone and host (narrator) views. Server logic: games/mafia.js.
(function () {
  const { t, num, esc, avatar } = Hub;
  const ROLE_ICON = { godfather: '🎩', mafia: '🔪', doctor: '💉', detective: '🔍', sniper: '🎯', bulletproof: '🛡️', jester: '🃏', citizen: '🧑' };
  const isMafiaRole = (r) => r === 'godfather' || r === 'mafia';
  const roleLabel = (r) => t(`mf.role.${r}`);

  function stars(n = 60) {
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `<i style="left:${Math.random() * 100}%;top:${Math.random() * 70}%;--d:${(Math.random() * 4).toFixed(2)}s;--s:${(0.5 + Math.random()).toFixed(2)}"></i>`;
    }
    return `<div class="mf-stars">${html}</div>`;
  }

  function roleLineup(g) {
    return Object.entries(g.roleCounts || {}).map(([r, n]) => `<span class="mf-rl ${isMafiaRole(r) ? 'bad' : ''}">${ROLE_ICON[r]} ${esc(roleLabel(r))}${n > 1 ? ` ×${num(n)}` : ''}</span>`).join('');
  }
  // Predicted lineup for the lobby (mirrors the server's deal()).
  function plannedLineup(g, n) {
    const s = g.settings;
    const auto = n <= 6 ? 1 : n <= 9 ? 2 : n <= 12 ? 3 : 4;
    const k = Math.min(Math.max(1, s.mafiaCount || auto), Math.max(1, Math.floor((n - 1) / 2)));
    const counts = {};
    if (s.godfather && k >= 2) { counts.godfather = 1; counts.mafia = k - 1; } else counts.mafia = k;
    let used = k;
    for (const r of ['doctor', 'detective', 'sniper', 'bulletproof', 'jester']) if (s[r] && used < n - 1) { counts[r] = 1; used++; }
    if (n - used > 0) counts.citizen = n - used;
    return counts;
  }

  function playerGrid(g, opts = {}) {
    return `<div class="mf-grid">${g.players.map((p, i) => {
      const votesOn = opts.votes ? Object.entries(opts.votes).filter(([, tgt]) => tgt === p.id).map(([v]) => v) : [];
      return `<div class="mf-p ${p.alive ? '' : 'dead'} ${opts.highlight === p.id ? 'hl' : ''}" style="--i:${i}">
        <div class="mf-p-av">${avatar(p.name)}${p.alive ? '' : '<span class="mf-ghost">👻</span>'}</div>
        <span class="mf-p-name">${esc(p.name)}</span>
        ${p.role ? `<span class="mf-p-role ${isMafiaRole(p.role) ? 'bad' : ''}">${ROLE_ICON[p.role]} ${esc(roleLabel(p.role))}</span>` : ''}
        ${opts.votes ? `<div class="mf-p-votes">${votesOn.map(v => avatar(Hub.playerName(v), 'mini')).join('')}${votesOn.length ? `<b>${num(votesOn.length)}</b>` : ''}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function dawnLines(g) {
    const d = g.dawn;
    if (!d) return '';
    const lines = [];
    if (!d.attacked) lines.push(`<p class="mf-line" style="--i:1">😴 ${esc(t('mf.quietNight'))}</p>`);
    if (d.saved) lines.push(`<p class="mf-line good" style="--i:1">💉 ${esc(t('mf.saved'))}</p>`);
    if (d.shielded) lines.push(`<p class="mf-line good" style="--i:1">🛡️ ${esc(t('mf.shielded'))}</p>`);
    if (d.sniper !== 'none') lines.push(`<p class="mf-line" style="--i:2">🎯 ${esc(t('mf.shot'))}</p>`);
    d.deaths.forEach((id, i) => {
      const p = g.players.find(x => x.id === id);
      lines.push(`<p class="mf-line bad" style="--i:${3 + i}">☠️ ${esc(t('mf.died', { name: p ? p.name : '?' }))}${p && p.role ? ` <span class="mf-p-role">${ROLE_ICON[p.role]} ${esc(roleLabel(p.role))}</span>` : ''}</p>`);
    });
    if (!d.deaths.length && d.attacked && !d.saved) lines.push(`<p class="mf-line" style="--i:1">😴 ${esc(t('mf.quietNight'))}</p>`);
    return lines.join('');
  }

  function judgmentTally(v) {
    return v.judgment ? `<p class="mf-judged">👎 ${esc(t('mf.guilty'))} ${num(v.judgment.guilty)} ${Hub.SEP} 👍 ${esc(t('mf.innocent'))} ${num(v.judgment.innocent)}</p>` : '';
  }
  function verdictLine(g) {
    const v = g.verdict;
    if (!v) return '';
    if (v.spared) {
      const sp = g.players.find(x => x.id === v.spared);
      return `<div class="mf-out spared">${avatar(sp ? sp.name : '?', 'mf-out-av')}<h1 class="mf-verdict">😮‍💨 ${esc(t('mf.spared', { name: sp ? sp.name : '?' }))}</h1>${judgmentTally(v)}</div>`;
    }
    if (!v.out) return `<h1 class="mf-verdict">⚖️ ${esc(t(v.tie ? 'mf.tie' : 'mf.nobodyOut'))}</h1>`;
    const p = g.players.find(x => x.id === v.out);
    return `<div class="mf-out">${avatar(p ? p.name : '?', 'mf-out-av')}<h1 class="mf-verdict">${esc(t('mf.votedOut', { name: p ? p.name : '?' }))}</h1>
      ${v.outRole ? `<p class="mf-out-role ${isMafiaRole(v.outRole) ? 'bad' : 'good'}">${ROLE_ICON[v.outRole]} ${esc(t(isMafiaRole(v.outRole) ? 'mf.wasMafia' : 'mf.wasInnocent', { role: roleLabel(v.outRole) }))}</p>` : ''}
      ${judgmentTally(v)}
      ${v.lastWordsEndsAt ? `<div class="mf-lastwords">🗣️ ${esc(t('mf.lastWords'))} <span class="mf-lw-clock" data-ends="${v.lastWordsEndsAt}"></span></div>` : ''}</div>`;
  }

  // =============== TV ===============
  const tv = {
    mount(root) { root.innerHTML = '<div class="mf-tv" id="mf-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('mf-tv');
      const st = g.status;
      el.dataset.phase = st;
      if (st === 'lobby') {
        const n = Math.max(g.lobbyCount, 4);
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.settings) + g.lobbyCount, () => UI.tvLobby('mafia', `
          <div class="mf-lineup">${roleLineup({ roleCounts: plannedLineup(g, n) })}</div>
          <p class="lobby-meta">${esc(t('mf.minPlayers'))}</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'roles') {
        Hub.screen(el, 'roles' + Hub.lang, `<div class="mf-scene mf-roles">${stars(40)}
          <div class="mf-deck">${[0, 1, 2, 3, 4].map(i => `<span class="mf-card-back" style="--i:${i}">🂠</span>`).join('')}</div>
          <h1>🤫 ${esc(t('mf.lookRole'))}</h1><p>${esc(t('mf.lookRoleSub'))}</p>
          <div class="mf-lineup">${roleLineup(g)}</div>
          <p class="mf-progress" id="mf-seen"></p></div>`);
        document.getElementById('mf-seen').textContent = t('mf.seenN', { n: num(g.seenCount), of: num(g.players.length) });
        return;
      }
      if (st === 'night') {
        if (Hub.screen(el, 'night' + g.night + Hub.lang, `<div class="mf-scene mf-night">${stars(90)}
          <div class="mf-moon"></div>
          <div class="mf-city"></div>
          <div class="mf-night-text">
            <p class="eyebrow">${esc(t('mf.nightN', { n: num(g.night) }))}</p>
            <h1>${esc(t('mf.citySleeps'))}</h1>
            <p>${esc(t('mf.nightSub'))}</p>
            <div class="mf-night-prog"><span id="mf-night-dots"></span>${g.endsAt ? `<span class="mf-night-time" data-ends="${g.endsAt}"></span>` : ''}</div>
          </div></div>`)) Hub.sfx.night();
        document.getElementById('mf-night-dots').innerHTML = Array.from({ length: g.livingCount }, (_, i) => `<i class="${i < g.nightDone ? 'on' : ''}"></i>`).join('');
        return;
      }
      if (st === 'dawn') {
        if (Hub.screen(el, 'dawn' + g.night + Hub.lang, `<div class="mf-scene mf-dawn">
          <div class="mf-sun"></div><div class="mf-city"></div>
          <div class="mf-dawn-text"><p class="eyebrow">${esc(t('mf.morning'))}</p><h1>${esc(t('mf.lastNight'))}</h1>${dawnLines(g)}</div></div>`)) {
          Hub.sfx.dawn();
          if (g.dawn && g.dawn.deaths.length) setTimeout(() => Hub.sfx.gong(), 1800);
        }
        return;
      }
      if (st === 'day' || st === 'vote') {
        const fresh = Hub.screen(el, st + g.day + Hub.lang, `<div class="mf-scene mf-day ${st}">
          <div class="mf-day-head">
            <div><p class="eyebrow">${esc(t('mf.dayN', { n: num(g.day) }))}</p>
            <h1>${esc(t(st === 'day' ? 'mf.discuss' : 'mf.voteNow'))}</h1>
            <p>${esc(t(st === 'day' ? 'mf.discussSub' : 'mf.voteSub'))}</p></div>
            ${g.endsAt ? `<span class="mf-clock" data-ends="${g.endsAt}" data-format="clock"></span>` : ''}
          </div>
          <div id="mf-day-grid"></div>
          ${st === 'vote' ? '<p class="mf-skipvotes" id="mf-skipvotes"></p>' : ''}
        </div>`);
        if (fresh && st === 'vote') Hub.sfx.alarm();
        const grid = document.getElementById('mf-day-grid');
        const key = JSON.stringify([g.players, g.votes]);
        if (grid.dataset.k !== key) { grid.dataset.k = key; grid.innerHTML = playerGrid(g, st === 'vote' ? { votes: g.votes } : {}); }
        const sk = document.getElementById('mf-skipvotes');
        if (sk) {
          const skips = Object.values(g.votes).filter(v => v === 'skip').length;
          sk.textContent = skips ? t('mf.skipVotes', { n: num(skips) }) : '';
        }
        return;
      }
      if (st === 'defense' || st === 'judgment') {
        const acc = g.accused || { name: '?' };
        if (Hub.screen(el, st + g.day + Hub.lang, `<div class="mf-scene mf-trial ${st}">
          <p class="eyebrow">⚖️ ${esc(t('mf.dayN', { n: num(g.day) }))}</p>
          ${avatar(acc.name, 'mf-out-av')}
          <h1>${esc(t(st === 'defense' ? 'mf.onTrial' : 'mf.judgeNow', { name: acc.name }))}</h1>
          <p>${esc(t(st === 'defense' ? 'mf.defenseSub' : 'mf.judgeSub'))}</p>
          ${g.endsAt ? `<span class="mf-clock" data-ends="${g.endsAt}" data-format="clock"></span>` : ''}
          <p class="mf-progress" id="mf-judged"></p>
        </div>`)) { if (st === 'judgment') Hub.sfx.alarm(); else Hub.sfx.gong(); }
        const jd = document.getElementById('mf-judged');
        jd.textContent = st === 'judgment' ? t('mf.seenN', { n: num(g.judgedCount), of: num(Math.max(0, g.livingCount - 1)) }) : '';
        return;
      }
      if (st === 'verdict') {
        if (Hub.screen(el, 'verdict' + g.day + Hub.lang, `<div class="mf-scene mf-verdict-scene">
          <p class="eyebrow">${esc(t('mf.cityDecided'))}</p>
          ${verdictLine(g)}
          <div class="mf-tally">${playerGrid({ players: g.players.filter(p => g.verdict.counts[p.id]) }, { votes: g.votes })}</div>
        </div>`)) { Hub.sfx.drumroll(1200); setTimeout(() => Hub.sfx.gong(), 1250); }
        return;
      }
      if (st === 'end') {
        if (Hub.screen(el, 'end' + Hub.lang, `<div class="mf-scene mf-end ${g.winner}">${g.winner === 'mafia' ? stars(60) : ''}
          <p class="eyebrow">${esc(t('core.gameOver'))}</p>
          <h1>${g.winner === 'mafia' ? '🕶️' : g.winner === 'jester' ? '🃏' : '🏙️'} ${esc(t(g.winner === 'mafia' ? 'mf.mafiaWin' : g.winner === 'jester' ? 'mf.jesterWin' : 'mf.townWin'))}</h1>
          ${playerGrid(g)}
        </div>`)) { Hub.sfx.fanfare(); Hub.confetti(g.winner === 'mafia' ? 60 : 160); }
      }
    },
  };

  // =============== phone ===============
  let showCard = false;
  let lastInquiry = null;
  const player = {
    mount(root) {
      root.innerHTML = '<div class="mf-ph" id="mf-ph"></div>';
      showCard = false;
      root.addEventListener('click', (e) => {
        if (e.target.closest('#mf-card')) { showCard = !showCard; Hub.vibrate(15); player.update(Hub.state); return; }
        if (e.target.closest('#mf-seen-btn')) { Hub.emit('player:mafia:seen'); showCard = false; Hub.vibrate(20); return; }
        const n = e.target.closest('[data-night]');
        if (n && !n.disabled) { Hub.emit('player:mafia:night', { target: n.dataset.night }); Hub.vibrate(20); return; }
        const v = e.target.closest('[data-mfvote]');
        if (v) { Hub.emit('player:mafia:vote', { target: v.dataset.mfvote }); Hub.vibrate(20); return; }
        const j = e.target.closest('[data-judge]');
        if (j) { Hub.emit('player:mafia:judge', { verdict: j.dataset.judge }); Hub.vibrate(30); }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('mf-ph');
      const st = g.status;
      el.dataset.phase = st;
      const me = g.me;
      if (st === 'lobby') { Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('mafia')); return; }
      if (!me) {
        Hub.screen(el, 'spectator' + st + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">🍿</div><h2>${esc(t('mf.spectator'))}</h2></div>`);
        return;
      }
      const roleCard = (open) => `<button class="mf-card ${open ? 'open' : ''} ${isMafiaRole(me.role) ? 'bad' : ''}" id="mf-card">
          <span class="mf-card-front"><span class="mf-card-ico">🂠</span><b>${esc(t('mf.tapReveal'))}</b></span>
          <span class="mf-card-face"><span class="mf-card-ico">${ROLE_ICON[me.role]}</span><b>${esc(roleLabel(me.role))}</b><small>${esc(t(`mf.desc.${me.role}`))}</small>
          ${me.team && me.team.length ? `<span class="mf-team">${esc(t('mf.yourTeam'))}: ${me.team.map(x => `${avatar(x.name, 'mini')} ${esc(x.name)}${x.role === 'godfather' ? ' 🎩' : ''}`).join(Hub.SEP)}</span>` : ''}</span>
        </button>`;
      if (!me.alive && st !== 'end') {
        Hub.screen(el, 'dead' + Hub.lang + showCard, `<div class="mf-ph-msg dead"><div class="gp-big-ico">👻</div><h2>${esc(t('mf.youAreOut'))}</h2><p>${esc(t('mf.staySilent'))}</p>${roleCard(showCard)}</div>`);
        return;
      }
      if (st === 'roles') {
        Hub.screen(el, 'roles' + showCard + me.seen + Hub.lang, `<div class="mf-ph-roles">
          <h2>${esc(t('mf.yourRole'))}</h2>${roleCard(showCard)}
          ${me.seen ? `<p class="muted">✓ ${esc(t('mf.waitOthers'))}</p>` : `<button class="primary" id="mf-seen-btn" ${showCard ? '' : 'disabled'}>✓ ${esc(t('mf.gotIt'))}</button>`}
          <p class="muted small">🤫 ${esc(t('mf.hideScreen'))}</p></div>`);
        return;
      }
      if (st === 'night') {
        const r = me.role;
        const others = g.players.filter(p => p.alive);
        const legal = (p) => {
          if (p.id === Hub.myId) return r === 'doctor' && !me.doctorSelfUsed;
          if (isMafiaRole(r) && me.team && me.team.some(x => x.id === p.id)) return false;
          if (r === 'sniper' && me.sniperShots <= 0) return false;
          return true;
        };
        const locked = r === 'detective' && me.pick;
        const teamPicks = (pid) => (me.team || []).filter(x => x.pick === pid).map(x => avatar(x.name, 'mini')).join('');
        const promptKey = r === 'sniper' && me.sniperShots <= 0 ? 'mf.night.sniperEmpty' : `mf.night.${r}`;
        const inquiry = r === 'detective' && me.inquiries && me.inquiries.length ? me.inquiries[me.inquiries.length - 1] : null;
        el.innerHTML = `<div class="mf-ph-night">
          <p class="eyebrow">🌙 ${esc(t('mf.nightN', { n: num(g.night) }))} ${g.endsAt ? `${Hub.SEP} <span data-ends="${g.endsAt}"></span>` : ''}</p>
          <h2>${esc(t(promptKey))}</h2>
          ${inquiry && inquiry.night === g.night ? `<div class="mf-inq ${inquiry.mafia ? 'bad' : 'good'}">${inquiry.mafia ? '👎' : '👍'} ${esc(t(inquiry.mafia ? 'mf.isMafia' : 'mf.notMafia', { name: inquiry.name }))}</div>` : ''}
          <div class="mf-targets">${others.map(p => `<button class="mf-target ${me.pick === p.id ? 'on' : ''}" data-night="${esc(p.id)}" ${legal(p) && !locked ? '' : 'disabled'}>
            ${avatar(p.name)}<span>${esc(p.name)}${p.id === Hub.myId ? ` (${esc(t('mf.you'))})` : ''}</span><span class="mf-tp">${teamPicks(p.id)}</span></button>`).join('')}
            ${r === 'sniper' ? `<button class="mf-target hold ${me.pick === 'none' ? 'on' : ''}" data-night="none">🤚 ${esc(t('mf.holdFire'))}</button>` : ''}
          </div>
          <p class="muted small">${esc(me.pick ? t('mf.picked') : t('mf.hideScreen'))}</p>
        </div>`;
        return;
      }
      if (st === 'defense' || st === 'judgment') {
        const onTrial = g.accused && g.accused.id === Hub.myId;
        if (onTrial) {
          Hub.screen(el, st + 'me' + g.day + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">⚖️</div><h2>${esc(t(st === 'defense' ? 'mf.defendYourself' : 'mf.waitVerdict'))}</h2>${g.endsAt ? `<p class="mf-ph-clock" data-ends="${g.endsAt}" data-format="clock"></p>` : ''}</div>`);
        } else if (st === 'defense') {
          Hub.screen(el, 'def' + g.day + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">👂</div><h2>${esc(t('mf.listen', { name: g.accused ? g.accused.name : '' }))}</h2></div>`);
        } else {
          el.innerHTML = `<div class="mf-ph-vote"><p class="eyebrow">⚖️ ${g.endsAt ? `<span data-ends="${g.endsAt}"></span>` : ''}</p>
            <h2>${esc(t('mf.judgeNow', { name: g.accused ? g.accused.name : '' }))}</h2>
            <div class="mf-judge-btns"><button class="mf-judge guilty ${me.judgment === 'guilty' ? 'on' : ''}" data-judge="guilty">👎 ${esc(t('mf.guilty'))}</button>
            <button class="mf-judge innocent ${me.judgment === 'innocent' ? 'on' : ''}" data-judge="innocent">👍 ${esc(t('mf.innocent'))}</button></div>
            <p class="muted small">${esc(t('mf.changeUntil'))}</p></div>`;
        }
        return;
      }
      if (st === 'verdict' && g.verdict && g.verdict.out === Hub.myId) {
        Hub.screen(el, 'lastwords' + g.day + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">🗣️</div><h2>${esc(t('mf.yourLastWords'))}</h2>${g.verdict.lastWordsEndsAt ? `<p class="mf-ph-clock" data-ends="${g.verdict.lastWordsEndsAt}"></p>` : ''}</div>`);
        return;
      }
      if (st === 'dawn' || st === 'verdict') {
        Hub.screen(el, st + g.day + g.night + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">${st === 'dawn' ? '☀️' : '⚖️'}</div><h2>${esc(t('mf.lookTv'))}</h2></div>`);
        return;
      }
      if (st === 'day') {
        Hub.screen(el, 'day' + g.day + showCard + Hub.lang, `<div class="mf-ph-day">
          <p class="eyebrow">☀️ ${esc(t('mf.dayN', { n: num(g.day) }))}</p>
          <h2>${esc(t('mf.discuss'))}</h2>
          ${g.endsAt ? `<p class="mf-ph-clock" data-ends="${g.endsAt}" data-format="clock"></p>` : ''}
          ${roleCard(showCard)}
          <p class="muted small">${esc(t('mf.tapCard'))}</p></div>`);
        return;
      }
      if (st === 'vote') {
        const alive = g.players.filter(p => p.alive && p.id !== Hub.myId);
        el.innerHTML = `<div class="mf-ph-vote">
          <p class="eyebrow">🗳️ ${esc(t('mf.dayN', { n: num(g.day) }))} ${g.endsAt ? `${Hub.SEP} <span data-ends="${g.endsAt}"></span>` : ''}</p>
          <h2>${esc(t('mf.whoOut'))}</h2>
          <div class="mf-targets">${alive.map(p => {
            const n = Object.values(g.votes).filter(v => v === p.id).length;
            return `<button class="mf-target ${me.vote === p.id ? 'on' : ''}" data-mfvote="${esc(p.id)}">${avatar(p.name)}<span>${esc(p.name)}</span><b class="mf-vn">${n ? num(n) : ''}</b></button>`;
          }).join('')}
          <button class="mf-target hold ${me.vote === 'skip' ? 'on' : ''}" data-mfvote="skip">🤷 ${esc(t('mf.skipVote'))}</button></div>
        </div>`;
        return;
      }
      if (st === 'end') {
        const won = g.winner === 'jester' ? me.role === 'jester' : me.role !== 'jester' && (g.winner === 'mafia') === isMafiaRole(me.role);
        Hub.screen(el, 'end' + Hub.lang, `<div class="ph-result"><div class="big-rank">${won ? '🏆' : g.winner === 'mafia' ? '🕶️' : g.winner === 'jester' ? '🃏' : '🏙️'}</div>
          <h1>${esc(t(won ? 'mf.youWin' : 'mf.youLose'))}</h1><p>${esc(t(g.winner === 'mafia' ? 'mf.mafiaWin' : g.winner === 'jester' ? 'mf.jesterWin' : 'mf.townWin'))}</p>
          <p class="mf-p-role ${isMafiaRole(me.role) ? 'bad' : ''}">${ROLE_ICON[me.role]} ${esc(roleLabel(me.role))}</p></div>`);
      }
    },
    events: {
      'mf:roles': () => Hub.vibrate([60, 40, 60]),
      'mf:night': () => { showCard = false; Hub.vibrate(80); },
      'mf:day': () => { showCard = false; },
      'mf:inquiry': (d) => { lastInquiry = d; Hub.vibrate(d.mafia ? [200, 80, 200] : 60); },
    },
  };

  // =============== host (narrator) ===============
  let hostShowRoles = false;
  const NEXT_LABEL = { roles: (g) => (g.settings.introNight ? 'Start day 1 ☀️' : 'Night falls 🌙'), night: () => 'Dawn ☀️ (resolve the night)', dawn: () => 'Start the discussion', day: () => 'Start the vote 🗳️', vote: () => 'Close the vote', defense: () => 'End the defense → guilty/innocent vote', judgment: () => 'Close the guilty/innocent vote', verdict: () => 'Night falls 🌙' };
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="mf-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:mafia:settings');
      root.addEventListener('click', (e) => { if (e.target.closest('#mf-roles-toggle')) { hostShowRoles = !hostShowRoles; host.update(Hub.state); } });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('mf-host');
      const st = g.status;
      if (st === 'lobby' || st === 'end') {
        const n = s.players.filter(p => p.connected).length;
        Hub.screen(el, st + JSON.stringify(g.settings) + n, `<section class="h-card span2 h-hero">
            <h2>${st === 'end' ? (g.winner === 'mafia' ? '🕶️ The mafia won' : '🏙️ The town won') : '🕶️ Mafia'}</h2>
            <p class="muted small">The app is the narrator: roles go out to the phones, every living player taps someone each night (citizens pick a "suspect" so nobody can tell who's who), and the day vote happens on the phones too. You just press the next-step button. Best with 6+ players; at least 4.</p>
            <button class="primary big-btn" data-emit="host:mafia:start" ${n >= 4 ? '' : 'disabled'}>${st === 'end' ? 'Deal new roles ▶' : 'Deal the roles ▶'}</button>
            ${n < 4 ? `<p class="muted small">Need at least 4 players (${n} online).</p>` : `<p class="muted small">With ${n} players: ${Object.entries(plannedLineup(g, n)).map(([r, c]) => `${ROLE_ICON[r]} ${HUB_STRINGS.en[`mf.role.${r}`]}${c > 1 ? ' ×' + c : ''}`).join(', ')}</p>`}
          </section>
          <section class="h-card"><h2>Roles</h2>
            ${UI.toggle('godfather', g.settings.godfather, 'Godfather', 'Mafia boss — the detective sees him as innocent (needs 2+ mafia)')}
            ${UI.toggle('doctor', g.settings.doctor, 'Doctor', 'Saves one person each night (themselves once)')}
            ${UI.toggle('detective', g.settings.detective, 'Detective', 'Asks about one person each night')}
            ${UI.toggle('sniper', g.settings.sniper, 'Sniper', 'One bullet; shooting an innocent kills the sniper')}
            ${UI.toggle('bulletproof', g.settings.bulletproof, '🛡️ Bulletproof', 'A citizen who survives the first mafia attack')}
            ${UI.toggle('jester', g.settings.jester, '🃏 Jester', 'Wins alone if the town votes them out — so they act suspicious')}
            ${UI.hostField('Mafia members (0 = automatic)', UI.numberInput('mafiaCount', g.settings.mafiaCount, 0, 6))}
          </section>
          <section class="h-card"><h2>Rules & timers</h2>
            ${UI.toggle('introNight', g.settings.introNight, 'Introduction night', 'No kill on the first night — day 1 comes straight after the role cards')}
            ${UI.toggle('revealOnDeath', g.settings.revealOnDeath, 'Reveal roles when someone is out')}
            ${UI.toggle('defense', g.settings.defense, '⚖️ Defense + guilty/innocent vote', 'The most-voted player gets to defend themselves, then everyone else votes guilty or innocent')}
            <div class="h-fields">
              ${UI.hostField('Night (sec, 0 = no limit)', UI.numberInput('nightSeconds', g.settings.nightSeconds, 0, 600, 10))}
              ${UI.hostField('Discussion (sec)', UI.numberInput('daySeconds', g.settings.daySeconds, 0, 1800, 30))}
              ${UI.hostField('Vote (sec)', UI.numberInput('voteSeconds', g.settings.voteSeconds, 0, 600, 5))}
              ${UI.hostField('Defense (sec)', UI.numberInput('defenseSeconds', g.settings.defenseSeconds, 0, 300, 5))}
              ${UI.hostField('Last words (sec, 0 = off)', UI.numberInput('lastWords', g.settings.lastWords, 0, 120, 5))}
            </div></section>
          ${st === 'end' ? `<section class="h-card span2"><h2>Who was who</h2>${playerGrid(g)}</section>` : ''}`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const phase = { roles: 'Role cards', night: `Night ${g.night}`, dawn: `Dawn after night ${g.night}`, day: `Day ${g.day} — discussion`, vote: `Day ${g.day} — vote`, defense: `Day ${g.day} — ${g.accused ? g.accused.name : ''} defends`, judgment: `Day ${g.day} — guilty or innocent?`, verdict: `Day ${g.day} — verdict` }[st];
      const acted = st === 'night' ? `${g.nightDone} of ${g.livingCount} have chosen` : st === 'roles' ? `${g.seenCount} of ${g.players.length} have seen their role` : st === 'vote' ? `${Object.keys(g.votes).length} of ${g.livingCount} voted` : st === 'judgment' ? `${g.judgedCount} of ${g.livingCount - 1} have judged` : '';
      el.innerHTML = `<section class="h-card span2 h-hero">
          <p class="eyebrow">Narrator</p><h2>${esc(phase)} ${g.endsAt ? `<span class="h-timer" data-ends="${g.endsAt}" data-format="clock"></span>` : ''}</h2>
          <p class="h-status">${esc(acted)}</p>
          <div class="h-btns">
            <button class="primary big-btn" data-emit="host:mafia:advance">${esc(NEXT_LABEL[st](g))}</button>
            <button id="mf-roles-toggle">${hostShowRoles ? '🙈 Hide roles' : '👁 Show roles (only if you\'re not playing)'}</button>
            <button class="danger" data-emit="host:mafia:end" data-confirm="Tap again to end">End game</button>
          </div>
        </section>
        <section class="h-card span2"><h2>Players</h2>
          <div class="mf-h-list">${g.players.map(p => `<div class="mf-h-row ${p.alive ? '' : 'dead'}">${avatar(p.name)} <b>${esc(p.name)}</b>
            ${hostShowRoles && p.role ? `<span class="mf-p-role ${isMafiaRole(p.role) ? 'bad' : ''}">${ROLE_ICON[p.role]} ${HUB_STRINGS.en[`mf.role.${p.role}`]}</span>` : ''}
            ${!p.alive ? '<span class="muted small">out</span>' : ''}
            ${st === 'night' && g.picks ? `<span class="small">${g.picks[p.id] ? '✓ chose' : '…'}${hostShowRoles && g.picks[p.id] ? ` → ${esc(g.picks[p.id] === 'none' ? 'hold fire' : Hub.playerName(g.picks[p.id]))}` : ''}</span>` : ''}
            ${st === 'roles' && g.seen ? `<span class="small">${g.seen[p.id] ? '✓ seen' : '…'}</span>` : ''}
            ${st === 'vote' && g.votes[p.id] ? `<span class="small">→ ${esc(g.votes[p.id] === 'skip' ? 'skip' : Hub.playerName(g.votes[p.id]))}</span>` : ''}
          </div>`).join('')}</div></section>
        ${hostShowRoles ? `<section class="h-card span2"><h2>Narrator log</h2>${(g.log || []).map(l => `<p class="small">${esc(l.text)}</p>`).join('') || '<p class="muted small">Nothing yet.</p>'}</section>` : ''}`;
    },
  };

  Hub.register('mafia', { tv, player, host });
})();

// Gol ya Pooch (گل یا پوچ) — TV, phone and host views. Server logic: games/golpooch.js.
(function () {
  const { t, num, esc, avatar } = Hub;
  const other = (team) => (team === 'red' ? 'blue' : 'red');

  function scoreBar(g) {
    return `<div class="gp-scorebar">
      ${['red', 'blue'].map(tm => `<div class="gp-team-score team-${tm} ${g.hidingTeam === tm ? 'hiding' : ''}">
        ${UI.teamBadge(tm)}<span class="gp-pts" data-team="${tm}">${num(g.scores[tm])}</span>
        ${g.hidingTeam === tm ? `<span class="gp-has">🌹</span>` : ''}</div>`).join(`<div class="gp-target">${esc(t('gp.firstTo', { n: num(g.settings.target) }))}</div>`)}
    </div>`;
  }

  // One player's pair of hands. `mode`: 'tv' | 'pick' (tappable) | 'view'.
  function handsCard(g, pid, name, opts = {}) {
    const hands = g.hands.filter(h => h.pid === pid);
    return `<div class="gp-person" data-person="${esc(pid)}">
      <div class="gp-hands">${hands.map(h => {
        const sugg = (g.suggestions || []).filter(x => x.key === h.key);
        const pending = g.pending && g.pending.key === h.key;
        const cls = ['gp-hand', `hand-${h.hand}`, h.open ? `open-${h.open}` : 'closed', pending ? `pending call-${g.pending.call}` : '', opts.selected === h.key ? 'selected' : '', opts.mySuggest === h.key ? 'my-sugg' : ''].join(' ');
        const inner = h.open === 'gol' ? '<span class="h-ico">🖐️</span><span class="h-rose">🌹</span>'
          : h.open === 'empty' ? '<span class="h-ico">🖐️</span><span class="h-puff">💨</span>'
          : '<span class="h-ico">✊</span>';
        const tag = opts.tappable && !h.open ? 'button' : 'div';
        return `<${tag} class="${cls}" data-hand="${esc(h.key)}">${inner}
          <span class="h-label">${esc(t(h.hand === 'L' ? 'gp.left' : 'gp.right'))}</span>
          ${pending ? `<span class="h-call">${esc(t(g.pending.call === 'gol' ? 'gp.callGol' : 'gp.callPooch'))}</span>` : ''}
          ${sugg.length ? `<span class="h-sugg">${sugg.map(x => avatar(x.name, 'sugg-av')).join('')}</span>` : ''}
        </${tag}>`;
      }).join('')}</div>
      <div class="gp-person-name">${avatar(name)}<span>${esc(name)}</span></div>
    </div>`;
  }
  function handsGrid(g, opts) {
    const team = g.teams.find(x => x.id === g.hidingTeam);
    return `<div class="gp-grid n${Math.min(team ? team.members.length : 0, 8)}">${(team ? team.members : []).map(m => handsCard(g, m.id, m.name, opts)).join('')}</div>`;
  }

  const AWARD_ICON = { eye: '🎯', poker: '😏', sweep: '🧹' };
  function awardCards(g, cls) {
    if (!g.awards || !g.awards.length) return '';
    return `<div class="gp-awards ${cls || ''}">${g.awards.map((a, i) => `<div class="gp-award" style="--i:${i}"><span class="ga-ico">${AWARD_ICON[a.key]}</span><b>${esc(t(`gp.award.${a.key}`))}</b>${avatar(a.name)}<span class="ga-name"><bdi>${esc(a.name)}</bdi></span><small>${esc(t(`gp.award.${a.key}.n`, { n: num(a.n) }))}</small></div>`).join('')}</div>`;
  }

  function resultLine(g) {
    const r = g.result;
    if (!r) return '';
    const win = UI.teamName(r.winner);
    return t(`gp.res.${r.reason}`, { team: win, n: num(r.points) });
  }
  const resultIcon = (r) => ({ poochedGol: '🌹', wrongGol: '💨', found: '🌹', bullseye: '🎯', elimination: '🌹' }[r.reason] || '🌹');

  // =============== TV ===============
  let lastStatusKey = '';
  const tv = {
    mount(root) { root.innerHTML = '<div class="gp-tv" id="gp-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('gp-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.teams), () => UI.tvLobby('golpooch', `
          <div class="gp-lobby-teams">${g.teams.map(tm => `<div class="gp-lt team-${tm.id}">${UI.teamBadge(tm.id)}<div>${tm.members.map(m => `<span class="who-chip">${avatar(m.name)}<span>${esc(m.name)}</span></span>`).join('') || '<span class="muted">—</span>'}</div></div>`).join('<span class="vs">VS</span>')}</div>
          <p class="lobby-meta">${esc(t('gp.firstTo', { n: num(g.settings.target) }))} ${Hub.SEP} 🎯 ${esc(t('gp.bullseyeRule'))}</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, () => {
          const team = g.teams.find(x => x.id === g.winner);
          return `<div class="final-screen gp-final team-${g.winner}">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <div class="gp-final-rose">🌹</div>
            <h1>${esc(t('gp.teamWins', { team: UI.teamName(g.winner) }))}</h1>
            <p class="gp-final-score">${num(g.scores[g.winner])} : ${num(g.scores[other(g.winner)])}</p>
            <div class="gp-final-members">${(team ? team.members : []).map((m, i) => `<span class="who-chip big" style="--i:${i}">${avatar(m.name)}<span>${esc(m.name)}</span></span>`).join('')}</div>
            ${awardCards(g)}
          </div>`;
        })) { Hub.confetti(180); Hub.sfx.fanfare(); }
        return;
      }
      // hiding / guessing / reveal share one stage
      const fresh = Hub.screen(el, 'stage' + g.round + Hub.lang, `<div class="gp-stage">
          <div id="gp-score"></div>
          <div class="gp-caption" id="gp-caption"></div>
          <div class="gp-hands-area" id="gp-hands"></div>
          <div class="gp-result" id="gp-result" hidden></div>
          <div class="gp-streak" id="gp-streak" hidden></div>
        </div>`);
      const scoreEl = document.getElementById('gp-score');
      Hub.screen(scoreEl, JSON.stringify(g.scores) + g.hidingTeam + Hub.lang, scoreBar(g));
      const cap = document.getElementById('gp-caption');
      const hiders = UI.teamName(g.hidingTeam);
      const guessers = UI.teamName(other(g.hidingTeam));
      if (st === 'hiding') {
        Hub.screen(cap, 'h' + g.round, `<h2>🤫 ${esc(t('gp.tvHiding', { team: hiders }))}</h2><p>${esc(t('gp.tvHidingSub', { name: g.hider ? g.hider.name : '?', team: guessers }))}${g.hideEndsAt ? ` <span class="gp-clock" data-ends="${g.hideEndsAt}"></span>` : ''}</p>`);
      } else if (st === 'guessing') {
        Hub.screen(cap, 'g' + g.round + (g.pending ? g.pending.key : ''), g.pending
          ? `<h2 class="gp-suspense">${esc(t(g.pending.call === 'gol' ? 'gp.tvCallGol' : 'gp.tvCallPooch', { name: g.guesser.name }))}</h2>`
          : `<h2>👉 ${esc(t('gp.tvGuessing', { name: g.guesser ? g.guesser.name : '?', team: guessers }))}</h2><p>${esc(t('gp.tvGuessingSub'))}</p>`);
      } else if (st === 'reveal') {
        Hub.screen(cap, 'r' + g.round, '');
      }
      const handsEl = document.getElementById('gp-hands');
      const hkey = JSON.stringify([g.hands, g.pending, g.suggestions, st]);
      if (handsEl.dataset.k !== hkey) {
        handsEl.dataset.k = hkey;
        handsEl.innerHTML = handsGrid(g, {}) + (st === 'hiding' ? '<div class="gp-floating-rose">🌹</div>' : '');
      }
      // 🔥 A team that keeps winning rounds gets a banner.
      const streakEl = document.getElementById('gp-streak');
      streakEl.hidden = !g.streak;
      if (g.streak && Hub.screen(streakEl, 'st' + g.streak.team + g.streak.count, `🔥 ${esc(t('gp.streak', { team: UI.teamName(g.streak.team), n: num(g.streak.count) }))}`)) Hub.sfx.sparkle();
      const res = document.getElementById('gp-result');
      res.hidden = st !== 'reveal';
      if (st === 'reveal' && g.result) {
        const good = g.result.winner !== g.hidingTeam;
        if (Hub.screen(res, 'res' + g.round, `<div class="gp-res-card ${good ? 'found' : 'kept'} team-${g.result.winner}">
            <span class="gp-res-ico">${resultIcon(g.result)}</span>
            <span class="gp-res-text">${esc(resultLine(g))}</span>
          </div>`)) {
          if (g.result.reason === 'bullseye') { Hub.stamp(t('gp.bullseye'), 'gold'); Hub.confetti(120); }
          if (good) { Hub.sfx.chime(); Hub.confetti(70); } else Hub.sfx.buzzer();
        }
      }
      const key = st + g.round;
      if (key !== lastStatusKey) { lastStatusKey = key; if (st === 'guessing' && !fresh) Hub.sfx.pop(); }
    },
    events: {
      'gp:pending': () => Hub.sfx.drumroll(1600),
      'gp:opened': () => Hub.sfx.whoosh(),
    },
  };

  // =============== phone ===============
  let selected = null;
  let peeking = false;
  const player = {
    mount(root) {
      root.innerHTML = '<div class="gp-ph" id="gp-ph"></div>';
      root.addEventListener('click', (e) => {
        const g = Hub.state.game;
        const hand = e.target.closest('button[data-hand]');
        if (hand) {
          const key = hand.dataset.hand;
          if (g.status === 'hiding' && g.hider && g.hider.id === Hub.myId) {
            Hub.emit('player:golpooch:hide', { key });
            Hub.vibrate([40, 30, 40]);
          } else if (g.status === 'guessing' && g.guesser && g.guesser.id === Hub.myId) {
            selected = selected === key ? null : key;
            Hub.vibrate(15);
            player.update(Hub.state);
          } else if (g.status === 'guessing') {
            Hub.emit('player:golpooch:suggest', { key });
            Hub.vibrate(15);
          }
        }
        const call = e.target.closest('[data-call]');
        if (call && selected) {
          Hub.emit('player:golpooch:pick', { key: selected, call: call.dataset.call });
          Hub.vibrate(60);
          selected = null;
        }
      });
      // Press-and-hold to peek, so a glance over the shoulder shows nothing.
      const setPeek = (on) => {
        peeking = on;
        const pad = document.getElementById('gp-peek');
        if (pad) pad.classList.toggle('peeking', on);
      };
      root.addEventListener('pointerdown', (e) => { if (e.target.closest('#gp-peek')) { setPeek(true); Hub.vibrate(10); } });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => root.addEventListener(ev, () => { if (peeking) setPeek(false); }));
      root.addEventListener('contextmenu', (e) => { if (e.target.closest('#gp-peek')) e.preventDefault(); });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('gp-ph');
      const st = g.status;
      const my = g.myTeam;
      const myBadge = my ? `<div class="ph-team">${esc(t('gp.youreOn'))} ${UI.teamBadge(my)}</div>` : '';
      if (st === 'lobby') { Hub.screen(el, 'lobby' + Hub.lang + my, UI.phoneLobby('golpooch', myBadge)); return; }
      if (st === 'final') {
        const won = g.winner === my;
        Hub.screen(el, 'final' + won + Hub.lang, `<div class="ph-result">
          <div class="big-rank">${won ? '🏆' : '🌹'}</div>
          <h1>${esc(t(won ? 'gp.youWon' : 'gp.teamWins', { team: UI.teamName(g.winner) }))}</h1>
          ${(g.awards || []).filter(a => a.id === Hub.myId).map(a => `<p class="gain">${AWARD_ICON[a.key]} ${esc(t(`gp.award.${a.key}`))}</p>`).join('')}
          <p class="big-score">${num(g.scores[g.winner])} : ${num(g.scores[other(g.winner)])}</p>
          <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
        return;
      }
      if (!my) {
        Hub.screen(el, 'noteam' + st + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">🍿</div><h2>${esc(t('core.nextRound'))}</h2></div>`);
        return;
      }
      const hiding = my === g.hidingTeam;
      const amHider = g.hider && g.hider.id === Hub.myId;
      const amGuesser = g.guesser && g.guesser.id === Hub.myId;
      const top = `<div class="gp-ph-score">${['red', 'blue'].map(tm => `<span class="team-${tm} ${tm === my ? 'mine' : ''}">${UI.TEAM_ART[tm]} ${num(g.scores[tm])}</span>`).join('<i>:</i>')}</div>`;
      let body = '';
      let key = st + g.round;
      if (st === 'hiding') {
        if (amHider) { body = `<h2>🌹 ${esc(t('gp.youHide'))}</h2><p>${esc(t('gp.youHideSub'))}${g.hideEndsAt ? ` <span class="pill" data-ends="${g.hideEndsAt}"></span>` : ''}</p>${handsGrid(g, { tappable: true })}`; key += 'hider'; }
        else if (hiding) body = `<div class="gp-big-ico">🤫</div><h2>${esc(t('gp.teamHiding', { name: g.hider ? g.hider.name : '?' }))}</h2><p>${esc(t('gp.holdFists'))}</p>`;
        else body = `<div class="gp-big-ico">🙈</div><h2>${esc(t('gp.noPeeking'))}</h2><p>${esc(t('gp.otherHiding', { team: UI.teamName(g.hidingTeam) }))}</p>`;
      } else if (st === 'guessing') {
        if (hiding) {
          const gol = g.gol;
          const mine = gol && gol.pid === Hub.myId;
          const secret = mine
            ? `<span class="peek-big">🌹</span><b>${esc(t('gp.inYourHand', { hand: t(gol.hand === 'L' ? 'gp.leftHand' : 'gp.rightHand') }))}</b>`
            : amHider && gol
              ? `<span class="peek-big">🤝</span><b>${esc(t('gp.youPutIt', { name: Hub.playerName(gol.pid), hand: t(gol.hand === 'L' ? 'gp.leftPlain' : 'gp.rightPlain') }))}</b>`
              : `<span class="peek-big">😏</span><b>${esc(t('gp.emptyBluff'))}</b>`;
          body = `<h2>${esc(t('gp.pokerFace'))}</h2>
            <div class="gp-peek" id="gp-peek"><div class="peek-cover"><span>👁️</span>${esc(t('gp.holdToPeek'))}</div><div class="peek-secret">${secret}</div></div>
            <p class="muted small">${esc(t('gp.guesserIs', { name: g.guesser ? g.guesser.name : '?' }))}</p>`;
          key += 'hid' + (mine ? 'm' : '') + (amHider ? 'h' : '');
        } else if (amGuesser) {
          if (selected && !g.hands.some(h => h.key === selected && !h.open)) selected = null;
          body = `<h2>👉 ${esc(t('gp.yourCall'))}</h2>
            ${handsGrid(g, { tappable: !g.pending, selected })}
            <div class="gp-calls ${selected && !g.pending ? 'show' : ''}">
              <button class="gp-call pooch" data-call="pooch">💨 ${esc(t('gp.callPooch'))}<small>${esc(t('gp.poochMeans'))}</small></button>
              <button class="gp-call gol" data-call="gol">🌹 ${esc(t('gp.callGol'))}<small>${esc(t('gp.golMeans'))}</small></button>
            </div>
            <p class="muted small">${esc(g.pending ? t('gp.opening') : selected ? t('gp.nowCall') : t('gp.pickHand'))}</p>`;
          key = null;
        } else {
          const mine = (g.suggestions || []).find(x => x.id === Hub.myId);
          body = `<h2>${esc(t('gp.helpCaptain', { name: g.guesser ? g.guesser.name : '?' }))}</h2>
            ${handsGrid(g, { tappable: !g.pending, mySuggest: mine ? mine.key : null })}
            <p class="muted small">${esc(t('gp.suggestHint'))}</p>`;
          key = null;
        }
      } else if (st === 'reveal' && g.result) {
        const iWon = g.result.winner === my;
        body = `<div class="gp-big-ico">${iWon ? '🎉' : resultIcon(g.result)}</div>
          <h2>${esc(resultLine(g))}</h2>
          <p class="muted">${esc(t('gp.nextSoon'))}</p>`;
        key += 'res';
        if (el.dataset.res !== key) { el.dataset.res = key; Hub.vibrate(iWon ? [60, 40, 120] : 200); }
      }
      const html = `${myBadge}${top}<div class="gp-ph-body">${body}</div>`;
      if (key) Hub.screen(el, key + Hub.lang + JSON.stringify(g.hands), html);
      else { el.innerHTML = html; el.dataset.k = ''; }
      if (peeking) { const pad = document.getElementById('gp-peek'); if (pad) pad.classList.add('peeking'); }
    },
    events: {
      'gp:holding': () => Hub.vibrate([120, 60, 120, 60, 240]),
      'gp:pending': () => Hub.vibrate(30),
    },
  };

  // =============== host ===============
  let peekHost = false;
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="gp-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:golpooch:settings');
      UI.bindTeamEditor(root, 'golpooch');
      root.addEventListener('click', (e) => {
        if (e.target.closest('#gp-peek-host')) { peekHost = !peekHost; host.update(Hub.state); }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('gp-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        Hub.screen(el, 'lobby' + st + JSON.stringify([g.settings, g.teams, g.scores, g.winner]), `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? `🏆 ${UI.teamName(g.winner)} win ${g.scores[g.winner]}–${g.scores[other(g.winner)]}` : '🌹 Gol ya Pooch'}</h2>
            <p class="muted small">Two teams. The hiding team's captain picks which hand gets the flower on their phone; the other captain opens hands — "Pooch" (empty) or "Gol!". Captains rotate every round.</p>
            <div class="h-btns"><button class="primary big-btn" data-emit="host:golpooch:start" ${g.teams.every(x => x.members.length) ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
            <button data-emit="host:golpooch:shuffle" ${st === 'lobby' ? '' : 'disabled'}>🔀 Shuffle teams</button></div>
            ${g.teams.every(x => x.members.length) ? '' : '<p class="muted small">Each team needs at least one player.</p>'}
          </section>
          <section class="h-card"><h2>Teams <span class="muted small">tap a name to switch team</span></h2>${UI.teamEditor(g.teams, 'golpooch')}</section>
          <section class="h-card"><h2>Settings</h2><div class="h-fields">${UI.hostField('Points to win', UI.numberInput('target', g.settings.target, 1, 30))}${UI.hostField('Seconds to hide (0 = no limit)', UI.numberInput('hideSeconds', g.settings.hideSeconds, 0, 120, 5), 'Then the flower goes to a random hand')}</div></section>
          ${st === 'final' && g.awards.length ? `<section class="h-card span2"><h2>Awards</h2>${awardCards(g)}</section>` : ''}`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const statusText = st === 'hiding' ? `${UI.teamName(g.hidingTeam)} are hiding — ${g.hider ? g.hider.name : '?'} picks the hand.`
        : st === 'guessing' ? (g.pending ? `Opening ${Hub.playerName(g.pending.key.split(':')[0])}'s hand…` : `${g.guesser ? g.guesser.name : '?'} (${UI.teamName(other(g.hidingTeam))}) is choosing.`)
        : `Round over: ${resultLine(g)}`;
      const sg = g.secretGol;
      el.innerHTML = `<section class="h-card span2 h-hero">
          <div class="gp-h-score">${['red', 'blue'].map(tm => `<span class="team-${tm}">${UI.teamBadge(tm)} <b>${g.scores[tm]}</b></span>`).join('')}<span class="muted small">first to ${g.settings.target}</span></div>
          <p class="h-status">${esc(statusText)}</p>
          <div class="h-btns">
            ${st === 'hiding' ? '<button data-emit="host:golpooch:hideRandom">🎲 Hide it randomly (if the captain is stuck)</button>' : ''}
            ${st === 'guessing' && !g.pending ? '<button data-emit="host:golpooch:newCaptain">🔄 Give the call to another teammate</button>' : ''}
            ${st === 'reveal' && !g.winner ? '<button class="primary" data-emit="host:golpooch:next">Next round now ▶</button>' : ''}
            <button id="gp-peek-host">${peekHost ? '🙈 Hide' : '👁 Peek where it is'}</button>
            <button class="danger" data-emit="host:golpooch:newGame" data-confirm="Tap again to reset">Reset game</button>
          </div>
          ${peekHost ? `<p class="h-secret">${sg ? `🌹 ${esc(Hub.playerName(sg.pid))} — ${sg.hand === 'L' ? 'left' : 'right'} hand` : 'Not hidden yet.'}</p>` : ''}
        </section>
        <section class="h-card span2"><h2>Hands</h2>${handsGrid(g, {})}</section>`;
    },
  };

  Hub.register('golpooch', { tv, player, host });
})();

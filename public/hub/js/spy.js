// Spy (جاسوس) — TV, phone and host views. Server logic: games/spy.js.
(function () {
  const { t, num, esc, avatar } = Hub;
  const CAT_EMOJI = { place: '📍', city: '🏙️', food: '🍲', job: '🧑‍🔧', animal: '🐘', sport: '⚽', object: '🧸' };
  const spyWonRound = (g) => g.outcome !== 'caught' && g.outcome !== 'earlyWrong';
  const catLabel = (c) => t(`spy.cat.${c}`);

  function board(g, opts = {}) {
    return `<div class="spy-board">${g.board.map((w, i) => `<${opts.tappable ? 'button' : 'div'} class="spy-tile ${g.word === w ? 'answer' : ''} ${g.guess === w ? 'guessed' : ''}" ${opts.tappable ? `data-guess="${esc(w)}"` : ''} style="--i:${i}" dir="auto">${esc(w)}</${opts.tappable ? 'button' : 'div'}>`).join('')}</div>`;
  }
  function outcomeText(g) {
    const spies = g.players.filter(p => p.spy).map(p => p.name).join(Hub.lang === 'fa' ? ' و ' : ' & ');
    if (g.outcome === 'escaped') return t('spy.escaped', { name: spies });
    if (g.outcome === 'guessed') return t('spy.guessedIt', { name: spies });
    if (g.outcome === 'earlyRight') return t('spy.earlyRight', { name: spies });
    if (g.outcome === 'earlyWrong') return t('spy.earlyWrong', { name: spies });
    return t('spy.caught', { name: spies });
  }

  // =============== TV ===============
  const tv = {
    mount(root) { root.innerHTML = '<div class="spy-tv" id="spy-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('spy-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.settings), () => UI.tvLobby('spy', `<div class="ef-lobby-cats">${g.settings.categories.map(c => `<span class="ef-cat"><span>${CAT_EMOJI[c]}</span>${esc(catLabel(c))}</span>`).join('')}</div>
          <p class="lobby-meta">${esc(t('spy.roundsN', { n: num(g.settings.rounds) }))} ${Hub.SEP} ⏱ ${num(g.settings.minutes)}′</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      const head = `<div class="spy-head"><span class="spy-cat">${CAT_EMOJI[g.cat]} ${esc(catLabel(g.cat))}</span><span class="eyebrow">${esc(t('spy.roundOf', { n: num(g.round), of: num(g.settings.rounds) }))}</span></div>`;
      if (st === 'cards') {
        Hub.screen(el, 'cards' + g.round + Hub.lang, `<div class="spy-scene">
          ${head}<div class="spy-big">🕵️</div><h1>${esc(t('spy.checkCard'))}</h1><p>${esc(t('spy.checkCardSub', { n: num(g.spyCount) }))}</p>
          <p class="mf-progress" id="spy-seen"></p></div>`);
        document.getElementById('spy-seen').textContent = t('mf.seenN', { n: num(g.seenCount), of: num(g.players.length) });
        return;
      }
      if (st === 'talk') {
        if (Hub.screen(el, 'talk' + g.round + Hub.lang, `<div class="spy-scene talk">
          ${head}
          <div class="spy-talk-row"><div><h1>${esc(t('spy.askAway'))}</h1><p>🎤 ${esc(t('spy.firstAsker', { name: g.firstAsker ? g.firstAsker.name : '' }))}</p></div>
          <span class="mf-clock" data-ends="${g.endsAt}" data-format="clock"></span></div>
          <div class="spy-order"><span class="muted">${esc(t('spy.order'))}</span>${g.order.map((p, i) => `${i ? '<i>→</i>' : ''}<span class="spy-order-chip">${avatar(p.name)}<bdi>${esc(p.name)}</bdi></span>`).join('')}<i>↺</i></div>
          ${board(g)}
          <p class="muted">${esc(t('spy.boardHint'))}</p></div>`)) Hub.sfx.sparkle();
        return;
      }
      if (st === 'vote') {
        Hub.screen(el, 'vote' + g.round + Hub.lang, `<div class="spy-scene">
          ${head}<div class="spy-big">🔎</div><h1>${esc(t('spy.whoIsSpy'))}</h1>
          <div class="ml-voting" id="spy-voting"></div></div>`);
        const voted = new Set(g.votes);
        document.getElementById('spy-voting').innerHTML = g.players.map(p => `<span class="ml-vchip ${voted.has(p.id) ? 'in' : ''}">${avatar(p.name)}<i>${voted.has(p.id) ? '✓' : ''}</i></span>`).join('');
        return;
      }
      if (st === 'guess') {
        if (Hub.screen(el, 'guess' + g.round + Hub.lang, `<div class="spy-scene">
          ${head}<h1>🕵️ ${esc(t(g.early ? 'spy.earlyCall' : 'spy.wasSpy', { name: g.accused ? g.accused.name : '' }))}</h1>
          <p>${esc(t(g.early ? 'spy.earlySub' : 'spy.lastChance'))} <span class="pill" data-ends="${g.endsAt}"></span></p>
          ${board(g)}</div>`)) { Hub.stamp(t(g.early ? 'spy.bold' : 'spy.gotcha'), 'gold'); Hub.sfx.alarm(); }
        return;
      }
      if (st === 'result') {
        const spyWon = spyWonRound(g);
        if (Hub.screen(el, 'result' + g.round + Hub.lang, `<div class="spy-scene result ${spyWon ? 'spy-won' : 'town-won'}">
          ${head}
          <h1>${spyWon ? '🕵️' : '🎉'} ${esc(outcomeText(g))}</h1>
          <p class="spy-word-reveal">${esc(t('spy.theWordWas'))} <b dir="auto">${esc(g.word)}</b></p>
          ${g.accused && !g.players.find(p => p.id === g.accused.id && p.spy) ? `<p class="muted">${esc(t('spy.wrongAccused', { name: g.accused.name }))}</p>` : ''}
          ${board(g)}</div>`)) { if (spyWon) Hub.sfx.buzzer(); else { Hub.sfx.fanfare(); Hub.confetti(90); } }
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, `<div class="final-screen"><p class="eyebrow">${esc(t('core.gameOver'))}</p><h1>🕵️ ${esc(t('game.spy.name'))}</h1>
          ${UI.podium(g.standings, r => r.points, r => r.name)}</div>`)) { Hub.confetti(150); Hub.sfx.fanfare(); }
      }
    },
  };

  // =============== phone ===============
  let showCard = false;
  const player = {
    mount(root) {
      root.innerHTML = '<div class="spy-ph" id="spy-ph"></div>';
      showCard = false;
      root.addEventListener('click', (e) => {
        if (e.target.closest('#spy-card')) { showCard = !showCard; Hub.vibrate(15); player.update(Hub.state); return; }
        if (e.target.closest('#spy-seen')) { Hub.emit('player:spy:seen'); showCard = false; return; }
        const v = e.target.closest('[data-spyvote]');
        if (v) { Hub.emit('player:spy:vote', { target: v.dataset.spyvote }); Hub.vibrate(20); return; }
        const w = e.target.closest('[data-guess]');
        if (w) { Hub.emit('player:spy:guess', { word: w.dataset.guess }); Hub.vibrate([40, 30, 80]); return; }
        // "I know the word!" takes two taps — it ends the round on the spot.
        const eg = e.target.closest('#spy-early');
        if (eg) {
          if (!eg.classList.contains('armed')) { eg.classList.add('armed'); eg.textContent = t('spy.earlySure'); setTimeout(() => { eg.classList.remove('armed'); eg.textContent = `🕵️ ${t('spy.iKnow')}`; }, 3000); return; }
          Hub.emit('player:spy:earlyGuess'); Hub.vibrate([60, 40, 120]);
        }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('spy-ph');
      const st = g.status;
      const me = g.me;
      if (st === 'lobby') { Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('spy')); return; }
      if (st === 'final') {
        const mine = g.standings.find(r => r.id === Hub.myId);
        Hub.screen(el, 'final' + Hub.lang, `<div class="ph-result"><p class="eyebrow">${esc(t('core.gameOver'))}</p><div class="big-rank">🕵️</div>
          <p class="big-score">${num(mine ? mine.points : 0)} <small>${esc(t('core.pts'))}</small></p>
          <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
        return;
      }
      if (!me) { Hub.screen(el, 'spect' + st + Hub.lang, `<div class="mf-ph-msg"><div class="gp-big-ico">🍿</div><h2>${esc(t('spy.nextRound'))}</h2></div>`); return; }
      const card = `<button class="mf-card spy-card ${showCard ? 'open' : ''} ${me.spy ? 'bad' : ''}" id="spy-card">
        <span class="mf-card-front"><span class="mf-card-ico">🂠</span><b>${esc(t('mf.tapReveal'))}</b></span>
        <span class="mf-card-face">${me.spy
          ? `<span class="mf-card-ico">🕵️</span><b>${esc(t('spy.youAreSpy'))}</b><small>${esc(t('spy.spyHint', { cat: catLabel(g.cat) }))}</small>${me.fellowSpies.length ? `<span class="mf-team">${esc(t('spy.fellow'))}: ${esc(me.fellowSpies.join(', '))}</span>` : ''}`
          : `<span class="mf-card-ico">${CAT_EMOJI[g.cat]}</span><small>${esc(catLabel(g.cat))}</small><b dir="auto">${esc(me.word)}</b><small>${esc(t('spy.wordHint'))}</small>`}</span></button>`;
      if (st === 'cards') {
        Hub.screen(el, 'cards' + g.round + showCard + me.seen + Hub.lang, `<div class="mf-ph-roles"><h2>${esc(t('spy.yourCard'))}</h2>${card}
          ${me.seen ? `<p class="muted">✓ ${esc(t('mf.waitOthers'))}</p>` : `<button class="primary" id="spy-seen" ${showCard ? '' : 'disabled'}>✓ ${esc(t('mf.gotIt'))}</button>`}</div>`);
        return;
      }
      if (st === 'talk') {
        Hub.screen(el, 'talk' + g.round + showCard + Hub.lang, `<div class="mf-ph-day"><p class="eyebrow">🎤 ${esc(t('spy.askAway'))}</p>
          <p class="mf-ph-clock" data-ends="${g.endsAt}" data-format="clock"></p>${card}<p class="muted small">${esc(t('mf.tapCard'))}</p>
          ${me.spy ? `<button class="spy-early" id="spy-early">🕵️ ${esc(t('spy.iKnow'))}</button><p class="muted small">${esc(t('spy.iKnowSub'))}</p>` : ''}</div>`);
        return;
      }
      if (st === 'vote') {
        el.innerHTML = `<div class="mf-ph-vote"><h2>${esc(t('spy.whoIsSpy'))}</h2><div class="mf-targets">${g.players.filter(p => p.id !== Hub.myId).map(p => `<button class="mf-target ${me.vote === p.id ? 'on' : ''}" data-spyvote="${esc(p.id)}">${avatar(p.name)}<span>${esc(p.name)}</span></button>`).join('')}</div></div>`;
        return;
      }
      if (st === 'guess') {
        const amAccused = g.accused && g.accused.id === Hub.myId;
        Hub.screen(el, 'guess' + g.round + amAccused + Hub.lang, amAccused
          ? `<div class="spy-ph-guess"><h2>🕵️ ${esc(t(g.early ? 'spy.goForIt' : 'spy.youreCaught'))}</h2><p>${esc(t('spy.pickWord'))} <span class="pill" data-ends="${g.endsAt}"></span></p>${board(g, { tappable: true })}</div>`
          : `<div class="mf-ph-msg"><div class="gp-big-ico">🤞</div><h2>${esc(t('spy.spyGuessing', { name: g.accused ? g.accused.name : '' }))}</h2></div>`);
        return;
      }
      if (st === 'result') {
        const spyWon = spyWonRound(g);
        const iWon = me.spy ? spyWon : !spyWon;
        Hub.screen(el, 'result' + g.round + Hub.lang, `<div class="ph-result"><div class="big-rank">${iWon ? '🎉' : '😅'}</div><h2>${esc(outcomeText(g))}</h2>
          <p class="spy-word-reveal">${esc(t('spy.theWordWas'))} <b dir="auto">${esc(g.word)}</b></p>
          <p class="gain ${iWon ? '' : 'miss'}">${Hub.signed(iWon ? (me.spy ? (g.outcome === 'earlyRight' ? 3 : 2) : 1) : 0)} ${esc(t('core.pts'))}</p></div>`);
      }
    },
    events: { 'spy:cards': () => { showCard = false; Hub.vibrate([60, 40, 60]); } },
  };

  // =============== host ===============
  let peek = false;
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="spy-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:spy:settings');
      root.addEventListener('click', (e) => {
        if (e.target.closest('#spy-peek')) { peek = !peek; host.update(Hub.state); }
        const c = e.target.closest('[data-spycat]');
        if (c) {
          const cats = Hub.state.game.settings.categories.slice();
          const i = cats.indexOf(c.dataset.spycat);
          if (i >= 0) { if (cats.length > 1) cats.splice(i, 1); } else cats.push(c.dataset.spycat);
          Hub.emit('host:spy:settings', { categories: cats });
        }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('spy-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        Hub.screen(el, st + JSON.stringify(g.settings) + g.lobbyCount, `<section class="h-card span2 h-hero">
          <h2>${st === 'final' ? '🏆 Game over' : '🕵️ Spy'}</h2>
          <p class="muted small">Everyone's phone shows the same secret word except the spy's. Players question each other out loud, then vote. A caught spy can still win by guessing the word from the board on the TV. Needs 3+ players.</p>
          <button class="primary big-btn" data-emit="host:spy:start" ${g.lobbyCount >= 3 ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
          <div class="roster">${UI.hostRoster(s.players)}</div></section>
          <section class="h-card"><h2>Settings</h2><div class="h-fields">
            ${UI.hostField('Rounds', UI.numberInput('rounds', g.settings.rounds, 1, 20))}
            ${UI.hostField('Minutes of questions', UI.numberInput('minutes', g.settings.minutes, 1, 15))}
            ${UI.hostField('Spies (0 = automatic: 2 with 8+ players)', UI.numberInput('spies', g.settings.spies, 0, 3))}
          </div>
          <h3>Categories</h3><div class="cat-picker">${g.categoriesAll.map(c => `<button class="cat-pick ${g.settings.categories.includes(c) ? 'on' : ''}" data-spycat="${c}">${CAT_EMOJI[c]} ${esc(HUB_STRINGS.en[`spy.cat.${c}`])} <span class="fa-name">${esc(HUB_STRINGS.fa[`spy.cat.${c}`])}</span></button>`).join('')}</div></section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const next = { cards: ['host:spy:talk', 'Start the questions ▶'], talk: ['host:spy:vote', 'Time to vote 🗳️'], vote: ['host:spy:closeVote', 'Close the vote'], result: ['host:spy:next', g.round >= g.settings.rounds ? 'Final results 🏆' : 'Next round ▶'] }[st];
      el.innerHTML = `<section class="h-card span2 h-hero">
        <p class="eyebrow">Round ${g.round} of ${g.settings.rounds} · ${CAT_EMOJI[g.cat]} ${esc(HUB_STRINGS.en[`spy.cat.${g.cat}`])}</p>
        <h2>${esc({ cards: 'Players are checking their cards', talk: 'Questions round', vote: 'Voting', guess: 'The spy is guessing the word', result: 'Round over' }[st])} ${g.endsAt ? `<span class="h-timer" data-ends="${g.endsAt}" data-format="clock"></span>` : ''}</h2>
        <p class="h-status">${st === 'cards' ? `${g.seenCount} of ${g.players.length} have looked` : st === 'vote' ? `${g.votes.length} of ${g.players.length} voted` : st === 'result' ? esc(outcomeText(g)) : ''}</p>
        <div class="h-btns">${next ? `<button class="primary big-btn" data-emit="${next[0]}">${next[1]}</button>` : ''}
          <button id="spy-peek">${peek ? '🙈 Hide' : '👁 Peek (only if you\'re not playing)'}</button>
          <button class="danger" data-emit="host:spy:end" data-confirm="Tap again to end">End game</button></div>
        ${peek ? `<p class="h-secret">Word: <b dir="auto">${esc(g.secretWord || '')}</b> · Spy: ${esc((g.spies || []).map(x => x.name).join(', '))}</p>` : ''}
      </section>
      <section class="h-card"><h2>Points</h2>${g.standings.map(r => `<div class="trophy-row">${avatar(r.name)} <b>${esc(r.name)}</b> ${r.points}</div>`).join('') || '<p class="muted small">No points yet.</p>'}</section>`;
    },
  };

  Hub.register('spy', { tv, player, host });
})();

// Pantomime (پانتومیم) — TV, phone and host views. Server logic: games/pantomime.js.
(function () {
  const { t, num, esc, avatar } = Hub;
  const CAT_EMOJI = { movie: '🎬', proverb: '📜', job: '🧑‍🔧', animal: '🐘', action: '🏃', object: '🧸', sport: '⚽', food: '🍲', famous: '🗿', adult: '🔞', custom: '✍️' };
  // The 🔞 18+ category is never on by default; when it is, everyone is told in the lobby.
  const adultMode = (g) => (!g.settings.categories.includes('adult') ? null : g.settings.categories.length === 1 ? 'only' : 'on');
  const adultNote = (g) => (adultMode(g) ? `<div class="pm-adult-card"><span class="pm-adult-ico">🔞</span><p>${esc(t(adultMode(g) === 'only' ? 'pm.adultOnly' : 'pm.adultOn'))}</p></div>` : '');
  const catLabel = (c) => t(`pm.cat.${c}`);
  const stars = (n) => '★'.repeat(n || 1);

  // Phones: write words for the OTHER teams to act (classic rule — your rivals pick your word).
  function writePanel() {
    return `<div class="pm-write">
      <h3>✍️ ${esc(t('pm.writeTitle'))}</h3><p class="muted small">${esc(t('pm.writeSub'))}</p>
      <div class="pm-write-row"><input type="text" id="pm-word-input" maxlength="40" dir="auto" autocomplete="off" placeholder="${esc(t('pm.writePh'))}" enterkeyhint="done"><button class="primary" data-addword>+</button></div>
      <div class="pm-mywords" id="pm-mywords"></div></div>`;
  }
  function renderMyWords(g) {
    const box = document.getElementById('pm-mywords');
    if (!box) return;
    const words = g.myWords || [];
    const k = JSON.stringify(words);
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    box.innerHTML = words.map((w, i) => `<span class="pm-myword"><bdi>${esc(w)}</bdi><button data-rmword="${i}" aria-label="Remove">✕</button></span>`).join('') || `<span class="muted small">${esc(t('pm.writeNone'))}</span>`;
  }
  function offerCards(g, tappable) {
    return `<div class="pm-offer">${(g.offer || []).map((w, i) => `<${tappable ? 'button' : 'div'} class="pm-offer-card ${w.points > 1 ? 'hard' : 'easy'} cat-${w.cat}" ${tappable ? `data-choose="${i}"` : ''}>
      <span class="pm-wc-cat">${CAT_EMOJI[w.cat] || ''} ${esc(catLabel(w.cat))}</span><b dir="auto">${esc(w.text)}</b>
      <span class="pm-pts">${stars(w.points)} ${esc(t(w.points > 1 ? 'pm.hard' : 'pm.easy', { n: num(w.points) }))}</span>
      ${w.by ? `<small>✍️ ${esc(t('pm.by', { name: w.by }))}</small>` : ''}</${tappable ? 'button' : 'div'}>`).join('')}</div>`;
  }
  const RESULT_ICON = { correct: '✅', skip: '⏭', missed: '⌛' };

  function teamScores(g, vertical) {
    const best = Math.max(...g.teams.map(x => g.scores[x.id]));
    return `<div class="pm-scores ${vertical ? 'vertical' : ''}">${g.teams.map(tm => `<div class="pm-score team-${tm.id} ${g.team === tm.id ? 'acting' : ''} ${best > 0 && g.scores[tm.id] === best ? 'lead' : ''}">
      ${UI.teamBadge(tm.id)}<b>${num(g.scores[tm.id])}</b></div>`).join('')}</div>`;
  }
  function wordTiles(n) {
    return `<div class="pm-tiles">${Array.from({ length: Math.max(1, n) }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>`;
  }
  function turnList(g) {
    return `<div class="pm-turnlist">${g.turnLog.map((w, i) => `<div class="pm-tw ${w.result}" style="--i:${i}"><span>${RESULT_ICON[w.result]}</span><b dir="auto">${esc(w.text || '')}</b><small>${CAT_EMOJI[w.cat]}${w.result === 'correct' ? ` ${Hub.signed(w.points || 1)}` : ''}</small></div>`).join('') || `<p class="muted">${esc(t('pm.noWords'))}</p>`}</div>`;
  }

  // =============== TV ===============
  let lastCorrect = -1;
  const tv = {
    mount(root) { root.innerHTML = '<div class="pm-tv" id="pm-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('pm-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.teams) + JSON.stringify(g.settings) + g.customCount, () => UI.tvLobby('pantomime', `
          <div class="gp-lobby-teams">${g.teams.map(tm => `<div class="gp-lt team-${tm.id}">${UI.teamBadge(tm.id)}<div>${tm.members.map(m => `<span class="who-chip">${avatar(m.name)}<span>${esc(m.name)}</span></span>`).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>
          <p class="lobby-meta">⏱ ${num(g.settings.seconds)}″ ${Hub.SEP} ${esc(t('pm.turnsEach', { n: num(g.settings.turns) }))} ${Hub.SEP} ⏭ ${esc(t('pm.skipsN', { n: num(g.settings.skips) }))}${g.settings.choice ? ` ${Hub.SEP} ★ ${esc(t('pm.choiceRule'))}` : ''}</p>
          ${g.settings.customWords ? `<p class="lobby-meta pm-written">✍️ ${esc(t('pm.writtenCount', { n: num(g.customCount) }))}</p>` : ''}`, adultNote(g)));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'ready') {
        Hub.screen(el, 'ready' + g.turnNo + (g.actor ? g.actor.id : '') + Hub.lang, `<div class="pm-ready team-${g.team}">
          ${teamScores(g)}
          <div class="pm-spot">
            <div class="pm-spot-light"></div>
            ${avatar(g.actor ? g.actor.name : '?', 'pm-actor-av')}
            <p class="eyebrow">${esc(t('pm.turnOf', { n: num(g.turnNo + 1), of: num(g.totalTurns) }))} ${Hub.SEP} ${UI.teamBadge(g.team)}</p>
            <h1>${esc(t('pm.isUp', { name: g.actor ? g.actor.name : '?' }))}</h1>
            <p>${esc(t('pm.pressStart'))}</p>
          </div></div>`);
        return;
      }
      if (st === 'acting') {
        const fresh = Hub.screen(el, 'act' + g.turnNo + Hub.lang, `<div class="pm-act team-${g.team}">
          <section class="pm-act-main">
            <p class="eyebrow">${UI.teamBadge(g.team)} ${Hub.SEP} 🎭 ${esc(g.actor ? g.actor.name : '')}</p>
            ${Hub.ring(g.endsAt, g.settings.seconds, 'pm-ring')}
            <div class="pm-clue" id="pm-clue"></div>
          </section>
          <aside class="pm-act-side">
            <div class="pm-count"><span id="pm-count">0</span><small>${esc(t('pm.points'))}</small></div>
            <div class="pm-dots" id="pm-dots"></div>
            ${teamScores(g, true)}
          </aside></div>`);
        if (fresh) lastCorrect = -1;
        const ring = el.querySelector('.pm-ring');
        ring.dataset.ends = g.endsAt;
        Hub.screen(document.getElementById('pm-clue'), (g.choosing ? 'choosing' : (g.wordCat || '') + g.wordCount) + g.turnLog.length, g.choosing
          ? `<span class="pm-cat choosing">🤔 ${esc(t('pm.choosing', { name: g.actor ? g.actor.name : '' }))}</span><span class="pm-wc">★ ${esc(t('pm.choiceRule'))}</span>`
          : `<span class="pm-cat cat-${g.wordCat}">${CAT_EMOJI[g.wordCat] || '❔'} ${esc(g.wordCat ? catLabel(g.wordCat) : '')}</span>
          ${wordTiles(g.wordCount)}
          <span class="pm-wc">${esc(t('pm.words', { n: num(g.wordCount) }))}</span>
          <span class="pm-worth ${g.wordPoints > 1 ? 'hard' : ''}">${stars(g.wordPoints)} ${esc(t('pm.worth', { n: num(g.wordPoints) }))}</span>
          ${g.wordBy ? `<span class="pm-by">✍️ ${esc(t('pm.by', { name: g.wordBy }))}</span>` : ''}`);
        const count = document.getElementById('pm-count');
        count.textContent = num(g.pointsThisTurn);
        if (g.pointsThisTurn !== lastCorrect) {
          if (lastCorrect >= 0 && g.pointsThisTurn > lastCorrect) { count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump'); }
          lastCorrect = g.pointsThisTurn;
        }
        document.getElementById('pm-dots').innerHTML = g.turnLog.map(w => `<i class="${w.result}">${RESULT_ICON[w.result]}</i>`).join('');
        el.querySelector('.pm-scores').outerHTML = teamScores(g, true);
        return;
      }
      if (st === 'turnEnd') {
        if (Hub.screen(el, 'end' + g.turnNo + Hub.lang, `<div class="pm-end team-${g.team}">
          <h1>⌛ ${esc(t('pm.timeUp'))}</h1>
          <p class="pm-end-sum">${UI.teamBadge(g.team)} <b>${Hub.signed(g.pointsThisTurn)}</b></p>
          ${turnList(g)}
          ${teamScores(g)}
        </div>`)) Hub.sfx.fanfare();
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, () => {
          const ranked = g.teams.slice().sort((a, b) => g.scores[b.id] - g.scores[a.id]);
          const best = g.scores[ranked[0].id];
          const max = Math.max(1, best);
          return `<div class="final-screen pm-final">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <h1>🎭 ${esc(ranked.filter(x => g.scores[x.id] === best).map(x => UI.teamName(x.id)).join(' & '))} ${esc(t('pm.win'))}</h1>
            <div class="pm-bars">${ranked.map((tm, i) => `<div class="pm-bar team-${tm.id}" style="--h:${(g.scores[tm.id] / max) * 100}%;--i:${i}">
              <b>${num(g.scores[tm.id])}</b><div class="pm-bar-fill"></div>${UI.teamBadge(tm.id)}
              <div class="pm-bar-members">${tm.members.map(m => avatar(m.name)).join('')}</div></div>`).join('')}</div>
            ${g.mvp ? `<p class="pm-mvp">🌟 ${esc(t('pm.mvp', { name: g.mvp.name, n: num(g.mvp.points) }))}</p>` : ''}
          </div>`;
        })) { Hub.confetti(170); Hub.sfx.fanfare(); }
      }
    },
    tick(s) {
      const g = s.game;
      if (g.status !== 'acting' || !g.endsAt) return;
      const left = Hub.secondsLeft(g.endsAt);
      if (left <= 10 && left > 0 && tv._lastTick !== left) { tv._lastTick = left; Hub.sfx.tick(); }
    },
    events: {
      'pm:correct': () => { Hub.sfx.chime(); Hub.flash('rgba(52,211,153,.3)'); },
      'pm:timeUp': () => { Hub.sfx.buzzer(); Hub.stamp(t('pm.timeUp'), 'stop'); },
    },
  };

  // =============== phone ===============
  const player = {
    mount(root) {
      root.innerHTML = '<div class="pm-ph" id="pm-ph"></div>';
      const addWord = () => {
        const input = document.getElementById('pm-word-input');
        if (!input || !input.value.trim()) return;
        Hub.emit('player:pantomime:addWord', { text: input.value });
        input.value = '';
        Hub.vibrate(15);
      };
      root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pm-word-input') addWord(); });
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-addword]')) { addWord(); return; }
        const rm = e.target.closest('[data-rmword]');
        if (rm) { Hub.emit('player:pantomime:removeWord', { index: Number(rm.dataset.rmword) }); return; }
        const ch = e.target.closest('[data-choose]');
        if (ch) { Hub.emit('player:pantomime:choose', { index: Number(ch.dataset.choose) }); Hub.vibrate(30); return; }
        const b = e.target.closest('[data-pm]');
        if (!b || b.disabled) return;
        Hub.emit(`player:pantomime:${b.dataset.pm}`);
        Hub.vibrate(b.dataset.pm === 'correct' ? [40, 30, 80] : 30);
        // Brief lock so a double tap doesn't burn the next word.
        b.disabled = true;
        setTimeout(() => { b.disabled = false; }, 650);
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('pm-ph');
      const st = g.status;
      const me = Hub.myId;
      const amActor = g.actor && g.actor.id === me;
      const myBadge = g.myTeam ? `<div class="ph-team">${esc(t('gp.youreOn'))} ${UI.teamBadge(g.myTeam)}</div>` : '';
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + g.myTeam + g.settings.customWords + adultMode(g), UI.phoneLobby('pantomime', myBadge + adultNote(g) + (g.settings.customWords ? writePanel() : '')));
        renderMyWords(g);
        return;
      }
      if (st === 'final') {
        const best = Math.max(...g.teams.map(x => g.scores[x.id]));
        const won = g.myTeam && g.scores[g.myTeam] === best;
        Hub.screen(el, 'final' + Hub.lang, `<div class="ph-result"><div class="big-rank">${won ? '🏆' : '🎭'}</div>
          <h1>${esc(won ? t('pm.youWon') : t('pm.goodGame'))}</h1>${teamScores(g)}
          <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
        return;
      }
      if (st === 'ready') {
        if (amActor) {
          Hub.screen(el, 'ready-me' + g.turnNo + Hub.lang, `<div class="pm-ph-ready me">
            <div class="gp-big-ico">🎭</div><h1>${esc(t('pm.yourTurn'))}</h1><p>${esc(t('pm.noTalking'))}</p>
            <button class="primary pm-go" data-pm="go">▶ ${esc(t('pm.start'))}</button></div>`);
          if (el.dataset.vib !== 'r' + g.turnNo) { el.dataset.vib = 'r' + g.turnNo; Hub.vibrate([100, 50, 100]); }
        } else {
          const mine = g.myTeam === g.team;
          Hub.screen(el, 'ready' + g.turnNo + mine + Hub.lang, `<div class="pm-ph-ready">${myBadge}
            <div class="gp-big-ico">${mine ? '🗣️' : '🤫'}</div>
            <h2>${esc(t(mine ? 'pm.getReadyGuess' : 'pm.otherTeamUp', { name: g.actor ? g.actor.name : '?', team: UI.teamName(g.team) }))}</h2></div>`);
        }
        return;
      }
      if (st === 'acting') {
        if (amActor) {
          if (g.offer) {
            Hub.screen(el, 'choose-me' + g.turnNo + JSON.stringify(g.offer) + Hub.lang, `<div class="pm-ph-act">
              <div class="pm-ph-top"><span class="pm-ph-time" data-ends="${g.endsAt}"></span><span class="pm-ph-got">★ <b>${num(g.pointsThisTurn)}</b></span></div>
              <h2 class="pm-choose-title">${esc(t('pm.pickOne'))}</h2>
              ${offerCards(g, true)}
              <button class="pm-skip wide" data-pm="skip" ${g.skipsLeft > 0 ? '' : 'disabled'}>⏭ ${esc(t('pm.skipBoth'))} (${num(g.skipsLeft)})</button></div>`);
            return;
          }
          Hub.screen(el, 'act-me' + g.turnNo + Hub.lang, `<div class="pm-ph-act">
            <div class="pm-ph-top"><span class="pm-ph-time" data-ends="${g.endsAt}"></span><span class="pm-ph-got">★ <b id="pm-got"></b></span></div>
            <div class="pm-word-card" id="pm-word"></div>
            <div class="pm-ph-btns">
              <button class="pm-skip" data-pm="skip" id="pm-skip"></button>
              <button class="pm-correct" data-pm="correct">✅ ${esc(t('pm.gotItBtn'))}</button>
            </div></div>`);
          document.getElementById('pm-word').classList.toggle('cat-adult', g.wordCat === 'adult');
          Hub.screen(document.getElementById('pm-word'), g.word || '', `<span class="pm-wc-cat">${CAT_EMOJI[g.wordCat] || ''} ${esc(g.wordCat ? catLabel(g.wordCat) : '')}</span><b dir="auto">${esc(g.word || '')}</b><span class="pm-pts">${stars(g.wordPoints)} ${esc(t('pm.worth', { n: num(g.wordPoints) }))}</span>`);
          document.getElementById('pm-got').textContent = num(g.pointsThisTurn);
          const skip = document.getElementById('pm-skip');
          skip.textContent = `⏭ ${t('pm.skip')} (${num(g.skipsLeft)})`;
          if (g.skipsLeft <= 0) skip.setAttribute('disabled', '');
        } else {
          const mine = g.myTeam === g.team;
          Hub.screen(el, 'act' + g.turnNo + mine + Hub.lang, `<div class="pm-ph-watch ${mine ? 'guessing' : 'watching'}">
            <span class="pm-ph-time big" data-ends="${g.endsAt}"></span>
            ${mine ? `<div class="gp-big-ico">🗣️</div><h2>${esc(t('pm.shoutIt'))}</h2>`
              : `<p class="eyebrow">${esc(t('pm.theyAreActing'))}</p><div class="pm-word-card small" id="pm-word"></div><p class="muted small">🤫 ${esc(t('pm.keepQuiet'))}</p>`}
            <p class="pm-ph-got">★ <b id="pm-got"></b></p></div>`);
          if (!mine) document.getElementById('pm-word').classList.toggle('cat-adult', !g.offer && g.wordCat === 'adult');
          if (!mine) Hub.screen(document.getElementById('pm-word'), g.offer ? 'offer' + JSON.stringify(g.offer) : (g.word || ''), g.offer
            ? `<span class="pm-wc-cat">🤔 ${esc(t('pm.choosing', { name: g.actor ? g.actor.name : '' }))}</span>${offerCards(g, false)}`
            : `<span class="pm-wc-cat">${CAT_EMOJI[g.wordCat] || ''} ${esc(g.wordCat ? catLabel(g.wordCat) : '')}</span><b dir="auto">${esc(g.word || '')}</b>`);
          document.getElementById('pm-got').textContent = num(g.pointsThisTurn);
        }
        return;
      }
      if (st === 'turnEnd') {
        Hub.screen(el, 'end' + g.turnNo + Hub.lang, `<div class="pm-ph-end">
          <h1>⌛ ${esc(t('pm.timeUp'))}</h1><p class="big-score">${Hub.signed(g.pointsThisTurn)}</p>
          ${turnList(g)}
          ${amActor ? `<button class="primary pm-go" data-pm="next">${esc(t('pm.passOn'))} ▶</button>` : `<p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('pm.waitNext'))}</p>`}
          ${!amActor && g.settings.customWords ? writePanel() : ''}
        </div>`);
        renderMyWords(g);
      }
    },
    events: {
      'pm:timeUp': () => Hub.vibrate([300, 100, 300]),
      'pm:correct': () => {},
    },
  };

  // =============== host ===============
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="pm-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:pantomime:settings');
      UI.bindTeamEditor(root, 'pantomime');
      root.addEventListener('click', (e) => {
        const preset = e.target.closest('[data-pmcats]');
        if (preset) { Hub.emit('host:pantomime:settings', { categories: preset.dataset.pmcats.split(',') }); return; }
        const c = e.target.closest('[data-pmcat]');
        if (!c) return;
        const cats = Hub.state.game.settings.categories.slice();
        const i = cats.indexOf(c.dataset.pmcat);
        if (i >= 0) { if (cats.length > 1) cats.splice(i, 1); } else cats.push(c.dataset.pmcat);
        Hub.emit('host:pantomime:settings', { categories: cats });
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('pm-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        Hub.screen(el, 'lobby' + st + JSON.stringify([g.settings, g.teams, g.scores, g.customCount]), `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '🎭 Pantomime'}</h2>
            <p class="muted small">Teams take turns. The actor's phone shows the word with ✅ / ⏭ buttons — the other teams see the word too, the actor's own team doesn't. Words follow the TV language.</p>
            ${st === 'final' ? teamScores(g) : ''}
            <div class="h-btns"><button class="primary big-btn" data-emit="host:pantomime:start" ${g.teams.filter(x => x.members.length).length >= 2 ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
            <button data-emit="host:pantomime:shuffle" ${st === 'lobby' ? '' : 'disabled'}>🔀 Shuffle teams</button></div>
          </section>
          <section class="h-card"><h2>Teams <span class="muted small">tap a name to switch team</span></h2>${UI.teamEditor(g.teams, 'pantomime')}</section>
          <section class="h-card"><h2>Settings</h2>
            <div class="h-fields">
              ${UI.hostField('Seconds per turn', UI.numberInput('seconds', g.settings.seconds, 20, 300, 10))}
              ${UI.hostField('Turns per team', UI.numberInput('turns', g.settings.turns, 1, 10))}
              ${UI.hostField('Skips per turn', UI.numberInput('skips', g.settings.skips, 0, 10))}
              ${UI.hostField('Teams', UI.numberInput('teamCount', g.settings.teamCount, 2, 4))}
            </div>
            ${UI.toggle('choice', g.settings.choice, '★ Actor picks easy (1 pt) or hard (2 pts)', 'Films, sayings, famous things and players\' own words are the hard ones')}
            ${UI.toggle('customWords', g.settings.customWords, '✍️ Players write words for the other teams', `Up to 5 each, from the phones. ${g.customCount} written so far.`)}
            <h3>Word categories</h3>
            <div class="cat-picker">${g.categoriesAll.map(c => `<button class="cat-pick ${c === 'adult' ? 'adult' : ''} ${g.settings.categories.includes(c) ? 'on' : ''}" data-pmcat="${c}">${CAT_EMOJI[c]} ${esc(HUB_STRINGS.en[`pm.cat.${c}`])} <span class="fa-name">${esc(HUB_STRINGS.fa[`pm.cat.${c}`])}</span></button>`).join('')}</div>
            <div class="pm-adult-host">
              <p class="muted small">🔞 <b>18+ Naughty</b> is off by default: dirty words (lap dance, doggy style, walk of shame, broken condom...) with easy and hard cards of their own. No word repeats until the whole list has been played tonight. Turn it on only when everyone playing is an adult and up for it. The TV and phones say so in the lobby.</p>
              <div class="h-btns">${adultMode(g) === 'only'
                ? `<button data-pmcats="${g.categoriesAll.filter(c => c !== 'adult').join(',')}">Back to the clean categories</button><button data-pmcats="${g.categoriesAll.join(',')}">Mix 18+ with everything</button>`
                : `<button class="pm-adult-btn" data-pmcats="adult">🔞 Only 18+ words</button>${adultMode(g) === 'on' ? `<button data-pmcats="${g.categoriesAll.filter(c => c !== 'adult').join(',')}">Remove 18+</button>` : ''}`}</div>
            </div>
          </section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      el.innerHTML = `<section class="h-card span2 h-hero">
          ${teamScores(g)}
          <p class="h-status">Turn ${g.turnNo + 1} of ${g.totalTurns} · ${UI.teamName(g.team)} · 🎭 ${esc(g.actor ? g.actor.name : '—')}
            ${st === 'acting' ? `· <span data-ends="${g.endsAt}"></span>s left` : ''}</p>
          ${st === 'acting' ? `<p class="h-secret">${g.offer ? `🤔 Choosing: ${g.offer.map(w => `<b dir="auto">${esc(w.text)}</b> (${w.points})`).join(' or ')}` : `${CAT_EMOJI[g.wordCat]} <b dir="auto">${esc(g.word || '')}</b> (${g.wordPoints} pt)`} · ★ ${g.pointsThisTurn} · skips left ${g.skipsLeft}</p>` : ''}
          <div class="h-btns">
            ${st === 'ready' ? '<button class="primary" data-emit="host:pantomime:go">▶ Start the turn</button><button data-emit="host:pantomime:skipActor">Pick someone else</button>' : ''}
            ${st === 'acting' ? '<button class="good" data-emit="host:pantomime:correct">✅ Got it</button><button data-emit="host:pantomime:skip">⏭ Skip</button><button data-emit="host:pantomime:endTurn">⏹ End turn</button>' : ''}
            ${st === 'turnEnd' ? `<button class="primary" data-emit="host:pantomime:next">${g.turnNo + 1 >= g.totalTurns ? 'Show final results 🏆' : 'Next team ▶'}</button>` : ''}
            <button class="danger" data-emit="host:pantomime:end" data-confirm="Tap again to end">End game</button>
          </div>
        </section>
        ${st === 'turnEnd' ? `<section class="h-card span2"><h2>This turn</h2>${turnList(g)}</section>` : ''}`;
    },
  };

  Hub.register('pantomime', { tv, player, host });
})();

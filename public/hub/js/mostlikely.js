// Who's Most Likely…? (کی از همه بیشتر…؟) — TV, phone and host views. Server: games/mostlikely.js.
// Three round types: likely (vote for a player), rather (pick A or B) and
// never (I have / never).
(function () {
  const { t, num, esc, avatar } = Hub;
  const KIND_ICON = { likely: '👑', rather: '⚖️', never: '🙊' };
  const kindTitle = (g) => t(`ml.kind.${g.kind}`);
  const joinNames = (list) => list.join(Hub.lang === 'fa' ? ' و ' : ' & ');

  // The question as the TV shows it: a speech bubble, or two options facing off.
  function questionCard(g) {
    if (g.kind === 'rather') {
      return `<div class="ml-rather">
        <div class="ml-opt a" dir="auto"><span>A</span>${esc(g.prompt[0])}</div>
        <div class="ml-or">${esc(t('ml.or'))}</div>
        <div class="ml-opt b" dir="auto"><span>B</span>${esc(g.prompt[1])}</div></div>`;
    }
    return `<div class="ml-bubble ${g.kind}"><span class="ml-crown">${KIND_ICON[g.kind]}</span>
      ${g.kind === 'never' ? `<p class="ml-never-lead">${esc(t('ml.neverLead'))}</p>` : ''}<h1 dir="auto">${esc(g.prompt)}</h1></div>`;
  }

  function revealColumns(g) {
    const counts = g.result.counts;
    const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const max = Math.max(1, ...Object.values(counts));
    const winners = new Set(g.result.winners.map(w => w.id));
    return `<div class="ml-cols">${ids.map((id, i) => {
      const voters = g.result.byTarget[id] || [];
      const name = Hub.playerName(id);
      return `<div class="ml-col ${winners.has(id) ? 'win' : ''}" style="--i:${i};--h:${(counts[id] / max) * 100}%">
        <div class="ml-voters">${voters.map((v, j) => `<span class="ml-voter" style="--j:${j}">${avatar(v.name)}</span>`).join('')}</div>
        <div class="ml-bar"><b>${num(counts[id])}</b></div>
        <div class="ml-cand">${winners.has(id) ? '<span class="crown">👑</span>' : ''}${avatar(name, 'ml-av')}<span>${esc(name)}</span></div>
      </div>`;
    }).join('') || `<p class="muted">${esc(t('ml.noVotes'))}</p>`}</div>`;
  }

  // Two sides with the voters' faces stacked on each: "would you rather" and "never have I ever".
  function revealSides(g) {
    const sides = g.kind === 'rather'
      ? [['a', g.prompt[0], 'A'], ['b', g.prompt[1], 'B']]
      : [['yes', t('ml.have'), '🙋'], ['no', t('ml.never'), '🙅']];
    const total = Math.max(1, Object.values(g.result.counts).reduce((a, b) => a + b, 0));
    const win = new Set(g.result.winners.map(w => w.id));
    return `<div class="ml-sides ${g.kind}">${sides.map(([key, label, tag], i) => {
      const voters = g.result.byTarget[key] || [];
      const pct = Math.round((voters.length / total) * 100);
      return `<div class="ml-side ${key} ${win.has(key) ? 'win' : ''}" style="--i:${i};--p:${pct}%">
        <div class="ml-side-head"><span class="ml-tag">${tag}</span><b dir="auto">${esc(label)}</b><span class="ml-pct">${num(pct)}${Hub.lang === 'fa' ? '٪' : '%'}</span></div>
        <div class="ml-side-bar"><i></i></div>
        <div class="ml-side-faces">${voters.map((v, j) => `<span class="ml-voter" style="--j:${j}">${avatar(v.name)}<small>${esc(v.name)}</small></span>`).join('') || '<span class="muted">—</span>'}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function revealHeadline(g) {
    if (g.kind === 'likely') return g.result.winners.length ? `👑 ${esc(joinNames(g.result.winners.map(w => w.name)))}` : '';
    if (g.kind === 'rather') {
      if (!g.result.winners.length) return `🤝 ${esc(t('ml.split'))}`;
      return `${esc(t('ml.crowdPicked'))} ${g.result.winners[0].id === 'a' ? 'A' : 'B'}`;
    }
    const have = g.result.byTarget.yes || [];
    if (have.length === 1) return `😱 ${esc(t('ml.onlyOne', { name: have[0].name }))}`;
    if (!have.length) return `😇 ${esc(t('ml.nobody'))}`;
    return `🙋 ${esc(t('ml.haveN', { n: num(have.length) }))}`;
  }

  // =============== TV ===============
  const tv = {
    mount(root) { root.innerHTML = '<div class="ml-tv" id="ml-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ml-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + g.settings.mode + g.customCount, () => UI.tvLobby('mostlikely', `
          <div class="ml-kinds">${['likely', 'rather', 'never'].filter(k => g.settings.mode === 'mix' || g.settings.mode === k).map(k => `<span class="ef-cat">${KIND_ICON[k]} ${esc(t(`ml.kind.${k}`))}</span>`).join('')}</div>
          <p class="lobby-meta">${esc(t('ml.roundsN', { n: num(g.settings.rounds) }))} ${Hub.SEP} ⏱ ${num(g.settings.seconds)}″ ${Hub.SEP} ${esc(t('ml.pointRule'))}</p>
          <p class="lobby-meta">✍️ ${esc(t('ml.writtenCount', { n: num(g.customCount) }))}</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'question') {
        if (Hub.screen(el, 'q' + g.round, `<div class="ml-q ${g.kind}">
            <p class="eyebrow">${esc(t('ml.roundOf', { n: num(g.round), of: num(g.settings.rounds) }))} ${Hub.SEP} ${KIND_ICON[g.kind]} ${esc(kindTitle(g))}</p>
            ${questionCard(g)}
            ${g.by ? `<p class="ml-by">✍️ ${esc(t('ml.by', { name: g.by }))}</p>` : ''}
            <div class="ml-q-foot">${Hub.ring(g.endsAt, g.settings.seconds, 'ml-ring')}<div class="ml-voting" id="ml-voting"></div></div>
          </div>`)) Hub.sfx.sparkle();
        const voted = new Set(g.voted);
        document.getElementById('ml-voting').innerHTML = g.candidates.map(c => `<span class="ml-vchip ${voted.has(c.id) ? 'in' : ''}">${avatar(c.name)}<i>${voted.has(c.id) ? '✓' : ''}</i></span>`).join('')
          + `<span class="ml-vcount">${esc(t('ml.votedN', { n: num(g.voted.length), of: num(g.candidates.length) }))}</span>`;
        return;
      }
      if (st === 'reveal') {
        if (Hub.screen(el, 'r' + g.round, `<div class="ml-reveal ${g.kind}">
            <h2 dir="auto">${g.kind === 'rather' ? `${esc(t('ml.kind.rather'))}` : `${g.kind === 'never' ? esc(t('ml.neverLead')) + ' ' : ''}${esc(g.prompt)}`}</h2>
            ${g.kind === 'likely' ? revealColumns(g) : revealSides(g)}
            <p class="ml-winner">${revealHeadline(g)}</p>
            ${g.nextAt ? `<p class="ml-next">${esc(t('ml.nextIn'))} <span data-ends="${g.nextAt}"></span></p>` : ''}
          </div>`)) {
          Hub.sfx.drumroll(900);
          setTimeout(() => { Hub.sfx.fanfare(); if (g.result.winners.length) Hub.confetti(60); }, 950);
        }
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, `<div class="final-screen ml-final">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <h1>👑 ${esc(t('ml.titlesTitle'))}</h1>
            <div class="ml-titles">${g.standings.map((r, i) => `<div class="ml-tcard" style="--i:${i}">
              <div class="ml-tc-head">${avatar(r.name)}<b>${esc(r.name)}</b><span class="ml-pts">${num(r.points)} ${esc(t('core.pts'))}</span></div>
              <ul>${r.titles.slice(0, 2).map(x => `<li dir="auto">${esc(x)}</li>`).join('') || `<li class="muted">${esc(t('ml.noTitles'))}</li>`}</ul>
              ${r.confessions.length ? `<small class="ml-conf">🙊 ${esc(t('ml.confessed', { n: num(r.confessions.length) }))}</small>` : ''}
            </div>`).join('')}</div>
            ${g.standings[0] && g.standings[0].points > 0 ? `<p class="ml-mind">🧠 ${esc(t('ml.mindReader', { name: joinNames(g.standings.filter(r => r.points === g.standings[0].points).map(r => r.name)) }))}</p>` : ''}
          </div>`)) { Hub.confetti(150); Hub.sfx.fanfare(); }
      }
    },
  };

  // =============== phone ===============
  const writePanel = () => `<div class="pm-write">
      <h3>✍️ ${esc(t('ml.writeTitle'))}</h3><p class="muted small">${esc(t('ml.writeSub'))}</p>
      <div class="pm-write-row"><input type="text" id="ml-q-input" maxlength="90" dir="auto" autocomplete="off" placeholder="${esc(t('ml.writePh'))}" enterkeyhint="done"><button class="primary" data-addq>+</button></div>
      <div class="pm-mywords" id="ml-myqs"></div></div>`;
  function renderMyQs(g) {
    const box = document.getElementById('ml-myqs');
    if (!box) return;
    const k = JSON.stringify(g.myQuestions || []);
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    box.innerHTML = (g.myQuestions || []).map((q, i) => `<span class="pm-myword"><bdi>${esc(q)}</bdi><button data-rmq="${i}" aria-label="Remove">✕</button></span>`).join('') || `<span class="muted small">${esc(t('pm.writeNone'))}</span>`;
  }

  const player = {
    mount(root) {
      root.innerHTML = '<div class="ml-ph" id="ml-ph"></div>';
      const addQ = () => {
        const input = document.getElementById('ml-q-input');
        if (!input || !input.value.trim()) return;
        Hub.emit('player:mostlikely:addQuestion', { text: input.value });
        input.value = '';
        Hub.vibrate(15);
      };
      root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ml-q-input') addQ(); });
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-addq]')) { addQ(); return; }
        const rm = e.target.closest('[data-rmq]');
        if (rm) { Hub.emit('player:mostlikely:removeQuestion', { index: Number(rm.dataset.rmq) }); return; }
        const b = e.target.closest('[data-vote-for]');
        if (!b) return;
        Hub.emit('player:mostlikely:vote', { target: b.dataset.voteFor });
        Hub.vibrate(20);
        Hub.sfx.pop();
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ml-ph');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('mostlikely', writePanel()));
        renderMyQs(g);
        return;
      }
      if (st === 'question') {
        Hub.screen(el, 'q' + g.round, `<div class="ml-ph-q ${g.kind}">
          <div class="ml-ph-top"><span class="eyebrow">${KIND_ICON[g.kind]} ${esc(kindTitle(g))} ${Hub.SEP} ${num(g.round)}/${num(g.settings.rounds)}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
          ${g.kind === 'rather' ? '' : `<h2 dir="auto">${g.kind === 'never' ? `<small>${esc(t('ml.neverLead'))}</small> ` : ''}${esc(g.prompt)}</h2>`}
          <div class="ml-picks ${g.kind}" id="ml-picks"></div>
          <p class="muted small" id="ml-hint"></p></div>`);
        const picks = document.getElementById('ml-picks');
        const options = g.kind === 'likely'
          ? g.candidates.filter(c => g.settings.allowSelf || c.id !== Hub.myId).map(c => ({ id: c.id, html: `${avatar(c.name, 'ml-pick-av')}<span>${esc(c.name)}</span>` }))
          : g.kind === 'rather'
            ? [{ id: 'a', html: `<span class="ml-tag">A</span><span dir="auto">${esc(g.prompt[0])}</span>` }, { id: 'b', html: `<span class="ml-tag">B</span><span dir="auto">${esc(g.prompt[1])}</span>` }]
            : [{ id: 'yes', html: `<span class="ml-big">🙋</span><span>${esc(t('ml.have'))}</span>` }, { id: 'no', html: `<span class="ml-big">🙅</span><span>${esc(t('ml.never'))}</span>` }];
        const k = options.map(o => o.id).join(',') + g.myVote;
        if (picks.dataset.k !== k) {
          picks.dataset.k = k;
          picks.innerHTML = options.map(o => `<button class="ml-pick opt-${o.id} ${g.myVote === o.id ? 'on' : ''}" data-vote-for="${esc(o.id)}">${o.html}</button>`).join('');
        }
        document.getElementById('ml-hint').textContent = g.myVote ? t('ml.changeHint') : t(g.kind === 'likely' ? 'ml.tapSomeone' : 'ml.tapOption');
        return;
      }
      if (st === 'reveal') {
        const me = Hub.myId;
        const winners = g.result.winners.map(w => w.id);
        let icon = '👑';
        let line = '';
        let sub = '';
        if (g.kind === 'likely') {
          const iAm = winners.includes(me);
          icon = iAm ? '😂' : '👑';
          line = iAm ? t('ml.itsYou') : joinNames(g.result.winners.map(w => w.name)) || t('ml.noVotes');
          if (g.myVote) sub = winners.includes(g.myVote) ? t('ml.readRoom') : t('ml.notQuite');
        } else if (g.kind === 'rather') {
          icon = '⚖️';
          line = winners.length ? `${t('ml.crowdPicked')} ${winners[0] === 'a' ? 'A' : 'B'}` : t('ml.split');
          if (g.myVote && winners.length) sub = winners.includes(g.myVote) ? t('ml.readRoom') : t('ml.notQuite');
        } else {
          const have = g.result.byTarget.yes || [];
          icon = g.myVote === 'yes' ? '🙈' : '😇';
          line = have.length === 1 ? t('ml.onlyOne', { name: have[0].name }) : t('ml.haveN', { n: num(have.length) });
        }
        Hub.screen(el, 'r' + g.round, `<div class="ph-result ml-ph-r"><div class="big-rank">${icon}</div><h1>${esc(line)}</h1>
          ${sub ? `<p class="gain ${sub === t('ml.notQuite') ? 'miss' : ''}">${esc(sub)}</p>` : ''}</div>`);
        if (el.dataset.vib !== String(g.round)) { el.dataset.vib = String(g.round); Hub.vibrate(sub === t('ml.readRoom') ? [40, 30, 90] : 60); }
        return;
      }
      if (st === 'final') {
        const mine = g.standings.find(r => r.id === Hub.myId);
        Hub.screen(el, 'final' + Hub.lang, `<div class="ph-result">
          <p class="eyebrow">${esc(t('core.gameOver'))}</p>
          <h1>👑 ${esc(t('ml.yourTitles'))}</h1>
          <ul class="ml-mytitles">${mine && mine.titles.length ? mine.titles.map(x => `<li dir="auto">${esc(x)}</li>`).join('') : `<li class="muted">${esc(t('ml.noTitles'))}</li>`}</ul>
          <p class="big-score">${num(mine ? mine.points : 0)} <small>${esc(t('core.pts'))}</small></p>
          <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p></div>`);
      }
    },
  };

  // =============== host ===============
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="ml-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:mostlikely:settings');
      root.addEventListener('change', (e) => { if (e.target.id === 'ml-mode') Hub.emit('host:mostlikely:settings', { mode: e.target.value }); });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ml-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        Hub.screen(el, st + JSON.stringify(g.settings) + s.players.length + g.customCount, `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '👑 Who\'s Most Likely?'}</h2>
            <p class="muted small">Three kinds of round: <b>Who's most likely</b> (vote for a player — voting with the crowd = +1, the winner gets the title), <b>Would you rather</b> (pick A or B — the majority side = +1) and <b>Never have I ever</b> (no points, just confessions). Questions follow the TV language. Players can write their own "who's most likely" questions on their phones in the lobby — ${g.customCount} so far; they come up first.</p>
            <button class="primary big-btn" data-emit="host:mostlikely:start" ${s.players.filter(p => p.connected).length >= 2 ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'}</button>
            <div class="roster">${UI.hostRoster(s.players)}</div>
          </section>
          <section class="h-card"><h2>Settings</h2><div class="h-fields">
            ${UI.hostField('Rounds', `<select id="ml-mode"><option value="mix" ${g.settings.mode === 'mix' ? 'selected' : ''}>Mix of all three</option><option value="likely" ${g.settings.mode === 'likely' ? 'selected' : ''}>Only "most likely"</option><option value="rather" ${g.settings.mode === 'rather' ? 'selected' : ''}>Only "would you rather"</option><option value="never" ${g.settings.mode === 'never' ? 'selected' : ''}>Only "never have I ever"</option></select>`)}
            ${UI.hostField('Questions', UI.numberInput('rounds', g.settings.rounds, 1, 50))}
            ${UI.hostField('Seconds to vote', UI.numberInput('seconds', g.settings.seconds, 10, 120, 5))}
            ${UI.hostField('Auto-next after reveal (sec, 0 = off)', UI.numberInput('autoNext', g.settings.autoNext, 0, 60))}
          </div>${UI.toggle('allowSelf', g.settings.allowSelf, 'Players can vote for themselves')}</section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const q = g.kind === 'rather' ? `A: ${esc(g.prompt[0])}<br>B: ${esc(g.prompt[1])}` : esc(g.prompt);
      el.innerHTML = `<section class="h-card span2 h-hero">
          <p class="eyebrow">Question ${g.round} of ${g.settings.rounds} · ${KIND_ICON[g.kind]} ${esc(HUB_STRINGS.en[`ml.kind.${g.kind}`])}${g.by ? ` · written by ${esc(g.by)}` : ''}</p>
          <h2 dir="auto">${q}</h2>
          <p class="h-status">${st === 'question' ? `${g.voted.length} of ${g.candidates.length} voted · <span data-ends="${g.endsAt}"></span>s left` : esc(revealHeadline(g).replace(/<[^>]+>/g, ''))}</p>
          <div class="h-btns">
            ${st === 'question' ? '<button class="primary" data-emit="host:mostlikely:reveal">Reveal now</button><button data-emit="host:mostlikely:skip">Skip this question</button>' : ''}
            ${st === 'reveal' ? `<button class="primary" data-emit="host:mostlikely:next">${g.round >= g.settings.rounds ? 'Show the titles 🏆' : 'Next question ▶'}</button>` : ''}
            <button class="danger" data-emit="host:mostlikely:end" data-confirm="Tap again to end">End game</button>
          </div></section>
        <section class="h-card"><h2>Points</h2>${g.standings.map(r => `<div class="trophy-row">${avatar(r.name)} <b>${esc(r.name)}</b> ${r.points} pts · ${r.titles.length} titles</div>`).join('') || '<p class="muted small">No points yet.</p>'}</section>`;
    },
  };

  Hub.register('mostlikely', { tv, player, host });
})();

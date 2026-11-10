// Two Truths & a Lie (دو راست، یه دروغ) — TV, phone and host views. Server: games/truths.js.
(function () {
  const { t, num, esc, avatar } = Hub;
  const MARK = ['①', '②', '③'];
  const list = (names) => names.join(Hub.lang === 'fa' ? '، ' : ', ');

  // Ideas for the phone's "Need an idea?" button.
  const IDEAS = {
    en: [
      'A famous person you’ve met', 'The weirdest thing you’ve ever eaten', 'A country you’ve been to', 'Your very first job',
      'A hidden talent', 'Something you broke and never owned up to', 'Your most embarrassing moment', 'A pet you’ve had',
      'A record or prize you’ve won', 'Something wild you did as a kid', 'A phobia you have', 'A time you got completely lost',
      'A sport you used to play', 'A language you can speak a bit of', 'A night in hospital', 'A strange habit of yours',
      'The first concert you went to', 'Something you did on a dare', 'A time you were on TV or the radio', 'A food you refuse to eat',
      'A celebrity you were mistaken for', 'Something you’ve collected', 'An odd job you’ve done', 'A dream you still remember',
    ],
    fa: [
      'یه آدم معروف که دیدی', 'عجیب‌ترین غذایی که خوردی', 'کشوری که رفتی', 'اولین کارت',
      'یه استعداد مخفی', 'یه چیزی که شکستی و هیچ‌وقت گردن نگرفتی', 'ضایع‌ترین لحظه‌ی زندگیت', 'حیوون خونگی‌ای که داشتی',
      'یه جایزه یا مقام', 'یه کار خطرناک تو بچگی', 'چیزی که ازش می‌ترسی', 'یه بار که حسابی گم شدی',
      'ورزشی که قبلاً می‌کردی', 'زبونی که یه کم بلدی', 'یه شب تو بیمارستان', 'یه عادت عجیب',
      'اولین کنسرتی که رفتی', 'کاری که سر شرط کردی', 'یه بار که رفتی تلویزیون یا رادیو', 'غذایی که لب نمی‌زنی',
      'یه سلبریتی که باهاش اشتباهت گرفتن', 'چیزی که کلکسیون کردی', 'یه کار عجیب که کردی', 'خوابی که هنوز یادته',
    ],
  };

  // Three lines as the TV shows them: number, text, and (at the reveal) the verdict and the voters.
  function linesHtml(g, reveal) {
    return `<div class="tt-lines ${reveal ? 'reveal' : ''}">${g.lines.map((line, i) => {
      const lie = reveal && g.lieAt === i;
      const voters = reveal ? (g.result.byLine[i] || []) : [];
      return `<div class="tt-line ${reveal ? (lie ? 'lie' : 'truth') : ''}" style="--i:${i}">
        <span class="tt-num">${MARK[i]}</span>
        <p dir="auto">${esc(line)}</p>
        ${reveal ? `<span class="tt-verdict">${lie ? `🤥 ${esc(t('tt.lieStamp'))}` : `✓ ${esc(t('tt.truth'))}`}</span>
          <div class="tt-voters">${voters.map((v, j) => `<span class="tt-voter" style="--j:${j}">${avatar(v.name)}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  function revealHeadline(g) {
    const r = g.result;
    if (r.perfect) return `😈 ${esc(t('tt.perfect'))}`;
    if (r.caught && !r.fooled) return esc(t('tt.busted'));
    if (!r.caught && !r.fooled) return esc(t('tt.waitVote'));
    return `🕵️ ${esc(t('tt.caughtN', { n: num(r.caught) }))} ${Hub.SEP} 🤡 ${esc(t('tt.fooledN', { n: num(r.fooled) }))}`;
  }

  // =============== TV ===============
  const tv = {
    mount(root) { root.innerHTML = '<div class="tt-tv" id="tt-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('tt-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang, () => UI.tvLobby('truths', '<div class="tt-ready-box" id="tt-ready"></div>'));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        const box = document.getElementById('tt-ready');
        const readyIds = new Set(g.ready.map(r => r.id));
        const online = s.players.filter(p => p.connected);
        const k = online.map(p => p.id + readyIds.has(p.id)).join() + Hub.lang;
        if (box.dataset.k !== k) {
          box.dataset.k = k;
          box.innerHTML = `<p class="lobby-meta">✍️ ${esc(t('tt.readyN', { n: num(g.ready.length) }))}</p>
            <div class="tt-ready">${online.map(p => `<span class="tt-rchip ${readyIds.has(p.id) ? 'in' : ''}">${avatar(p.name)}<i>${readyIds.has(p.id) ? '✓' : '✎'}</i></span>`).join('')}</div>`;
        }
        return;
      }
      if (st === 'telling' || st === 'voting') {
        const key = 'q' + g.turnNo + g.teller.id;
        if (Hub.screen(el, key, `<div class="tt-stage">
            <header class="tt-head">
              <div class="tt-teller">${avatar(g.teller.name, 'tt-av')}<span class="tt-nose">🤥</span></div>
              <div><p class="eyebrow">${esc(t('tt.turnOf', { n: num(g.turnNo), of: num(g.totalTurns) }))}</p>
              <h1 id="tt-title"></h1><p class="tt-sub" id="tt-sub"></p></div>
              <div class="tt-clock" id="tt-clock"></div>
            </header>
            ${linesHtml(g, false)}
            <div class="tt-votes" id="tt-votes"></div>
          </div>`)) Hub.sfx.sparkle();
        const phase = st + g.endsAt;
        const clock = document.getElementById('tt-clock');
        if (clock.dataset.k !== phase) {
          clock.dataset.k = phase;
          clock.innerHTML = Hub.ring(g.endsAt, st === 'telling' ? g.settings.askSeconds : g.settings.voteSeconds, 'tt-ring');
          document.getElementById('tt-title').textContent = st === 'telling' ? t('tt.grill', { name: g.teller.name }) : t('tt.voteNow');
          document.getElementById('tt-sub').textContent = st === 'telling' ? t('tt.grillSub') : t('tt.tapLie');
          el.querySelector('.tt-stage').classList.toggle('voting', st === 'voting');
          if (st === 'voting') Hub.sfx.gong();
        }
        const votes = document.getElementById('tt-votes');
        const voted = new Set(g.voted);
        const vk = st + g.voters.map(v => v.id + voted.has(v.id)).join();
        if (votes.dataset.k !== vk) {
          votes.dataset.k = vk;
          votes.innerHTML = st === 'voting'
            ? g.voters.map(v => `<span class="ml-vchip ${voted.has(v.id) ? 'in' : ''}">${avatar(v.name)}<i>✓</i></span>`).join('') + `<span class="ml-vcount">${esc(t('tt.votedN', { n: num(g.voted.length), of: num(g.voters.length) }))}</span>`
            : '';
        }
        return;
      }
      if (st === 'reveal') {
        if (Hub.screen(el, 'r' + g.turnNo + g.teller.id, `<div class="tt-stage reveal">
            <header class="tt-head">
              <div class="tt-teller">${avatar(g.teller.name, 'tt-av')}</div>
              <div><p class="eyebrow">${esc(t('tt.turnOf', { n: num(g.turnNo), of: num(g.totalTurns) }))}</p><h1>${esc(g.teller.name)}</h1></div>
            </header>
            ${linesHtml(g, true)}
            <p class="tt-headline">${revealHeadline(g)}</p>
            ${g.nextAt ? `<p class="tt-next">${esc(t('tt.nextIn'))} <span data-ends="${g.nextAt}"></span></p>` : ''}
          </div>`)) {
          Hub.sfx.drumroll(900);
          setTimeout(() => {
            Hub.stamp(t('tt.lieStamp'), 'stop');
            if (g.result.perfect || g.result.caught) { Hub.sfx.fanfare(); Hub.confetti(g.result.perfect ? 120 : 50); } else Hub.sfx.buzzer();
          }, 950);
        }
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, `<div class="final-screen tt-final">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <h1>🤥 ${esc(t('game.truths.name'))}</h1>
            ${UI.podium(g.standings, r => r.points, r => r.name)}
            <div class="tt-awards">${awardsHtml(g)}</div>
          </div>`)) { Hub.confetti(150); Hub.sfx.fanfare(); }
      }
    },
  };
  function awardsHtml(g) {
    const a = g.awards || {};
    return [
      a.liar ? `<span class="tt-award">😈 <b>${esc(t('tt.bestLiar'))}</b> ${esc(list(a.liar.names))} <small>${esc(t('tt.fooledLine', { n: num(a.liar.n) }))}</small></span>` : '',
      a.detector ? `<span class="tt-award">🕵️ <b>${esc(t('tt.detector'))}</b> ${esc(list(a.detector.names))} <small>${esc(t('tt.caughtLine', { n: num(a.detector.n) }))}</small></span>` : '',
    ].join('');
  }

  // =============== phone ===============
  let draft = null; // what's typed but not saved yet: { lines: [3], lie }
  function writeForm(g) {
    const d = draft || (g.mySet ? { lines: g.mySet.lines.slice(), lie: g.mySet.lie } : { lines: ['', '', ''], lie: null });
    draft = d;
    return `<div class="tt-write">
      <h3>✍️ ${esc(t('tt.writeTitle'))}</h3><p class="muted small">${esc(t('tt.writeSub'))}</p>
      ${[0, 1, 2].map(i => `<div class="tt-wline ${d.lie === i ? 'lie' : ''}">
        <span class="tt-num">${MARK[i]}</span>
        <textarea data-line="${i}" rows="2" maxlength="120" dir="auto" placeholder="${esc(t('tt.linePh'))}">${esc(d.lines[i])}</textarea>
        <button class="tt-liebtn" data-lie="${i}" aria-pressed="${d.lie === i}">🤥<small>${esc(t('tt.isLie'))}</small></button>
      </div>`).join('')}
      <div class="tt-wbtns"><button class="small-btn" data-idea>${esc(t('tt.idea'))}</button><button class="primary" data-save>${esc(t('tt.save'))}</button></div>
      <p class="tt-idea" id="tt-idea"></p>
      <p class="tt-err" id="tt-err"></p>
    </div>`;
  }
  function savedCard(g) {
    return `<div class="tt-saved">
      <p class="tt-ok">✅ ${esc(t('tt.readyMsg'))}</p>
      <ol class="tt-mylines">${g.mySet.lines.map((l, i) => `<li class="${i === g.mySet.lie ? 'lie' : ''}"><span class="tt-num">${MARK[i]}</span><span dir="auto">${esc(l)}</span>${i === g.mySet.lie ? '<em>🤥</em>' : ''}</li>`).join('')}</ol>
      <button class="small-btn" data-edit>✎ ${esc(t('tt.edit'))}</button>
    </div>`;
  }
  let editing = false;
  function writeArea(g) {
    if (g.mySet && !editing) return savedCard(g);
    return writeForm(g);
  }

  const player = {
    mount(root) {
      root.innerHTML = '<div class="tt-ph" id="tt-ph"></div>';
      root.addEventListener('input', (e) => {
        const ta = e.target.closest('[data-line]');
        if (ta && draft) draft.lines[Number(ta.dataset.line)] = ta.value;
      });
      root.addEventListener('click', (e) => {
        const lie = e.target.closest('[data-lie]');
        if (lie && draft) {
          draft.lie = Number(lie.dataset.lie);
          root.querySelectorAll('.tt-wline').forEach((row, i) => row.classList.toggle('lie', i === draft.lie));
          root.querySelectorAll('[data-lie]').forEach((b, i) => b.setAttribute('aria-pressed', String(i === draft.lie)));
          Hub.vibrate(15);
          return;
        }
        if (e.target.closest('[data-idea]')) {
          const pool = IDEAS[Hub.lang] || IDEAS.en;
          document.getElementById('tt-idea').textContent = '💡 ' + pool[Math.floor(Math.random() * pool.length)];
          return;
        }
        if (e.target.closest('[data-save]')) {
          const err = document.getElementById('tt-err');
          if (!draft || draft.lines.some(l => !l.trim()) || draft.lie === null) { err.textContent = t('tt.needAll'); Hub.vibrate([20, 40, 20]); return; }
          Hub.emit('player:truths:write', { lines: draft.lines, lie: draft.lie });
          editing = false;
          draft = null;
          Hub.vibrate([20, 30, 60]);
          Hub.sfx.pop();
          return;
        }
        if (e.target.closest('[data-edit]')) {
          editing = true;
          draft = null;
          const area = document.getElementById('tt-area');
          if (area && Hub.state) area.innerHTML = writeArea(Hub.state.game);
          return;
        }
        const v = e.target.closest('[data-vote]');
        if (v) { Hub.emit('player:truths:vote', { index: Number(v.dataset.vote) }); Hub.vibrate(20); Hub.sfx.pop(); }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('tt-ph');
      const st = g.status;
      const me = Hub.myId;
      const live = st === 'telling' || st === 'voting' || st === 'reveal';
      // Writing: in the lobby, after a game, or mid-game for someone who hasn't had a turn.
      const writeKey = (g.mySet ? JSON.stringify(g.mySet) : 'none') + editing + Hub.lang;
      if (st === 'lobby' || st === 'final') {
        const mine = g.standings.find(r => r.id === me);
        const top = st === 'final' ? `<div class="ph-result tt-ph-final"><p class="eyebrow">${esc(t('core.gameOver'))}</p>
          <p class="big-score">${num(mine ? mine.points : 0)} <small>${esc(t('core.pts'))}</small></p><div class="tt-awards ph">${awardsHtml(g)}</div></div>` : '';
        if (Hub.screen(el, st + writeKey, st === 'lobby'
          ? UI.phoneLobby('truths', `<div id="tt-area">${writeArea(g)}</div>`)
          : `${top}<div id="tt-area">${writeArea(g)}</div>`)) { /* fresh form */ }
        return;
      }
      if (live && g.teller && g.teller.id === me) {
        if (st === 'reveal') {
          const r = g.result;
          Hub.screen(el, 'r' + g.turnNo + 'me', `<div class="ph-result"><div class="big-rank">${r.perfect ? '😈' : r.fooled ? '😏' : '😅'}</div>
            <h1>${esc(r.fooled ? t('tt.youFooledN', { n: num(r.fooled) }) : t('tt.nobodyFell'))}</h1>
            ${r.perfect ? `<p class="gain">${esc(t('tt.perfect'))}</p>` : ''}</div>`);
          return;
        }
        Hub.screen(el, 'q' + g.turnNo + 'me' + st, `<div class="tt-me">
            <div class="ph-top-row"><span class="eyebrow">🎤 ${esc(t('tt.yourTurn'))}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
            <h2>${esc(t('tt.yourLie', { n: num(g.lieAt + 1) }))}</h2>
            <ol class="tt-mylines">${g.lines.map((l, i) => `<li class="${i === g.lieAt ? 'lie' : ''}"><span class="tt-num">${MARK[i]}</span><span dir="auto">${esc(l)}</span>${i === g.lieAt ? '<em>🤥</em>' : ''}</li>`).join('')}</ol>
            <p class="muted">${esc(t('tt.defend'))}</p></div>`);
        return;
      }
      if (st === 'telling') {
        Hub.screen(el, 'q' + g.turnNo + 'tell' + writeKey, `<div class="tt-listen">
            <div class="ph-top-row"><span class="eyebrow">${avatar(g.teller.name)} ${esc(g.teller.name)}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
            <h2>${esc(t('tt.listening'))}</h2>
            <ol class="tt-mylines">${g.lines.map((l, i) => `<li><span class="tt-num">${MARK[i]}</span><span dir="auto">${esc(l)}</span></li>`).join('')}</ol>
            ${!g.mySet && !g.iTold ? `<details class="tt-late"><summary>${esc(t('tt.mustWrite'))}</summary><div id="tt-area">${writeArea(g)}</div></details>` : ''}
          </div>`);
        return;
      }
      if (st === 'voting') {
        Hub.screen(el, 'v' + g.turnNo, `<div class="tt-vote">
            <div class="ph-top-row"><span class="eyebrow">🤥 ${esc(t('tt.voteNow'))}</span><span class="pill" data-ends="${g.endsAt}"></span></div>
            <div class="tt-picks" id="tt-picks"></div>
            <p class="muted small">${esc(t('tt.tapLie'))}</p></div>`);
        const picks = document.getElementById('tt-picks');
        const k = String(g.myVote);
        if (picks.dataset.k !== k) {
          picks.dataset.k = k;
          picks.innerHTML = g.lines.map((l, i) => `<button class="tt-pick ${g.myVote === i ? 'on' : ''}" data-vote="${i}"><span class="tt-num">${MARK[i]}</span><span dir="auto">${esc(l)}</span></button>`).join('');
        }
        return;
      }
      if (st === 'reveal') {
        const caught = g.myVote === g.lieAt;
        const voted = g.myVote !== null;
        Hub.screen(el, 'r' + g.turnNo, `<div class="ph-result tt-ph-reveal"><div class="big-rank">${!voted ? '🤥' : caught ? '🕵️' : '🤡'}</div>
            <h1>${esc(!voted ? t('tt.lieStamp') : caught ? t('tt.youCaught') : t('tt.youFooled'))}</h1>
            ${voted && caught ? `<p class="gain">${Hub.signed(1)}</p>` : ''}
            <p class="tt-thelie"><span class="tt-num">${MARK[g.lieAt]}</span><span dir="auto">${esc(g.lines[g.lieAt])}</span></p></div>`);
        if (el.dataset.vib !== String(g.turnNo)) { el.dataset.vib = String(g.turnNo); Hub.vibrate(caught ? [40, 30, 90] : 80); }
      }
    },
  };

  // =============== host ===============
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="tt-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:truths:settings');
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('tt-host');
      const st = g.status;
      if (st === 'lobby' || st === 'final') {
        const online = s.players.filter(p => p.connected);
        const readyIds = new Set(g.ready.map(r => r.id));
        const readyOnline = online.filter(p => readyIds.has(p.id)).length;
        Hub.screen(el, st + JSON.stringify(g.settings) + online.map(p => p.id + readyIds.has(p.id)).join(), `<section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '🤥 Two Truths & a Lie'}</h2>
            <p class="muted small">Everyone writes three things about themselves on their phone and marks the made-up one. Then one teller at a time: the lines go up on the TV, there's <b>question time</b> (everyone grills the teller out loud), then a secret vote. Catching the lie = +1; the teller gets +1 for each person fooled, and +1 more for fooling everyone. Lines are used once — after their turn, a player writes new ones for the next game.</p>
            <button class="primary big-btn" data-emit="host:truths:start" ${online.length >= 2 && readyOnline >= 1 ? '' : 'disabled'}>${st === 'final' ? 'Play again ▶' : 'Start ▶'} (${readyOnline} ready)</button>
            ${readyOnline < online.length ? `<p class="muted small">Still writing: ${online.filter(p => !readyIds.has(p.id)).map(p => esc(p.name)).join(', ')}. You can start without them; they can still vote, and anyone who finishes during the game gets a turn at the end.</p>` : ''}
            <div class="roster">${UI.hostRoster(s.players)}</div>
          </section>
          <section class="h-card"><h2>Settings</h2><div class="h-fields">
            ${UI.hostField('Question time (sec, 0 = straight to the vote)', UI.numberInput('askSeconds', g.settings.askSeconds, 0, 180, 5))}
            ${UI.hostField('Seconds to vote', UI.numberInput('voteSeconds', g.settings.voteSeconds, 10, 120, 5))}
            ${UI.hostField('Auto-next after reveal (sec, 0 = off)', UI.numberInput('autoNext', g.settings.autoNext, 0, 60))}
          </div></section>`);
        UI.syncSettings(el, g.settings);
        return;
      }
      const status = st === 'telling' ? `Question time · <span data-ends="${g.endsAt}"></span>s`
        : st === 'voting' ? `${g.voted.length} of ${g.voters.length} voted · <span data-ends="${g.endsAt}"></span>s left`
          : `The lie was ${MARK[g.lieAt]} · ${g.result.caught} caught it, ${g.result.fooled} fooled${g.result.perfect ? ' · perfect lie!' : ''}`;
      el.innerHTML = `<section class="h-card span2 h-hero">
          <p class="eyebrow">Teller ${g.turnNo} of ${g.totalTurns} · ${esc(g.teller ? g.teller.name : '?')}</p>
          <ol class="tt-host-lines">${(g.lines || []).map((l, i) => `<li class="${st === 'reveal' && i === g.lieAt ? 'lie' : ''}" dir="auto">${esc(l)}</li>`).join('')}</ol>
          <p class="h-status">${status}</p>
          <div class="h-btns">
            ${st === 'telling' ? '<button class="primary" data-emit="host:truths:vote">Open the vote now</button>' : ''}
            ${st === 'voting' ? '<button class="primary" data-emit="host:truths:reveal">Reveal now</button>' : ''}
            ${st === 'telling' || st === 'voting' ? '<button data-emit="host:truths:skip">Skip this teller</button>' : ''}
            ${st === 'reveal' ? `<button class="primary" data-emit="host:truths:next">${g.queueLeft ? 'Next teller ▶' : 'Show results 🏆'}</button>` : ''}
            <button class="danger" data-emit="host:truths:end" data-confirm="Tap again to end">End game</button>
          </div></section>
        <section class="h-card"><h2>Points</h2>${g.standings.map(r => `<div class="trophy-row">${avatar(r.name)} <b>${esc(r.name)}</b> ${r.points} pts · caught ${r.caught} · fooled ${r.fooled}</div>`).join('') || '<p class="muted small">No points yet.</p>'}</section>`;
    },
  };

  Hub.register('truths', { tv, player, host });
})();

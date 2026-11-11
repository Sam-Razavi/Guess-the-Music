// Esm-Famil (اسم فامیل) — TV, phone and host views. Server logic: games/esmfamil.js.
(function () {
  const { t, num, esc, avatar } = Hub;

  const CAT_EMOJI = {
    name: '👤', family: '👪', city: '🏙️', country: '🌍', food: '🍲', animal: '🐾', color: '🎨', object: '🧸',
    fruit: '🍎', flower: '🌸', car: '🚗', job: '🧑‍🔧', sport: '⚽', movie: '🎬', singer: '🎤', brand: '🏷️',
    body: '💪', celebrity: '⭐',
  };
  const ALL_CATS = Object.keys(CAT_EMOJI);
  const LETTERS = {
    fa: 'ا ب پ ت ث ج چ ح خ د ذ ر ز ژ س ش ص ض ط ظ ع غ ف ق ک گ ل م ن و ه ی'.split(' '),
    en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  };
  const HARD = { fa: 'ث ذ ژ ض ط ظ'.split(' '), en: 'K Q U V X Y Z'.split(' ') };
  // Only the letters this game draws from (hard ones only if they're switched on).
  const choosableLetters = (g) => (LETTERS[g.settings.alphabet] || LETTERS.fa)
    .filter(l => g.settings.hardLetters || !(HARD[g.settings.alphabet] || []).includes(l));
  const catLabel = (c) => t(`ef.cat.${c}`);
  const catChip = (c, golden) => `<span class="ef-cat ${c === golden ? 'golden' : ''}"><span>${CAT_EMOJI[c]}</span>${esc(catLabel(c))}${c === golden ? ` <b class="x2"><bdi dir="ltr">×${num(2)}</bdi></b>` : ''}</span>`;

  // Points badge for one reviewed answer.
  function pointsBadge(row) {
    if (!row.valid) {
      const why = { empty: '—', letter: '🔤', voted: '👎', host: '✋' }[row.reason] || '✗';
      return `<span class="ef-pts zero" title="${esc(t(`ef.reason.${row.reason}`))}">${why} ${num(0)}</span>`;
    }
    return `<span class="ef-pts p${row.points}">+${num(row.points)}</span>`;
  }

  // Slot-machine letter roulette that lands on the real letter at spinEndsAt.
  function rouletteInto(el, s) {
    const pool = LETTERS[s.settings.alphabet] || LETTERS.fa;
    let i = Math.floor(Math.random() * pool.length);
    const end = s.spinEndsAt;
    const step = () => {
      if (!el.isConnected) return;
      const left = end - Hub.now();
      if (left <= 250) {
        el.textContent = s.letter;
        el.classList.add('landed');
        if (Hub.role === 'tv') { Hub.sfx.chime(); Hub.flash('rgba(16,185,129,.35)'); }
        else Hub.vibrate([30, 40, 60]);
        return;
      }
      i = (i + 1 + Math.floor(Math.random() * 3)) % pool.length;
      el.textContent = pool[i];
      if (Hub.role === 'tv') Hub.sfx.tick();
      // Starts fast, slows down towards the end like a wheel.
      const delay = 45 + Math.max(0, 1 - left / 3500) ** 2 * 380;
      setTimeout(step, delay);
    };
    step();
  }

  function progressRows(s) {
    const total = s.settings.categories.length;
    return s.participants.map(p => {
      const done = p.filled >= total;
      const segs = Array.from({ length: total }, (_, i) => `<i class="${i < p.filled ? 'on' : ''}"></i>`).join('');
      return `<div class="ef-prog ${done ? 'done' : ''} ${s.stopBy && s.stopBy.id === p.id ? 'stopper' : ''}" data-pid="${esc(p.id)}">
        ${avatar(p.name)}<span class="ef-prog-name">${esc(p.name)}</span><span class="ef-segs">${segs}</span><span class="ef-prog-n">${done ? '✓' : num(p.filled)}</span></div>`;
    }).join('');
  }

  function scoreTable(s, highlightId) {
    const cats = s.settings.categories;
    const last = s.lastRound ? s.lastRound.scores : {};
    const rows = s.standings.filter(r => s.roundScores && s.roundScores[r.id]);
    rows.sort((a, b) => (last[b.id] || 0) - (last[a.id] || 0));
    return `<table class="ef-table">
      <thead><tr><th></th>${cats.map(c => `<th title="${esc(catLabel(c))}">${CAT_EMOJI[c]}${c === s.golden ? '⭐' : ''}<small>${esc(catLabel(c))}</small></th>`).join('')}<th>${esc(t('ef.round'))}</th><th>${esc(t('ef.total'))}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr style="--i:${i}" class="${r.id === highlightId ? 'me' : ''}">
        <th>${avatar(r.name)}<span>${esc(r.name)}</span></th>
        ${cats.map(c => {
          const pts = s.roundScores[r.id][c];
          const text = (s.answers && s.answers[r.id] && s.answers[r.id][c]) || '';
          return `<td class="c${pts}"><span class="cell-ans">${esc(text || '—')}</span><span class="cell-pts">${pts ? num(pts) : '·'}</span></td>`;
        }).join('')}
        <td class="ef-rt">${Hub.signed(last[r.id] || 0)}${s.lastBonus && s.lastBonus[r.id] ? `<small class="ef-bonus">⚡${Hub.signed(s.lastBonus[r.id])}</small>` : ''}</td><td class="ef-gt">${num(r.total)}</td></tr>`).join('')}</tbody></table>`;
  }

  // =============== TV ===============
  const tv = {
    mount(root) { root.innerHTML = '<div class="ef-tv" id="ef-tv"></div>'; },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ef-tv');
      const st = g.status;
      if (st === 'lobby') {
        Hub.screen(el, 'lobby' + Hub.lang + JSON.stringify(g.settings), () => UI.tvLobby('esmfamil', `
          <div class="ef-lobby-cats">${g.settings.categories.map(catChip).join('')}</div>
          <p class="lobby-meta">⏱ ${Hub.clock(g.settings.seconds)} ${Hub.SEP} ${esc(t('ef.roundsN', { n: num(g.settings.rounds) }))} ${Hub.SEP} ${esc(t('ef.scoring'))}</p>`));
        UI.renderWho(el.querySelector('[data-who]'), s.players);
        return;
      }
      if (st === 'picking') {
        if (Hub.screen(el, 'pick' + g.round + (g.picker ? g.picker.id : '') + Hub.lang, `<div class="ef-spin">
            <p class="eyebrow">${esc(t('ef.roundOf', { n: num(g.round + 1), of: num(g.settings.rounds) }))}</p>
            ${avatar(g.picker ? g.picker.name : '?', 'ef-picker-av')}
            <h2>${esc(t('ef.choosingLetter', { name: g.picker ? g.picker.name : '' }))}</h2>
            <div class="ef-paper ef-letter-big ${g.settings.alphabet} idle" id="ef-idle-letter">?</div>
            ${Hub.ring(g.pickEndsAt, 20, 'ef-ring small')}
          </div>`)) Hub.sfx.pop();
        return;
      }
      if (st === 'spinning') {
        if (Hub.screen(el, 'spin' + g.round, `<div class="ef-spin">
            <p class="eyebrow">${esc(t('ef.roundOf', { n: num(g.round), of: num(g.settings.rounds) }))}</p>
            <h2>${esc(t('ef.theLetterIs'))}</h2>
            <div class="ef-paper ef-letter-big ${g.settings.alphabet}" id="ef-roulette"></div>
          </div>`)) rouletteInto(document.getElementById('ef-roulette'), g);
        return;
      }
      if (st === 'writing' || st === 'stopping') {
        Hub.screen(el, 'write' + g.round + Hub.lang, `<div class="ef-write">
            <section class="ef-left">
              <p class="eyebrow">${esc(t('ef.roundOf', { n: num(g.round), of: num(g.settings.rounds) }))}</p>
              <div class="ef-paper ef-letter ${g.settings.alphabet}">${esc(g.letter)}</div>
              ${Hub.ring(g.endsAt, g.settings.seconds, 'ef-ring')}
            </section>
            <section class="ef-right">
              <div class="ef-cats-row">${g.settings.categories.map(c => catChip(c, g.golden)).join('')}</div>
              <div class="ef-progress" id="ef-progress"></div>
              <p class="ef-hint">✋ ${esc(t('ef.stopHint'))}${g.settings.stopBonus ? ` ${esc(t('ef.stopBonusHint'))}` : ''}</p>
              ${g.golden ? `<p class="ef-golden-note">⭐ ${esc(t('ef.goldenNote', { cat: catLabel(g.golden) }))}</p>` : ''}
            </section>
            <div class="ef-stop-banner" id="ef-stop-banner" hidden></div>
          </div>`);
        const ringEl = el.querySelector('.ef-ring');
        ringEl.dataset.ends = g.endsAt || 0;
        ringEl.dataset.total = st === 'stopping' ? g.settings.stopGrace : g.settings.seconds;
        const prog = document.getElementById('ef-progress');
        const pkey = JSON.stringify(g.participants) + (g.stopBy ? g.stopBy.id : '');
        if (prog.dataset.k !== pkey) { prog.dataset.k = pkey; prog.innerHTML = progressRows(g); }
        const banner = document.getElementById('ef-stop-banner');
        banner.hidden = st !== 'stopping';
        el.querySelector('.ef-write').classList.toggle('stopping', st === 'stopping');
        if (st === 'stopping') {
          Hub.screen(banner, 'stop' + g.stopBy.id, `<span class="sb-hand">✋</span><span class="sb-text"><b>${esc(t('ef.stopWord'))}</b> ${esc(t('ef.stopBy', { name: g.stopBy.name }))}</span><span class="sb-count" data-ends="${g.endsAt}"></span>`);
        }
        return;
      }
      if (st === 'review') {
        const r = g.review;
        const idx = g.reviewIndex;
        Hub.screen(el, 'review' + g.round, `<div class="ef-review">
            <header class="ef-rev-head">
              <div class="ef-paper ef-letter-sm ${g.settings.alphabet}">${esc(g.letter)}</div>
              <div><p class="eyebrow">${esc(t('ef.checking'))}</p><h2 id="ef-rev-cat"></h2></div>
              <div class="ef-rev-dots" id="ef-rev-dots"></div>
            </header>
            <div class="ef-answers" id="ef-answers"></div>
            <div class="ef-moments" id="ef-moments"></div>
            <p class="ef-hint">👎 ${esc(t('ef.challengeHint'))}</p>
          </div>`);
        document.getElementById('ef-rev-cat').innerHTML = `${CAT_EMOJI[r.cat]} ${esc(catLabel(r.cat))}${r.golden ? ` <span class="ef-golden-tag">⭐ <bdi dir="ltr">×${num(2)}</bdi></span>` : ''}`;
        // "4 people wrote Tehran" / "only Sara answered" — the moments people laugh about
        const moments = r.dupes.slice(0, 2).map(d => `<span class="ef-moment">😅 ${esc(t('ef.sameAnswer', { n: num(d.names.length), text: d.text }))}</span>`)
          .concat(r.solo ? [`<span class="ef-moment solo">🌟 ${esc(t('ef.onlyOne', { name: r.solo }))}</span>`] : []);
        Hub.screen(document.getElementById('ef-moments'), 'm' + idx + moments.join(''), moments.join(''));
        document.getElementById('ef-rev-dots').innerHTML = g.settings.categories.map((c, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${CAT_EMOJI[c]}</i>`).join('');
        const box = document.getElementById('ef-answers');
        if (Hub.screen(box, 'cat' + idx, () => r.rows.map((row, i) => `<div class="ef-ans" data-pid="${esc(row.id)}" style="--i:${i}">
              <div class="ef-ans-who">${avatar(row.name)}<span>${esc(row.name)}</span></div>
              <div class="ef-ans-text" dir="auto"></div>
              <div class="ef-ans-foot"></div></div>`).join(''))) Hub.sfx.whoosh();
        for (const row of r.rows) {
          const card = box.querySelector(`[data-pid="${CSS.escape(row.id)}"]`);
          if (!card) continue;
          card.querySelector('.ef-ans-text').textContent = row.text || '—';
          card.classList.toggle('invalid', !row.valid);
          card.classList.toggle('dupe', row.valid && row.points === 5);
          card.classList.toggle('solo', row.valid && row.points === 20);
          card.querySelector('.ef-ans-foot').innerHTML = pointsBadge(row) + (row.challenges ? `<span class="ef-chal">👎 ${num(row.challenges)}</span>` : '');
        }
        return;
      }
      if (st === 'scores') {
        if (Hub.screen(el, 'scores' + g.round + Hub.lang, `<div class="ef-scores">
            <h2>${esc(t('ef.roundDone', { n: num(g.round), letter: g.letter }))}</h2>
            ${scoreTable(g)}
          </div>`)) Hub.sfx.fanfare();
        return;
      }
      if (st === 'final') {
        if (Hub.screen(el, 'final' + Hub.lang, `<div class="final-screen">
            <p class="eyebrow">${esc(t('core.gameOver'))}</p>
            <h1>🏆 ${esc(t('game.esmfamil.name'))}</h1>
            ${UI.podium(g.standings, r => r.total, r => r.name)}
          </div>`)) { Hub.confetti(160); Hub.sfx.fanfare(); }
      }
    },
    events: {
      'ef:stop': ({ name }) => { Hub.stamp(t('ef.stopWord'), 'stop', name); Hub.sfx.alarm(); },
      'ef:pensDown': () => { Hub.sfx.gong(); },
    },
  };

  // =============== phone ===============
  const pending = {};
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer);
    for (const [cat, text] of Object.entries(pending)) Hub.emit('player:esmfamil:answer', { cat, text });
    for (const k of Object.keys(pending)) delete pending[k];
  }

  const player = {
    mount(root) {
      root.innerHTML = '<div class="ef-ph" id="ef-ph"></div>';
      root.addEventListener('input', (e) => {
        const input = e.target.closest('[data-cat]');
        if (!input) return;
        pending[input.dataset.cat] = input.value;
        input.closest('.ef-field').classList.toggle('filled', !!input.value.trim());
        clearTimeout(saveTimer);
        if (Hub.state && Hub.state.game && Hub.state.game.status === 'stopping') flush();
        else saveTimer = setTimeout(flush, 150);
        updateStopBtn();
      });
      root.addEventListener('focusout', (e) => { if (e.target.closest('[data-cat]')) flush(); });
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('[data-cat]');
        if (!input) return;
        e.preventDefault();
        const all = [...root.querySelectorAll('[data-cat]')];
        const next = all[all.indexOf(input) + 1];
        if (next) next.focus(); else input.blur();
      });
      root.addEventListener('click', (e) => {
        if (e.target.closest('#ef-stop-btn')) {
          flush();
          Hub.emit('player:esmfamil:stop');
          Hub.vibrate([80, 40, 80]);
        }
        const ch = e.target.closest('[data-challenge]');
        if (ch) { Hub.emit('player:esmfamil:challenge', { target: ch.dataset.challenge }); Hub.vibrate(15); }
        const lt = e.target.closest('[data-letter]');
        if (lt && !lt.disabled) { Hub.emit('player:esmfamil:pickLetter', { letter: lt.dataset.letter }); Hub.vibrate(40); }
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ef-ph');
      const st = g.status;
      if (st === 'lobby') { Hub.screen(el, 'lobby' + Hub.lang, UI.phoneLobby('esmfamil')); return; }
      if (st === 'picking') {
        const me = g.picker && g.picker.id === Hub.myId;
        const letters = choosableLetters(g);
        Hub.screen(el, 'pick' + g.round + me + Hub.lang, me
          ? `<div class="ef-ph-pick"><h2>🎯 ${esc(t('ef.youChoose'))}</h2><p class="muted">${esc(t('ef.youChooseSub'))} <span class="pill" data-ends="${g.pickEndsAt}"></span></p>
              <div class="ef-letter-grid ${g.settings.alphabet}">${letters.map(l => `<button data-letter="${esc(l)}" ${g.usedLetters.includes(l) ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div></div>`
          : `<div class="ef-ph-spin"><p>${esc(t('ef.choosingLetter', { name: g.picker ? g.picker.name : '' }))}</p><div class="ef-paper ef-letter-big ${g.settings.alphabet} idle">?</div></div>`);
        if (me && el.dataset.vib !== 'p' + g.round) { el.dataset.vib = 'p' + g.round; Hub.vibrate([60, 40, 60]); }
        return;
      }
      if (st === 'spinning') {
        if (Hub.screen(el, 'spin' + g.round, `<div class="ef-ph-spin"><p>${esc(t('ef.getPen'))}</p><div class="ef-paper ef-letter-big ${g.settings.alphabet}" id="ef-ph-roulette"></div></div>`)) {
          rouletteInto(document.getElementById('ef-ph-roulette'), g);
        }
        return;
      }
      if (st === 'writing' || st === 'stopping') {
        const fresh = Hub.screen(el, 'write' + g.round + Hub.lang, () => `<div class="ef-sheet">
            <div class="ef-sheet-head">
              <div class="ef-paper ef-letter-sm ${g.settings.alphabet}">${esc(g.letter)}</div>
              <div class="ef-sheet-title"><b>${esc(t('ef.startsWith', { letter: g.letter }))}</b><small>${esc(t('ef.roundOf', { n: num(g.round), of: num(g.settings.rounds) }))}</small></div>
              <span class="ef-sheet-time" data-ends="${g.endsAt}" data-format="clock"></span>
            </div>
            <div class="ef-ph-banner" id="ef-ph-banner" hidden></div>
            <div class="ef-fields">${g.settings.categories.map((c, i) => `<label class="ef-field ${c === g.golden ? 'golden' : ''}" style="--i:${i}">
              <span class="ef-f-label">${CAT_EMOJI[c]} ${esc(catLabel(c))}${c === g.golden ? ` <b class="x2">⭐ <bdi dir="ltr">×${num(2)}</bdi></b>` : ''}</span>
              <input type="text" data-cat="${c}" maxlength="32" autocomplete="off" autocapitalize="words" spellcheck="false" dir="auto" enterkeyhint="next">
            </label>`).join('')}</div>
            <button class="ef-stop-btn" id="ef-stop-btn" disabled><span>✋ ${esc(t('ef.stopWord'))}</span><small>${esc(t('ef.stopFill'))}</small></button>
          </div>`);
        if (fresh && g.mine) {
          el.querySelectorAll('[data-cat]').forEach(input => {
            input.value = g.mine[input.dataset.cat] || '';
            input.closest('.ef-field').classList.toggle('filled', !!input.value.trim());
          });
        }
        el.querySelector('.ef-sheet-time').dataset.ends = g.endsAt || 0;
        const banner = document.getElementById('ef-ph-banner');
        const stopping = st === 'stopping';
        banner.hidden = !stopping;
        if (stopping) {
          const mine = g.stopBy && g.stopBy.id === Hub.myId;
          Hub.screen(banner, 'b' + g.stopBy.id, mine
            ? `✋ ${esc(t('ef.youStopped'))}`
            : `✋ <b>${esc(t('ef.stopBy', { name: g.stopBy.name }))}</b> — ${esc(t('ef.finishUp'))} <span data-ends="${g.endsAt}"></span>`);
          if (!mine && banner.dataset.buzzed !== g.stopBy.id) { banner.dataset.buzzed = g.stopBy.id; Hub.vibrate([200, 80, 200]); }
        }
        updateStopBtn();
        return;
      }
      if (st === 'review') {
        flush();
        const r = g.review;
        Hub.screen(el, 'review' + g.round, `<div class="ef-ph-review">
            <p class="eyebrow">${esc(t('ef.checking'))} ${Hub.SEP} ${num(g.reviewIndex + 1)}/${num(g.settings.categories.length)}</p>
            <h2 id="ef-ph-cat"></h2>
            <p class="muted small">${esc(t('ef.tapToChallenge'))}</p>
            <div class="ef-ph-answers" id="ef-ph-answers"></div>
          </div>`);
        el.querySelector('.eyebrow').textContent = `${t('ef.checking')} — ${num(g.reviewIndex + 1)}/${num(g.settings.categories.length)}`;
        document.getElementById('ef-ph-cat').innerHTML = `${CAT_EMOJI[r.cat]} ${esc(catLabel(r.cat))}`;
        const box = document.getElementById('ef-ph-answers');
        box.innerHTML = r.rows.map(row => {
          const mine = row.id === Hub.myId;
          return `<div class="ef-ph-ans ${row.valid ? '' : 'invalid'} ${mine ? 'mine' : ''}">
            ${avatar(row.name)}<span class="pa-text" dir="auto">${esc(row.text || '—')}</span>${pointsBadge(row)}
            ${mine || !row.text ? '<span class="pa-spacer"></span>' : `<button class="pa-chal ${row.challengedByMe ? 'on' : ''}" data-challenge="${esc(row.id)}">👎${row.challenges ? ' ' + num(row.challenges) : ''}</button>`}
          </div>`;
        }).join('');
        return;
      }
      if (st === 'scores' || st === 'final') {
        const me = g.standings.find(r => r.id === Hub.myId);
        const rank = me ? g.standings.findIndex(r => r.total === me.total) + 1 : null;
        const mineRound = g.lastRound && g.lastRound.scores[Hub.myId];
        Hub.screen(el, st + g.round + Hub.lang + (me ? me.total : ''), `<div class="ph-result">
            ${st === 'final' ? `<p class="eyebrow">${esc(t('core.gameOver'))}</p>` : `<p class="eyebrow">${esc(t('ef.roundDone', { n: num(g.round), letter: g.letter }))}</p>`}
            ${me ? `<div class="big-rank">${rank === 1 ? '🏆' : esc(t('core.rank', { n: num(rank) }))}</div>
            <p class="big-score">${num(me.total)} <small>${esc(t('core.pts'))}</small></p>
            ${st === 'scores' && mineRound !== undefined ? `<p class="gain">${Hub.signed(mineRound)} ${esc(t('ef.thisRound'))}</p>${g.lastBonus && g.lastBonus[Hub.myId] ? `<p class="gain bonus">⚡ ${esc(t('ef.stopBonusGot', { n: num(g.lastBonus[Hub.myId]) }))}</p>` : ''}` : ''}` : `<p class="muted">${esc(t('ef.notInRound'))}</p>`}
            ${st === 'scores' && g.roundScores && g.roundScores[Hub.myId] ? `<div class="ef-mine">${g.settings.categories.map(c => `<span class="${g.roundScores[Hub.myId][c] ? '' : 'zero'}">${CAT_EMOJI[c]} ${esc((g.answers[Hub.myId] || {})[c] || '—')} <b>${num(g.roundScores[Hub.myId][c])}</b></span>`).join('')}</div>` : ''}
            <p class="lobby-wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(t('core.waitHost'))}</p>
          </div>`);
      }
    },
    events: {
      'ef:stop': ({ name }) => { Hub.sfx.alarm(); },
      'ef:pensDown': () => { flush(); Hub.vibrate(120); },
    },
    unmount() { flush(); },
  };
  function updateStopBtn() {
    const btn = document.getElementById('ef-stop-btn');
    if (!btn) return;
    const g = Hub.state && Hub.state.game;
    const inputs = [...document.querySelectorAll('#ef-ph [data-cat]')];
    const all = inputs.length && inputs.every(i => i.value.trim());
    btn.disabled = !all || !g || g.status !== 'writing';
    btn.classList.toggle('ready', !btn.disabled);
  }

  // =============== host ===============
  const host = {
    mount(root) {
      root.innerHTML = '<div class="host-grid" id="ef-host"></div>';
      UI.bindEmits(root);
      UI.bindSettings(root, 'host:esmfamil:settings');
      root.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-cat-toggle]');
        if (chip) {
          const cats = Hub.state.game.settings.categories.slice();
          const c = chip.dataset.catToggle;
          const i = cats.indexOf(c);
          if (i >= 0) { if (cats.length > 3) cats.splice(i, 1); } else cats.push(c);
          Hub.emit('host:esmfamil:settings', { categories: cats });
        }
        const j = e.target.closest('[data-judge]');
        if (j) Hub.emit('host:esmfamil:judge', JSON.parse(j.dataset.judge));
      });
      root.addEventListener('change', (e) => {
        if (e.target.id === 'ef-letter-mode') Hub.emit('host:esmfamil:settings', { letterMode: e.target.value });
      });
    },
    update(s) {
      const g = s.game;
      const el = document.getElementById('ef-host');
      const st = g.status;
      const startLabel = st === 'scores' ? (g.round >= g.settings.rounds ? 'Show final results 🏆' : `Next round (${g.round + 1}/${g.settings.rounds}) ▶`) : st === 'final' ? 'Play again ▶' : 'Start round 1 ▶';
      const nextRound = st === 'scores' ? g.round + 1 : 1;
      const moreRounds = st !== 'scores' || g.round < g.settings.rounds;
      // Persian or English letters: up front, because it decides the whole game.
      const alphaPick = `<div class="ef-h-alpha"><b>Letters</b><div class="seg">${[['fa', 'ا ب پ', 'Persian'], ['en', 'A B C', 'English']]
        .map(([k, sample, label]) => `<button class="${g.settings.alphabet === k ? 'active' : ''}" data-emit="host:esmfamil:settings" data-args='{"alphabet":"${k}"}'><bdi>${sample}</bdi> ${label}</button>`).join('')}</div></div>`;
      // "Me" mode: the host taps the letter that starts the next round (used ones greyed out).
      const letterGrid = () => `<p class="muted small">Tap the letter for round ${nextRound}:</p>
          <div class="ef-letter-grid ef-h-letters ${g.settings.alphabet}">${choosableLetters(g).map(l => `<button data-emit="host:esmfamil:start" data-args="${esc(JSON.stringify({ letter: l }))}" ${st !== 'final' && g.usedLetters.includes(l) ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>
          <div class="h-btns"><button data-emit="host:esmfamil:start">🎲 Random letter</button></div>`;
      const startControls = g.settings.letterMode === 'host' && moreRounds
        ? letterGrid()
        : `<button class="primary big-btn" data-emit="host:esmfamil:start">${startLabel}</button>`;
      const settingsCard = `<section class="h-card">
          <h2>Settings</h2>
          <div class="h-fields">
            ${UI.hostField('Seconds to write', UI.numberInput('seconds', g.settings.seconds, 30, 600, 10))}
            ${UI.hostField('After STOP, others get (sec)', UI.numberInput('stopGrace', g.settings.stopGrace, 0, 60))}
            ${UI.hostField('Rounds', UI.numberInput('rounds', g.settings.rounds, 1, 30))}
          </div>
          ${UI.hostField('Who picks the letter', `<select id="ef-letter-mode">${[['random', 'Random draw'], ['host', 'Me (tap it on this screen)'], ['player', 'A player (takes turns, 20 sec)']]
            .map(([k, label]) => `<option value="${k}" ${g.settings.letterMode === k ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
          ${UI.toggle('hardLetters', g.settings.hardLetters, 'Include hard letters', (HARD[g.settings.alphabet] || HARD.fa).join(' '))}
          ${UI.toggle('golden', g.settings.golden, '⭐ Golden category', 'One random category each round is worth double')}
          ${UI.toggle('stopBonus', g.settings.stopBonus, '⚡ STOP bonus', '+5 for calling STOP — only if all your answers are accepted')}
          <h3>Categories <span class="muted small">(${g.settings.categories.length} — tap to add/remove)</span></h3>
          <div class="cat-picker">${ALL_CATS.map(c => `<button class="cat-pick ${g.settings.categories.includes(c) ? 'on' : ''}" data-cat-toggle="${c}">${CAT_EMOJI[c]} ${esc(HUB_STRINGS.en[`ef.cat.${c}`])} <span class="fa-name">${esc(HUB_STRINGS.fa[`ef.cat.${c}`])}</span></button>`).join('')}</div>
        </section>`;
      if (st === 'lobby' || st === 'final') {
        Hub.screen(el, st + JSON.stringify(g.settings) + JSON.stringify(s.players), `
          <section class="h-card span2 h-hero">
            <h2>${st === 'final' ? '🏆 Game over' : '✍️ Esm-Famil'}</h2>
            <p class="muted small">Everyone fills in the categories on their phone. Scoring: 20 if you're the only one with an answer, 10 for a unique answer, 5 if someone else wrote the same thing.</p>
            ${alphaPick}
            ${startControls}
            ${st === 'final' ? '<button data-emit="host:esmfamil:newGame">Reset scores</button>' : ''}
            <div class="roster">${UI.hostRoster(s.players)}</div>
          </section>
          ${settingsCard}`);
        UI.syncSettings(el, g.settings);
        return;
      }
      if (st === 'picking') {
        Hub.screen(el, 'pick' + g.round, `<section class="h-card span2 h-hero"><h2>🎯 ${esc(g.picker ? g.picker.name : '')} is choosing the letter</h2>
          <p class="muted small">They get 20 seconds, then it's drawn at random. <span data-ends="${g.pickEndsAt}"></span>s left</p>
          <div class="h-btns"><button class="primary" data-emit="host:esmfamil:randomLetter">🎲 Draw one now</button></div></section>`);
        return;
      }
      if (st === 'spinning' || st === 'writing' || st === 'stopping') {
        Hub.screen(el, 'live' + g.round, `
          <section class="h-card span2 h-hero">
            <div class="h-live-head"><div class="ef-paper ef-letter-sm ${g.settings.alphabet}">${esc(g.letter)}</div>
              <div><h2>Round ${g.round} of ${g.settings.rounds}</h2><p class="muted small" id="ef-h-status"></p></div>
              <span class="h-timer" data-ends="${g.endsAt || 0}" data-format="clock"></span></div>
            <div class="ef-h-progress" id="ef-h-progress"></div>
            <div class="h-btns">
              <button data-emit="host:esmfamil:addTime" data-args='{"seconds":30}'>+30 sec</button>
              <button class="primary" data-emit="host:esmfamil:forceStop">✋ Pens down now</button>
              <button class="danger" data-emit="host:esmfamil:end" data-confirm="Tap again to end the game">End game</button>
            </div>
          </section>`);
        el.querySelector('.h-timer').dataset.ends = g.endsAt || 0;
        document.getElementById('ef-h-status').textContent = st === 'spinning' ? 'Drawing the letter…' : st === 'stopping' ? `✋ STOP by ${g.stopBy.name} — others are finishing up` : 'Players are writing…';
        const total = g.settings.categories.length;
        document.getElementById('ef-h-progress').innerHTML = g.participants.map(p => `<div class="ef-h-row">${avatar(p.name)} <b>${esc(p.name)}</b> <span class="bar"><i style="width:${(p.filled / total) * 100}%"></i></span> ${p.filled}/${total}</div>`).join('');
        return;
      }
      if (st === 'review' || st === 'scores') {
        const cats = g.settings.categories;
        const v = g.allVerdicts || {};
        const curCat = st === 'review' ? cats[g.reviewIndex] : null;
        el.innerHTML = `
          <section class="h-card span2 h-hero">
            <div class="h-live-head"><div class="ef-paper ef-letter-sm ${g.settings.alphabet}">${esc(g.letter)}</div>
              <div><h2>${st === 'review' ? `Checking: ${CAT_EMOJI[curCat]} ${esc(HUB_STRINGS.en[`ef.cat.${curCat}`])} (${g.reviewIndex + 1}/${cats.length})` : `Round ${g.round} scored`}</h2>
              <p class="muted small">${st === 'review' ? 'Players can 👎 answers on their phones: rejected once half of the other players object (and at least 2). Your ✓/✗ overrides everything.' : 'Spotted a bad call? Tap ✓/✗ — the round re-scores instantly.'}</p></div></div>
            ${st === 'scores' && moreRounds ? `${alphaPick}${g.settings.letterMode === 'host' ? letterGrid() : ''}` : ''}
            <div class="h-btns">
              ${st === 'review' ? `<button data-emit="host:esmfamil:reviewNav" data-args='{"dir":-1}' ${g.reviewIndex === 0 ? 'disabled' : ''}>◀ Previous</button>
              <button class="primary" data-emit="host:esmfamil:reviewNav" data-args='{"dir":1}'>${g.reviewIndex === cats.length - 1 ? 'Score the round ✓' : 'Next category ▶'}</button>`
              : g.settings.letterMode === 'host' && moreRounds ? '' : `<button class="primary big-btn" data-emit="host:esmfamil:start">${startLabel}</button>`}
              <button class="danger" data-emit="host:esmfamil:end" data-confirm="Tap again to end the game">End game</button>
            </div>
          </section>
          <section class="h-card span2">
            <div class="ef-h-grid-wrap"><table class="ef-h-grid"><thead><tr><th></th>${cats.map(c => `<th class="${c === curCat ? 'cur' : ''}">${CAT_EMOJI[c]}</th>`).join('')}</tr></thead><tbody>
            ${g.participants.map(p => `<tr><th>${avatar(p.name)} ${esc(p.name)}</th>${cats.map(c => {
              const x = (v[c] || {})[p.id];
              if (!x) return '<td></td>';
              const args = esc(JSON.stringify({ target: p.id, cat: c, verdict: x.override === 'accept' ? null : 'accept' }));
              const argsR = esc(JSON.stringify({ target: p.id, cat: c, verdict: x.override === 'reject' ? null : 'reject' }));
              return `<td class="${x.valid ? 'ok' : 'bad'} ${c === curCat ? 'cur' : ''}"><span class="hg-text" dir="auto">${esc(x.text || '—')}</span>
                <span class="hg-meta">${x.valid ? `+${x.points}` : '0'}${x.challengers ? ` · 👎${x.challengers}` : ''}${x.reason && !x.valid ? ` · ${x.reason}` : ''}</span>
                ${x.text ? `<span class="hg-btns"><button class="${x.override === 'accept' ? 'on' : ''}" data-judge="${args}">✓</button><button class="${x.override === 'reject' ? 'on' : ''}" data-judge="${argsR}">✗</button></span>` : ''}</td>`;
            }).join('')}</tr>`).join('')}
            </tbody></table></div>
          </section>`;
        return;
      }
    },
  };

  Hub.register('esmfamil', { tv, player, host });
})();

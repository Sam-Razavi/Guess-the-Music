// The hub menu: "what are we playing?" — game cards on the TV (with the
// players' votes stacking up on them), a vote list on the phones, and the
// launch buttons on the host page.

(function () {
  const { t, tOther, num, esc, avatar } = Hub;

  function votesFor(s, id) {
    return Object.entries(s.hub.votes || {}).filter(([, g]) => g === id).map(([pid]) => pid);
  }
  function topVoted(s) {
    const counts = {};
    for (const g of Object.values(s.hub.votes || {})) counts[g] = (counts[g] || 0) + 1;
    const best = Math.max(0, ...Object.values(counts));
    return best > 0 ? Object.keys(counts).filter(k => counts[k] === best) : [];
  }

  function trophyList(s, limit) {
    const list = (s.hub.trophies || []).slice(0, limit);
    if (!list.length) return `<p class="muted trophy-empty">${esc(t('hub.noTrophies'))}</p>`;
    return list.map((tr, i) => {
      const m = UI.gameMeta(tr.game);
      return `<div class="trophy-row" style="--i:${i}"><span class="trophy-ico">${m.art[0]}</span><span class="trophy-names" dir="auto">${esc(tr.names.join(Hub.lang === 'fa' ? '، ' : ', '))}</span><span class="trophy-game">${esc(t(`game.${tr.game}.name`))}</span></div>`;
    }).join('');
  }

  // Party points for the night: who's winning the whole evening.
  function nightList(s, limit) {
    const rows = (s.hub.night || []).slice(0, limit);
    if (!rows.length) return `<p class="muted trophy-empty">${esc(t('hub.noTrophies'))}</p>`;
    return rows.map((r, i) => `<div class="night-row ${i === 0 ? 'lead' : ''}" style="--i:${i}">${i === 0 ? '<span class="night-crown">👑</span>' : `<b class="night-rank">${num(i + 1)}</b>`}${avatar(r.name)}<bdi class="night-name">${esc(r.name)}</bdi><span class="night-pts">${num(r.points)}</span></div>`).join('');
  }

  // "Surprise me": a spotlight hops across the game cards, slowing down, and
  // lands on the server's pick when the spin ends (then the game launches).
  let spinning = null;
  function runSpin(s, cards) {
    const spin = s.hub.spin;
    if (!spin || spinning === spin.endsAt) return;
    spinning = spin.endsAt;
    const list = [...cards.querySelectorAll('.hub-card[data-game]')];
    const target = list.findIndex(c => c.dataset.game === spin.game);
    cards.classList.add('spinning');
    let i = Math.floor(Math.random() * list.length);
    const step = () => {
      if (!cards.isConnected) return;
      const left = spin.endsAt - Hub.now();
      list.forEach(c => c.classList.remove('spot'));
      if (left <= 350) {
        list[target].classList.add('spot', 'landed');
        Hub.sfx.fanfare();
        Hub.stamp(t(`game.${spin.game}.name`), 'gold');
        return;
      }
      i = (i + 1) % list.length;
      list[i].classList.add('spot');
      Hub.sfx.tick();
      setTimeout(step, 70 + Math.max(0, 1 - left / 4800) ** 2 * 420);
    };
    Hub.sfx.whoosh();
    step();
  }

  // ---------------- TV ----------------
  const tv = {
    mount(root) {
      root.innerHTML = `<div class="hub-tv">
        <section class="hub-main">
          <h1 class="hub-heading"><span>${esc(t('hub.whatPlay'))}</span></h1>
          <div class="hub-cards" id="hub-cards"></div>
        </section>
        <aside class="hub-side">
          <div class="qr-card tall">
            <img src="/qr.png" alt="" class="qr">
            <span class="eyebrow">${esc(t('core.scan'))}</span>
            <p class="qr-url" dir="ltr" data-join-url>${esc(Hub.joinUrl)}</p>
          </div>
          <div class="side-box"><h3>${esc(t('hub.here'))}</h3><div class="who" data-who></div></div>
          <p class="hub-tip">${esc(t('hub.voteTip'))}</p>
        </aside>
      </div>`;
    },
    update(s) {
      const cards = document.getElementById('hub-cards');
      Hub.screen(cards, Hub.lang, () => HUB_GAMES.map((g, i) => `
        <article class="hub-card" data-game="${g.id}" style="--g1:${g.grad[0]};--g2:${g.grad[1]};--i:${i}">
          <div class="hc-art">${g.art.map((a, j) => `<span class="hca hca${j}">${a}</span>`).join('')}</div>
          <div class="hc-body">
            <h2 class="hc-name">${esc(t(`game.${g.id}.name`))}</h2>
            <p class="hc-alt"><bdi dir="${Hub.lang === 'fa' ? 'ltr' : 'rtl'}">${esc(tOther(`game.${g.id}.name`))}</bdi></p>
            <p class="hc-tag">${esc(t(`game.${g.id}.tag`))}</p>
            <div class="hc-meta"><span>👥 ${num(g.players)}</span><span>⏱ ${num(g.mins)}′</span></div>
          </div>
          <div class="hc-votes"></div>
          <span class="hc-ribbon">${esc(t('hub.mostWanted'))}</span>
        </article>`).join('') + `
        <article class="hub-card trophy-card" style="--i:${HUB_GAMES.length}">
          <h2 class="tc-title">🏆 ${esc(t('hub.champions'))}</h2>
          <div class="tc-list"></div>
        </article>`);
      const top = topVoted(s);
      cards.querySelectorAll('.hub-card[data-game]').forEach(card => {
        const id = card.dataset.game;
        const voters = votesFor(s, id);
        const box = card.querySelector('.hc-votes');
        const key = voters.join(',');
        if (box.dataset.k !== key) {
          box.dataset.k = key;
          box.innerHTML = voters.map(v => avatar(Hub.playerName(v), 'vote-av')).join('') + (voters.length ? `<b class="vote-n">${num(voters.length)}</b>` : '');
          if (voters.length) Hub.sfx.pop();
        }
        card.classList.toggle('wanted', top.includes(id));
      });
      const tc = cards.querySelector('.tc-list');
      const tkey = JSON.stringify([s.hub.night, s.hub.trophies.slice(0, 3)]) + Hub.lang;
      if (tc.dataset.k !== tkey) { tc.dataset.k = tkey; tc.innerHTML = nightList(s, 4) + (s.hub.trophies.length ? `<div class="tc-recent">${s.hub.trophies.slice(0, 3).map(tr => `<span>${UI.gameMeta(tr.game).art[0]} <bdi>${esc(tr.names[0])}</bdi></span>`).join('')}</div>` : ''); }
      UI.renderWho(document.querySelector('.hub-tv [data-who]'), s.players);
      runSpin(s, cards);
    },
  };

  // ---------------- phone ----------------
  const player = {
    mount(root) {
      root.innerHTML = `<div class="ph-hub">
        <div class="ph-hello"><h1 id="ph-hello"></h1><p class="ph-night" id="ph-night" hidden></p><p>${esc(t('hub.voteNext'))}</p></div>
        <p class="ph-spin" id="ph-spin" hidden>🎲 ${esc(t('hub.spinning'))}</p>
        <div class="ph-games" id="ph-games"></div>
      </div>`;
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-vote]');
        if (!b) return;
        Hub.emit('player:hub:vote', { game: b.dataset.vote });
        Hub.vibrate(15);
        Hub.sfx.pop();
      });
    },
    update(s) {
      const name = (s.me && s.me.name) || '';
      document.getElementById('ph-hello').textContent = t('hub.hello', { name });
      const nightEl = document.getElementById('ph-night');
      const rank = s.me ? (s.hub.night || []).findIndex(r => r.id === s.me.id) : -1;
      nightEl.hidden = rank < 0;
      if (rank >= 0) nightEl.textContent = t('hub.myNight', { n: num(s.hub.night[rank].points), rank: num(rank + 1) });
      document.getElementById('ph-spin').hidden = !s.hub.spin;
      const mine = s.me ? s.hub.votes[s.me.id] : null;
      const box = document.getElementById('ph-games');
      Hub.screen(box, Hub.lang, () => HUB_GAMES.map((g, i) => `
        <button class="ph-game" data-vote="${g.id}" style="--g1:${g.grad[0]};--g2:${g.grad[1]};--i:${i}">
          <span class="pg-art">${g.art[0]}</span>
          <span class="pg-text"><b>${esc(t(`game.${g.id}.name`))}</b><small>${esc(t(`game.${g.id}.tag`))}</small></span>
          <span class="pg-votes"></span>
        </button>`).join(''));
      box.querySelectorAll('[data-vote]').forEach(b => {
        const n = votesFor(s, b.dataset.vote).length;
        b.classList.toggle('mine', mine === b.dataset.vote);
        b.querySelector('.pg-votes').textContent = n ? `♥ ${num(n)}` : '';
      });
    },
  };

  // ---------------- host ----------------
  const host = {
    mount(root) {
      root.innerHTML = `<div class="host-grid">
        <section class="h-card span2">
          <div class="h-row"><h2>Choose a game</h2><button class="pill surprise" data-emit="host:hub:surprise">🎲 Surprise me</button></div>
          <p class="muted small">Everything — the TV and every phone — switches to it. Players can vote on their phones while you decide; "Surprise me" spins the TV and picks one (weighted by the votes).</p>
          <div class="launch-grid" id="launch-grid"></div>
        </section>
        <section class="h-card">
          <h2>Players <span class="muted small" id="h-count"></span></h2>
          <div class="roster" id="h-roster"></div>
          <p class="muted small">Tap ✕ twice to remove someone (their scores go too).</p>
        </section>
        <section class="h-card">
          <h2>Champion of the night</h2>
          <p class="muted small">Every finished game gives 3 / 2 / 1 party points for 1st / 2nd / 3rd.</p>
          <div id="h-night"></div>
          <div id="h-trophies"></div>
          <button class="danger small-btn" data-emit="host:hub:clearTrophies" data-confirm="Tap again — clears points and trophies">Start a new night</button>
        </section>
      </div>`;
      UI.bindEmits(root);
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-launch]');
        if (b) Hub.emit('host:hub:select', { game: b.dataset.launch });
        const k = e.target.closest('[data-kick]');
        if (k) {
          if (!k.classList.contains('armed')) {
            k.classList.add('armed');
            setTimeout(() => k.classList.remove('armed'), 2500);
          } else Hub.socket.emit('host:removePlayer', { id: k.dataset.kick });
        }
      });
    },
    update(s) {
      const grid = document.getElementById('launch-grid');
      Hub.screen(grid, 'v1', () => HUB_GAMES.map(g => `
        <div class="launch" data-game="${g.id}" style="--g1:${g.grad[0]};--g2:${g.grad[1]}">
          <span class="l-art">${g.art[0]}</span>
          <span class="l-text"><b>${esc(HUB_STRINGS.en[`game.${g.id}.name`])} <span class="fa-name">${esc(HUB_STRINGS.fa[`game.${g.id}.name`])}</span></b><small>${esc(HUB_STRINGS.en[`game.${g.id}.tag`])}</small><small class="l-meta">👥 ${g.players} · ⏱ ${g.mins} min</small></span>
          <span class="l-votes"></span>
          <button class="primary" data-launch="${g.id}">Launch ▶</button>
        </div>`).join(''));
      grid.querySelectorAll('.launch').forEach(el => {
        const n = votesFor(s, el.dataset.game).length;
        el.querySelector('.l-votes').textContent = n ? `${n} vote${n > 1 ? 's' : ''}` : '';
      });
      document.getElementById('h-count').textContent = `(${s.players.filter(p => p.connected).length} online)`;
      const roster = document.getElementById('h-roster');
      const rkey = JSON.stringify(s.players);
      if (roster.dataset.k !== rkey) {
        roster.dataset.k = rkey;
        roster.innerHTML = s.players.map(p => `<span class="roster-chip ${p.connected ? '' : 'off'}">${avatar(p.name)} ${esc(p.name)}<button class="kick" data-kick="${esc(p.id)}" title="Remove">✕</button></span>`).join('') || '<span class="muted small">No one has joined yet — they scan the QR code on the TV.</span>';
      }
      const nb = document.getElementById('h-night');
      const nkey = JSON.stringify(s.hub.night);
      if (nb.dataset.k !== nkey) {
        nb.dataset.k = nkey;
        nb.innerHTML = (s.hub.night || []).map((r, i) => `<div class="trophy-row">${i === 0 ? '👑' : `<b>${i + 1}</b>`} ${avatar(r.name)} <b>${esc(r.name)}</b> <span class="muted small">${r.points} pts</span></div>`).join('');
      }
      const tr = document.getElementById('h-trophies');
      const tkey = JSON.stringify(s.hub.trophies);
      if (tr.dataset.k !== tkey) {
        tr.dataset.k = tkey;
        tr.innerHTML = s.hub.trophies.length
          ? s.hub.trophies.slice(0, 10).map(x => `<div class="trophy-row">${UI.gameMeta(x.game).art[0]} <b>${esc(x.names.join(', '))}</b> <span class="muted small">${esc(HUB_STRINGS.en[`game.${x.game}.name`])}</span></div>`).join('')
          : '<p class="muted small">No winners yet tonight.</p>';
      }
    },
  };

  Hub.register('hub', { tv, player, host });
})();

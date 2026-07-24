/* Helheim — HUD, modals, and input wiring */
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);

  function update() {
    const st = Game.state;
    if (!st) return;
    const p = st.player;

    // Hearts
    let hearts = '';
    for (let i = 0; i < p.maxHp; i++) {
      hearts += `<span class="heart ${i < p.hp ? 'full' : 'empty'}">♥</span>`;
    }
    $('hearts').innerHTML = hearts;

    // Vigor bar
    const pct = Math.round((p.energy / p.maxEnergy) * 100);
    $('vigor-fill').style.width = pct + '%';
    $('vigor-text').textContent = `${p.energy} / ${p.maxEnergy}`;
    $('vigor-fill').classList.toggle('low', p.energy < 50);

    // Depth & glory
    $('depth').textContent = st.depth;
    $('kills').textContent = st.glory;

    // Buttons
    const throwBtn = $('btn-throw');
    throwBtn.disabled = st.over || !p.hasSpear;
    throwBtn.classList.toggle('active', Game.getMode() === 'throw');
    throwBtn.querySelector('.sub').textContent = p.hasSpear ? `range ${p.throwRange}` : 'thrown';

    const bashBtn = $('btn-bash');
    bashBtn.disabled = st.over || p.bashCd > 0;
    bashBtn.classList.toggle('active', Game.getMode() === 'bash');
    bashBtn.querySelector('.sub').textContent = p.bashCd > 0 ? `ready in ${p.bashCd}` : 'ready';

    const leapBtn = $('btn-leap');
    leapBtn.disabled = st.over || p.energy < 50 || st.bonusAction;
    leapBtn.classList.toggle('active', Game.getMode() === 'leap');
    leapBtn.querySelector('.sub').textContent =
      st.bonusAction ? 'no double leap' :
      p.energy < 50 ? 'need 50 vigor' :
      '50 vigor · ' + Game.leapRange() + ' tiles';

    $('btn-wait').disabled = st.over;

    const recallBtn = $('btn-recall');
    recallBtn.style.display = Game.has('recall') ? '' : 'none';
    recallBtn.disabled = st.over || p.hasSpear || !p.spearAt;

    const followBtn = $('btn-follow');
    followBtn.style.display = Game.has('follow') ? '' : 'none';
    followBtn.disabled = st.over || p.hasSpear || !p.spearAt;

    // Blessing chips (name + what it does)
    const chips = [...p.blessings].map(id => {
      const b = BLESSINGS.find(x => x.id === id);
      return `<span class="chip"><b>${b.name}</b><span class="chip-desc"> — ${b.desc}</span></span>`;
    }).join('');
    $('blessing-chips').innerHTML = chips || '<span class="chip none">No blessings yet</span>';

    // Native shell: same list lives in a popup instead of below the board
    const owned = [...p.blessings].map(id => {
      const b = BLESSINGS.find(x => x.id === id);
      return `<div class="owned-blessing"><span class="b-name">${b.name}</span><span class="b-desc">${b.desc}</span></div>`;
    }).join('');
    $('blessing-owned').innerHTML = owned ||
      '<p class="owned-empty">No blessings yet — seek the runestones.</p>';
    $('btn-blessings').querySelector('.sub').textContent =
      p.blessings.size ? p.blessings.size + ' held' : 'none';

    // Rune hint
    const canPray = !st.runeUsed && hexDist(p, st.rune) === 1 && !st.over;
    $('pray-hint').style.display = canPray ? '' : 'none';
  }

  function setLog(msg) {
    const el = $('log');
    el.textContent = msg;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function hurtFlash() {
    const el = $('board-wrap');
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
  }

  function flashDepth(depth, name) {
    const el = $('depth-banner');
    el.innerHTML = `<div class="d-num">Depth ${depth}</div>` + (name ? `<div class="d-name">${name}</div>` : '');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /* ---------- modals ---------- */

  function showBlessings(choices, onPick) {
    const list = $('blessing-list');
    list.innerHTML = '';
    let picked = false;
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'blessing-btn' +
        (c.id === 'mend' ? ' mend' : '') + (c.id === 'fortitude' ? ' heart' : '');
      btn.innerHTML = `<span class="b-name">${c.name}</span><span class="b-desc">${c.desc}</span>`;
      btn.addEventListener('click', () => {
        if (picked) return;
        picked = true;
        $('modal-blessing').classList.remove('open');
        list.innerHTML = '';
        onPick(c);
      });
      list.appendChild(btn);
    }
    $('modal-blessing').classList.add('open');
  }

  function showDeath(cause, run, rank) {
    $('death-cause').textContent = cause + ' ended your saga.';
    $('death-stats').innerHTML =
      `You fell at <b>Depth ${run.depth}</b>${run.title ? ' — ' + run.title : ''}<br>` +
      `Glory: <b>${run.glory}</b> (${run.kills} foes slain)<br>` +
      `${rank ? `<span class="newbest">⚔ Ranked #${rank} among your sagas ⚔</span>` : 'This saga will not be sung.'}`;
    lastRunWhen = run.when;
    $('modal-death').classList.add('open');
  }

  function hideDeath() { $('modal-death').classList.remove('open'); }

  let lastRunWhen = null;

  function renderLeaderboard() {
    const runs = Game.loadRuns();
    const el = $('leaderboard');
    if (!runs.length) {
      el.innerHTML = '<p class="lb-empty">No sagas sung yet. Yours will be the first.</p>';
      return;
    }
    const rows = runs.map((r, i) =>
      `<tr class="${r.when === lastRunWhen ? 'latest' : ''}">
        <td>${i + 1}</td><td class="lb-glory">${r.glory}</td><td>${r.depth}</td>
        <td>${r.kills}</td><td class="lb-date">${new Date(r.when).toLocaleDateString()}</td>
      </tr>`).join('');
    el.innerHTML =
      `<h3>Songs of the Fallen</h3>
      <table class="lb-table">
        <thead><tr><th>#</th><th>Glory</th><th>Depth</th><th>Slain</th><th>When</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function showIntro() {
    renderLeaderboard();
    $('modal-intro').classList.add('open');
  }

  /* ---------- wiring ---------- */

  function init() {
    // Inside the native iOS shell (detected via the haptics bridge): no keyboard,
    // and vertical space is precious — kbd badges hide, blessings become a popup.
    const isNative = !!(window.webkit && window.webkit.messageHandlers &&
                        window.webkit.messageHandlers.haptic);
    if (isNative) document.body.classList.add('native');

    $('version').textContent = 'Helheim ' + GAME_VERSION + ' · open source (MIT)';

    const canvas = $('board');
    Renderer.init(canvas);

    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      Game.clickTile(Renderer.pixelToTile(e.clientX - rect.left, e.clientY - rect.top));
    });
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const h = Renderer.pixelToTile(e.clientX - rect.left, e.clientY - rect.top);
      Renderer.setHover(h);
      // Tooltip
      const tip = $('tooltip');
      if (h && Game.state && !Game.state.over) {
        const f = Game.foeAt(h);
        const b = Game.bombAt(h);
        let text = '';
        if (f) {
          const def = FOES[f.type];
          text = `<b>${f.elite ? 'Ancient ' : ''}${def.name}</b>${f.elite ? ' (2 hits)' : ''} — ${def.desc}`;
        } else if (b) {
          text = `<b>Burning ember</b> — bursts ${b.fuse <= 1 ? 'after your next move' : 'soon'}, scorching all adjacent tiles.`;
        } else if (hexEq(h, Game.state.rune)) {
          text = Game.state.runeUsed
            ? '<b>Runestone</b> — its power is spent for this depth.'
            : '<b>Runestone</b> — stand beside it and tap it to receive a blessing (once per depth).';
        } else if (hexEq(h, Game.state.stairs)) {
          text = '<b>Descending stair</b> — step here to delve deeper. When the floor is clear, tap it to walk there automatically.';
        } else if (Game.state.player.spearAt && hexEq(h, Game.state.player.spearAt)) {
          text = '<b>Your spear</b> — step onto it to pick it up.';
        } else if (Game.tileAt(h) && Game.tileAt(h).lava) {
          text = '<b>Fire rift</b> — instantly fatal. Bash foes into it.';
        }
        if (text) {
          tip.innerHTML = text;
          tip.style.display = 'block';
        } else tip.style.display = 'none';
      } else tip.style.display = 'none';
    });
    canvas.addEventListener('mouseleave', () => {
      Renderer.setHover(null);
      $('tooltip').style.display = 'none';
    });

    $('btn-throw').addEventListener('click', () => Game.setMode('throw'));
    $('btn-bash').addEventListener('click', () => Game.setMode('bash'));
    $('btn-leap').addEventListener('click', () => Game.setMode('leap'));
    $('btn-wait').addEventListener('click', () => Game.actWait());
    $('btn-recall').addEventListener('click', () => Game.actRecall());
    $('btn-follow').addEventListener('click', () => Game.actFollow());
    $('btn-help').addEventListener('click', () => $('modal-help').classList.add('open'));
    $('help-close').addEventListener('click', () => $('modal-help').classList.remove('open'));
    $('btn-blessings').addEventListener('click', () => $('modal-runes').classList.add('open'));
    $('runes-close').addEventListener('click', () => $('modal-runes').classList.remove('open'));
    $('btn-mute').addEventListener('click', () => {
      const muted = Game.Sound.toggleMute();
      $('btn-mute').textContent = muted ? '🔇' : '🔊';
    });
    $('btn-mute').textContent = Game.Sound.isMuted() ? '🔇' : '🔊';

    $('death-restart').addEventListener('click', () => {
      hideDeath();
      showIntro();
    });
    $('intro-start').addEventListener('click', () => {
      $('modal-intro').classList.remove('open');
      Game.newGame();
    });

    document.addEventListener('keydown', e => {
      if (!Game.state || Game.state.modal) return;
      switch (e.key.toLowerCase()) {
        case 't': Game.setMode('throw'); break;
        case 'b': Game.setMode('bash'); break;
        case 'l': Game.setMode('leap'); break;
        case 'r': Game.actRecall(); break;
        case 'f': Game.actFollow(); break;
        case 'w': case ' ': e.preventDefault(); Game.actWait(); break;
        case 'escape': Game.setMode(Game.getMode()); break; // toggles off
        case '?': $('modal-help').classList.toggle('open'); break;
      }
    });

    showIntro();
  }

  return { init, update, setLog, hurtFlash, flashDepth, showBlessings, showDeath, showIntro };
})();

document.addEventListener('DOMContentLoaded', UI.init);

/* Helheim — development mode: per-floor turn history, replay paging, bug reports.
   Recording is always on (a snapshot is ~2 KB and history resets each floor).
   The replay bar is hidden until toggled with ` (backtick) or ?dev=1. */
'use strict';

const Dev = (() => {
  const SS_KEY = 'helheim-dev-history';
  let history = [];        // serialized snapshots for the current floor, oldest first
  let viewIndex = -1;      // -1 = live game
  let liveState = null;    // real state parked while paging history
  let hiddenModals = [];   // modals closed while paging, to restore on Live
  let enabled = false;
  let bar = null;

  /* ---------- snapshots ---------- */

  function serialize(st) {
    return {
      depth: st.depth,
      depthTitle: st.depthTitle,
      lava: [...st.tiles.values()].filter(t => t.lava).map(t => hexKey(t.q, t.r)),
      stairs: { ...st.stairs }, rune: { ...st.rune }, runeUsed: st.runeUsed,
      foes: st.foes.map(f => ({ ...f })),
      bombs: st.bombs.map(b => ({ ...b })),
      player: { ...st.player, blessings: [...st.player.blessings] },
      kills: st.kills, glory: st.glory, streak: st.streak,
      berserkUsed: st.berserkUsed, tranceUsed: st.tranceUsed,
      bonusAction: st.bonusAction, shieldBlock: st.shieldBlock,
      floorStartKills: st.floorStartKills,
      over: st.over,
      log: st.log, lastAction: st.lastAction || 'floor start',
    };
  }

  function deserialize(snap, replay) {
    const s = JSON.parse(JSON.stringify(snap)); // defensive copy
    const tiles = new Map();
    for (const c of hexBoard(BOARD_RADIUS)) {
      tiles.set(hexKey(c.q, c.r), { q: c.q, r: c.r, lava: false });
    }
    for (const k of s.lava) {
      const t = tiles.get(k);
      if (t) t.lava = true;
    }
    return {
      depth: s.depth, depthTitle: s.depthTitle, tiles,
      stairs: s.stairs, rune: s.rune, runeUsed: s.runeUsed,
      foes: s.foes, bombs: s.bombs,
      player: { ...s.player, blessings: new Set(s.player.blessings) },
      kills: s.kills, glory: s.glory, streak: s.streak,
      berserkUsed: s.berserkUsed, tranceUsed: s.tranceUsed,
      bonusAction: s.bonusAction, shieldBlock: s.shieldBlock,
      floorStartKills: s.floorStartKills,
      skipBonus: false, pacifistBonus: 0, turnKills: 0,
      over: replay ? false : s.over, modal: null,
      log: s.log, lastAction: s.lastAction,
      replay: !!replay,
    };
  }

  function snapAnims() {
    Renderer.clearAnims();
    const st = Game.state;
    Renderer.setAnim('P', st.player, true);
    for (const f of st.foes) Renderer.setAnim(f.id, f, true);
    for (const b of st.bombs) Renderer.setAnim('b_' + b.id, b, true);
  }

  /* ---------- recording ---------- */

  function record() {
    const st = Game.state;
    if (!st || st.replay) return;
    history.push(serialize(st));
    if (history.length > 500) history.shift();
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(history)); } catch (e) { /* full/blocked */ }
    updateBar();
  }

  function newFloor() {
    if (viewIndex !== -1) live(); // never strand the UI in a stale replay
    history = [];
  }

  /* ---------- replay navigation ---------- */

  function view(i) {
    if (!history.length) return;
    if (viewIndex === -1) {
      liveState = Game.state;
      hiddenModals = ['modal-death', 'modal-intro'].filter(id =>
        document.getElementById(id).classList.contains('open'));
      hiddenModals.forEach(id => document.getElementById(id).classList.remove('open'));
    }
    viewIndex = Math.max(0, Math.min(history.length - 1, i));
    Game.state = deserialize(history[viewIndex], true);
    snapAnims();
    UI.update();
    updateBar();
  }

  function live() {
    if (viewIndex === -1) return;
    viewIndex = -1;
    Game.state = liveState;
    liveState = null;
    hiddenModals.forEach(id => document.getElementById(id).classList.add('open'));
    hiddenModals = [];
    snapAnims();
    UI.update();
    updateBar();
  }

  function resumeHere() {
    if (viewIndex === -1) return;
    const snap = history[viewIndex];
    history = history.slice(0, viewIndex + 1);
    viewIndex = -1;
    liveState = null;
    hiddenModals = []; // resuming abandons whatever ending those modals announced
    Game.state = deserialize(snap, false);
    snapAnims();
    UI.update();
    updateBar();
    UI.setLog('⟲ Resumed from turn ' + history.length + '.');
  }

  /* ---------- bug reports ---------- */

  function reportJSON() {
    const focus = viewIndex === -1 ? history.length - 1 : viewIndex;
    const lo = Math.max(0, focus - 3);
    const hi = Math.min(history.length, focus + 4);
    return JSON.stringify({
      helheim: 'bug-report',
      reportVersion: 1,
      focusTurn: focus - lo,
      history: history.slice(lo, hi),
    });
  }

  function copyReport() {
    const text = reportJSON();
    const done = () => {
      const btn = bar.querySelector('.dev-copy');
      btn.textContent = 'copied!';
      setTimeout(() => { btn.textContent = 'copy bug report'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* clipboard unavailable */ }
    ta.remove();
  }

  /* Load a pasted bug report (from the console: HelheimDev.load(reportString)). */
  function load(report) {
    const rep = typeof report === 'string' ? JSON.parse(report) : report;
    if (!rep || rep.helheim !== 'bug-report' || !Array.isArray(rep.history) || !rep.history.length) {
      throw new Error('Not a Helheim bug report');
    }
    ['modal-death', 'modal-intro'].forEach(id => document.getElementById(id).classList.remove('open'));
    history = rep.history.slice();
    viewIndex = -1;
    liveState = null;
    Game.state = deserialize(history[Math.min(rep.focusTurn || 0, history.length - 1)], false);
    setEnabled(true);
    snapAnims();
    UI.update();
    updateBar();
    UI.setLog('🐞 Bug report loaded — ' + history.length + ' turns of history.');
  }

  /* ---------- UI ---------- */

  function buildBar() {
    bar = document.createElement('div');
    bar.id = 'dev-bar';
    bar.innerHTML =
      '<span class="dev-tag">🐞 dev</span>' +
      '<button class="dev-prev" title="Previous turn">◀</button>' +
      '<span class="dev-label"></span>' +
      '<button class="dev-next" title="Next turn">▶</button>' +
      '<button class="dev-live">live</button>' +
      '<button class="dev-resume">resume here</button>' +
      '<button class="dev-copy">copy bug report</button>';
    document.body.appendChild(bar);
    bar.querySelector('.dev-prev').addEventListener('click', () =>
      view(viewIndex === -1 ? history.length - 2 : viewIndex - 1));
    bar.querySelector('.dev-next').addEventListener('click', () => {
      if (viewIndex === -1) return;
      if (viewIndex >= history.length - 1) live(); else view(viewIndex + 1);
    });
    bar.querySelector('.dev-live').addEventListener('click', live);
    bar.querySelector('.dev-resume').addEventListener('click', resumeHere);
    bar.querySelector('.dev-copy').addEventListener('click', copyReport);

    const badge = document.createElement('div');
    badge.id = 'replay-badge';
    badge.textContent = 'REPLAY';
    document.getElementById('board-wrap').appendChild(badge);
  }

  function updateBar() {
    if (!bar) return;
    bar.style.display = enabled ? '' : 'none';
    const label = bar.querySelector('.dev-label');
    if (viewIndex === -1) {
      label.textContent = 'live · ' + history.length + ' turns recorded';
    } else {
      label.textContent = 'turn ' + (viewIndex + 1) + '/' + history.length +
        ' — ' + history[viewIndex].lastAction;
    }
    bar.querySelector('.dev-resume').disabled = viewIndex === -1;
    bar.querySelector('.dev-live').disabled = viewIndex === -1;
    bar.querySelector('.dev-prev').disabled =
      !history.length || viewIndex === 0;
    bar.querySelector('.dev-next').disabled = viewIndex === -1;
    bar.classList.toggle('replaying', viewIndex !== -1);
    document.getElementById('replay-badge').style.display = viewIndex !== -1 ? 'block' : 'none';
  }

  function setEnabled(on) {
    enabled = on;
    localStorage.setItem('helheim-dev', on ? '1' : '0');
    if (on && viewIndex === -1 && !history.length) {
      // Recover any history that survived a crash/reload this session
      try {
        const saved = JSON.parse(sessionStorage.getItem(SS_KEY) || '[]');
        if (saved.length) history = saved;
      } catch (e) { /* ignore corrupt saves */ }
    }
    if (!on && viewIndex !== -1) live();
    updateBar();
  }

  function init() {
    buildBar();
    const params = new URLSearchParams(location.search);
    setEnabled(params.get('dev') === '1' || localStorage.getItem('helheim-dev') === '1');
    document.addEventListener('keydown', e => {
      if (e.key === '`') { setEnabled(!enabled); e.preventDefault(); }
      if (!enabled || !Game.state) return;
      if (e.key === '[') view(viewIndex === -1 ? history.length - 2 : viewIndex - 1);
      if (e.key === ']') { if (viewIndex !== -1) { if (viewIndex >= history.length - 1) live(); else view(viewIndex + 1); } }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { record, newFloor, load, reportJSON, view, live, resumeHere,
           get enabled() { return enabled; }, setEnabled };
})();

window.HelheimDev = Dev;
window.Dev = Dev; // game.js guards recording hooks with `if (window.Dev)`

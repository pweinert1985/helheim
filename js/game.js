/* Helheim — core game logic: turn engine, player actions, foe AI, blessings */
'use strict';

const Game = (() => {
  let state = null;
  let mode = 'idle'; // idle | throw | bash | leap
  let bombSeq = 0;
  let traveling = false; // auto-walking to shrine/exit on a cleared floor
  let leapingKills = false; // kills made mid-leap earn no vigor (else leaps refund themselves)
  let bombKills = false;    // foes killed by an ember blast earn the player no vigor
  // A stun value of 2 makes a stunned foe skip its retaliation AND stay visibly
  // stunned (no threat markers) through the player's next turn before recovering.
  const STUN = 2;

  /* ================= sound (tiny WebAudio synth, no assets) ================= */
  const Sound = (() => {
    let ac = null, master = null, echo = null, nbuf = null;
    let muted = localStorage.getItem('helheim-muted') === '1';

    // Lazily create/resume the context and build the master bus once. Chain:
    // voices -> master gain (0.9) -> gentle limiter -> speakers, so layered cues
    // (death, boom) stay loud but never clip. A short darkened feedback delay is
    // offered as a *send* for the bigger, spacier cues.
    function ctx() {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.9;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        master.connect(limiter);
        limiter.connect(ac.destination);
        const din = ac.createDelay(0.5);
        din.delayTime.value = 0.11;
        const fb = ac.createGain(); fb.gain.value = 0.3;      // feedback amount
        const dark = ac.createBiquadFilter();                 // darken each repeat
        dark.type = 'lowpass'; dark.frequency.value = 2200;
        const wet = ac.createGain(); wet.gain.value = 0.5;    // echo level into mix
        din.connect(dark); dark.connect(fb); fb.connect(din); // feedback loop
        dark.connect(wet); wet.connect(master);
        echo = din;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    // One reusable 2s white-noise buffer; bursts loop and shape slices of it.
    function noiseBuf() {
      if (!nbuf) {
        nbuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = nbuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return nbuf;
    }

    // Route a finished voice to the dry master plus (optionally) the echo bus.
    function route(node, send) {
      node.connect(master);
      if (send) { const s = ac.createGain(); s.gain.value = send; node.connect(s); s.connect(echo); }
    }

    // A pitched "hit": glide f0->f1 (a metallic clang drops, a whoosh rises),
    // fast attack + exponential decay, optional filter, optional echo send.
    function hit(o) {
      const a = ctx(), t = a.currentTime + (o.at || 0);
      const osc = a.createOscillator();
      osc.type = o.type || 'sine';
      if (o.detune) osc.detune.value = o.detune;
      const f1 = o.f1 || o.f0;
      osc.frequency.setValueAtTime(o.f0, t);
      if (f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + o.dur);
      let n = osc;
      if (o.filter) {
        const flt = a.createBiquadFilter();
        flt.type = o.filter;
        flt.frequency.value = o.cutoff || 1000;
        if (o.q) flt.Q.value = o.q;
        osc.connect(flt); n = flt;
      }
      const g = a.createGain();
      const atk = o.atk || 0.004;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      n.connect(g);
      route(g, o.echo || 0);
      osc.start(t); osc.stop(t + o.dur + 0.03);
    }

    // A filtered noise burst shaped transient -> body -> tail, with an optional
    // cutoff sweep (f0->f1). Backbone of slashes, impacts, whooshes, blasts.
    function burst(o) {
      const a = ctx(), t = a.currentTime + (o.at || 0);
      const src = a.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
      const flt = a.createBiquadFilter();
      flt.type = o.filter || 'lowpass';
      flt.frequency.setValueAtTime(o.f0, t);
      if (o.f1 && o.f1 !== o.f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
      if (o.q) flt.Q.value = o.q;
      const g = a.createGain();
      const atk = o.atk || 0.002;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol, t + atk);         // transient
      if (o.hold) g.gain.setValueAtTime(o.vol, t + atk + o.hold);  // body
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);      // tail
      src.connect(flt); flt.connect(g);
      route(g, o.echo || 0);
      src.start(t); src.stop(t + o.dur + 0.05);
    }

    // A struck bell / knell: fundamental + octave + an inharmonic 2.76x clang
    // + a low hum partial. Rings for bless (bright) and the death dirge (dark).
    function bell(f, at, dur, vol, ech) {
      hit({ f0: f,        type: 'sine', dur: dur,       vol: vol,        atk: 0.003, at: at, echo: ech });
      hit({ f0: f * 2,    type: 'sine', dur: dur * 0.7, vol: vol * 0.5,  atk: 0.003, at: at, echo: ech });
      hit({ f0: f * 2.76, type: 'sine', dur: dur * 0.5, vol: vol * 0.28, atk: 0.002, at: at, echo: ech });
      hit({ f0: f * 0.5,  type: 'sine', dur: dur,       vol: vol * 0.4,  atk: 0.004, at: at, echo: ech });
    }

    // Every cue is guarded: honour mute, and never let an audio error throw.
    function play(fn) { if (muted) return; try { ctx(); fn(); } catch (e) { /* audio unavailable */ } }

    return {
      // bright metallic clang dropping in pitch + a sharp chink
      kill: () => play(() => {
        hit({ f0: 1000, f1: 340, type: 'triangle', dur: 0.14, vol: 0.05, echo: 0.12 });
        hit({ f0: 1500, f1: 520, type: 'square',   dur: 0.11, vol: 0.028, echo: 0.1 });
        burst({ filter: 'bandpass', f0: 3600, q: 2.2, dur: 0.07, vol: 0.05, atk: 0.001 });
      }),
      // dark, rough, downward grunt — a blow the hero takes
      hurt: () => play(() => {
        hit({ f0: 200, f1: 70, type: 'sawtooth', filter: 'lowpass', cutoff: 520, q: 1, dur: 0.22, vol: 0.09 });
        burst({ filter: 'lowpass', f0: 420, f1: 120, dur: 0.14, vol: 0.05, atk: 0.002, hold: 0.02 });
      }),
      // soft, dull footfall
      step: () => play(() => {
        burst({ filter: 'lowpass', f0: 900, f1: 380, q: 0.6, dur: 0.05, vol: 0.03 });
        hit({ f0: 120, type: 'sine', dur: 0.05, vol: 0.02 });
      }),
      // airy upward whoosh — a rising arc
      leap: () => play(() => {
        hit({ f0: 240, f1: 720, type: 'triangle', dur: 0.19, vol: 0.05, atk: 0.02 });
        burst({ filter: 'bandpass', f0: 300, f1: 1400, q: 0.9, dur: 0.18, vol: 0.045, atk: 0.03 });
      }),
      // heavy shield shove — tight low thud + woody crack
      bash: () => play(() => {
        hit({ f0: 190, f1: 60, type: 'sine',   dur: 0.16, vol: 0.09 });
        hit({ f0: 150, f1: 70, type: 'square', filter: 'lowpass', cutoff: 600, dur: 0.12, vol: 0.05 });
        burst({ filter: 'bandpass', f0: 1800, f1: 600, q: 1.5, dur: 0.09, vol: 0.07, atk: 0.001 });
      }),
      // spear/axe release — a crisp swish and a departing tick
      throw: () => play(() => {
        burst({ filter: 'bandpass', f0: 800, f1: 2600, q: 1.2, dur: 0.12, vol: 0.05, atk: 0.02 });
        hit({ f0: 900, f1: 1500, type: 'sine', dur: 0.1, vol: 0.035, atk: 0.006 });
      }),
      // explosion — bright crack, dark blast body, deep sub drop, echo
      boom: () => play(() => {
        burst({ filter: 'highpass', f0: 3000, dur: 0.05, vol: 0.06, atk: 0.001 });
        burst({ filter: 'lowpass', f0: 2200, f1: 120, dur: 0.36, vol: 0.11, atk: 0.002, hold: 0.02, echo: 0.15 });
        hit({ f0: 110, f1: 38, type: 'sine', dur: 0.38, vol: 0.11, echo: 0.1 });
      }),
      // sacred rising bell shimmer (C-E-G + a top sparkle)
      bless: () => play(() => {
        bell(523, 0.00, 0.34, 0.045, 0.20);
        bell(659, 0.09, 0.34, 0.045, 0.20);
        bell(784, 0.18, 0.38, 0.050, 0.22);
        hit({ f0: 1047, type: 'sine', dur: 0.3, vol: 0.03, at: 0.27, echo: 0.28 });
      }),
      // stairs down — ominous, smooth, resonant descent
      descend: () => play(() => {
        hit({ f0: 200, f1: 70, type: 'sine',     dur: 0.5, vol: 0.08, echo: 0.12 });
        hit({ f0: 200, f1: 70, type: 'sawtooth', filter: 'lowpass', cutoff: 300, dur: 0.5, vol: 0.04, echo: 0.1 });
        burst({ filter: 'lowpass', f0: 200, f1: 80, dur: 0.5, vol: 0.03 });
      }),
      // the fall (~1.7s): a struck war-horn, a sub-drone abyss, and a
      // descending funeral dirge of knells, all bathed in echo
      death: () => play(() => {
        burst({ filter: 'lowpass', f0: 1600, f1: 200, dur: 0.6, vol: 0.09, atk: 0.002, hold: 0.03, echo: 0.22 });
        hit({ f0: 165, f1: 150, type: 'sawtooth', filter: 'lowpass', cutoff: 850, q: 0.7, dur: 1.4, vol: 0.09, atk: 0.06, echo: 0.28 });
        hit({ f0: 247, f1: 224, type: 'sawtooth', filter: 'lowpass', cutoff: 1100, dur: 1.2, vol: 0.04, atk: 0.08, echo: 0.25 });
        hit({ f0: 60, f1: 44, type: 'sine', dur: 1.55, vol: 0.07, atk: 0.12, echo: 0.15 });
        bell(330, 0.08, 0.65, 0.050, 0.28);
        bell(262, 0.50, 0.70, 0.050, 0.28);
        bell(196, 0.92, 0.80, 0.055, 0.32);
      }),
      toggleMute: () => { muted = !muted; localStorage.setItem('helheim-muted', muted ? '1' : '0'); return muted; },
      isMuted: () => muted,
    };
  })();

  /* Haptic feedback via the native iOS shell; a no-op everywhere else. */
  function buzz(kind) {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic) {
        window.webkit.messageHandlers.haptic.postMessage(kind);
      }
    } catch (e) { /* not in the native shell */ }
  }

  /* ================= state helpers ================= */

  function tileAt(h) { return state.tiles.get(hexKey(h.q, h.r)); }
  function foeAt(h) { return state.foes.find(f => f.q === h.q && f.r === h.r); }
  function bombAt(h) { return state.bombs.find(b => b.q === h.q && b.r === h.r); }

  function isWalkable(h, forFoe) {
    const t = tileAt(h);
    if (!t || t.lava) return false;
    if (hexEq(h, state.rune)) return false;
    if (foeAt(h) || bombAt(h)) return false;
    if (forFoe) {
      if (hexEq(h, state.player)) return false;
      if (hexEq(h, state.stairs)) return false;
      if (state.player.spearAt && hexEq(h, state.player.spearAt)) return false;
    }
    return true;
  }

  function leapRange() { return 2 + state.player.leapBonus; }
  function has(b) { return state.player.blessings.has(b); }

  /* ================= game setup ================= */

  function newGame() {
    traveling = false;
    state = {
      depth: 0,
      tiles: null, stairs: null, rune: null, runeUsed: false,
      foes: [], bombs: [],
      player: {
        q: 0, r: 0, hp: 3, maxHp: 3,
        energy: 100, maxEnergy: 100,
        bashCd: 0, bashMax: 4, bashPush: 1,
        leapCd: 0, leapMax: 2,
        hasSpear: true, spearAt: null,
        throwRange: 2, leapBonus: 0,
        blessings: new Set(),
        blessingCounts: {}, // id -> times taken (for the ×N stack indicator)
        mendDepth: -99,     // depth the full-heal was last taken (2-depth cooldown)
      },
      kills: 0, glory: 0, streak: 0, berserkUsed: false,
      tranceUsed: false, bonusAction: false, shieldBlock: 0,
      floorStartKills: 0,
      over: false, modal: null,
      log: 'You descend beneath the barrow…',
    };
    Game.state = state;
    nextDepth();
  }

  function nextDepth() {
    state.depth += 1;
    state.depthTitle = depthName(state.depth);
    const lvl = generateLevel(state.depth);
    state.tiles = lvl.tiles;
    state.stairs = lvl.stairs;
    state.rune = lvl.rune;
    state.foes = lvl.foes;
    state.bombs = [];
    state.runeUsed = false;
    state.berserkUsed = false;
    state.tranceUsed = false;
    state.bonusAction = false;
    state.shieldBlock = 0;
    state.streak = 0;
    state.player.q = lvl.start.q;
    state.player.r = lvl.start.r;
    state.player.energy = state.player.maxEnergy;
    state.player.leapCd = 0; // fresh floor — leap is ready
    if (state.player.spearAt) { state.player.spearAt = null; state.player.hasSpear = true; }
    mode = 'idle';
    Renderer.clearAnims();
    Renderer.setAnim('P', state.player, true);
    for (const f of state.foes) Renderer.setAnim(f.id, f, true);
    const extras = [];
    let bonusTotal = 0;
    if (state.pacifistBonus) {
      extras.push(`+${state.pacifistBonus} for sparing the dead`);
      bonusTotal += state.pacifistBonus;
    }
    if (state.skipBonus) {
      extras.push('+10 for spurning the runestone');
      bonusTotal += 10;
    }
    state.skipBonus = false;
    state.pacifistBonus = 0;
    state.floorStartKills = state.kills;
    const depthLabel = state.depthTitle ? `Depth ${state.depth} — ${state.depthTitle}` : `Depth ${state.depth}`;
    if (extras.length) {
      Renderer.fxText(state.player, `+${bonusTotal} glory`, 'rgba(216,178,90,$A)');
      log(`${depthLabel} · glory: ${extras.join(', ')}!`);
    } else {
      log(depthLabel);
    }
    Sound.descend();
    UI.flashDepth(state.depth, state.depthTitle);
    UI.update();
    state.lastAction = 'arrive at depth ' + state.depth;
    if (window.Dev) { Dev.newFloor(); Dev.record(); }
  }

  /* ================= logging ================= */

  function log(msg) { state.log = msg; UI.setLog(msg); }

  /* ================= kills / damage ================= */

  function killFoe(f, cause, outright) {
    if (outright) f.hp = 1; // ignores remaining hearts (e.g. crushed Ancients)
    f.hp -= 1;
    Renderer.fxSlash(f);
    if (f.hp > 0) {
      // Wounding staggers a foe: it cannot act on the turn it was hurt.
      f.stun = Math.max(f.stun, STUN);
      Renderer.fxStun(f);
      log(`The ${FOES[f.type].name.toLowerCase()} is wounded and staggers!`);
      return false;
    }
    state.foes = state.foes.filter(x => x !== f);
    state.kills += 1;
    state.glory += 1;
    state.turnKills += 1;
    Sound.kill();
    buzz('light');
    // No vigor for kills you didn't land directly: mid-leap kills and foes
    // caught in an ember blast.
    if (!leapingKills && !bombKills) {
      const vig = has('bloodlust') ? 30 : 15;
      state.player.energy = Math.min(state.player.energy + vig, state.player.maxEnergy);
      Renderer.fxText(f, '+' + vig, 'rgba(120,220,255,$A)');
    }
    log(`The ${FOES[f.type].name.toLowerCase()} ${pick(KILL_WORDS)}${cause ? ' (' + cause + ')' : ''}.`);
    return true;
  }

  function hurtPlayer(n, source) {
    if (state.over) return; // already fallen — ignore further blows (no double-death, no duplicate leaderboard entry)
    if (state.shieldBlock > 0) {
      state.shieldBlock -= 1;
      Sound.bash();
      Renderer.fxText(state.player, 'blocked!', 'rgba(140,220,255,$A)');
      log(`Your braced shield turns aside ${source.toLowerCase()}!`);
      return;
    }
    state.player.hp -= n;
    Sound.hurt();
    buzz('heavy');
    Renderer.fxText(state.player, '-' + n, 'rgba(255,90,90,$A)');
    UI.hurtFlash();
    log(`${source} wounds you!`);
    if (state.player.hp <= 0) die(source);
  }

  function loadRuns() {
    try { return JSON.parse(localStorage.getItem('helheim-runs') || '[]'); }
    catch (e) { return []; }
  }

  function die(cause) {
    state.over = true;
    Sound.death();
    buzz('error');
    Renderer.playerDeath(); // collapse + soul-rise; input is already locked
    const run = { glory: state.glory, depth: state.depth, kills: state.kills,
                  title: state.depthTitle, when: Date.now() };
    const runs = loadRuns();
    runs.push(run);
    runs.sort((a, b) => b.glory - a.glory || b.depth - a.depth);
    localStorage.setItem('helheim-runs', JSON.stringify(runs.slice(0, 10)));
    const rank = runs.indexOf(run) < 10 ? runs.indexOf(run) + 1 : null;
    // Let the killing blow and death animation play out before the summary.
    setTimeout(() => {
      if (state.over && !state.replay) UI.showDeath(cause, run, rank);
    }, 1950);
  }

  /* ================= player actions ================= */

  function validMoves() {
    const out = [];
    for (const n of hexNeighbors(state.player)) {
      if (isWalkable(n, false)) out.push({ h: n, kind: 'move' });
    }
    return out.concat(leapTargets());
  }

  function leapTargets() {
    const out = [];
    if (state.player.energy < 50 || state.bonusAction || state.player.leapCd > 0) return out;
    for (const h of hexWithin(state.player, leapRange())) {
      if (hexDist(state.player, h) < 2) continue;
      if (isWalkable(h, false)) out.push({ h, kind: 'leap' });
      else if (has('thorsdescent') && foeAt(h)) out.push({ h, kind: 'leap' }); // crush from above
    }
    return out;
  }

  function throwTargets() {
    const out = [];
    for (const h of hexWithin(state.player, state.player.throwRange)) {
      const t = tileAt(h);
      if (!t || t.lava) continue;
      if (hexEq(h, state.rune) || hexEq(h, state.stairs)) continue;
      if (bombAt(h)) continue;
      out.push({ h, kind: 'throw' });
    }
    return out;
  }

  function bashTargets() {
    return hexNeighbors(state.player)
      .filter(h => tileAt(h) && (foeAt(h) || bombAt(h)))
      .map(h => ({ h, kind: 'bash' }));
  }

  function currentHighlights() {
    if (!state || state.over || state.modal) return [];
    if (mode === 'throw') return throwTargets();
    if (mode === 'bash') return bashTargets();
    if (mode === 'leap') return leapTargets();
    return validMoves();
  }

  /* Stab: foes adjacent both before AND after the move die.
     Lunge: moving along an axis kills the foe directly ahead of the destination (needs spear). */
  function resolveMoveKills(from, to) {
    const before = state.foes.filter(f => hexDist(f, from) === 1);
    const after = new Set(state.foes.filter(f => hexDist(f, to) === 1));
    for (const f of before) {
      if (after.has(f)) killFoe(f, 'stab');
    }
    if (state.player.hasSpear || has('swordlunge')) {
      const ray = hexRay(from, to);
      if (ray) {
        const ahead = hexAdd(to, ray.dir);
        const target = foeAt(ahead);
        if (target) {
          const died = killFoe(target, 'lunge');
          if (died && has('deeplunge')) {
            const behind = foeAt(hexAdd(ahead, ray.dir));
            if (behind) killFoe(behind, 'deep lunge');
          }
        }
      }
    }
  }

  function actMove(dest) {
    const d = hexDist(state.player, dest);
    const from = { q: state.player.q, r: state.player.r };
    let crushTarget = null;
    if (d === 1) {
      if (!isWalkable(dest, false)) return false;
      Sound.step();
    } else if (d >= 2 && d <= leapRange()) {
      if (state.player.energy < 50 || state.bonusAction || state.player.leapCd > 0) return false;
      crushTarget = has('thorsdescent') ? foeAt(dest) : null;
      if (!isWalkable(dest, false) && !crushTarget) return false;
      state.player.energy -= 50;
      // +1 compensates for endTurn decrementing on this same turn, so leapMax=2
      // reads as a true 2-turn cooldown ("ready in 2", "ready in 1").
      state.player.leapCd = state.player.leapMax + 1;
      Sound.leap();
    } else return false;

    state.player.q = dest.q;
    state.player.r = dest.r;
    state.lastAction = (d === 1 ? 'walk to ' : 'leap to ') + dest.q + ',' + dest.r +
      (crushTarget ? ' (crush)' : '');
    leapingKills = d >= 2;
    if (crushTarget) killFoe(crushTarget, 'crushed beneath your landing', true);
    resolveMoveKills(from, dest);
    leapingKills = false;

    if (d >= 2 && has('stagger')) {
      for (const f of state.foes) {
        if (hexDist(f, dest) === 1) { f.stun = STUN; Renderer.fxStun(f); }
      }
    }
    // Pick up spear
    if (state.player.spearAt && hexEq(dest, state.player.spearAt)) {
      state.player.spearAt = null;
      state.player.hasSpear = true;
      log('You reclaim your spear.');
    }
    // Stairs: descend immediately (no foe turn)
    if (hexEq(dest, state.stairs)) {
      endTurn(true);
      return true;
    }
    endTurn(false);
    return true;
  }

  function actThrow(dest) {
    const ok = throwTargets().some(t => hexEq(t.h, dest));
    if (!ok || !state.player.hasSpear) return false;
    Sound.throw();
    Renderer.fxBeam(state.player, dest, 'rgba(230,235,245,$A)');
    state.lastAction = 'throw spear to ' + dest.q + ',' + dest.r;
    const target = foeAt(dest);
    if (target) killFoe(target, 'spear');
    state.player.hasSpear = false;
    state.player.spearAt = { q: dest.q, r: dest.r };
    // Thunderfall: the landing spear staggers everything around it
    if (has('thunderfall')) {
      for (const f of state.foes) {
        if (hexDist(f, dest) === 1) { f.stun = Math.max(f.stun, STUN); Renderer.fxStun(f); }
      }
    }
    mode = 'idle';
    endTurn(false);
    return true;
  }

  /* Push whatever stands at h along dir, up to the player's bash-push distance.
     Movement stops at the first blocker; the void and fire rifts kill. */
  function pushEntity(h, dir) {
    const f = foeAt(h);
    const b = bombAt(h);
    const steps = state.player.bashPush;
    if (f) {
      for (let i = 0; i < steps; i++) {
        const dest = hexAdd(f, dir);
        const destTile = tileAt(dest);
        if (!destTile) {
          killFoe(f, 'hurled into the void', true);
          return;
        }
        if (destTile.lava) {
          f.q = dest.q; f.r = dest.r; // dies in the rift
          Renderer.fxBoom(dest);
          killFoe(f, 'cast into the fire', true);
          return;
        }
        if (!isWalkable(dest, true)) break; // blocked mid-flight
        f.q = dest.q; f.r = dest.r;
      }
      f.stun = STUN; Renderer.fxStun(f);
    } else if (b) {
      // A bashed ember is spiked away and bursts ON IMPACT, driven as far from
      // you as it can go. If something blocks it, it detonates against that tile
      // (the crowd behind it) — never left sitting on its fuse beside you.
      let impact = null;
      for (let i = 0; i < steps; i++) {
        const dest = hexAdd(b, dir);
        const destTile = tileAt(dest);
        if (!destTile) { // knocked off the world's edge — gone, no blast
          state.bombs = state.bombs.filter(x => x !== b);
          return;
        }
        if (destTile.lava) { b.q = dest.q; b.r = dest.r; break; } // bursts in the fire
        if (foeAt(dest) || bombAt(dest) || hexEq(dest, state.rune)) { impact = dest; break; }
        b.q = dest.q; b.r = dest.r; // free tile — keep sliding
      }
      if (impact) { b.q = impact.q; b.r = impact.r; } // center the burst on the obstacle/crowd
      log('You spike the ember away — it bursts!');
      detonate(b);
      return;
    }
  }

  function actBash(dest) {
    if (state.player.bashCd > 0) return false;
    let descended = false;
    Sound.bash();
    state.lastAction = has('sweeping') ? 'sweeping bash' : (dest ? 'bash ' + dest.q + ',' + dest.r : 'bash');
    // Shield Wall braces BEFORE the push lands, so even a bomb you knock into
    // lava beside yourself can be blocked.
    if (has('shieldwall')) state.shieldBlock = 1;
    if (has('sweeping')) {
      for (const n of hexNeighbors(state.player)) {
        const dir = { q: n.q - state.player.q, r: n.r - state.player.r };
        if (foeAt(n) || bombAt(n)) pushEntity(n, dir);
      }
      Renderer.fxBoom(state.player);
    } else {
      if (!dest) return false;
      const dir = { q: dest.q - state.player.q, r: dest.r - state.player.r };
      if (hexDist(state.player, dest) !== 1) return false;
      if (!foeAt(dest) && !bombAt(dest)) return false;
      Renderer.fxSlash(dest);
      pushEntity(dest, dir);
      // Echo Step: the blow springs you back, away from your target
      if (has('echostep')) {
        const back = { q: state.player.q - dir.q, r: state.player.r - dir.r };
        if (isWalkable(back, false)) {
          state.player.q = back.q;
          state.player.r = back.r;
          if (state.player.spearAt && hexEq(back, state.player.spearAt)) {
            state.player.spearAt = null;
            state.player.hasSpear = true;
            log('You spring back onto your spear and reclaim it.');
          }
          if (hexEq(back, state.stairs)) descended = true;
        }
      }
    }
    state.player.bashCd = state.player.bashMax;
    mode = 'idle';
    endTurn(descended);
    return true;
  }

  function actWait() {
    if (traveling || state.replay) return;
    state.lastAction = 'hold';
    log('You hold your ground.');
    endTurn(false);
  }

  function actRecall() {
    if (traveling || state.replay) return false;
    if (!has('recall') || state.player.hasSpear || !state.player.spearAt) return false;
    state.player.spearAt = null;
    state.player.hasSpear = true;
    state.lastAction = 'recall spear';
    log('Your spear flies back to your hand.');
    Sound.throw();
    endTurn(false);
    return true;
  }

  function actFollow() {
    if (traveling || state.replay) return false;
    if (!has('follow') || state.player.hasSpear || !state.player.spearAt) return false;
    const s = state.player.spearAt;
    if (foeAt(s) || bombAt(s)) { log('Something stands upon your spear — the Bifrost will not open.'); return false; }
    Renderer.fxBeam(state.player, s, 'rgba(160,220,255,$A)');
    state.player.q = s.q;
    state.player.r = s.r;
    state.player.spearAt = null;
    state.player.hasSpear = true;
    Renderer.setAnim('P', state.player, true); // teleport: snap, don't glide
    state.lastAction = 'bifrost step';
    log('You flash across the Bifrost to your spear.');
    Sound.leap();
    endTurn(false);
    return true;
  }

  function actPray() {
    if (state.runeUsed || hexDist(state.player, state.rune) !== 1) return false;
    openBlessingModal();
    return true;
  }

  /* ---------- auto-travel (cleared floors only) ---------- */

  /* BFS shortest path over walkable tiles; returns steps after `from`, or null. */
  function findPath(from, goalTest) {
    if (goalTest(from)) return [];
    const prev = new Map([[hexKey(from.q, from.r), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of hexNeighbors(cur)) {
        const k = hexKey(n.q, n.r);
        if (prev.has(k) || !isWalkable(n, false)) continue;
        prev.set(k, cur);
        if (goalTest(n)) {
          const path = [];
          let step = n;
          while (step && !hexEq(step, from)) {
            path.unshift(step);
            step = prev.get(hexKey(step.q, step.r));
          }
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }

  /* Walk the path one real turn at a time (bombs still tick); abort on damage. */
  function autoTravel(goalTest, onArrive) {
    const path = findPath(state.player, goalTest);
    if (!path) { log('No clear path.'); return; }
    if (!path.length) { if (onArrive) onArrive(); return; }
    traveling = true;
    const step = () => {
      if (!traveling) return; // cancelled (e.g. new game started)
      if (state.over || !path.length) {
        traveling = false;
        if (!state.over && onArrive) onArrive();
        UI.update();
        return;
      }
      const next = path.shift();
      if (!isWalkable(next, false)) { traveling = false; UI.update(); return; }
      const hpBefore = state.player.hp;
      const depthBefore = state.depth;
      actMove(next);
      if (state.over || state.player.hp < hpBefore || state.depth !== depthBefore) {
        traveling = false;
        return;
      }
      if (!path.length) { // arrived — release input immediately
        traveling = false;
        if (onArrive) onArrive();
        UI.update();
        return;
      }
      setTimeout(step, 140);
    };
    step();
  }

  /* ================= blessing modal ================= */

  function rollBlessingChoices() {
    const p = state.player;
    // 3 random upgrades (the two standard gifts below are always offered separately).
    const available = BLESSINGS.filter(b => {
      if (b.id === 'fortitude') return false;
      if (!b.stackable && p.blessings.has(b.id)) return false;
      if (b.canTake && !b.canTake(p)) return false;
      return true;
    });
    for (let i = available.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [available[i], available[j]] = [available[j], available[i]];
    }
    const choices = available.slice(0, 3);
    while (choices.length < 3 && !choices.includes(FALLBACK_OPTION)) choices.push(FALLBACK_OPTION);
    // Standard gifts: an extra heart (until capped at 8), plus a full heal —
    // but only when it would help (below full health) and off cooldown (it can't
    // be taken again until 2 depths after the depth it was last used on).
    const fortitude = BLESSINGS.find(b => b.id === 'fortitude');
    if (fortitude.canTake(p)) choices.push(fortitude);
    if (p.hp < p.maxHp && state.depth - p.mendDepth >= 3) choices.push(MEND_OPTION);
    return choices;
  }

  function openBlessingModal() {
    state.modal = 'blessing';
    UI.showBlessings(rollBlessingChoices(), choice => {
      choice.apply(state.player);
      if (choice.id !== 'mend' && choice.id !== 'surge') {
        state.player.blessings.add(choice.id);
        state.player.blessingCounts[choice.id] = (state.player.blessingCounts[choice.id] || 0) + 1;
      }
      if (choice.id === 'mend') state.player.mendDepth = state.depth; // start the 2-depth cooldown
      state.runeUsed = true;
      state.modal = null;
      Sound.bless();
      buzz('success');
      state.lastAction = 'blessing: ' + choice.name;
      log(`The runestone grants: ${choice.name}.`);
      endTurn(false);
    });
  }

  /* ================= turn engine ================= */

  function endTurn(descended) {
    state.turnKills = state.turnKills || 0;
    state.bonusAction = false;

    if (descended) {
      state.turnKills = 0;
      // Reward for passing up the runestone's gift
      state.skipBonus = !state.runeUsed;
      if (state.skipBonus) state.glory += 10;
      // Pacifist descent: not one foe died on this floor — +1 glory per foe spared
      state.pacifistBonus =
        (state.kills === state.floorStartKills && state.foes.length > 0) ? state.foes.length : 0;
      state.glory += state.pacifistBonus;
      UI.update();
      nextDepth();
      return;
    }

    // Berserker streak
    if (state.turnKills > 0) state.streak += 1; else state.streak = 0;
    if (has('berserk') && !state.berserkUsed && state.streak >= 3 && state.player.hp < state.player.maxHp) {
      state.player.hp += 1;
      state.berserkUsed = true;
      Renderer.fxText(state.player, '+1 ♥', 'rgba(120,255,140,$A)');
      log('Battle-fury knits your wounds!');
    }
    state.turnKills = 0;

    // Battle Trance: a 3-turn kill streak freezes the world for one extra action
    if (has('battletrance') && !state.tranceUsed && state.streak >= 3) {
      state.tranceUsed = true;
      Renderer.fxText(state.player, 'battle trance!', 'rgba(216,178,90,$A)');
      log('Battle-trance! The world slows — act again!');
      UI.update();
      if (window.Dev) Dev.record();
      return;
    }

    bombPhase();
    if (!state.over) foePhase();
    state.shieldBlock = 0; // a braced shield lasts only the turn it was raised

    if (state.player.bashCd > 0) state.player.bashCd -= 1;
    if (state.player.leapCd > 0) state.player.leapCd -= 1;
    UI.update();
    if (window.Dev) Dev.record();
  }

  /* Blow up a bomb (and chain-react neighbors), damaging everything within 1 tile. */
  function detonate(first) {
    const queue = [first];
    const done = new Set();
    while (queue.length) {
      const b = queue.shift();
      if (done.has(b)) continue;
      done.add(b);
      state.bombs = state.bombs.filter(x => x !== b);
      Renderer.fxBoom(b);
      Sound.boom();
      if (hexDist(state.player, b) <= 1) hurtPlayer(1, 'The ember-burst');
      bombKills = true; // these kills grant no vigor
      for (const f of [...state.foes]) {
        if (hexDist(f, b) <= 1) killFoe(f, 'caught in the blast');
      }
      bombKills = false;
      for (const other of state.bombs) {
        if (hexDist(other, b) <= 1 && !done.has(other)) queue.push(other);
      }
    }
  }

  function bombPhase() {
    const exploding = [];
    for (const b of state.bombs) {
      b.fuse -= 1;
      if (b.fuse <= 0) exploding.push(b);
    }
    for (const b of exploding) {
      if (state.bombs.includes(b)) detonate(b); // may already be gone via a chain
    }
  }

  /* Line of sight along a hex axis; blocked by foes, bombs, the runestone. */
  function clearShot(from, to, minR, maxR) {
    const ray = hexRay(from, to);
    if (!ray || ray.steps < minR || ray.steps > maxR) return false;
    for (let i = 1; i < ray.steps; i++) {
      const c = hexAdd(from, hexScale(ray.dir, i));
      if (!tileAt(c)) return false;
      if (foeAt(c) || bombAt(c) || hexEq(c, state.rune)) return false;
    }
    return true;
  }

  function stepChoices(f) {
    return hexNeighbors(f).filter(n => isWalkable(n, true));
  }

  function moveToward(f, targetDist) {
    const cur = hexDist(f, state.player);
    const opts = stepChoices(f);
    if (!opts.length) return;
    let best, bestScore = Infinity;
    const scored = opts.map(o => {
      const d = hexDist(o, state.player);
      return { o, score: Math.abs(d - targetDist) };
    });
    const curScore = Math.abs(cur - targetDist);
    const better = scored.filter(s => s.score < curScore);
    const equal = scored.filter(s => s.score === curScore);
    let choice = null;
    if (better.length) choice = pick(better).o;
    else if (equal.length && Math.random() < 0.5) choice = pick(equal).o;
    if (choice) { f.q = choice.q; f.r = choice.r; }
  }

  function seekLineOfSight(f, minR, maxR) {
    // Prefer a step that yields a clear shot at the player.
    const opts = stepChoices(f);
    const good = opts.filter(o => {
      const saved = { q: f.q, r: f.r };
      f.q = o.q; f.r = o.r;
      const ok = clearShot(f, state.player, minR, maxR);
      f.q = saved.q; f.r = saved.r;
      return ok;
    });
    if (good.length) {
      const c = pick(good);
      f.q = c.q; f.r = c.r;
      return true;
    }
    return false;
  }

  /* Foe round in three strict phases (matching classic Hoplite order):
     1. every foe declares its attack from the FROZEN board — a foe stepping
        aside can never open a line of fire for another foe in the same round;
     2. all declared attacks land together;
     3. everyone who did not attack moves (or gathers power).
     This makes the red threat markers a promise, not a guess. */
  function foePhase() {
    // Stun upkeep: staggered foes lose their whole round.
    const acting = [];
    for (const f of state.foes) {
      if (f.stun > 0) f.stun -= 1;
      else acting.push(f);
    }

    // Phase 1 — declare attacks.
    const plans = [];
    const claimed = new Set();
    for (const f of acting) {
      const def = FOES[f.type];
      const dist = hexDist(f, state.player);
      if (f.type === 'draugr') {
        if (dist === 1) plans.push({ f, kind: 'melee' });
      } else if (f.type === 'archer') {
        if (clearShot(f, state.player, def.minRange, def.maxRange)) plans.push({ f, kind: 'arrow' });
      } else if (f.type === 'volva') {
        if (!(f.cooldown > 0) && clearShot(f, state.player, def.minRange, def.maxRange)) {
          plans.push({ f, kind: 'searing' });
        }
      } else if (f.type === 'surtling') {
        if (f.charges >= def.chargesNeeded) {
          const spots = hexNeighbors(state.player).filter(n => {
            const t = tileAt(n);
            return t && !t.lava && !foeAt(n) && !bombAt(n) &&
              !hexEq(n, state.rune) && !hexEq(n, state.stairs) &&
              hexDist(f, n) <= def.range &&
              hexDist(f, n) >= 2 && // never inside its own blast radius
              !claimed.has(hexKey(n.q, n.r));
          });
          if (spots.length) {
            const spot = pick(spots);
            claimed.add(hexKey(spot.q, spot.r));
            plans.push({ f, kind: 'ember', spot });
          }
        }
      }
    }

    // Phase 2 — attacks land.
    const attacked = new Set();
    for (const plan of plans) {
      if (state.over) return;
      const f = plan.f;
      attacked.add(f);
      if (plan.kind === 'melee') {
        Renderer.fxLunge(f.id, f, state.player, 0.55); // hop at the player and spring back
        Renderer.fxSlash(state.player);
        hurtPlayer(1, 'The draugr');
      } else if (plan.kind === 'arrow') {
        Renderer.fxLunge(f.id, f, state.player, 0.22);
        Renderer.fxBeam(f, state.player, 'rgba(235,225,180,$A)');
        hurtPlayer(1, 'An arrow');
      } else if (plan.kind === 'searing') {
        f.cooldown = 1; // rests for one turn after the blast
        Renderer.fxLunge(f.id, f, state.player, 0.18);
        Renderer.fxBeam(f, state.player, 'rgba(200,120,255,$A)');
        hurtPlayer(1, "The völva's searing rune");
      } else if (plan.kind === 'ember') {
        state.bombs.push({ id: ++bombSeq, q: plan.spot.q, r: plan.spot.r, fuse: 1 });
        Renderer.fxLunge(f.id, f, plan.spot, 0.25);
        Renderer.fxBeam(f, plan.spot, 'rgba(255,170,60,$A)');
        Renderer.setAnim('b_' + bombSeq, plan.spot, true);
        f.charges = 0;
        log('A surtling lobs a burning ember!');
      }
    }

    // Phase 3 — non-attackers move.
    for (const f of acting) {
      if (state.over) return;
      if (attacked.has(f) || !state.foes.includes(f)) continue;
      const def = FOES[f.type];
      const dist = hexDist(f, state.player);
      if (f.type === 'draugr') {
        moveToward(f, 1);
      } else if (f.type === 'archer') {
        if (dist === 1) {
          const opts = stepChoices(f).filter(o => hexDist(o, state.player) > 1);
          if (opts.length) { const c = pick(opts); f.q = c.q; f.r = c.r; }
        } else if (!seekLineOfSight(f, def.minRange, def.maxRange)) {
          moveToward(f, 3);
        }
      } else if (f.type === 'volva') {
        if (f.cooldown > 0) {
          f.cooldown -= 1; // gathering breath — holds her firing position
        } else if (!seekLineOfSight(f, def.minRange, def.maxRange)) {
          moveToward(f, 3);
        }
      } else if (f.type === 'surtling') {
        f.charges = Math.min(f.charges + 1, def.chargesNeeded);
        if (dist > def.range) moveToward(f, 2);
        else if (dist === 1) {
          const opts = stepChoices(f).filter(o => hexDist(o, state.player) > 1);
          if (opts.length) { const c = pick(opts); f.q = c.q; f.r = c.r; }
        }
      }
    }
  }

  /* ================= threat display ================= */

  function threatSet() {
    const out = new Set();
    if (!state || state.over) return out;
    for (const f of state.foes) {
      if (f.stun > 0) continue;
      const def = FOES[f.type];
      if (f.type === 'draugr') {
        for (const n of hexNeighbors(f)) {
          const t = tileAt(n);
          if (t && !t.lava) out.add(hexKey(n.q, n.r));
        }
      } else if (f.type === 'archer' || (f.type === 'volva' && !(f.cooldown > 0))) {
        const minR = def.minRange, maxR = def.maxRange;
        for (const d of HEX_DIRS) {
          for (let i = 1; i <= maxR; i++) {
            const c = hexAdd(f, hexScale(d, i));
            if (!tileAt(c)) break;
            if (foeAt(c) || bombAt(c) || hexEq(c, state.rune)) break;
            if (i >= minR) out.add(hexKey(c.q, c.r));
            // Don't stop at the player — show the foe's full firing lane,
            // including the tiles behind the player on the same line.
          }
        }
      }
    }
    for (const b of state.bombs) {
      if (b.fuse <= 1) {
        out.add(hexKey(b.q, b.r));
        for (const n of hexNeighbors(b)) {
          if (tileAt(n)) out.add(hexKey(n.q, n.r));
        }
      }
    }
    return out;
  }

  /* ================= press-and-hold preview =================
     computePreview(dest) returns, WITHOUT mutating state, what tapping `dest`
     would do — so the UI can show it on a press-and-hold and cancel on release.
     A quick tap still commits via clickTile(). */

  // Threatened tiles for a SINGLE foe (used when holding on an enemy).
  function threatTilesForFoe(f) {
    const out = new Set();
    if (!f || f.stun > 0) return out;
    const def = FOES[f.type];
    if (f.type === 'draugr') {
      for (const n of hexNeighbors(f)) { const t = tileAt(n); if (t && !t.lava) out.add(hexKey(n.q, n.r)); }
    } else if (f.type === 'archer' || (f.type === 'volva' && !(f.cooldown > 0))) {
      for (const d of HEX_DIRS) {
        for (let i = 1; i <= def.maxRange; i++) {
          const c = hexAdd(f, hexScale(d, i));
          if (!tileAt(c)) break;
          if (foeAt(c) || bombAt(c) || hexEq(c, state.rune)) break;
          if (i >= def.minRange) out.add(hexKey(c.q, c.r));
        }
      }
    } else if (f.type === 'surtling') {
      if (f.charges >= def.chargesNeeded) {   // where it could lob an ember + its blast
        for (const n of hexNeighbors(state.player)) {
          const t = tileAt(n);
          if (t && !t.lava && !foeAt(n) && !bombAt(n) && !hexEq(n, state.rune) &&
              !hexEq(n, state.stairs) && hexDist(f, n) <= def.range && hexDist(f, n) >= 2) {
            out.add(hexKey(n.q, n.r));
            for (const m of hexNeighbors(n)) { if (tileAt(m)) out.add(hexKey(m.q, m.r)); }
          }
        }
      }
    }
    return out;
  }

  // Threat map with a set of foes hypothetically removed (their kills previewed).
  function simThreats(deadFoes) {
    if (!deadFoes || !deadFoes.length) return threatSet();
    const saved = state.foes;
    state.foes = state.foes.filter(f => !deadFoes.includes(f));
    const t = threatSet();
    state.foes = saved;
    return t;
  }

  // Foes that a move from -> to would kill (stab + lunge + deep lunge), read-only.
  function wouldMoveKill(from, to) {
    const dead = [];
    const before = state.foes.filter(f => hexDist(f, from) === 1);
    const afterSet = new Set(state.foes.filter(f => hexDist(f, to) === 1));
    for (const f of before) if (afterSet.has(f)) dead.push(f);
    if (state.player.hasSpear || has('swordlunge')) {
      const ray = hexRay(from, to);
      if (ray) {
        const ahead = hexAdd(to, ray.dir);
        const target = foeAt(ahead);
        if (target && !dead.includes(target)) {
          dead.push(target);
          if (has('deeplunge')) {
            const behind = foeAt(hexAdd(ahead, ray.dir));
            if (behind && !dead.includes(behind)) dead.push(behind);
          }
        }
      }
    }
    return dead;
  }

  function previewMove(dest) {
    const from = { q: state.player.q, r: state.player.r };
    const isLeap = hexDist(from, dest) >= 2;
    const dead = [];
    const crush = (isLeap && has('thorsdescent')) ? foeAt(dest) : null;
    if (crush) dead.push(crush);
    for (const f of wouldMoveKill(from, dest)) if (!dead.includes(f)) dead.push(f);
    const stun = (isLeap && has('stagger'))
      ? state.foes.filter(f => !dead.includes(f) && hexDist(f, dest) === 1) : [];
    return {
      type: isLeap ? 'leap' : 'move',
      ghost: { q: dest.q, r: dest.r },
      dying: dead.map(f => ({ q: f.q, r: f.r })),
      stun: stun.map(f => ({ q: f.q, r: f.r })),
      threats: simThreats(dead),
    };
  }

  function previewThrow(dest) {
    const target = foeAt(dest);
    const dead = target ? [target] : [];
    const stun = has('thunderfall')
      ? state.foes.filter(f => !dead.includes(f) && hexDist(f, dest) === 1) : [];
    return {
      type: 'throw',
      spear: { q: dest.q, r: dest.r },
      dying: dead.map(f => ({ q: f.q, r: f.r })),
      stun: stun.map(f => ({ q: f.q, r: f.r })),
      threats: simThreats(dead),
    };
  }

  // Read-only version of the bomb branch of pushEntity: where it detonates + who dies.
  function simPushBomb(b, dir) {
    let c = { q: b.q, r: b.r }, impact = null;
    for (let i = 0; i < state.player.bashPush; i++) {
      const dst = hexAdd(c, dir), t = tileAt(dst);
      if (!t) return { gone: true };
      if (t.lava) { c = dst; break; }
      if (foeAt(dst) || bombAt(dst) || hexEq(dst, state.rune)) { impact = dst; break; }
      c = dst;
    }
    if (impact) c = impact;
    const deadFoes = state.foes.filter(f => hexDist(f, c) <= 1);
    return { detonateAt: c, deadFoes, playerHit: hexDist(state.player, c) <= 1 };
  }

  // Read-only version of the foe branch of pushEntity.
  function simPushFoe(f, dir) {
    let c = { q: f.q, r: f.r }, dies = false, dieAt = null;
    for (let i = 0; i < state.player.bashPush; i++) {
      const dst = hexAdd(c, dir), t = tileAt(dst);
      if (!t) { dies = true; break; }                 // off the edge
      if (t.lava) { dies = true; dieAt = dst; break; } // into the fire
      if (!isWalkable(dst, true)) break;               // blocked — stays, stunned
      c = dst;
    }
    return { finalTile: c, dies, dieAt };
  }

  function previewBashOne(pos, dir, res) {
    const f = foeAt(pos), b = bombAt(pos);
    if (f) {
      const r = simPushFoe(f, dir);
      if (r.dies) { res.dying.push({ q: f.q, r: f.r }); if (r.dieAt) res.boom = r.dieAt; }
      else { res.push.push({ from: { q: f.q, r: f.r }, to: r.finalTile }); res.stun.push(r.finalTile); }
    } else if (b) {
      const r = simPushBomb(b, dir);
      if (!r.gone) {
        res.boom = r.detonateAt;
        for (const d of r.deadFoes) res.dying.push({ q: d.q, r: d.r });
        if (r.playerHit) res.playerHit = true;
      }
    }
  }

  function previewBash(dest) {
    const res = { type: 'bash', dying: [], stun: [], push: [] };
    if (has('sweeping')) {
      for (const n of hexNeighbors(state.player)) {
        previewBashOne(n, { q: n.q - state.player.q, r: n.r - state.player.r }, res);
      }
    } else {
      const dir = { q: dest.q - state.player.q, r: dest.r - state.player.r };
      previewBashOne(dest, dir, res);
      if (has('echostep')) {
        const back = { q: state.player.q - dir.q, r: state.player.r - dir.r };
        if (isWalkable(back, false)) res.ghost = back;
      }
    }
    const deadFoeObjs = state.foes.filter(x => res.dying.some(d => d.q === x.q && d.r === x.r));
    res.threats = simThreats(deadFoeObjs);
    return res;
  }

  function computePreview(dest) {
    if (!state || state.over || state.modal || traveling || state.replay || !dest) return null;
    if (mode === 'throw') {
      return (state.player.hasSpear && throwTargets().some(t => hexEq(t.h, dest))) ? previewThrow(dest) : null;
    }
    if (mode === 'bash') {
      if (has('sweeping')) return previewBash(dest);
      return bashTargets().some(t => hexEq(t.h, dest)) ? previewBash(dest) : null;
    }
    if (mode === 'leap') {
      return leapTargets().some(t => hexEq(t.h, dest)) ? previewMove(dest) : null;
    }
    // idle: a reachable tile previews the move; otherwise a foe previews its attack
    if (validMoves().some(x => hexEq(x.h, dest))) return previewMove(dest);
    const f = foeAt(dest);
    if (f) return { type: 'foe', focusFoe: { q: f.q, r: f.r }, threats: threatTilesForFoe(f) };
    return null;
  }

  /* ================= input ================= */

  function clickTile(h) {
    if (!state || state.over || state.modal || traveling || state.replay) return;
    if (!h) return;

    // Cleared floor: tap the shrine or the exit to auto-walk there.
    if (mode === 'idle' && state.foes.length === 0) {
      if (hexEq(h, state.stairs) && hexDist(state.player, h) > 1) {
        log('You stride for the stair…');
        autoTravel(t => hexEq(t, state.stairs), null);
        return;
      }
      if (hexEq(h, state.rune) && !state.runeUsed && hexDist(state.player, h) > 1) {
        log('You approach the runestone…');
        autoTravel(t => hexDist(t, state.rune) === 1, () => actPray());
        return;
      }
      if (state.player.spearAt && hexEq(h, state.player.spearAt) && hexDist(state.player, h) > 1) {
        const target = { q: h.q, r: h.r };
        log('You go to reclaim your spear…');
        autoTravel(t => hexEq(t, target), null);
        return;
      }
    }

    if (mode === 'throw') {
      if (!actThrow(h)) { mode = 'idle'; UI.update(); }
      return;
    }
    if (mode === 'bash') {
      if (!actBash(h)) { mode = 'idle'; UI.update(); }
      return;
    }
    if (mode === 'leap') {
      const ok = leapTargets().some(t => hexEq(t.h, h));
      mode = 'idle';
      if (ok) actMove(h); else UI.update();
      return;
    }
    // Runestone: pray when adjacent
    if (hexEq(h, state.rune)) {
      if (state.runeUsed) { log('The runestone is spent.'); return; }
      if (hexDist(state.player, state.rune) === 1) actPray();
      else log('Stand beside the runestone to invoke it.');
      return;
    }
    if (hexEq(h, state.player)) { actWait(); return; }
    actMove(h);
  }

  function setMode(m) {
    if (!state || state.over || state.modal || traveling || state.replay) return;
    if (m === 'throw' && (!state.player.hasSpear)) { log('Your spear is not in hand.'); return; }
    if (m === 'bash' && state.player.bashCd > 0) { log('Your shield arm is still recovering.'); return; }
    if (m === 'leap' && state.bonusAction) { log('No leaping during your bonus action.'); return; }
    if (m === 'leap' && state.player.leapCd > 0) { log('Your legs need a moment before the next leap.'); return; }
    if (m === 'leap' && state.player.energy < 50) { log('Too winded to leap — you need 50 vigor.'); return; }
    if (m === 'bash' && has('sweeping')) { actBash(null); return; }
    mode = (mode === m) ? 'idle' : m;
    UI.update();
  }

  function getMode() { return mode; }

  return {
    get state() { return state; },
    set state(s) { state = s; },
    newGame, clickTile, setMode, getMode, loadRuns,
    actWait, actRecall, actFollow, actPray,
    currentHighlights, threatSet, computePreview,
    tileAt, foeAt, bombAt,
    Sound,
    has, leapRange,
  };
})();

/* Helheim — canvas renderer. All art is procedural (no image assets). */
'use strict';

const Renderer = (() => {
  let canvas, ctx, hexSize = 36, originX = 0, originY = 0, dpr = 1;

  const effects = [];   // {type, ..., t0, dur}
  const anims = new Map(); // entity id -> {x, y}
  let deathAnim = null;    // {t0} while the player's death sequence plays
  const DEATH_ANIM_MS = 1500;
  let preview = null;      // press-and-hold action preview (see Game.computePreview)
  function setPreview(p) { preview = p; }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.min(rect.width, 720);
    const cols = 2 * BOARD_RADIUS + 1;
    hexSize = Math.min(w / (Math.sqrt(3) * (cols + 0.6)), 40);
    const h = hexSize * (1.5 * cols + 1.4);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    originX = w / 2;
    originY = h / 2;
  }

  function tileCenter(h) {
    const p = hexToPixel(h, hexSize);
    return { x: originX + p.x, y: originY + p.y };
  }

  function pixelToTile(px, py) {
    let best = null, bestD = Infinity;
    for (const t of Game.state.tiles.values()) {
      const c = tileCenter(t);
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && Math.sqrt(bestD) <= hexSize * 0.98) return { q: best.q, r: best.r };
    return null;
  }

  /* ---------- animation helpers ---------- */

  function setAnim(id, h, snap) {
    const c = tileCenter(h);
    const cur = anims.get(id);
    if (snap || !cur) anims.set(id, { x: c.x, y: c.y });
  }

  function animPos(id, h) {
    const target = tileCenter(h);
    let a = anims.get(id);
    if (!a) { a = { x: target.x, y: target.y }; anims.set(id, a); }
    a.x += (target.x - a.x) * 0.28;
    a.y += (target.y - a.y) * 0.28;
    return a;
  }

  function addEffect(e) {
    e.t0 = performance.now();
    effects.push(e);
  }

  function fxSlash(h) { addEffect({ type: 'slash', h, dur: 260 }); }

  /* Attack hop: nudge an entity's rendered position toward its target;
     the anim lerp springs it back to its tile, reading as a strike. */
  function fxLunge(id, from, to, k) {
    const a = anims.get(id);
    if (!a) return;
    const f = tileCenter(from), t = tileCenter(to);
    a.x = f.x + (t.x - f.x) * k;
    a.y = f.y + (t.y - f.y) * k;
  }
  function fxBoom(h) { addEffect({ type: 'boom', h, dur: 420 }); }
  function fxBeam(from, to, color) { addEffect({ type: 'beam', from, to, color, dur: 480 }); }
  function fxText(h, text, color) { addEffect({ type: 'text', h, text, color, dur: 900 }); }
  function fxStun(h) { addEffect({ type: 'stun', h, dur: 500 }); }

  function clearAnims() { anims.clear(); effects.length = 0; deathAnim = null; }

  function playerDeath() { deathAnim = { t0: performance.now() }; }

  /* ---------- drawing primitives ---------- */

  function hexPath(cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI / 180 * (60 * i - 30);
      const x = cx + size * Math.cos(ang);
      const y = cy + size * Math.sin(ang);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawTile(t, now) {
    const c = tileCenter(t);
    if (t.lava) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 500 + t.q * 1.7 + t.r * 2.3);
      const grad = ctx.createRadialGradient(c.x, c.y, hexSize * 0.1, c.x, c.y, hexSize);
      grad.addColorStop(0, `rgb(${240}, ${140 + pulse * 60}, 40)`);
      grad.addColorStop(1, '#8c2b08');
      hexPath(c.x, c.y, hexSize * 0.96);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,180,80,' + (0.25 + pulse * 0.25) + ')';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Ember flecks
      ctx.fillStyle = 'rgba(255,230,120,' + (0.4 + pulse * 0.4) + ')';
      for (let i = 0; i < 3; i++) {
        const ang = t.q * 2.1 + t.r * 3.7 + i * 2.1;
        ctx.beginPath();
        ctx.arc(c.x + Math.cos(ang + now / 900) * hexSize * 0.4,
                c.y + Math.sin(ang * 1.3 + now / 1100) * hexSize * 0.35, 1.6, 0, 7);
        ctx.fill();
      }
      return;
    }
    hexPath(c.x, c.y, hexSize * 0.96);
    const shade = ((t.q * 31 + t.r * 17) % 5 + 5) % 5;
    ctx.fillStyle = ['#2e3644', '#2a323f', '#313a49', '#2c3441', '#2f3745'][shade];
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,170,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawStairs(h, now) {
    const c = tileCenter(h);
    hexPath(c.x, c.y, hexSize * 0.96);
    ctx.fillStyle = '#12161f';
    ctx.fill();
    // Descending steps
    ctx.strokeStyle = '#4a5a75';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const s = hexSize * (0.62 - i * 0.18);
      ctx.beginPath();
      ctx.moveTo(c.x - s, c.y - hexSize * 0.15 + i * hexSize * 0.2);
      ctx.lineTo(c.x + s, c.y - hexSize * 0.15 + i * hexSize * 0.2);
      ctx.stroke();
    }
    const pulse = 0.35 + 0.25 * Math.sin(now / 600);
    ctx.strokeStyle = `rgba(120,190,255,${pulse})`;
    hexPath(c.x, c.y, hexSize * 0.8);
    ctx.stroke();
  }

  function drawRune(h, used, now) {
    const c = tileCenter(h);
    // Standing stone
    ctx.fillStyle = used ? '#3a4150' : '#4a5266';
    ctx.beginPath();
    ctx.moveTo(c.x - hexSize * 0.42, c.y + hexSize * 0.5);
    ctx.lineTo(c.x - hexSize * 0.32, c.y - hexSize * 0.45);
    ctx.quadraticCurveTo(c.x, c.y - hexSize * 0.72, c.x + hexSize * 0.32, c.y - hexSize * 0.45);
    ctx.lineTo(c.x + hexSize * 0.42, c.y + hexSize * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1c2029';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const glow = used ? 0.25 : 0.65 + 0.3 * Math.sin(now / 400);
    ctx.fillStyle = used ? 'rgba(130,150,170,0.4)' : `rgba(110,235,220,${glow})`;
    ctx.font = `bold ${Math.round(hexSize * 0.42)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ᛒ', c.x, c.y - hexSize * 0.08);
    if (!used) {
      ctx.strokeStyle = `rgba(110,235,220,${glow * 0.5})`;
      hexPath(c.x, c.y, hexSize * 0.85);
      ctx.stroke();
    }
  }

  function drawSpearOnGround(h) {
    const c = tileCenter(h);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-0.6);
    drawSpearShape(0, 0, hexSize * 0.85);
    ctx.restore();
  }

  function drawSpearShape(x, y, len) {
    ctx.strokeStyle = '#9a7648';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y + len / 2);
    ctx.lineTo(x + len / 2 - 6, y - len / 2 + 6);
    ctx.stroke();
    ctx.fillStyle = '#cfd6e4';
    ctx.beginPath();
    ctx.moveTo(x + len / 2, y - len / 2);
    ctx.lineTo(x + len / 2 - 9, y - len / 2 + 2);
    ctx.lineTo(x + len / 2 - 2, y - len / 2 + 9);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayer(p, now) {
    const pos = animPos('P', p);
    const bob = Math.sin(now / 500) * 1.5;
    const s = hexSize;
    const x = pos.x, y = pos.y + bob;
    // Cloak
    ctx.fillStyle = '#3d5a80';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y + s * 0.42);
    ctx.quadraticCurveTo(x, y - s * 0.1, x + s * 0.34, y + s * 0.42);
    ctx.closePath();
    ctx.fill();
    // Body
    ctx.fillStyle = '#8b6b4a';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.08, s * 0.26, s * 0.3, 0, 0, 7);
    ctx.fill();
    // Head
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.3, s * 0.18, 0, 7);
    ctx.fill();
    // Beard
    ctx.fillStyle = '#c98f4e';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.24, s * 0.14, 0.2, Math.PI - 0.2);
    ctx.closePath();
    ctx.fill();
    // Helm
    ctx.fillStyle = '#aab4c4';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.34, s * 0.185, Math.PI, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#6d7889';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.52);
    ctx.lineTo(x, y - s * 0.34);
    ctx.stroke();
    // Round shield (left)
    ctx.fillStyle = '#7a4a2e';
    ctx.beginPath();
    ctx.arc(x - s * 0.34, y + s * 0.02, s * 0.2, 0, 7);
    ctx.fill();
    ctx.strokeStyle = '#d8b25a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x - s * 0.34, y + s * 0.02, s * 0.2, 0, 7);
    ctx.stroke();
    ctx.fillStyle = '#d8b25a';
    ctx.beginPath();
    ctx.arc(x - s * 0.34, y + s * 0.02, s * 0.06, 0, 7);
    ctx.fill();
    // Spear (right) if held
    if (Game.state.player.hasSpear) {
      ctx.save();
      ctx.translate(x + s * 0.36, y);
      ctx.rotate(0.12);
      drawSpearShape(0, 0, s * 0.95);
      ctx.restore();
    } else {
      // Axe when spear is thrown
      ctx.strokeStyle = '#9a7648';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.3, y + s * 0.3);
      ctx.lineTo(x + s * 0.42, y - s * 0.25);
      ctx.stroke();
      ctx.fillStyle = '#cfd6e4';
      ctx.beginPath();
      ctx.arc(x + s * 0.42, y - s * 0.28, s * 0.12, -1.2, 1.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* The fallen raider: a final flinch, a topple-and-sink, the helm tumbling
     free, and the soul rising to Valhalla — plays over ~1.5s before the modal. */
  function drawPlayerDeath(now) {
    const st = Game.state;
    const c = tileCenter(st.player);
    const s = hexSize;
    const pc = Math.min(Math.max((now - deathAnim.t0) / DEATH_ANIM_MS, 0), 1);

    // Fatal impact ring
    if (pc < 0.22) {
      const k = pc / 0.22;
      ctx.strokeStyle = `rgba(255,120,120,${(1 - k) * 0.9})`;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * (0.3 + k * 0.9), 0, 7);
      ctx.stroke();
    }

    // Collapsing body (toppling and sinking, fading out in the second half)
    const ease = 1 - Math.pow(1 - pc, 2);
    const bodyAlpha = pc < 0.6 ? 1 : Math.max(0, 1 - (pc - 0.6) / 0.4);
    if (bodyAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = bodyAlpha;
      ctx.translate(c.x, c.y + ease * s * 0.42);
      ctx.rotate(ease * 1.1);
      ctx.fillStyle = '#3d5a80';
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.42);
      ctx.quadraticCurveTo(0, -s * 0.1, s * 0.34, s * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8b6b4a';
      ctx.beginPath();
      ctx.ellipse(0, s * 0.08, s * 0.26, s * 0.3, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#e8c39a';
      ctx.beginPath();
      ctx.arc(0, -s * 0.3, s * 0.18, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#c98f4e';
      ctx.beginPath();
      ctx.arc(0, -s * 0.24, s * 0.14, 0.2, Math.PI - 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Helm tumbles free
    const helmAlpha = Math.max(0, 0.9 * (1 - pc));
    if (helmAlpha > 0.01) {
      const hop = Math.sin(pc * Math.PI) * s * 0.4;
      ctx.save();
      ctx.globalAlpha = helmAlpha;
      ctx.translate(c.x + ease * s * 0.5, c.y - s * 0.34 - hop + ease * s * 0.2);
      ctx.rotate(pc * 3.5);
      ctx.fillStyle = '#aab4c4';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.185, Math.PI, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Soul rising to Valhalla
    if (pc > 0.2) {
      const sp = (pc - 0.2) / 0.8;
      const sy = c.y - sp * s * 2.0;
      const alpha = Math.sin(sp * Math.PI) * 0.8;
      const grad = ctx.createRadialGradient(c.x, sy, 1, c.x, sy, s * 0.5);
      grad.addColorStop(0, `rgba(200,230,255,${alpha})`);
      grad.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, sy, s * 0.5, 0, 7);
      ctx.fill();
      ctx.fillStyle = `rgba(220,240,255,${alpha})`;
      for (let i = 0; i < 3; i++) {
        const ang = i * 2.1;
        ctx.beginPath();
        ctx.arc(c.x + Math.cos(ang + sp * 3) * s * 0.18,
                sy + Math.sin(ang) * s * 0.12 - sp * s * 0.3, 1.6, 0, 7);
        ctx.fill();
      }
    }
  }

  function drawFoe(f, now) {
    const def = FOES[f.type];
    const pos = animPos(f.id, f);
    const s = hexSize;
    const x = pos.x, y = pos.y + Math.sin(now / 420 + f.q) * 1.2;

    if (f.elite) {
      const pulse = 0.5 + 0.3 * Math.sin(now / 300);
      ctx.strokeStyle = `rgba(255,205,80,${pulse})`;
      ctx.lineWidth = 2;
      hexPath(pos.x, pos.y, s * 0.8);
      ctx.stroke();
    }

    // Body
    ctx.fillStyle = def.color;
    ctx.strokeStyle = def.dark;
    ctx.lineWidth = 1.5;

    if (f.type === 'draugr') {
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.06, s * 0.27, s * 0.32, 0, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - s * 0.28, s * 0.17, 0, 7);
      ctx.fill(); ctx.stroke();
      // Glowing eyes
      ctx.fillStyle = '#bfffd0';
      ctx.beginPath(); ctx.arc(x - s * 0.06, y - s * 0.3, 1.8, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.06, y - s * 0.3, 1.8, 0, 7); ctx.fill();
      // Axe
      ctx.strokeStyle = '#5b4a33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.28, y + s * 0.3); ctx.lineTo(x + s * 0.38, y - s * 0.18);
      ctx.stroke();
      ctx.fillStyle = '#9aa5b5';
      ctx.beginPath();
      ctx.arc(x + s * 0.38, y - s * 0.2, s * 0.1, -1.2, 1.6);
      ctx.closePath(); ctx.fill();
    } else if (f.type === 'archer') {
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.06, s * 0.22, s * 0.3, 0, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - s * 0.28, s * 0.15, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#33302a';
      ctx.beginPath(); ctx.arc(x - s * 0.05, y - s * 0.29, 1.6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.05, y - s * 0.29, 1.6, 0, 7); ctx.fill();
      // Bow
      ctx.strokeStyle = '#8a6a3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + s * 0.3, y, s * 0.26, -1.25, 1.25);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,230,230,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.3 + Math.cos(-1.25) * s * 0.26, y + Math.sin(-1.25) * s * 0.26);
      ctx.lineTo(x + s * 0.3 + Math.cos(1.25) * s * 0.26, y + Math.sin(1.25) * s * 0.26);
      ctx.stroke();
    } else if (f.type === 'surtling') {
      // Flame body
      const flick = Math.sin(now / 120 + f.q * 3) * s * 0.05;
      const grad = ctx.createRadialGradient(x, y, 2, x, y, s * 0.4);
      grad.addColorStop(0, '#ffe9a0');
      grad.addColorStop(0.55, def.color);
      grad.addColorStop(1, def.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.48 - flick);
      ctx.quadraticCurveTo(x + s * 0.34, y - s * 0.05, x + s * 0.22, y + s * 0.3);
      ctx.quadraticCurveTo(x, y + s * 0.42, x - s * 0.22, y + s * 0.3);
      ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.05, x, y - s * 0.48 - flick);
      ctx.fill();
      ctx.fillStyle = '#2b1206';
      ctx.beginPath(); ctx.arc(x - s * 0.08, y - s * 0.05, 2.2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.08, y - s * 0.05, 2.2, 0, 7); ctx.fill();
      // Charge indicator: about to throw
      if (f.charges >= FOES.surtling.chargesNeeded) {
        ctx.fillStyle = 'rgba(255,240,150,0.9)';
        ctx.font = `bold ${Math.round(s * 0.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('!', x, y - s * 0.62);
      }
    } else if (f.type === 'volva') {
      // Robed seer
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.45);
      ctx.lineTo(x + s * 0.3, y + s * 0.38);
      ctx.lineTo(x - s * 0.3, y + s * 0.38);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#dcc8ee';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.34, s * 0.13, 0, 7);
      ctx.fill();
      // Staff
      ctx.strokeStyle = '#5b4a33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.3, y + s * 0.34); ctx.lineTo(x - s * 0.3, y - s * 0.4);
      ctx.stroke();
      const charged = !(f.cooldown > 0);
      const g = charged ? 0.9 : 0.25;
      ctx.fillStyle = `rgba(200,120,255,${g})`;
      ctx.beginPath();
      ctx.arc(x - s * 0.3, y - s * 0.46, s * 0.09 + (charged ? Math.sin(now / 150) * 1.5 : 0), 0, 7);
      ctx.fill();
    }

    // Elite HP pips
    if (f.elite && f.hp > 1) {
      ctx.fillStyle = '#ffcd50';
      for (let i = 0; i < f.hp; i++) {
        ctx.beginPath();
        ctx.arc(pos.x - 5 + i * 10, pos.y + s * 0.62, 2.6, 0, 7);
        ctx.fill();
      }
    }
    if (f.stun > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${Math.round(s * 0.34)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('✦', pos.x + s * 0.3, pos.y - s * 0.45);
    }
  }

  function drawBomb(b, now) {
    const pos = animPos('b_' + b.id, b);
    const s = hexSize;
    const urgent = b.fuse <= 0 ? 1 : (b.fuse === 1 ? 0.7 : 0.3);
    const pulse = 0.5 + 0.5 * Math.sin(now / (b.fuse <= 1 ? 110 : 300));
    ctx.fillStyle = '#26211c';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y + s * 0.08, s * 0.26, 0, 7);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,${120 + pulse * 100},40,${0.5 + urgent * 0.5})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Fuse spark
    ctx.strokeStyle = '#8a6a3c';
    ctx.beginPath();
    ctx.moveTo(pos.x + s * 0.08, pos.y - s * 0.14);
    ctx.quadraticCurveTo(pos.x + s * 0.2, pos.y - s * 0.32, pos.x + s * 0.1, pos.y - s * 0.4);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,230,120,${0.5 + pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(pos.x + s * 0.1, pos.y - s * 0.42, 3 + pulse * 1.5, 0, 7);
    ctx.fill();
  }

  /* ---------- overlays ---------- */

  function drawHighlights() {
    const st = Game.state;
    if (st.over || st.modal) return;
    // While a preview is held, the preview overlay replaces the normal
    // highlights/threat dashes so the board reads clearly.
    if (preview) { drawPreviewThreats(); return; }
    const hl = Game.currentHighlights();
    for (const { h, kind } of hl) {
      const c = tileCenter(h);
      hexPath(c.x, c.y, hexSize * 0.9);
      if (kind === 'move') {
        ctx.fillStyle = 'rgba(140,220,255,0.10)';
        ctx.strokeStyle = 'rgba(140,220,255,0.45)';
      } else if (kind === 'leap') {
        ctx.fillStyle = 'rgba(160,255,190,0.10)';
        ctx.strokeStyle = 'rgba(160,255,190,0.45)';
      } else if (kind === 'throw') {
        ctx.fillStyle = 'rgba(255,220,120,0.13)';
        ctx.strokeStyle = 'rgba(255,220,120,0.6)';
      } else if (kind === 'bash') {
        ctx.fillStyle = 'rgba(255,160,120,0.16)';
        ctx.strokeStyle = 'rgba(255,160,120,0.65)';
      }
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Threatened tiles
    for (const k of Game.threatSet()) {
      const [q, r] = k.split(',').map(Number);
      const c = tileCenter({ q, r });
      hexPath(c.x, c.y, hexSize * 0.55);
      ctx.strokeStyle = 'rgba(255,90,90,0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ---------- press-and-hold preview overlay ---------- */

  // Strong threat tiles (drawn under entities, in place of the dashed markers).
  function drawPreviewThreats() {
    if (!preview || !preview.threats) return;
    for (const k of preview.threats) {
      const [q, r] = k.split(',').map(Number);
      const c = tileCenter({ q, r });
      hexPath(c.x, c.y, hexSize * 0.88);
      ctx.fillStyle = 'rgba(255,70,70,0.16)';
      ctx.strokeStyle = 'rgba(255,80,80,0.75)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawGhost(c, now) {
    const s = hexSize;
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.12 * Math.sin(now / 300);
    // dashed landing ring
    ctx.strokeStyle = 'rgba(180,230,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    hexPath(c.x, c.y, s * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
    // translucent raider silhouette
    const x = c.x, y = c.y;
    ctx.fillStyle = 'rgba(120,180,230,0.7)';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.08, s * 0.26, s * 0.3, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - s * 0.3, s * 0.17, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(200,220,240,0.7)';
    ctx.beginPath(); ctx.arc(x, y - s * 0.34, s * 0.18, Math.PI, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  // Markers drawn on top of entities: kill Xs, stun sparks, ghost, spear, rings.
  function drawPreviewMarks(now) {
    if (!preview) return;
    const s = hexSize;

    if (preview.focusFoe) {
      const c = tileCenter(preview.focusFoe);
      const pulse = 0.5 + 0.4 * Math.sin(now / 240);
      ctx.strokeStyle = `rgba(255,235,150,${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 2.5;
      hexPath(c.x, c.y, s * 0.86);
      ctx.stroke();
    }

    for (const t of preview.push || []) {
      const a = tileCenter(t.from), b = tileCenter(t.to);
      ctx.strokeStyle = 'rgba(255,180,120,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 8 * Math.cos(ang - 0.5), b.y - 8 * Math.sin(ang - 0.5));
      ctx.lineTo(b.x - 8 * Math.cos(ang + 0.5), b.y - 8 * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,180,120,0.9)';
      ctx.fill();
    }

    if (preview.boom) {
      const c = tileCenter(preview.boom);
      ctx.strokeStyle = 'rgba(255,150,60,0.9)';
      ctx.lineWidth = 2;
      hexPath(c.x, c.y, s * 0.85);
      ctx.stroke();
    }

    for (const d of preview.dying || []) {
      const c = tileCenter(d);
      hexPath(c.x, c.y, s * 0.9);
      ctx.fillStyle = 'rgba(255,60,60,0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,70,70,0.95)';
      ctx.lineWidth = 3;
      const r = s * 0.3;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - r); ctx.lineTo(c.x + r, c.y + r);
      ctx.moveTo(c.x + r, c.y - r); ctx.lineTo(c.x - r, c.y + r);
      ctx.stroke();
    }

    for (const st of preview.stun || []) {
      const c = tileCenter(st);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${Math.round(s * 0.4)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', c.x, c.y - s * 0.4);
    }

    if (preview.spear) drawSpearOnGround(preview.spear);
    if (preview.ghost) drawGhost(tileCenter(preview.ghost), now);

    if (preview.playerHit) {
      const c = tileCenter(Game.state.player);
      const pulse = 0.5 + 0.4 * Math.sin(now / 180);
      ctx.strokeStyle = `rgba(255,60,60,${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      hexPath(c.x, c.y, s * 0.8);
      ctx.stroke();
    }
  }

  function drawEffects(now) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const t = (now - e.t0) / e.dur;
      if (t >= 1) { effects.splice(i, 1); continue; }
      if (e.type === 'slash') {
        const c = tileCenter(e.h);
        ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, hexSize * (0.2 + t * 0.5), -0.8 + t * 2, 0.6 + t * 2);
        ctx.stroke();
      } else if (e.type === 'boom') {
        const c = tileCenter(e.h);
        const rad = hexSize * (0.3 + t * 1.6);
        ctx.strokeStyle = `rgba(255,170,60,${1 - t})`;
        ctx.lineWidth = 5 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, 7);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,120,40,${0.35 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, 7);
        ctx.fill();
      } else if (e.type === 'beam') {
        const a = tileCenter(e.from), b = tileCenter(e.to);
        ctx.strokeStyle = e.color.replace('$A', String(0.9 * (1 - t)));
        ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (e.type === 'text') {
        const c = tileCenter(e.h);
        ctx.fillStyle = e.color.replace('$A', String(1 - t));
        ctx.font = `bold ${Math.round(hexSize * 0.42)}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillText(e.text, c.x, c.y - hexSize * 0.5 - t * 22);
      } else if (e.type === 'stun') {
        const c = tileCenter(e.h);
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
        ctx.lineWidth = 2;
        hexPath(c.x, c.y, hexSize * (0.5 + t * 0.4));
        ctx.stroke();
      }
    }
  }

  /* ---------- main frame ---------- */

  function frame(now) {
    requestAnimationFrame(frame);
    if (!Game.state) return;
    const st = Game.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (const t of st.tiles.values()) {
      if (hexEq(t, st.stairs)) drawStairs(t, now);
      else drawTile(t, now);
    }
    drawHighlights();
    drawRune(st.rune, st.runeUsed, now);
    if (st.player.spearAt) drawSpearOnGround(st.player.spearAt);
    for (const b of st.bombs) drawBomb(b, now);
    for (const f of st.foes) drawFoe(f, now);
    if (!st.over) drawPlayer(st.player, now);
    else if (deathAnim) drawPlayerDeath(now);
    drawPreviewMarks(now);
    drawEffects(now);

    // Hover tooltip target
    if (hoverTile) {
      const c = tileCenter(hoverTile);
      hexPath(c.x, c.y, hexSize * 0.96);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  let hoverTile = null;
  function setHover(h) { hoverTile = h; }

  return {
    init, pixelToTile, setAnim, clearAnims, setHover, playerDeath, setPreview,
    fxSlash, fxBoom, fxBeam, fxText, fxStun, fxLunge,
  };
})();

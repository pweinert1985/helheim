/* Helheim — floor generation with connectivity guarantee */
'use strict';

const BOARD_RADIUS = 4;

function randInt(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }

function weightedPick(pool) {
  let total = 0;
  for (const [, w] of pool) total += w;
  let roll = Math.random() * total;
  for (const [item, w] of pool) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1][0];
}

/*
 * Returns { tiles: Map key->{q,r,lava,decor}, stairs, rune, start, foes[] }
 * Guarantees the stairs and a rune-adjacent tile are reachable from start.
 */
function generateLevel(depth) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = hexBoard(BOARD_RADIUS);
    const tiles = new Map();
    for (const c of cells) {
      tiles.set(hexKey(c.q, c.r), { q: c.q, r: c.r, lava: false });
    }

    const start = { q: 0, r: BOARD_RADIUS };
    const stairs = { q: randInt(3) - 1, r: -BOARD_RADIUS };
    // Runestone somewhere in the middle band, away from start and stairs.
    const runeCandidates = cells.filter(c =>
      hexDist(c, start) >= 3 && hexDist(c, stairs) >= 2 && Math.abs(c.r) <= 2);
    const rune = pick(runeCandidates);

    // Lava rifts: scale with depth, capped so the board stays playable.
    const lavaCount = Math.min(3 + Math.floor(depth * 0.8), 13);
    const lavaCandidates = cells.filter(c =>
      !hexEq(c, start) && !hexEq(c, stairs) && !hexEq(c, rune) &&
      hexDist(c, start) > 1 && hexDist(c, stairs) > 1);
    // Shuffle
    for (let i = lavaCandidates.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [lavaCandidates[i], lavaCandidates[j]] = [lavaCandidates[j], lavaCandidates[i]];
    }
    for (let i = 0; i < lavaCount && i < lavaCandidates.length; i++) {
      const c = lavaCandidates[i];
      tiles.get(hexKey(c.q, c.r)).lava = true;
    }

    // Connectivity: BFS over walkable ground (rune blocks movement).
    const reach = new Set();
    const queue = [start];
    reach.add(hexKey(start.q, start.r));
    while (queue.length) {
      const cur = queue.shift();
      for (const n of hexNeighbors(cur)) {
        const k = hexKey(n.q, n.r);
        const t = tiles.get(k);
        if (!t || t.lava || reach.has(k)) continue;
        if (hexEq(n, rune)) continue;
        reach.add(k);
        queue.push(n);
      }
    }
    const runeReachable = hexNeighbors(rune).some(n => reach.has(hexKey(n.q, n.r)));
    if (!reach.has(hexKey(stairs.q, stairs.r)) || !runeReachable) continue;

    // Foes: spawn on reachable ground, away from the start.
    const foeCount = Math.min(3 + Math.floor(depth * 0.7), 11);
    const eliteChance = Math.max(0, Math.min(0.5, (depth - 5) * 0.05));
    const pool = foePool(depth);
    const spawnCandidates = cells.filter(c => {
      const k = hexKey(c.q, c.r);
      return reach.has(k) && !tiles.get(k).lava &&
        !hexEq(c, start) && !hexEq(c, stairs) && !hexEq(c, rune) &&
        hexDist(c, start) >= 3;
    });
    if (spawnCandidates.length < foeCount) continue;
    for (let i = spawnCandidates.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [spawnCandidates[i], spawnCandidates[j]] = [spawnCandidates[j], spawnCandidates[i]];
    }
    const foes = [];
    for (let i = 0; i < foeCount; i++) {
      const c = spawnCandidates[i];
      const type = weightedPick(pool);
      const elite = Math.random() < eliteChance;
      foes.push({
        id: 'f' + depth + '_' + i,
        type, q: c.q, r: c.r,
        hp: elite ? 2 : 1, elite,
        charges: 0, cooldown: 0,
        stun: 0,
      });
    }

    return { tiles, stairs, rune, start, foes };
  }
  throw new Error('Level generation failed');
}

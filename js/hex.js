/* Helheim — hex grid math (pointy-top, axial coordinates) */
'use strict';

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function hexKey(q, r) { return q + ',' + r; }

function hexAdd(a, b) { return { q: a.q + b.q, r: a.r + b.r }; }

function hexScale(a, k) { return { q: a.q * k, r: a.r * k }; }

function hexEq(a, b) { return a.q === b.q && a.r === b.r; }

function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function hexNeighbors(h) {
  return HEX_DIRS.map(d => hexAdd(h, d));
}

/* If b lies on one of the 6 axis rays from a, return {dir, steps}; else null. */
function hexRay(a, b) {
  const dq = b.q - a.q, dr = b.r - a.r;
  if (dq === 0 && dr === 0) return null;
  for (const d of HEX_DIRS) {
    let k = null;
    if (d.q !== 0 && dq % d.q === 0) k = dq / d.q;
    else if (d.q === 0 && dq === 0) k = dr / d.r;
    if (k !== null && k > 0 && Number.isInteger(k) &&
        a.q + d.q * k === b.q && a.r + d.r * k === b.r) {
      return { dir: d, steps: k };
    }
  }
  return null;
}

/* Pixel position of a hex center (pointy-top). */
function hexToPixel(h, size) {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/* All hexes within radius R of origin (hexagonal board). */
function hexBoard(R) {
  const out = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

/* All hexes at distance <= range from center (excluding center). */
function hexWithin(center, range) {
  const out = [];
  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      if (q === 0 && r === 0) continue;
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

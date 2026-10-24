// The individual reeds (D7). Every reed (each rank on each key) has its own fixed
// tuning error and its own response to the wind. They come from a hash of the
// reed set's seed, rank and key, so they are random across the keyboard but the
// same on every visit until new reeds are fitted. Pure: no page, no audio.

import { RANKS } from './ranks.js';

// Uniform in [0, 1).
export function reedRand(seed, i, m, salt) {
  let h = Math.imul(seed, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ Math.imul(m + 1, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Triangular in [−1, 1]: most reeds close to the mark, a few further off.
export const reedTri = (seed, i, m, salt) => reedRand(seed, i, m, salt) + reedRand(seed, i, m, salt + 100) - 1;

// This reed's tuning error in cents, for a scatter of ±`spread` cents.
export const reedError = (seed, i, m, spread) => reedTri(seed, i, m, 1) * spread;

// How strongly this reed follows the wind's pitch drift (1 = exactly with the
// organ), for a Drift variation of `variation` (0…1). Bigger, lower reeds move more.
export function reedWindResponse(seed, i, m, variation) {
  const p = m + 12 * Math.log2(RANKS[i].mult);             // the pitch this reed actually sounds
  const reg = Math.max(-1, Math.min(1, (60 - p) / 24));
  return Math.max(0, 1 + variation * (.6 * reedTri(seed, i, m, 2) + .4 * reg));
}

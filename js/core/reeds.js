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

// Unison pull (D14). Reeds on one key that sound in unison or octaves share the
// same wind chest, and when their tunings are close enough they pull into step
// and sound as one, rather than beating slowly. Given each reed's settled offset
// in cents, its wind response and whether it may lock (the Celeste never does,
// its beat is the point), finds the largest group of lockable reeds whose
// offsets lie within `range` cents of each other. Group members take the group's
// average offset and wind response, so they stay locked as the wind moves.
// Returns new arrays and `locked` flags; a group needs at least two reeds.
export function lockReeds(cents, winds, lockable, range) {
  const out = { cents: [...cents], winds: [...winds], locked: cents.map(() => false) };
  if (!(range > 0)) return out;
  const idx = cents.map((_, i) => i).filter(i => lockable[i]).sort((a, b) => cents[a] - cents[b] || a - b);
  let best = [];
  for (let s = 0, e = 0; s < idx.length; s++) {
    while (e < idx.length && cents[idx[e]] - cents[idx[s]] <= range) e++;
    if (e - s > best.length) best = idx.slice(s, e);
  }
  if (best.length < 2) return out;
  const c = best.reduce((a, i) => a + cents[i], 0) / best.length;
  const w = best.reduce((a, i) => a + winds[i], 0) / best.length;
  for (const i of best) { out.cents[i] = c; out.winds[i] = w; out.locked[i] = true; }
  return out;
}

// How strongly this reed follows the wind's pitch drift (1 = exactly with the
// organ), for a Drift variation of `variation` (0…1). Bigger, lower reeds move more.
export function reedWindResponse(seed, i, m, variation) {
  const p = m + 12 * Math.log2(RANKS[i].mult);             // the pitch this reed actually sounds
  const reg = Math.max(-1, Math.min(1, (60 - p) / 24));
  return Math.max(0, 1 + variation * (.6 * reedTri(seed, i, m, 2) + .4 * reg));
}

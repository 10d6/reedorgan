// Expression (D28): a musical pitch scoop and the MIDI pitch wheel. Pure: no
// page, no audio.
//
// These are deliberately not part of the historical instrument. A reed organ's
// reeds only move a few cents (D12, D13); a scoop from below into the note is a
// singer's, a horn player's or a blues harmonica player's gesture. What makes it
// sound intended rather than out of tune:
//  - it lands exactly on pitch at a set time and stays there, instead of
//    creeping in on an exponential tail that leaves the note a few cents flat;
//  - every reed on the key (and its coupled octaves) bends together, so the stop
//    combination moves as one voice and its intervals never come apart;
//  - it is selective: by default only the top voice of what you're holding.

// How the scoop's distance to the note shrinks over its duration: x runs 0…1,
// the result runs 1 (the full depth below) down to exactly 0 (on pitch), and
// both curves arrive with zero slope, so there is no kink at the landing.
//  ease:   fast at first, then settling, (1 − x)²
//  smooth: an S-curve that holds low a moment, then rises, 1 − smootherstep(x)
export const SCOOP_CURVES = ['ease', 'smooth'];
export function scoopShape(x, curve) {
  const u = Math.min(1, Math.max(0, x));
  if (curve === 'smooth') return 1 - u * u * u * (u * (6 * u - 15) + 10);
  return (1 - u) * (1 - u);
}
// The pitch offset in cents (negative: below the note) at fraction x of the scoop.
export const scoopValue = (depth, curve, x) => -depth * scoopShape(x, curve);
// The scoop as a value curve for AudioParam.setValueCurveAtTime: n points from
// −depth to exactly 0.
export function scoopCurve(depth, curve, n = 64) {
  const c = new Float32Array(n);
  for (let k = 0; k < n; k++) c[k] = k === n - 1 ? 0 : scoopValue(depth, curve, k / (n - 1));
  return c;
}
// The scoop never lands before the reed is at full voice, so pitch and tone
// arrive together: its duration is the Scoop time or the reed's rise time,
// whichever is longer.
export const scoopDuration = (time, rise) => Math.max(time, rise);

// Which notes scoop.
//  top:      the highest key you're holding, so a melody bends over a steady chord
//  leaps:    the top voice, only when it jumps up by LEAP semitones or more
//  all:      every note
//  velocity: every note, deeper the harder you strike (keys and mouse count as 100)
export const SCOOP_MODES = ['top', 'leaps', 'all', 'velocity'];
export const LEAP = 3;
// A chord's notes arrive a few milliseconds apart, in any order. A note that was
// the top voice for less than this many seconds, before a higher one arrived,
// was part of a chord, not the melody, and gives up its scoop.
export const CHORD_WINDOW = .035;

// How deep this key's scoop is, in cents. `held` is the other keys being held
// (not counting this one or coupled octaves), `lastTop` the previous top-voice
// key (or null) and `velocity` 1…127.
export function scoopDepth({ mode, depth, m, held, lastTop, velocity = 100 }) {
  if (!(depth > 0)) return 0;
  if (mode === 'all') return depth;
  if (mode === 'velocity') return depth * Math.min(1, Math.max(0, velocity / 127));
  if (!isTop(m, held)) return 0;
  if (mode === 'leaps') return lastTop != null && m - lastTop >= LEAP ? depth : 0;
  return depth;
}
export const isTop = (m, held) => held.every(k => k < m);

// The MIDI pitch wheel (14 bits, centre 8192) in cents for a bend range of
// `range` semitones each way. Fully up and fully down reach exactly ±range.
export function bendCents(lsb, msb, range) {
  const v = ((msb & 127) << 7 | (lsb & 127)) - 8192;
  return (v >= 0 ? v / 8191 : v / 8192) * range * 100;
}

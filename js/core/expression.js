// Expression (D28, D29): a musical pitch scoop, delayed vibrato and the MIDI
// pitch wheel. Pure: no page, no audio.
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
// the result runs 1 (the full depth below) down to exactly 0 (on pitch).
//  ease:   fast at first, then settling, (1 − x)²; arrives with zero slope
//  smooth: an S-curve that holds low a moment, then rises, 1 − smootherstep(x);
//          arrives with zero slope
//  snap:   holds below longest and speeds up all the way into the note,
//          1 − x³, so it arrives at its fastest (D29): a deliberate flick
export const SCOOP_CURVES = ['ease', 'smooth', 'snap'];
export function scoopShape(x, curve) {
  const u = Math.min(1, Math.max(0, x));
  if (curve === 'smooth') return 1 - u * u * u * (u * (6 * u - 15) + 10);
  if (curve === 'snap') return 1 - u * u * u;
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
//  accent:   every note struck at or past the Crossover velocity scoops the
//            full depth; softer notes don't scoop at all (D29)
export const SCOOP_MODES = ['top', 'leaps', 'all', 'velocity', 'accent'];
// Keys and mouse have no velocity; they count as this.
export const KEY_VELOCITY = 100;
export const LEAP = 3;
// A chord's notes arrive a few milliseconds apart, in any order. A note that was
// the top voice for less than this many seconds, before a higher one arrived,
// was part of a chord, not the melody, and gives up its scoop.
export const CHORD_WINDOW = .035;

// How deep this key's scoop is, in cents. `held` is the other keys being held
// (not counting this one or coupled octaves), `lastTop` the previous top-voice
// key (or null), `velocity` 1…127 and `crossover` the accent threshold, 1…127.
export function scoopDepth({ mode, depth, m, held, lastTop, velocity = KEY_VELOCITY, crossover = 90 }) {
  if (!(depth > 0)) return 0;
  if (mode === 'all') return depth;
  if (mode === 'velocity') return depth * Math.min(1, Math.max(0, velocity / 127));
  if (mode === 'accent') return velocity >= crossover ? depth : 0;
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

/* ---------- delayed vibrato (D29) ----------
   A singer's vibrato doesn't start with the note: the note settles first, then
   the vibrato blooms in. Short notes in a quick passage never get any; long
   notes do. And it isn't a machine's sine wave: it starts a little slow and
   speeds up to its rate as it grows, its rate and width wander slightly from
   cycle to cycle, and the tone colour moves with the pitch, because the
   voice's harmonics slide across the resonances of the throat and mouth. */

// Which notes get vibrato: the top voice (one singer over the accompaniment;
// it moves to each new top note), or every note.
export const VIB_MODES = ['top', 'all'];

// Vibrato delay slider, in ms. Its top position is Never: no vibrato unless a
// controller brings the delay down (see delayFromCC).
export const VIB_DELAY_MAX = 2500;
export const vibDelaySec = v => v >= VIB_DELAY_MAX ? Infinity : v / 1000;
// A controller learned for the delay: all the way down is Never, all the way
// up is no delay, so pushing it brings the vibrato in sooner. Returns the
// slider position, in 50 ms steps.
export const delayFromCC = cc => Math.round((1 - Math.min(127, Math.max(0, cc)) / 127) * VIB_DELAY_MAX / 50) * 50;

// When the vibrato starts growing: `delay` seconds after the note lands (the
// end of its scoop, or note-on without one). `now` is the earliest it can be
// scheduled. Infinity means not yet.
export const vibStart = (land, delay, now) => delay === Infinity ? Infinity : Math.max(now, land + delay);

// The fade-in, as a value curve for setValueCurveAtTime: an S-curve from 0 to
// exactly 1, so the vibrato grows in rather than switching on.
export function vibFadeCurve(n = 64) {
  const c = new Float32Array(n);
  for (let k = 0; k < n; k++) { const u = k / (n - 1); c[k] = u * u * (3 - 2 * u); }
  return c;
}

// Natural variation (0…1) sets three things at once:
//  - the rate starts this much slower and speeds up to the set rate as the
//    vibrato fades in,
//  - the rate wanders by up to ± this fraction,
//  - the width wanders by up to ± this fraction.
export const VIB_RATE_START = .2, VIB_RATE_WANDER = .08, VIB_DEPTH_WANDER = .25;
export const vibStartRate = (rate, natural) => rate * (1 - VIB_RATE_START * natural);

// Voice colour (0…1): the reed's upper harmonics rise and fall with the pitch
// by up to ± this many dB.
export const VIB_COLOUR_DB = 4;

// A slowly wandering value between −1 and 1: random points `step` seconds
// apart, joined by cosine curves, so it never jumps. `rand` returns 0…1.
export function wanderCurve(seconds, sampleRate, step, rand = Math.random) {
  const n = Math.round(seconds * sampleRate), k = Math.max(1, Math.round(seconds / step));
  const pts = Array.from({ length: k }, () => rand() * 2 - 1);
  pts.push(pts[0]);                             // the end meets the start, so it loops smoothly
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n * k, j = Math.floor(x), f = (1 - Math.cos(Math.PI * (x - j))) / 2;
    out[i] = pts[j] + (pts[j + 1] - pts[j]) * f;
  }
  return out;
}

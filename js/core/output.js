// The output stage: volume, the cabinet's bass roll-off, the limiter and the
// soft-clip ceiling (D19, D20). Pure: no page, no audio.

// Volume slider (0–150%) to gain: squared so equal steps sound even. 100% = 1,
// 50% = −12 dB, 150% = +7 dB.
export const volumeGain = v => (v / 100) ** 2;

// Cabinet bass slider (0–100) to the highpass corner in Hz: 20 Hz to 200 Hz on a
// log scale, default 60 ≈ 80 Hz. The bottom of the slider is Off (5 Hz, well
// below anything the organ plays).
export const bassCutHz = v => v === 0 ? 5 : 20 * Math.pow(10, v / 100);

// The limiter's threshold (dB) and ratio. A DynamicsCompressorNode adds its own
// make-up gain, 0.6 × the gain it would take off a full-scale signal; the
// master gain trims this back out so the level below the limit is unchanged.
export const LIMIT = -4, LIMIT_RATIO = 20;
export const limiterMakeupDb = (threshold = LIMIT, ratio = LIMIT_RATIO) => .6 * -threshold * (1 - 1 / ratio);

// The ceiling after the limiter: unity below ±0.9, then a smooth knee that
// stays below full scale.
export const softClip = x => { const a = Math.abs(x); return a < .9 ? x : Math.sign(x) * (.9 + .085 * Math.tanh((a - .9) / .085)); };
export function softClipCurve(n = 2049) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = softClip(i / (n - 1) * 2 - 1);
  return c;
}

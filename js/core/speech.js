// How a reed speaks (D16, D17). Pure: no page, no audio.
//
// A free reed's swing grows from almost nothing, slowly at first and then fast,
// until it settles at full size, so its onset is S-shaped rather than starting at
// full speed. Big, low reeds take roughly a fixed number of cycles to get going,
// so they speak more slowly than small, high ones. Low wind slows every reed.
// While the swing is small the reed moves almost sinusoidally; the upper
// harmonics only fill in as it reaches full size.

import { P_REF } from './wind.js';

// The relative speech time at pressure p (1 at the reference wind). Same shape as
// before D16: about 0.3× at full wind, 1.85× nearly empty.
export const windSpeech = p => (.012 + .06 * (1 - Math.min(1, Math.max(0, p)))) / (.012 + .06 * (1 - P_REF));

// The 10–90% rise time in seconds of a reed sounding at frequency fr, at pressure
// p, for a Speech speed of `speech`: a short fixed part plus about 14 cycles,
// kept between 25 and 200 ms at the reference wind. An A3 reed takes about 84 ms,
// close to the old single time constant.
export const speechTime = (fr, p, speech) => speech * windSpeech(p) * Math.min(.2, Math.max(.025, .02 + 14 / fr));

// The onset is the product of two equal exponential approaches, (1 − e^(−t/τ))²,
// which starts with zero slope like a growing swing. Its 10–90% rise is 2.59 τ.
export const RISE_PER_TAU = 2.59;
export const onsetTau = riseTime => riseTime / RISE_PER_TAU;
export const onsetShape = (t, tau) => (1 - Math.exp(-t / tau)) ** 2;

// Brightness follows the swing, a little behind it: the harmonics' time constant
// is this many times the amplitude's.
export const BLOOM_LAG = 1.3;

// Each reed's tone shelf sits at this multiple of its own frequency, between the
// fundamental and the 2nd harmonic, so it tilts the harmonics against the
// fundamental at the same place on every note.
export const TILT_RATIO = 1.5;

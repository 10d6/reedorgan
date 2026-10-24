// The wind: loudness and brightness against pressure, and the treadle envelopes.
// Pure: no page, no audio.
//
// Pressure runs 0…1. The gauge reads up to GMAX inches and shows pressure × 3.6″.

export const GMAX = 4;
export const gaugeInches = p => p * GMAX * .9;
export const P_REF = .55;          // where reeds are in tune and tone offsets are zero (about 2″)
export const PEAK_FLOW = 1.2;      // reservoir units per second from one treadle at full stroke
export const HELPER_MAX = .6;      // the helper pump at 100% can feed the full organ

// Loudness rises normally up to about 2″ on the gauge, then a soft knee flattens
// it so the top of the reservoir adds only a little more (D2).
export const KNEE = 2 / (4 * .9);  // pressure where the gauge reads 2″
export const HEAD = .09;           // extra amplitude allowed above the knee
export function windLevel(p) {
  const base = x => Math.pow(x, 1.2);
  if (p <= KNEE) return base(p);
  const slope = 1.2 * Math.pow(KNEE, .2);
  return base(KNEE) + HEAD * Math.tanh((p - KNEE) * slope / HEAD);
}
// Brightness keeps climbing above the knee, but at half the rate.
export const windBright = p => p <= KNEE ? p : KNEE + (p - KNEE) * .5;

// Treadle envelope times run from 5 ms to 30 s on a log slider (0…1000).
export const TMIN = .005, TMAX = 30;
export const toTime = x => TMIN * Math.pow(TMAX / TMIN, x / 1000);
export const toSlider = t => Math.round(1000 * Math.log(t / TMIN) / Math.log(TMAX / TMIN));
export const fmtT = t => t < 1 ? Math.round(t * 1000) + ' ms' : t < 10 ? t.toFixed(2) + ' s' : t.toFixed(1) + ' s';
export const DEFAULT_ENV = { a: .06, d: .3, s: 0, r: .15 };

// Advances one treadle's ADSR by dt seconds. P has {stage, lvl, relFrom, p:{a,d,s,r}}.
export function stepEnvelope(P, dt) {
  const { a, d, s, r } = P.p;
  if (P.stage === 'a') { P.lvl += dt / a; if (P.lvl >= 1) { P.lvl = 1; P.stage = 'd'; } }
  else if (P.stage === 'd') {
    if (s >= 1) { P.lvl = 1; P.stage = 's'; }
    else { P.lvl -= dt * (1 - s) / d; if (P.lvl <= s) { P.lvl = s; P.stage = 's'; } }
  }
  else if (P.stage === 's') { P.lvl = s; }
  else if (P.stage === 'r') { P.lvl -= dt * P.relFrom / r; if (P.lvl <= 0) { P.lvl = 0; P.stage = 'idle'; } }
}

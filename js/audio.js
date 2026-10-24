// The sound: the Web Audio graph, voices, and everything that pushes settings into
// it. See docs/architecture.md for the signal flow.

import { RANKS, HALVES, noteFreq, waveRecipe, loudnessComp, celesteCents } from './core/ranks.js';
import { reedError, reedWindResponse, lockReeds } from './core/reeds.js';
import { windLevel, windBright, windCents, P_REF } from './core/wind.js';
import { fanWaveCoefficients } from './core/fan.js';
import { speechTime, onsetTau, BLOOM_LAG, TILT_RATIO } from './core/speech.js';
import { S, stops, voices, halfOf } from './state.js';
import { ctl, mix } from './controls.js';
import { markKey } from './keys.js';

export let ctx = null;
let waves, buses = { bass: [], treble: [] }, swell, tiltDb, windGain, trem, lfo, lfoAmp, lfoFilt, windPitch, noiseGain;
let hiPan, lfoPan, lfoPanAmt, fanLow, shadow, lfoShadow, refl, reflGain, lfoRefl;
let cabDry, cabWet, roomWet;

/* ---------- ranks ---------- */
// Brightness level-matching (D4): gain per rank that keeps its loudness at any brightness.
const loudComp = RANKS.map(() => 1);
export function updateComp(i) { loudComp[i] = loudnessComp(RANKS[i], ctl.voicing[i].bright.value / 100); }
export const rankLevel = i => RANKS[i].level * ctl.voicing[i].level.value * loudComp[i];
// The settled pitch offset of rank i on note m (frequency f), in cents.
export function rankCents(i, f, m) {
  const r = RANKS[i];
  return (r.celeste ? celesteCents(ctl.beat.value, f * r.mult) : r.det) + ctl.voicing[i].tune.value + reedError(S.reedSeed, i, m, ctl.scatter.value);
}
const reedWind = (i, m) => reedWindResponse(S.reedSeed, i, m, ctl.driftVar.value);
// The tuning of every reed on key m in half h: settled offsets in cents, wind
// responses, and which reeds Unison pull has locked together (D14). Only drawn,
// non-Celeste stops can lock: a silent reed can't pull anything.
function keyTuning(f, m, h) {
  const cents = RANKS.map((_, i) => rankCents(i, f, m)), winds = RANKS.map((_, i) => reedWind(i, m));
  const lockable = RANKS.map(r => !r.celeste && !!stops[h][r.id]);
  return lockReeds(cents, winds, lockable, ctl.pull.value);
}
function makeWave({ amp, n }) {
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) im[k] = amp(k);
  return ctx.createPeriodicWave(re, im);
}
const rankWave = i => makeWave(waveRecipe(RANKS[i], ctl.voicing[i].bright.value / 100));

/* ---------- case and room ---------- */
function impulse(sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return buf;
}
/* A wooden case about 1.2 × 1.0 × 0.6 m: a cluster of very early reflections
   between the panels, a short dense tail that the wood darkens, and a low
   panel resonance that gives the box its hollow "body". */
function cabinetIR() {
  const sr = ctx.sampleRate, len = Math.floor(sr * .2), buf = ctx.createBuffer(2, len, sr);
  const taps = [[.0017, .75], [.0029, .6], [.0035, .55], [.0046, .45], [.0052, .4], [.0064, .36], [.0071, .32],
    [.0087, .27], [.0099, .24], [.0116, .2], [.0128, .17], [.0145, .14], [.0174, .11]];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), spread = ch ? 1.06 : 1;
    d[0] = 1;
    taps.forEach(([t, a], i) => { const idx = Math.floor(t * spread * sr); if (idx < len) d[idx] += a * (i % 3 === 2 ? -1 : 1); });
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] += (Math.random() * 2 - 1) * .28 * Math.exp(-t / .032);                 // dense box tail
      d[i] += Math.sin(2 * Math.PI * 148 * t) * .12 * Math.exp(-t / .06)            // main panel mode
        + Math.sin(2 * Math.PI * 310 * t + 1) * .06 * Math.exp(-t / .04);           // second panel mode
    }
    let y = 0; for (let i = 0; i < len; i++) { y += .55 * (d[i] - y); d[i] = y; }   // wood soaks up the highs
  }
  return buf;
}
export function applyMix() {
  if (!ctx) return; const t = ctx.currentTime, c = mix.cab / 100, r = mix.room / 100;
  cabWet.gain.setTargetAtTime(c * 1.1, t, .05);
  cabDry.gain.setTargetAtTime(1 - c * .45, t, .05);
  roomWet.gain.setTargetAtTime(r * .7, t, .05);
}

/* ---------- Vox Humana fan (D8) ----------
   On a reed organ the Vox Humana is a small fan spun by its own wind wheel. It
   doesn't touch the reeds' wind; it stirs the sound just outside the reed cells.
   A blade a few centimetres across only shadows or reflects sound with a similar
   or shorter wavelength, so the fan works on the upper harmonics and leaves the
   fundamentals alone. The fan stage splits the sound at the blade-size frequency:
   the low band passes untouched; the upper band is shadowed as blades pass
   (shadow gain), mixed with a reflection whose path length changes as the fan
   turns (refl delay, giving a moving comb or phasing shimmer), and panned
   (hiPan). The two bands sum back to the original exactly when the fan is still.
   lfo is the blade-passing wave; lfoPan is a cosine started at the same moment,
   a quarter-turn ahead, for the reflection path and the stereo position.
   The old whole-sound tremolo (lfoAmp on trem gain, lfoFilt on the lid filter)
   remains as Whole-sound wobble and Lid wobble. */
// The Spinning fan shape covers one full turn of a two-bladed fan, so its
// oscillator runs at half the speed shown (the speed is blade passes per second).
export const lfoFreq = () => ctl.voxRate() * (S.voxShape === 'fan' ? .5 : 1);
export function setFanShape() {
  if (S.voxShape === 'fan') { const { re, im } = fanWaveCoefficients(); lfo.setPeriodicWave(ctx.createPeriodicWave(re, im, { disableNormalization: true })); }
  else lfo.type = 'sine';
}
// cosine: the pan swings a quarter-turn ahead of the volume, like a source going round
const cosWave = () => ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true });
// Drawing the stop spins the fan up; retiring it lets the fan coast down.
export function applyVox() {
  if (!ctx) return; const t = ctx.currentTime, on = stops.vox, tc = on ? .4 : .9;
  fanLow.frequency.setTargetAtTime(ctl.voxBlade.value, t, .05);
  lfoShadow.gain.setTargetAtTime(on ? ctl.voxShadow.value * .5 : 0, t, tc);   // 100% = upper band dips to half
  reflGain.gain.setTargetAtTime(on ? ctl.voxShim.value * .7 : 0, t, tc);
  lfoRefl.gain.setTargetAtTime(on ? .00015 : 0, t, tc);                       // reflection path swings ±5 cm
  lfoPanAmt.gain.setTargetAtTime(on ? ctl.voxStereo.value * .8 : 0, t, tc);
  lfoAmp.gain.setTargetAtTime(on ? ctl.voxWhole.value : 0, t, tc);
  lfoFilt.gain.setTargetAtTime(on ? ctl.voxLid.value : 0, t, tc);
  const f = on ? lfoFreq() : lfoFreq() * .25;
  [lfo, lfoPan].forEach(o => o.frequency.setTargetAtTime(f, t, on ? .5 : 1.2));
}

/* ---------- the graph ---------- */
// Builds the graph on the first touch (browsers only allow sound after one).
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  waves = RANKS.map((_, i) => rankWave(i));
  swell = ctx.createBiquadFilter(); swell.type = 'lowpass'; swell.Q.value = ctl.toneQ.value; swell.frequency.value = 2300;
  // the wind's tone tilt in dB, fed to every reed's own tone shelf (D17)
  tiltDb = ctx.createConstantSource(); tiltDb.offset.value = 0; tiltDb.start();
  windGain = ctx.createGain(); windGain.gain.value = 0;
  trem = ctx.createGain(); trem.gain.value = 1;
  const f0 = stops.vox ? lfoFreq() : lfoFreq() * .25;
  lfo = ctx.createOscillator(); lfo.frequency.value = f0; setFanShape();
  lfoAmp = ctx.createGain(); lfoAmp.gain.value = 0;
  lfoFilt = ctx.createGain(); lfoFilt.gain.value = 0;
  lfo.connect(lfoAmp).connect(trem.gain); lfo.connect(lfoFilt).connect(swell.detune);
  lfoPan = ctx.createOscillator(); lfoPan.setPeriodicWave(cosWave()); lfoPan.frequency.value = f0;
  lfoPanAmt = ctx.createGain(); lfoPanAmt.gain.value = 0;
  // the fan stage: low band straight through, upper band shadowed, reflected and panned
  const fanIn = ctx.createGain(), fanOut = ctx.createGain(), hiBand = ctx.createGain(), neg = ctx.createGain();
  fanLow = ctx.createBiquadFilter(); fanLow.type = 'lowpass'; fanLow.Q.value = .5; fanLow.frequency.value = ctl.voxBlade.value;
  neg.gain.value = -1;
  fanIn.connect(fanLow).connect(fanOut);
  fanIn.connect(hiBand); fanLow.connect(neg).connect(hiBand);   // upper band = everything minus the low band
  shadow = ctx.createGain(); shadow.gain.value = 1;
  refl = ctx.createDelay(.01); refl.delayTime.value = .00025;     // blade about 4 cm from the reed cells
  reflGain = ctx.createGain(); reflGain.gain.value = 0;
  hiPan = ctx.createStereoPanner(); hiPan.pan.value = 0;
  hiBand.connect(shadow); hiBand.connect(refl).connect(reflGain).connect(shadow);
  shadow.connect(hiPan).connect(fanOut);
  lfoShadow = ctx.createGain(); lfoShadow.gain.value = 0; lfo.connect(lfoShadow).connect(shadow.gain);
  lfoRefl = ctx.createGain(); lfoRefl.gain.value = 0; lfoPan.connect(lfoRefl).connect(refl.delayTime);
  lfoPan.connect(lfoPanAmt).connect(hiPan.pan);
  trem.connect(fanIn);
  const tStart = ctx.currentTime + .02; lfo.start(tStart); lfoPan.start(tStart);   // started together so they stay locked
  const body1 = ctx.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 230; body1.Q.value = 1; body1.gain.value = 3;
  const body2 = ctx.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 1100; body2.Q.value = 1.4; body2.gain.value = 2;
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 6000; shelf.gain.value = -7;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = .01; comp.release.value = .2;
  const dry = ctx.createGain(); dry.gain.value = .85;
  const conv = ctx.createConvolver(); conv.buffer = impulse(1.8, 3);
  roomWet = ctx.createGain(); roomWet.gain.value = 0;
  const cabConv = ctx.createConvolver(); cabConv.buffer = cabinetIR();
  cabDry = ctx.createGain(); cabDry.gain.value = 1;
  cabWet = ctx.createGain(); cabWet.gain.value = 0;
  const cabSum = ctx.createGain();
  const master = ctx.createGain(); master.gain.value = .8;
  HALVES.forEach(h => RANKS.forEach((r, i) => { const g = ctx.createGain(); g.gain.value = stops[h][r.id] ? rankLevel(i) : 0; g.connect(swell); buses[h][i] = g; }));
  swell.connect(windGain).connect(trem);
  fanOut.connect(body1).connect(body2).connect(shelf);
  // reeds → cabinet (dry + boxy reflections) → room (dry + long tail)
  shelf.connect(cabDry).connect(cabSum); shelf.connect(cabConv).connect(cabWet).connect(cabSum);
  cabSum.connect(dry).connect(comp); cabSum.connect(conv).connect(roomWet).connect(comp);
  comp.connect(master).connect(ctx.destination);
  windPitch = ctx.createConstantSource(); windPitch.offset.value = 0; windPitch.start();
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = .8;
  noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  ns.connect(bp).connect(noiseGain).connect(trem); ns.start();
  applyStops(); applyMix();
}
export function applyStops() {
  if (!ctx) return; const t = ctx.currentTime;
  HALVES.forEach(h => RANKS.forEach((r, i) => buses[h][i].gain.setTargetAtTime(stops[h][r.id] ? rankLevel(i) : 0, t, .04)));
  applyVox(); retune();   // drawing a stop can pull sounding reeds into step (D14)
}

/* ---------- the wind, each frame ---------- */
// Pushes the current wind into the graph: loudness, lid or tilt filter, pitch drift
// and breath noise. Called from the control loop.
export function applyWind(sounding) {
  if (!ctx) return;
  const t = ctx.currentTime, p = S.pressure;
  const speak = p < .04 ? 0 : Math.min(1, (p - .04) / .12);
  const bRef = windBright(P_REF), dBright = (windBright(S.tonePress) - bRef) * ctl.toneDepth.value;
  windGain.gain.setTargetAtTime(speak * windLevel(p) * 1.7 * (1 + .25 * S.swellPos), t, .03);
  swell.Q.setTargetAtTime(ctl.toneQ.value, t, .05);
  if (S.toneModel === 'sweep') {
    // depth 100% reproduces the original sweep exactly
    swell.frequency.setTargetAtTime(450 + 4200 * Math.pow(Math.max(0, bRef + dBright), 1.4) * (1 + .7 * S.swellPos), t, .04);
    tiltDb.offset.setTargetAtTime(0, t, .05);
  } else {
    // the lid filter sits where the sweep would at a mid-gauge reading; only the swell moves it
    swell.frequency.setTargetAtTime(2300 * (1 + 1.4 * S.swellPos), t, .04);
    // each reed's harmonics tilt against its own fundamental (D17): about −7 dB empty, +3 dB full at 60%
    tiltDb.offset.setTargetAtTime(Math.max(-24, 18 * dBright), t, .04);
  }
  windPitch.offset.setTargetAtTime(windCents(p, ctl.sens.value), t, .05);   // flat as the wind rises (D12)
  noiseGain.gain.setTargetAtTime(.025 * p * Math.min(1, sounding / 3) * ctl.breath.value, t, .05);
}

// The soft thump of a treadle hinge.
export function thump(level) {
  if (!ctx || level <= 0) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(45, t + .08);
  g.gain.setValueAtTime(.085 * level, t); g.gain.exponentialRampToValueAtTime(.0001, t + .1);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + .12);
}

/* ---------- voices ---------- */
// Starts a key: one oscillator per rank (stops only change bus gains). Use
// press()/release() in keys.js for input, which adds coupled octaves.
export function noteOn(m) {
  initAudio(); if (!ctx || m < 21 || m > 108) return;
  S.started = true;
  let v = voices.get(m);
  if (v && !v.released) { v.refs++; return; }
  if (v) killVoice(v, .01);
  const t = ctx.currentTime, f = noteFreq(m);
  const speech = ctl.speech.value;
  const amp = .11 * Math.max(.55, 1 - (m - 48) * .006);
  const half = halfOf(m);
  v = { refs: 1, oscs: [], envs: [], winds: [], released: false, half, f, m };
  const tun = keyTuning(f, m, half);
  RANKS.forEach((r, i) => {
    const o = ctx.createOscillator(); o.setPeriodicWave(waves[i]);
    o.frequency.value = f * r.mult;
    const base = tun.cents[i];
    // a free reed starts near its natural pitch and settles a little flat as its swing grows (D13)
    o.detune.setValueAtTime(base + ctl.scoop.value, t); o.detune.setTargetAtTime(base, t, .04 * speech);
    const w = ctx.createGain(); w.gain.value = tun.winds[i];   // this reed's own response to the wind
    windPitch.connect(w).connect(o.detune);
    // Speech (D16): the swing grows S-shaped, (1 − e^(−t/τ))², slower for low
    // reeds and low wind. g carries one factor and the release; on the other.
    const fr = f * r.mult, tau = onsetTau(speechTime(fr, S.pressure, speech));
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(amp, t, tau);
    const on = ctx.createGain(); on.gain.setValueAtTime(0, t); on.gain.setTargetAtTime(1, t, tau);
    // Tone (D17): a shelf between this reed's fundamental and 2nd harmonic. Its
    // own gain starts Bloom dB down and opens as the swing grows, a little
    // behind it; the wind's tilt is added on top through tiltDb.
    const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = fr * TILT_RATIO;
    sh.gain.setValueAtTime(-ctl.bloom.value, t); sh.gain.setTargetAtTime(0, t, tau * BLOOM_LAG);
    tiltDb.connect(sh.gain);
    // Start phase (D14): a reed starts wherever it happens to be in its swing.
    // Locked reeds start nearly together (within ±0.1 cycle) so their blend
    // varies a little from note to note without ever cancelling; free reeds start anywhere.
    const cyc = tun.locked[i] ? .1 + (Math.random() - .5) * .2 : Math.random();
    o.connect(sh).connect(g).connect(on).connect(buses[half][i]); o.start(t + cyc / fr);
    o.onended = () => {
      try { windPitch.disconnect(w); } catch (e) {} try { tiltDb.disconnect(sh.gain); } catch (e) {}
      w.disconnect(); sh.disconnect(); g.disconnect(); on.disconnect();
    };
    v.oscs.push(o); v.envs.push(g); v.winds.push(w);
  });
  voices.set(m, v); markKey(m, true);
}
// Tuning, Celeste beat, Unison pull and stop changes retune notes that are
// already sounding. Locking ties ranks together, so every rank is updated.
export function retune() {
  if (!ctx) return; const t = ctx.currentTime;
  for (const v of voices.values()) {
    if (v.released) continue;
    const tun = keyTuning(v.f, v.m, v.half);
    v.oscs.forEach((o, i) => o.detune.setTargetAtTime(tun.cents[i], t, .08));
    v.winds.forEach((w, i) => w.gain.setTargetAtTime(tun.winds[i], t, .08));
  }
}
// Drift variation and new reeds change how sounding reeds follow the wind.
export const rewind = retune;
// Brightness changes swap the harmonic recipe on sounding notes too.
export function revoice(i) {
  updateComp(i);
  if (!ctx) return;
  applyStops();
  waves[i] = rankWave(i);
  for (const v of voices.values()) if (!v.released) v.oscs[i].setPeriodicWave(waves[i]);
}
function killVoice(v, tc) {
  const t = ctx.currentTime; v.released = true;
  v.envs.forEach(g => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, tc); });
  v.oscs.forEach(o => { try { o.stop(t + tc * 10); } catch (e) {} });
}
export function noteOff(m) {
  const v = voices.get(m); if (!v || v.released) return;
  if (--v.refs > 0) return;
  killVoice(v, .05); markKey(m, false);
  setTimeout(() => { if (voices.get(m) === v) voices.delete(m); }, 600);
}

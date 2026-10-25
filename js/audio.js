// The sound: the Web Audio graph, voices, and everything that pushes settings into
// it. See docs/architecture.md for the signal flow.

import { RANKS, HALVES, noteFreq, waveRecipe, loudnessComp, celesteCents } from './core/ranks.js';
import { reedError, reedWindResponse, lockReeds } from './core/reeds.js';
import { windLevel, windBright, windCents, P_REF } from './core/wind.js';
import { fanWaveCoefficients } from './core/fan.js';
import { speechTime, onsetTau, BLOOM_LAG, TILT_RATIO } from './core/speech.js';
import { scoopCurve, scoopValue, bendCents, vibStart, vibDelaySec, vibFadeCurve, vibStartRate, wanderCurve, VIB_RATE_WANDER, VIB_DEPTH_WANDER, VIB_COLOUR_DB } from './core/expression.js';
import { LIMIT, LIMIT_RATIO, limiterMakeupDb, softClipCurve } from './core/output.js';
import { S, stops, voices, halfOf } from './state.js';
import { ctl, mix } from './controls.js';
import { markKey } from './keys.js';

export let ctx = null;
let waves, buses = { bass: [], treble: [] }, swell, tiltDb, windGain, trem, lfo, lfoAmp, lfoFilt, windPitch, noiseGain;
let hiPan, lfoPan, lfoPanAmt, fanLow, shadow, lfoShadow, refl, reflGain, lfoRefl;
let cabDry, cabWet, roomWet, bassCut, master, pitchBend, rateWander, depthWander;
// The knee swell's loudness, closed and fully open, on top of the brighter lid
// (D21). Before D21 it was 1 → 1.25.
export const SWELL_CLOSED = .75, SWELL_OPEN = 1.5;
// The limiter (D20) adds its own make-up gain; MASTER trims it back out, so below
// the limit the level at Volume 100% is exactly as before (0.8).
const MASTER = .8 * Math.pow(10, -limiterMakeupDb() / 20);

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
// Volume and Cabinet bass, from their sliders.
export function applyOutput() {
  if (!ctx) return; const t = ctx.currentTime;
  master.gain.setTargetAtTime(MASTER * ctl.volume.value, t, .03);
  bassCut.frequency.setTargetAtTime(ctl.bassCut.value, t, .03);
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
// The modulation sequencer can drive the fan's speed (D31); fanHz is its speed
// in blade passes a second while it does, otherwise null and the slider rules.
let fanHz = null;
export const lfoFreq = () => (fanHz ?? ctl.voxRate()) * (S.voxShape === 'fan' ? .5 : 1);
// Called each frame by the control loop: the sequencer's fan speed, or null.
// While it plays, the fan follows closely; when it stops, the fan eases back to
// its slider's speed as it does when the slider moves.
export function setFanSpeed(hz) {
  if (hz === fanHz) return;
  fanHz = hz;
  if (!ctx) return;
  if (hz === null) { applyVox(); return; }
  if (stops.vox) [lfo, lfoPan].forEach(o => o.frequency.setTargetAtTime(lfoFreq(), ctx.currentTime, .03));
}
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
  // Volume (D20), then a limiter that only acts on peaks near full scale, so
  // turning the volume up can't clip the speakers.
  master = ctx.createGain(); master.gain.value = MASTER * ctl.volume.value;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = LIMIT; limiter.knee.value = 0; limiter.ratio.value = LIMIT_RATIO; limiter.attack.value = .002; limiter.release.value = .15;
  // The cabinet radiates little below about 80 Hz (D19): a gentle highpass on the reeds.
  // Q is in dB for a highpass: −3.01 dB is flat (Butterworth), with no bump above the corner.
  bassCut = ctx.createBiquadFilter(); bassCut.type = 'highpass'; bassCut.Q.value = -3.01; bassCut.frequency.value = ctl.bassCut.value;
  HALVES.forEach(h => RANKS.forEach((r, i) => { const g = ctx.createGain(); g.gain.value = stops[h][r.id] ? rankLevel(i) : 0; g.connect(swell); buses[h][i] = g; }));
  swell.connect(bassCut).connect(windGain).connect(trem);
  fanOut.connect(body1).connect(body2).connect(shelf);
  // reeds → cabinet (dry + boxy reflections) → room (dry + long tail)
  shelf.connect(cabDry).connect(cabSum); shelf.connect(cabConv).connect(cabWet).connect(cabSum);
  cabSum.connect(dry).connect(comp); cabSum.connect(conv).connect(roomWet).connect(comp);
  // The limiter isn't a brickwall: a sharp transient can overshoot by a fraction
  // of a dB. A soft clip that leaves everything below 90% of full scale alone
  // rounds those off before the speakers.
  const ceiling = ctx.createWaveShaper(); ceiling.curve = softClipCurve(); ceiling.oversample = '2x';
  comp.connect(master).connect(limiter).connect(ceiling).connect(ctx.destination);
  windPitch = ctx.createConstantSource(); windPitch.offset.value = 0; windPitch.start();
  // the MIDI pitch wheel, in cents, added to every reed (D28)
  pitchBend = ctx.createConstantSource(); pitchBend.offset.value = bendCents(S.wheel[0], S.wheel[1], ctl.bendRange.value); pitchBend.start();
  // two slowly wandering values for the vibrato's rate and width (D29), shared
  // by every voice so coupled octaves wander together
  const wander = (seconds, step) => {
    const b = ctx.createBuffer(1, seconds * 3000, 3000); b.copyToChannel(wanderCurve(seconds, 3000, step), 0);
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.start(); return src;
  };
  rateWander = wander(23, .45); depthWander = wander(29, .6);
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
  windGain.gain.setTargetAtTime(speak * windLevel(p) * 1.7 * (SWELL_CLOSED + (SWELL_OPEN - SWELL_CLOSED) * S.swellPos), t, .03);
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
  o.connect(g).connect(master); o.start(t); o.stop(t + .12);
}

/* ---------- expression (D28) ---------- */
// The pitch wheel bends every sounding reed together, by cents.
// S.wheel is where the wheel was last moved; Bend range sets how far it reaches.
export function applyBend() {
  if (!ctx) return;
  pitchBend.offset.setTargetAtTime(bendCents(S.wheel[0], S.wheel[1], ctl.bendRange.value), ctx.currentTime, .006);
}
// Delayed vibrato (D29). Every voice that has one owns a sine LFO, scaled by
// an envelope (0 until the delay is over, then an S-curve fade to 1), and then
// by the width in cents into each of its reeds' detune, and by Voice colour in
// dB into each reed's tone shelf. Coupled octaves start identical LFOs at the
// same instant with the same automation, so they stay in phase.
// (Re)schedules a voice's vibrato from the current settings. Once a vibrato has
// started it keeps going; only its rate, width and colour follow the sliders.
function scheduleVib(s, now) {
  if (s.dropped) return;
  const rate = ctl.vibRate.value, nat = ctl.vibNatural.value, depth = ctl.vibDepth.value;
  s.depth.gain.setTargetAtTime(depth, now, .03);
  s.depthWander.gain.setTargetAtTime(depth * VIB_DEPTH_WANDER * nat, now, .03);
  s.rateWander.gain.setTargetAtTime(rate * VIB_RATE_WANDER * nat, now, .03);
  s.colour.gain.setTargetAtTime(ctl.vibColour.value * VIB_COLOUR_DB, now, .03);
  if (s.start <= now) { s.lfo.frequency.setTargetAtTime(rate, now, .1); return; }
  const start = vibStart(s.land, vibDelaySec(ctl.vibDelay.value), now + .005), fade = Math.max(.02, ctl.vibFade.value);
  s.env.gain.cancelScheduledValues(now);
  s.lfo.frequency.cancelScheduledValues(now); s.lfo.frequency.setValueAtTime(vibStartRate(rate, nat), now);
  s.start = start;
  if (start === Infinity) return;
  s.env.gain.setValueCurveAtTime(vibFadeCurve(), start, fade);
  s.lfo.frequency.setTargetAtTime(rate, start, fade / 2);   // speeds up to its rate as it grows
}
function makeVib(v, t, land, oscs, shelves) {
  const lfo = ctx.createOscillator(), env = ctx.createGain(), depth = ctx.createGain(), colour = ctx.createGain();
  const rw = ctx.createGain(), dw = ctx.createGain();
  env.gain.value = 0; depth.gain.value = 0; colour.gain.value = 0; rw.gain.value = 0; dw.gain.value = 0;
  lfo.connect(env); env.connect(depth); env.connect(colour);
  oscs.forEach(o => depth.connect(o.detune)); shelves.forEach(sh => colour.connect(sh.gain));
  rateWander.connect(rw).connect(lfo.frequency); depthWander.connect(dw).connect(depth.gain);
  lfo.onended = () => {
    try { rateWander.disconnect(rw); } catch (e) {} try { depthWander.disconnect(dw); } catch (e) {}
    [lfo, env, depth, colour, rw, dw].forEach(n => n.disconnect());
  };
  const s = { lfo, env, depth, colour, rateWander: rw, depthWander: dw, land, start: Infinity, dropped: false };
  scheduleVib(s, t); lfo.start(t);
  v.vib = s;
}
// The vibrato sliders, and a learned controller moving the delay, update every
// sounding note's vibrato. A note still waiting for its vibrato gets the new
// delay, counted from when it landed, so pushing the controller up can bring
// the vibrato in on a note you're already holding.
export function applyVibrato() {
  if (!ctx) return; const now = ctx.currentTime;
  for (const v of voices.values()) if (v.vib && !v.released) scheduleVib(v.vib, now);
}
// When the top voice moves on, the old top note's vibrato fades away, so one
// voice sings over the accompaniment.
export function dropVibrato(notes) {
  if (!ctx) return; const now = ctx.currentTime;
  for (const n of notes) {
    const v = voices.get(n); if (!v || !v.vib || v.vib.dropped) continue;
    const s = v.vib; s.dropped = true;
    s.env.gain.cancelAndHoldAtTime(now); s.env.gain.setTargetAtTime(0, now, .05);
  }
}

// A note that turned out to be part of a chord, not the melody, gives up its
// scoop: it slides the rest of the way to pitch in 15 ms. It has barely begun to
// speak by then, so the slide is hardly heard.
export function unscoop(notes) {
  if (!ctx) return; const t = ctx.currentTime;
  for (const n of notes) {
    const v = voices.get(n); if (!v || !v.bend || v.released) continue;
    const b = v.bend, x = (t - b.t) / b.dur; if (x >= 1) continue;
    b.src.offset.cancelScheduledValues(b.t);
    b.src.offset.setValueAtTime(scoopValue(b.depth, b.curve, x), t);
    b.src.offset.linearRampToValueAtTime(0, t + .015);
  }
}

/* ---------- voices ---------- */
// Starts a key: one oscillator per rank (stops only change bus gains). Use
// press()/release() in keys.js for input, which adds coupled octaves.
// `expr` is the press's Expression (D28, D29): {cents, dur, curve} for a scoop
// from below and `vib` for delayed vibrato, shared by every coupled octave of
// the key so they move together.
export function noteOn(m, expr) {
  initAudio(); if (!ctx || m < 21 || m > 108) return;
  S.started = true;
  let v = voices.get(m);
  if (v && !v.released) { v.refs++; return; }
  if (v) killVoice(v, .01);
  const t = ctx.currentTime, f = noteFreq(m);
  const speech = ctl.speech.value;
  const amp = .11 * Math.max(.55, 1 - (m - 48) * .006);
  const half = halfOf(m);
  v = { refs: 1, oscs: [], envs: [], winds: [], released: false, half, f, m, bend: null, vib: null };
  const tun = keyTuning(f, m, half), shelves = [];
  // Scoop (D28): one source per key feeds every reed's detune, so the whole stop
  // combination bends as one voice. It lands exactly on pitch, and never before
  // the played key's 8′ reed has reached full voice (expr.dur, worked out once
  // for the played key, so coupled octaves land together).
  if (expr && expr.cents > 0) {
    const dur = expr.dur;
    const src = ctx.createConstantSource(); src.offset.value = -expr.cents;
    src.offset.setValueCurveAtTime(scoopCurve(expr.cents, expr.curve), t, dur); src.start(t);
    v.bend = { src, t, dur, depth: expr.cents, curve: expr.curve };
  }
  RANKS.forEach((r, i) => {
    const o = ctx.createOscillator(); o.setPeriodicWave(waves[i]);
    o.frequency.value = f * r.mult;
    const base = tun.cents[i];
    // a free reed starts near its natural pitch and settles a little flat as its swing grows (D13)
    o.detune.setValueAtTime(base + ctl.scoop.value, t); o.detune.setTargetAtTime(base, t, .04 * speech);
    const w = ctx.createGain(); w.gain.value = tun.winds[i];   // this reed's own response to the wind
    windPitch.connect(w).connect(o.detune);
    pitchBend.connect(o.detune);
    if (v.bend) v.bend.src.connect(o.detune);
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
      try { pitchBend.disconnect(o.detune); } catch (e) {}
      if (v.bend) { try { v.bend.src.disconnect(o.detune); } catch (e) {} }
      w.disconnect(); sh.disconnect(); g.disconnect(); on.disconnect();
    };
    v.oscs.push(o); v.envs.push(g); v.winds.push(w); shelves.push(sh);
  });
  // Delayed vibrato (D29), counted from when the note lands.
  if (expr && expr.vib) makeVib(v, t, t + (v.bend ? v.bend.dur : 0), v.oscs, shelves);
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
// All notes off (D18): silences every voice at once, sounding or releasing, and
// clears the keys drawn as pressed.
export function silenceAll() {
  if (ctx) for (const v of voices.values()) { v.refs = 0; killVoice(v, .03); }
  for (const m of voices.keys()) markKey(m, false);
  voices.clear();
  document.querySelectorAll('#keys .key.down').forEach(el => el.classList.remove('down'));
}
function killVoice(v, tc) {
  const t = ctx.currentTime; v.released = true;
  v.envs.forEach(g => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, tc); });
  v.oscs.forEach(o => { try { o.stop(t + tc * 10); } catch (e) {} });
  if (v.bend) { try { v.bend.src.stop(t + tc * 10); } catch (e) {} }
  if (v.vib) { try { v.vib.lfo.stop(t + tc * 10); } catch (e) {} }
}
export function noteOff(m) {
  const v = voices.get(m); if (!v || v.released) return;
  if (--v.refs > 0) return;
  killVoice(v, .05); markKey(m, false);
  setTimeout(() => { if (voices.get(m) === v) voices.delete(m); }, 600);
}

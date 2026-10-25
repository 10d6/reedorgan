// Unit tests for the pure maths in js/core. Run with: npm run test:unit
// No browser needed; each test pins down a property from docs/decisions.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKS, CELESTE, SPLITS, noteFreq, waveRecipe, scaledRms, loudnessComp, celesteCents, WAVE_SPECS, WAVE_SPECS_V1 } from "../../js/core/ranks.js";
import { windSpeech, speechTime, onsetTau, onsetShape, RISE_PER_TAU, TILT_RATIO } from "../../js/core/speech.js";
import { reedRand, reedTri, reedError, reedWindResponse, lockReeds } from "../../js/core/reeds.js";
import { windLevel, windBright, windCents, windDrain, EASY_REEDS, KNEE, P_REF, gaugeInches, toTime, toSlider, fmtT, stepEnvelope, DEFAULT_ENV } from "../../js/core/wind.js";
import { fanWaveCoefficients } from "../../js/core/fan.js";
import { scoopShape, scoopValue, scoopCurve, scoopDuration, scoopDepth, isTop, bendCents, SCOOP_CURVES, LEAP, KEY_VELOCITY, VIB_DELAY_MAX, vibDelaySec, delayFromCC, vibStart, vibFadeCurve, vibStartRate, wanderCurve } from "../../js/core/expression.js";
import { SEQ_TARGETS, SEQ_TARGET_RANGE, toShare, fromShare, amountText, SEQ_CURVES, SEQ_ROWS, seqShape, DEFAULT_SEQ, normaliseSeq, placeNote, resizeNote, removeNote, seqValue, seqSteps, stepSeconds, seqPosition, METERS, stepsPerBar, stepsPerBeat, stroke, reshape, migrateSaved, FREE_LANES } from "../../js/core/modseq.js";
import { volumeGain, bassCutHz, limiterMakeupDb, softClip, softClipCurve } from "../../js/core/output.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x) / a.length, mb = b.reduce((s, x) => s + x) / b.length;
  let n = 0, da = 0, db = 0; a.forEach((x, k) => { n += (x - ma) * (b[k] - mb); da += (x - ma) ** 2; db += (b[k] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};

test("ranks: five ranks, one Celeste, split points", () => {
  assert.deepEqual(RANKS.map((r) => r.id), ["bourdon", "diapason", "melodia", "celeste", "principal"]);
  assert.equal(RANKS[CELESTE].id, "celeste");
  assert.equal(SPLITS.ef.note, 53);
  assert.equal(SPLITS.bc.note, 60);
  near(noteFreq(69), 440, 1e-9);
  near(noteFreq(57), 220, 1e-9);
});

test("D7: no fixed per-rank detune", () => {
  for (const r of RANKS) assert.equal(r.det, 0, r.id);
});

test("D3: the Celeste beats at the same rate on every note", () => {
  for (const f of [65.4, 130.8, 261.6, 523.3, 1046.5]) {
    const c = celesteCents(1.5, f);
    near(f * (2 ** (c / 1200) - 1), 1.5, 1e-9, `at ${f} Hz`);
  }
});

test("D7: reed errors are deterministic, uniform and uncorrelated between neighbouring keys", () => {
  assert.equal(reedRand(7, 1, 60, 1), reedRand(7, 1, 60, 1));
  assert.notEqual(reedRand(7, 1, 60, 1), reedRand(8, 1, 60, 1));
  const xs = [];
  for (let i = 0; i < 5; i++) for (let m = 21; m <= 108; m++) xs.push(reedRand(1, i, m, 1));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  near(xs.reduce((s, x) => s + x) / xs.length, .5, .05, "mean");
  // the old generator was a sawtooth: neighbouring keys were 74% correlated
  for (const seed of [1, 2, 99]) {
    const a = [], b = [];
    for (let m = 36; m < 96; m++) { a.push(reedError(seed, 1, m, 1)); b.push(reedError(seed, 1, m + 1, 1)); }
    assert.ok(Math.abs(corr(a, b)) < .3, `seed ${seed}: neighbour correlation ${corr(a, b).toFixed(2)}`);
    const o = [], p = [];                                         // octaves too
    for (let m = 36; m < 84; m++) { o.push(reedError(seed, 1, m, 1)); p.push(reedError(seed, 1, m + 12, 1)); }
    assert.ok(Math.abs(corr(o, p)) < .35, `seed ${seed}: octave correlation ${corr(o, p).toFixed(2)}`);
  }
});

test("D7: reed scatter stays within ±spread and is mostly small", () => {
  const all = [];
  for (let i = 0; i < 5; i++) for (let m = 21; m <= 108; m++) all.push(reedError(1, i, m, 1));
  assert.ok(all.every((x) => Math.abs(x) <= 1));
  assert.ok(all.filter((x) => Math.abs(x) <= .5).length / all.length > .65, "most reeds within ±0.5 cents");
  assert.ok(Math.abs(reedTri(1, 0, 60, 1)) <= 1);
});

test("D7: wind response is exact at no variation, and low reeds move more", () => {
  for (let m = 21; m <= 108; m += 7) assert.equal(reedWindResponse(1, 1, m, 0), 1);
  let low = 0, high = 0;
  for (let m = 36; m < 48; m++) low += reedWindResponse(1, 1, m, .4);
  for (let m = 84; m < 96; m++) high += reedWindResponse(1, 1, m, .4);
  assert.ok(low > high, `low ${low.toFixed(2)} vs high ${high.toFixed(2)}`);
  for (let m = 21; m <= 108; m++) assert.ok(reedWindResponse(1, 0, m, 1) >= 0);
});

test("D2: loudness rises up to 2 inches, then levels off", () => {
  near(gaugeInches(KNEE), 2, 1e-9);
  for (let p = 0; p < 1; p += .05) assert.ok(windLevel(p + .05) >= windLevel(p), `monotonic at ${p}`);
  const db = (a, b) => 20 * Math.log10(a / b);
  assert.ok(db(windLevel(KNEE), windLevel(KNEE / 2)) > 5, "plenty of change below the knee");
  assert.ok(db(windLevel(1), windLevel(KNEE)) < 1.6, "at most about +1.5 dB above the knee");
  near(windBright(P_REF), P_REF, 1e-9);
  near(windBright(1) - windBright(KNEE), (1 - KNEE) * .5, 1e-9, "brightness climbs at half rate above the knee");
});

test("D4: brightness compensation keeps loudness the same at any brightness", () => {
  for (const r of RANKS) {
    const factory = scaledRms(waveRecipe(r, 0));
    for (const b of [-1, -.5, .5, 1]) near(scaledRms(waveRecipe(r, b)) * loudnessComp(r, b), factory, 1e-9, `${r.id} at ${b}`);
    near(loudnessComp(r, 0), 1, 1e-12);
  }
  const d = RANKS[1];
  assert.ok(waveRecipe(d, 1).amp(10) > waveRecipe(d, 0).amp(10), "brighter keeps more of the 10th harmonic");
});

test("D8: the spinning-fan wave dips as blades pass, with a mean of zero", () => {
  const { re, im } = fanWaveCoefficients();
  const N = 720, x = [];
  for (let j = 0; j < N; j++) { const ph = 2 * Math.PI * j / N; let v = 0; for (let k = 1; k < re.length; k++) v += re[k] * Math.cos(k * ph) + im[k] * Math.sin(k * ph); x.push(v); }
  const mean = x.reduce((s, v) => s + v) / N, min = Math.min(...x), max = Math.max(...x);
  near(mean, 0, 1e-6, "mean");
  near(min, -1, .08, "deepest dip");
  assert.ok(max < .6, `rises stay small (${max.toFixed(2)})`);
  const sd = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / N), skew = x.reduce((s, v) => s + v ** 3, 0) / N / sd ** 3;
  assert.ok(skew < -.5, `dips, not swells (skew ${skew.toFixed(2)})`);
});

test("treadle envelopes: times map both ways and the ADSR steps through its stages", () => {
  for (const t of [.005, .06, 1, 30]) near(toTime(toSlider(t)), t, t * .01, `round trip ${t}`);
  assert.equal(fmtT(.06), "60 ms"); assert.equal(fmtT(2.5), "2.50 s"); assert.equal(fmtT(30), "30.0 s");
  const P = { stage: "a", lvl: 0, relFrom: 0, p: { ...DEFAULT_ENV, s: .5 } };
  stepEnvelope(P, .06); assert.equal(P.stage, "d");
  for (let i = 0; i < 100; i++) stepEnvelope(P, .01);
  assert.equal(P.stage, "s"); near(P.lvl, .5, 1e-9);
  P.stage = "r"; P.relFrom = P.lvl;
  for (let i = 0; i < 20; i++) stepEnvelope(P, .01);
  assert.equal(P.stage, "idle"); assert.equal(P.lvl, 0);
});

test("D12: free reeds go flat as the wind rises", () => {
  assert.equal(windCents(P_REF, 10), 0);
  assert.ok(windCents(1, 10) < 0, "full wind is flat");
  assert.ok(windCents(0.2, 10) > 0, "low wind is sharp");
  near(windCents(1, 10) - windCents(0, 10), -10, 1e-9, "Pitch drift is the span across the gauge");
});

test("D14: Unison pull locks close unison reeds and leaves the Celeste alone", () => {
  const cents = [0.4, -0.6, 0.9, 2.1, 0.1], winds = [1.2, 1.0, 0.8, 1.1, 0.9];
  const lockable = [true, true, true, false, true];
  const r = lockReeds(cents, winds, lockable, 3);
  assert.deepEqual(r.locked, [true, true, true, false, true]);
  const c = (0.4 - 0.6 + 0.9 + 0.1) / 4, w = (1.2 + 1.0 + 0.8 + 0.9) / 4;
  for (const i of [0, 1, 2, 4]) { near(r.cents[i], c, 1e-12); near(r.winds[i], w, 1e-12); }
  assert.equal(r.cents[3], 2.1, "Celeste keeps its offset");
  assert.equal(r.winds[3], 1.1);
  assert.deepEqual(cents, [0.4, -0.6, 0.9, 2.1, 0.1], "inputs untouched");
});

test("D14: reeds outside the pull range stay free; Off and lone reeds never lock", () => {
  const r = lockReeds([0, 0.5, 6, 0, 0], [1, 1, 1, 1, 1], [true, true, true, false, false], 2);
  assert.deepEqual(r.locked, [true, true, false, false, false]);
  assert.equal(r.cents[2], 6);
  assert.deepEqual(lockReeds([0, 0.5], [1, 1], [true, true], 0).locked, [false, false]);
  assert.deepEqual(lockReeds([0, 0.5], [1, 1], [true, false], 3).locked, [false, false]);
});

test("D14: at default scatter (±1 ¢) and pull (3 ¢), every key's unison ranks lock", () => {
  for (const seed of [1, 7, 12345]) for (let m = 36; m <= 96; m++) {
    const cents = [0, 1, 2, 4].map((i) => reedError(seed, i, m, 1));
    assert.ok(lockReeds(cents, [1, 1, 1, 1], [true, true, true, true], 3).locked.every(Boolean), `seed ${seed} key ${m}`);
  }
});

const fundShare = (sp) => { let t = 0; for (let k = 1; k <= sp.n; k++) t += ((k % 2 ? 1 : sp.even) / k ** sp.exp) ** 2; return 1 / t; };
const recipe = (sp) => ({ amp: (k) => (k % 2 ? 1 : sp.even) / k ** sp.exp, n: sp.n });

test("D15: Melodia and Bourdon keep clear harmonics, at the same loudness as before", () => {
  assert.ok(fundShare(WAVE_SPECS.mellow) < 0.92, "Melodia is no longer almost a pure tone");
  assert.ok(fundShare(WAVE_SPECS.bass) < fundShare(WAVE_SPECS.mellow), "the Bourdon is buzzier than the Melodia");
  assert.ok(fundShare(WAVE_SPECS_V1.mellow) > 0.95, "the old recipe was nearly a sine");
  const old = scaledRms(recipe(WAVE_SPECS_V1.mellow));
  for (const [id, oldLevel] of [["melodia", 0.9], ["bourdon", 0.85]]) {
    const r = RANKS.find((x) => x.id === id);
    near(20 * Math.log10(r.level * scaledRms(waveRecipe(r, 0)) / (oldLevel * old)), 0, 0.1, id + " loudness (dB)");
  }
});

test("D16: speech time is S-shaped, slower for low reeds and low wind", () => {
  near(windSpeech(P_REF), 1, 1e-12);
  assert.ok(windSpeech(1) < windSpeech(P_REF) && windSpeech(0.1) > windSpeech(P_REF));
  near(speechTime(220, P_REF, 1), 0.0836, 0.001, "A3 at the reference wind");
  assert.ok(speechTime(65, P_REF, 1) > 2 * speechTime(262, P_REF, 1), "C2 slower than C4");
  near(speechTime(20, P_REF, 1), 0.2, 1e-12, "slowest");
  near(speechTime(5000, P_REF, 1), 0.025, 1e-12, "fastest");
  near(speechTime(220, P_REF, 2), 2 * speechTime(220, P_REF, 1), 1e-12, "Speech speed scales it");
  // zero slope at the start, and the 10–90% rise matches RISE_PER_TAU
  const tau = onsetTau(0.1);
  assert.ok(onsetShape(tau * 0.01, tau) < 0.001, "starts almost flat");
  const cross = (y) => { let t = 0; while (onsetShape(t, tau) < y) t += tau / 10000; return t; };
  near((cross(0.9) - cross(0.1)) / tau, RISE_PER_TAU, 0.01);
});

test("D17: each reed's tone shelf sits between its fundamental and 2nd harmonic", () => {
  assert.ok(TILT_RATIO > 1 && TILT_RATIO < 2);
});

test("D20: Volume, limiter make-up and the soft-clip ceiling", () => {
  near(volumeGain(100), 1, 1e-12); near(20 * Math.log10(volumeGain(50)), -12.04, 0.01); assert.equal(volumeGain(0), 0);
  near(limiterMakeupDb(-4, 20), 2.28, 1e-9, "Chromium's make-up: 0.6 × 3.8 dB");
  for (const x of [0, 0.3, -0.5, 0.899]) assert.equal(softClip(x), x, "unity below 0.9");
  let prev = -Infinity;
  for (let x = -1.5; x <= 1.5; x += 0.001) { const y = softClip(x); assert.ok(Math.abs(y) < 0.986, `below full scale at ${x}`); assert.ok(y >= prev, "monotonic"); prev = y; }
  const c = softClipCurve(); assert.equal(c.length, 2049); near(c[1024], 0, 1e-12); near(c[0], softClip(-1), 1e-7);
});

test("D19: Cabinet bass slider maps to a 20–200 Hz corner, bottom is Off", () => {
  near(bassCutHz(60), 79.6, 0.1); near(bassCutHz(100), 200, 1e-9); assert.ok(bassCutHz(0) < 10);
});

test("D23: Easy wind charges for at most three reeds; off, every reed counts", () => {
  near(windDrain(0, 0, false), 0.018, 1e-12, "a little leakage with nothing playing");
  near(windDrain(2, 0, false), 0.018 + 0.042, 1e-12);
  near(windDrain(30, 0, false), 0.018 + 0.63, 1e-12, "full organ, six notes");
  assert.equal(EASY_REEDS, 3);
  near(windDrain(30, 0, true), windDrain(3, 0, false), 1e-12, "capped at three reeds");
  near(windDrain(2, 0, true), windDrain(2, 0, false), 1e-12, "below the cap, the same as off");
  near(windDrain(30, 1, true), 0.018 + 0.021 * 3 * 1.3, 1e-12, "the open swell still draws more");
});

test("D28: the scoop lands exactly on pitch with no kink, from the full depth below", () => {
  for (const c of SCOOP_CURVES) {
    assert.equal(scoopShape(0, c), 1, c);
    assert.equal(scoopShape(1, c), 0, c);
    assert.equal(scoopShape(2, c), 0, `${c} stays on pitch after it lands`);
    for (let x = 0; x < 1; x += .01) assert.ok(scoopShape(x + .01, c) <= scoopShape(x, c) + 1e-12, `${c} only rises toward the note`);
    if (c !== "snap") near(scoopShape(.995, c), 0, 1e-3, `${c} arrives with zero slope`);
    const curve = scoopCurve(100, c);
    near(curve[0], -100, 1e-6, c); assert.equal(curve[curve.length - 1], 0, c);
  }
  // an exponential tail (time constant a third of the scoop) is still 5 cents flat
  // of a 100 cent scoop at the end; these are exactly there
  near(100 * Math.exp(-3), 5, .1);
  // the S-curve holds low longer: halfway through, ease-out is a quarter of the way
  // below and the S-curve halfway
  near(scoopValue(100, "ease", .5), -25, 1e-9);
  near(scoopValue(100, "smooth", .5), -50, 1e-9);
});

test("D28: the scoop lasts at least as long as the reed takes to speak", () => {
  assert.equal(scoopDuration(.12, .06), .12);
  assert.equal(scoopDuration(.12, .16), .16);
});

test("D28: which notes scoop", () => {
  const base = { depth: 100, m: 72, held: [60, 64, 67], lastTop: 67 };
  assert.equal(scoopDepth({ ...base, mode: "top" }), 100, "the top voice scoops");
  assert.equal(scoopDepth({ ...base, mode: "top", m: 62 }), 0, "an inner voice doesn't");
  assert.equal(scoopDepth({ ...base, mode: "top", held: [] }), 100, "a lone note is the top voice");
  assert.equal(scoopDepth({ ...base, mode: "top", depth: 0 }), 0, "Off");
  assert.equal(scoopDepth({ ...base, mode: "leaps" }), 100, "a fourth up is a leap");
  assert.equal(scoopDepth({ ...base, mode: "leaps", lastTop: 71 }), 0, "a step isn't");
  assert.equal(scoopDepth({ ...base, mode: "leaps", m: 72 - 0, lastTop: 72 - LEAP }), 100, "a minor third is");
  assert.equal(scoopDepth({ ...base, mode: "leaps", lastTop: 76 }), 0, "a leap down isn't");
  assert.equal(scoopDepth({ ...base, mode: "leaps", lastTop: null }), 0, "nothing to leap from");
  assert.equal(scoopDepth({ ...base, mode: "all", m: 62 }), 100, "every note");
  assert.equal(scoopDepth({ ...base, mode: "velocity", m: 62, velocity: 127 }), 100);
  near(scoopDepth({ ...base, mode: "velocity", m: 62, velocity: 64 }), 50.4, .1);
  assert.ok(isTop(60, [48, 55]) && !isTop(60, [48, 60]));
});

test("D28: the pitch wheel spans exactly the bend range each way", () => {
  assert.equal(bendCents(0, 64, 2), 0);
  near(bendCents(127, 127, 2), 200, 1e-9);
  near(bendCents(0, 0, 2), -200, 1e-9);
  near(bendCents(0, 96, 12), 600, 1);
  assert.equal(bendCents(127, 127, 0), 0);
});

test("D29: Late snap holds below longest and arrives at its fastest", () => {
  // halfway through it is still 7/8 of the way below; the others are at 1/4 and 1/2
  near(scoopShape(.5, "snap"), .875, 1e-9);
  for (const x of [.25, .5, .75]) for (const c of ["ease", "smooth"]) assert.ok(scoopShape(x, "snap") > scoopShape(x, c), `below ${c} at ${x}`);
  const speed = (x) => (scoopShape(x - .01, "snap") - scoopShape(x, "snap")) / .01;
  assert.ok(speed(1) > speed(.75) && speed(.75) > speed(.5) && speed(.5) > speed(.25), "keeps speeding up");
  near(speed(1), 3, .05, "lands at three times the average speed");
});

test("D29: Accents scoop the full depth at or past the crossover, nothing below it", () => {
  const base = { mode: "accent", depth: 100, m: 60, held: [72], lastTop: null, crossover: 90 };
  assert.equal(scoopDepth({ ...base, velocity: 90 }), 100);
  assert.equal(scoopDepth({ ...base, velocity: 127 }), 100);
  assert.equal(scoopDepth({ ...base, velocity: 89 }), 0);
  assert.equal(scoopDepth({ ...base, velocity: 1 }), 0);
  assert.equal(scoopDepth({ ...base, velocity: KEY_VELOCITY }), 100, "keys and mouse count as 100");
  assert.equal(scoopDepth({ ...base, velocity: KEY_VELOCITY, crossover: 101 }), 0);
});

test("D29: the vibrato delay, its controller and when it starts", () => {
  assert.equal(vibDelaySec(400), .4);
  assert.equal(vibDelaySec(VIB_DELAY_MAX), Infinity, "the top of the slider is Never");
  assert.equal(delayFromCC(0), VIB_DELAY_MAX, "controller down: Never");
  assert.equal(delayFromCC(127), 0, "controller up: no delay");
  for (let cc = 0; cc < 127; cc++) assert.ok(delayFromCC(cc + 1) <= delayFromCC(cc), "pushing it up never lengthens the delay");
  assert.equal(delayFromCC(64) % 50, 0);
  near(vibStart(1, .4, 0), 1.4, 1e-12, "counted from the landing");
  assert.equal(vibStart(1, .4, 2), 2, "a delay already over starts now");
  assert.equal(vibStart(1, Infinity, 0), Infinity);
});

test("D29: the vibrato fades in on an S-curve and starts slower with natural variation", () => {
  const c = vibFadeCurve();
  assert.equal(c[0], 0); assert.equal(c[c.length - 1], 1);
  for (let k = 1; k < c.length; k++) assert.ok(c[k] >= c[k - 1]);
  assert.ok(c[1] < .01 && c[c.length - 2] > .99, "gentle at both ends");
  assert.equal(vibStartRate(5, 0), 5);
  near(vibStartRate(5, 1), 4, 1e-12);
});

test("D29: the wander curve is smooth, stays within ±1 and loops", () => {
  let seed = 1; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const w = wanderCurve(20, 3000, .45, rand);
  assert.equal(w.length, 60000);
  let jump = 0; for (let i = 1; i < w.length; i++) jump = Math.max(jump, Math.abs(w[i] - w[i - 1]));
  assert.ok(w.every((x) => x >= -1 && x <= 1));
  assert.ok(jump < .005, `largest step ${jump}`);
  assert.ok(Math.abs(w[w.length - 1] - w[0]) < .005, "the end meets the start");
  assert.ok(Math.max(...w) - Math.min(...w) > 1, "it really wanders");
});

test("D30: sequencer curves run from 0 to 1, each with its own shape", () => {
  for (const c of Object.keys(SEQ_CURVES)) {
    assert.equal(seqShape(0, c), 0, c); assert.equal(seqShape(1, c), 1, c);
    for (let x = 0; x < 1; x += .01) assert.ok(seqShape(x + .01, c) >= seqShape(x, c), `${c} only moves one way`);
  }
  near(seqShape(.5, "linear"), .5, 1e-12);
  near(seqShape(.5, "slow"), .25, 1e-12);
  near(seqShape(.5, "fast"), .75, 1e-12);
  near(seqShape(.5, "s"), .5, 1e-12);
  near(seqShape(.25, "s"), .15625, 1e-12);
  assert.deepEqual(SEQ_ROWS.map((r) => r.id), ["up-linear", "up-slow", "up-fast", "up-s", "down-linear", "down-slow", "down-fast", "down-s"]);
});

test("D30: each note builds on where the last one left off, and holds between notes", () => {
  const notes = [{ row: "up-linear", start: 0, len: 4 }, { row: "down-linear", start: 8, len: 2 }];
  near(seqValue(notes, 0, .5, .2), .5, 1e-12);
  near(seqValue(notes, 2, .5, .2), .6, 1e-12, "halfway up");
  near(seqValue(notes, 4, .5, .2), .7, 1e-12, "arrived");
  near(seqValue(notes, 6, .5, .2), .7, 1e-12, "holds in the gap");
  near(seqValue(notes, 9, .5, .2), .6, 1e-12, "the down sweep starts from 0.7");
  near(seqValue(notes, 12, .5, .2), .5, 1e-12);
  // continuous at every step boundary
  for (let p = 0; p < 16; p += .01) assert.ok(Math.abs(seqValue(notes, p + .01, .5, .2) - seqValue(notes, p, .5, .2)) < .006, `smooth at ${p}`);
});

test("D30: sweeping past the top or bottom of the range does nothing", () => {
  const up = [{ row: "up-linear", start: 0, len: 2 }, { row: "up-linear", start: 2, len: 2 }, { row: "down-linear", start: 4, len: 2 }];
  near(seqValue(up, 2, .8, .3), 1, 1e-12, "stops at the top");
  near(seqValue(up, 3, .8, .3), 1, 1e-12, "a second sweep up does nothing");
  near(seqValue(up, 6, .8, .3), .7, 1e-12, "coming down starts from the top");
  near(seqValue([{ row: "down-s", start: 0, len: 4 }], 4, .1, .5), 0, 1e-12, "stops at the bottom");
  near(seqValue([], 3, 1.4, .5), 1, 1e-12, "a setting outside the range is held at the limit");
});

test("D30: placing a note replaces any note covering that step, on any row", () => {
  const start = [{ row: "up-s", start: 0, len: 8 }, { row: "down-s", start: 8, len: 8 }];
  const a = placeNote(start, "down-fast", 3);
  assert.deepEqual(a.notes, [{ row: "down-fast", start: 3, len: 1 }, { row: "down-s", start: 8, len: 8 }]);
  assert.equal(a.index, 0);
  const b = placeNote([], "up-linear", 5);
  assert.deepEqual(b.notes, [{ row: "up-linear", start: 5, len: 1 }]);
  assert.deepEqual(removeNote(start, 0), [{ row: "down-s", start: 8, len: 8 }]);
});

test("D30: notes stretch forwards or backwards, but not into their neighbours or past the ends", () => {
  const notes = [{ row: "up-s", start: 2, len: 2 }, { row: "up-s", start: 6, len: 2 }, { row: "down-s", start: 12, len: 1 }];
  assert.deepEqual(resizeNote(notes, 1, "end", 10, 16).notes[1], { row: "up-s", start: 6, len: 4 }, "forwards");
  assert.deepEqual(resizeNote(notes, 1, "end", 15, 16).notes[1], { row: "up-s", start: 6, len: 6 }, "stops at the next note");
  assert.deepEqual(resizeNote(notes, 1, "start", 5, 16).notes[1], { row: "up-s", start: 5, len: 3 }, "backwards");
  assert.deepEqual(resizeNote(notes, 1, "start", 0, 16).notes[1], { row: "up-s", start: 4, len: 4 }, "stops at the note before");
  assert.deepEqual(resizeNote(notes, 1, "end", 2, 16).notes[1], { row: "up-s", start: 6, len: 1 }, "never under one step");
  assert.deepEqual(resizeNote(notes, 1, "start", 9, 16).notes[1], { row: "up-s", start: 7, len: 1 });
  assert.deepEqual(resizeNote(notes, 2, "end", 30, 16).notes[2], { row: "down-s", start: 12, len: 4 }, "the pattern's end");
  assert.deepEqual(resizeNote(notes, 0, "start", -3, 16).notes[0], { row: "up-s", start: 0, len: 4 }, "the pattern's start");
});

test("D31, D32: the lanes, their ranges and the Amount readout", () => {
  assert.deepEqual(SEQ_TARGETS, ["left", "right", "direct", "fan", "swell"]);
  assert.deepEqual(FREE_LANES, ["left", "right"]);
  near(toShare("direct", 1.8), .5, 1e-12);
  near(toShare("fan", 9), 8 / 11, 1e-12);
  near(fromShare("fan", 0), 1, 1e-12); near(fromShare("fan", 1), 12, 1e-12);
  near(toShare("swell", 25), .25, 1e-12);
  near(fromShare("left", .5), 50, 1e-12);
  for (const t of SEQ_TARGETS) for (const v of [SEQ_TARGET_RANGE[t][0], SEQ_TARGET_RANGE[t][1], 2.5]) near(fromShare(t, toShare(t, v)), v, 1e-9, t);
  assert.equal(amountText("direct", 25), "25% · 0.9″");
  assert.equal(amountText("fan", 25), "25% · 2.8 Hz");
  assert.equal(amountText("swell", 40), "40% of the swell");
  assert.equal(amountText("right", 100), "100% of a stroke");
  assert.equal(amountText("fan", 0), "None");
});

test("D32: time signatures: 16th notes, the tempo counting quarters or (in 6/8) eighths", () => {
  assert.deepEqual(Object.keys(METERS), ["2/4", "3/4", "4/4", "5/4", "6/8"]);
  assert.deepEqual(Object.keys(METERS).map(stepsPerBar), [8, 12, 16, 20, 12]);
  assert.equal(stepsPerBeat("6/8"), 2); assert.equal(stepsPerBeat("3/4"), 4);
  assert.equal(seqSteps("5/4", 4), 80);
  near(stepSeconds(120, "4/4"), .125, 1e-12);
  near(stepSeconds(120, "6/8"), .25, 1e-12, "an eighth at 120 is two 16ths");
  near(seqPosition(.5, 120, "4/4", 16), 4, 1e-9);
  near(seqPosition(2.25, 120, "4/4", 16), 2, 1e-9, "one bar at 120 bpm is 2 s");
  near(seqPosition(2.25, 120, "4/4", 32), 18, 1e-9);
  near(seqPosition(2.4, 100, "3/4", 12), 4, 1e-9, "one bar of 3/4 at 100 bpm is 1.8 s, so 2.4 s is 4 16ths into the next");
});

test("D32: the defaults: the treadles pump autoplay's pattern, everything else off", () => {
  const d = normaliseSeq(undefined);
  assert.equal(d.meter, "4/4"); assert.equal(d.bars, 1); assert.equal(d.trigger, "first"); assert.equal(d.edit, "left");
  assert.deepEqual(d.lanes, DEFAULT_SEQ.lanes);
  assert.equal(d.lanes.left.on && d.lanes.right.on, true);
  assert.equal(d.lanes.direct.on || d.lanes.fan.on || d.lanes.swell.on, false);
  assert.deepEqual(d.lanes.right.notes, stroke(0), "right on beat 1");
  assert.deepEqual(d.lanes.left.notes, stroke(4), "left on beat 2");
  assert.equal(d.lanes.left.amount, 1); assert.equal(d.lanes.fan.amount, .25);
  // a stroke presses and lets the pedal up again, so the next one starts from the top
  near(seqValue(d.lanes.right.notes, 0, 0, 1), 0, 1e-12);
  near(seqValue(d.lanes.right.notes, 1, 0, 1), 1, 1e-12, "fully down after one 16th");
  near(seqValue(d.lanes.right.notes, 3, 0, 1), 0, 1e-12, "up again after three");
  near(seqValue(d.lanes.direct.notes, 16, .5, .25), .5, 1e-12, "the swell pattern ends where it started, so it loops smoothly");
});

test("D32: strokes get longer and slower with the note, and keep a 16th to spare", () => {
  assert.deepEqual(stroke(0, 4), [{ row: "up-fast", start: 0, len: 1 }, { row: "down-fast", start: 1, len: 2 }]);
  assert.deepEqual(stroke(8, 8), [{ row: "up-fast", start: 8, len: 2 }, { row: "down-fast", start: 10, len: 5 }]);
  assert.deepEqual(stroke(0, 2), [{ row: "up-fast", start: 0, len: 1 }, { row: "down-fast", start: 1, len: 1 }], "an eighth in 6/8");
});

test("D32: patterns load cleanly, and changing time or bars keeps each bar's notes", () => {
  const bad = normaliseSeq({ meter: "7/9", bars: 9, trigger: "x", edit: "volume", lanes: { fan: { on: "yes", amount: 3, notes: [{ row: "up-s", start: 4, len: 4 }, { row: "nope", start: 0, len: 1 }, { row: "down-s", start: 6, len: 2 }, { row: "up-s", start: 14, len: 9 }] } } });
  assert.equal(bad.meter, "4/4"); assert.equal(bad.bars, 1); assert.equal(bad.trigger, "first"); assert.equal(bad.edit, "left");
  assert.equal(bad.lanes.fan.on, false); assert.equal(bad.lanes.fan.amount, .25);
  assert.deepEqual(bad.lanes.fan.notes, [{ row: "up-s", start: 4, len: 4 }, { row: "up-s", start: 14, len: 2 }]);
  assert.deepEqual(bad.lanes.left, DEFAULT_SEQ.lanes.left, "a missing lane takes its default");
  const p = normaliseSeq({ meter: "4/4", bars: 2, lanes: { swell: { notes: [{ row: "up-s", start: 2, len: 4 }, { row: "down-s", start: 14, len: 2 }, { row: "up-s", start: 18, len: 8 }] } } });
  const three = reshape(p, "3/4", 2);
  assert.deepEqual(three.lanes.swell.notes, [{ row: "up-s", start: 2, len: 4 }, { row: "up-s", start: 14, len: 8 }], "the note past a 3/4 bar's end goes; bar 2's moves with its bar");
  assert.deepEqual(reshape(three, "3/4", 1).lanes.swell.notes, [{ row: "up-s", start: 2, len: 4 }]);
  assert.equal(seqSteps(reshape(p, "6/8", 4).meter, 4), 48);
});

test("D32: saved autoplay and sequencer patterns carry over", () => {
  const a = migrateSaved({ autoplay: { on: true, meter: "3/4", measures: 2, cells: ["R", "~", "L", "R", "-", "-"] } });
  assert.equal(a.meter, "3/4"); assert.equal(a.bars, 2);
  assert.deepEqual(a.lanes.right.notes, [...stroke(0, 8), ...stroke(12, 4)], "a tied stroke is longer and slower");
  assert.deepEqual(a.lanes.left.notes, stroke(8, 4));
  assert.equal(migrateSaved({ autoplay: { on: false, meter: "4/4", measures: 1, cells: ["R", "L", "-", "-"] } }).lanes.left.on, false, "autoplay off: the treadle patterns start off");
  const eighths = migrateSaved({ autoplay: { on: true, meter: "6/8", measures: 1, cells: ["L", "-", "-", "R", "-", "-"] } });
  assert.deepEqual(eighths.lanes.right.notes, stroke(6, 2));
  const m = migrateSaved({ modseq: { on: true, target: "fan", bars: 2, trigger: "each", notes: [{ row: "up-s", start: 2, len: 4 }, { row: "down-s", start: 20, len: 2 }] }, amount: 40 });
  assert.equal(m.lanes.fan.on, true); near(m.lanes.fan.amount, .4, 1e-12); assert.equal(m.trigger, "each"); assert.equal(m.bars, 2);
  assert.deepEqual(m.lanes.fan.notes, [{ row: "up-s", start: 2, len: 4 }, { row: "down-s", start: 20, len: 2 }]);
  assert.deepEqual(m.lanes.right, DEFAULT_SEQ.lanes.right, "no saved autoplay: the default pumping");
  const both = migrateSaved({ autoplay: { on: true, meter: "3/4", measures: 1, cells: ["R", "L", "-"] }, modseq: { on: false, target: "direct", bars: 1, notes: [{ row: "up-s", start: 13, len: 2 }, { row: "up-s", start: 3, len: 2 }] } });
  assert.deepEqual(both.lanes.direct.notes, [{ row: "up-s", start: 3, len: 2 }], "a 4/4 note past a 3/4 bar is dropped");
  assert.deepEqual(migrateSaved({}), normaliseSeq(), "nothing saved: the defaults");
});


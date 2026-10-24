// Unit tests for the pure maths in js/core. Run with: npm run test:unit
// No browser needed; each test pins down a property from docs/decisions.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKS, CELESTE, SPLITS, noteFreq, waveRecipe, scaledRms, loudnessComp, celesteCents, WAVE_SPECS, WAVE_SPECS_V1 } from "../../js/core/ranks.js";
import { windSpeech, speechTime, onsetTau, onsetShape, RISE_PER_TAU, TILT_RATIO } from "../../js/core/speech.js";
import { reedRand, reedTri, reedError, reedWindResponse, lockReeds } from "../../js/core/reeds.js";
import { windLevel, windBright, windCents, windDrain, EASY_REEDS, KNEE, P_REF, gaugeInches, toTime, toSlider, fmtT, stepEnvelope, DEFAULT_ENV } from "../../js/core/wind.js";
import { fanWaveCoefficients } from "../../js/core/fan.js";
import { METERS, DEFAULT_PATTERN, normalise, reshape, nextCell, cellSeconds, noteAt, pedalsAt, liftGap } from "../../js/core/autoplay.js";
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

test("D22: the default autoplay pattern is one bar of 4/4, right and left quarter notes then a half rest", () => {
  const p = normalise(DEFAULT_PATTERN);
  assert.deepEqual(p, { on: true, meter: "4/4", measures: 1, cells: ["R", "L", "-", "-"] });
  const c = cellSeconds(100);                                  // 0.6 s a beat
  near(c, 0.6, 1e-12);
  const at = (t) => pedalsAt(p.cells, c, t);
  assert.deepEqual(at(0.05), { L: false, R: true, index: 0 });
  assert.deepEqual(at(0.65), { L: true, R: false, index: 1 });
  assert.deepEqual(at(1.3), { L: false, R: false, index: 2 });
  assert.deepEqual(at(1.9), { L: false, R: false, index: 3 });
  assert.deepEqual(at(2.45), { L: false, R: true, index: 0 }, "loops after 2.4 s");
  assert.equal(at(0.6 - liftGap(c) + 0.01).R, false, "lifts just before the next beat");
});

test("D22: ties lengthen a stroke, wrap around the loop, and tie after a rest is silent", () => {
  const c = 0.5;
  const half = noteAt(["L", "~", "R", "-"], c, 0.7);
  assert.equal(half.foot, "L"); near(half.start, 0, 1e-12); near(half.end, 1.0, 1e-12);
  const wrap = noteAt(["~", "-", "-", "R"], c, 2.1);           // the tie on beat 1 holds beat 4's R into the next loop
  assert.equal(wrap.foot, "R"); near(wrap.start, 1.5, 1e-12); near(wrap.end, 2.5, 1e-12);
  assert.equal(noteAt(["-", "~", "-", "-"], c, 0.7).foot, null);
  assert.equal(noteAt(["~", "~"], c, 0.2).foot, null, "all ties is silence");
  // two strokes in a row on the same foot are separate strokes
  const same = ["R", "R"]; assert.equal(pedalsAt(same, c, 0.49).R, false); assert.equal(pedalsAt(same, c, 0.51).R, true);
});

test("D22: editing: cycle order, reshaping meters and measures, and cleaning bad saved data", () => {
  assert.deepEqual(["-", "L", "R", "~"].map(nextCell), ["L", "R", "~", "-"]);
  const p = normalise({ meter: "4/4", measures: 2, cells: ["R", "L", "-", "~", "L", "R", "R", "L"] });
  const three = reshape(p, "3/4", 2);
  assert.deepEqual(three.cells, ["R", "L", "-", "L", "R", "R"], "each measure keeps its first beats");
  const six = reshape(three, "6/8", 3);
  assert.deepEqual(six.cells, ["R", "L", "-", "-", "-", "-", "L", "R", "R", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
  assert.equal(six.cells.length, 3 * METERS["6/8"].beats);
  assert.deepEqual(normalise({ meter: "7/9", measures: 9, cells: ["X"] }).cells.length, 16, "bad meter → 4/4, measures capped at 4");
  assert.equal(normalise(null).on, true);
  assert.equal(normalise({ on: false }).on, false);
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

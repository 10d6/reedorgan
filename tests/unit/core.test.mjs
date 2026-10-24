// Unit tests for the pure maths in js/core. Run with: npm run test:unit
// No browser needed; each test pins down a property from docs/decisions.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKS, CELESTE, SPLITS, noteFreq, waveRecipe, scaledRms, loudnessComp, celesteCents } from "../../js/core/ranks.js";
import { reedRand, reedTri, reedError, reedWindResponse } from "../../js/core/reeds.js";
import { windLevel, windBright, KNEE, P_REF, gaugeInches, toTime, toSlider, fmtT, stepEnvelope, DEFAULT_ENV } from "../../js/core/wind.js";
import { fanWaveCoefficients } from "../../js/core/fan.js";

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

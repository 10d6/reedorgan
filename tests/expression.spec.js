// Expression (D28): the musical scoop and the MIDI pitch and mod wheels. Pitch
// is measured from the speakers by autocorrelation (window.__pitch in organ.js),
// on the Melodia alone with Reed scatter, Pitch drift, Speech glide and Tone
// bloom at zero, so the only pitch movement is the one under test. A scoop is
// tens of cents; "doesn't scoop" allows a few cents of tracker noise at the onset.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, toggleStop, pitchTrace, cents, measure } from "./organ.js";

const A3 = 57, C5 = 72;
const on = (m, v = 100) => [0x90, m, v], off = (m) => [0x80, m, 0];
const midi = (page, ...msgs) => page.evaluate((ms) => ms.forEach(([a, b, c]) => window.__midi(a, b, c)), msgs);
const choose = (page, id, value) => page.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event("change")); }, [id, value]);
const clear = (fs) => fs.filter((f) => f[2] > 0.9);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
// cents from `ref`, for the clear frames between t0 and t1 seconds
const span = (trace, ref, t0, t1) => clear(trace).filter((f) => f[0] >= t0 && f[0] < t1).map((f) => cents(f[1], ref));

async function setup(page) {
  await openOrgan(page);
  await page.click("#midiBtn");
  await toggleStop(page, "Diapason 8′");                       // Melodia alone: nearly all fundamental
  // Tone bloom off too: its shelf opening shifts the phase, which reads as about
  // +20 cents for a note's first 50 ms whether or not it scoops.
  for (const [id, v] of [["scatterAmt", 0], ["sensAmt", 0], ["scoopAmt", 0], ["bloomAmt", 0]]) await setSlider(page, id, v);
  await page.waitForTimeout(1500);                             // let the reservoir fill
}
// The settled pitch of a held A3 with no scoop, in Hz.
async function reference(page) {
  const tr = await pitchTrace(page, 700, [on(A3)]);
  await midi(page, off(A3)); await page.waitForTimeout(700);
  return median(clear(tr).filter((f) => f[0] > 0.35).map((f) => f[1]));
}
async function play(page, ms, msgs, release) {
  const tr = await pitchTrace(page, ms, msgs);
  await midi(page, ...release.map(off)); await page.waitForTimeout(700);
  return tr;
}

test("Expression is off by default: notes don't scoop (D28)", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#scoopDepthOut")).toHaveText("Off");
  await expect(page.locator("#bendRangeOut")).toHaveText("±2 semitones");
  expect(await page.locator("#scoopMode").inputValue()).toBe("top");
  expect(await page.locator("#exprPanel")).not.toHaveAttribute("open", "");
  const ref = await reference(page);
  const tr = await play(page, 400, [on(A3)], [A3]);
  expect(Math.min(...span(tr, ref, 0, 0.4))).toBeGreaterThan(-8);
});

test("a scoop starts below the note and lands exactly on pitch at the end of Scoop time (D28)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 200);
  for (const curve of ["ease", "smooth"]) {
    await choose(page, "scoopCurve", curve);
    const tr = await play(page, 600, [on(A3)], [A3]);
    const early = span(tr, ref, 0, 0.07), landed = span(tr, ref, 0.25, 0.6);
    expect(Math.min(...early), curve).toBeLessThan(-45);       // starts most of a semitone down
    expect(Math.max(...landed), curve).toBeLessThan(0.5);      // and is exactly there afterwards,
    expect(Math.min(...landed), curve).toBeGreaterThan(-0.5);  // with no lingering flat tail
    const rising = span(tr, ref, 0.06, 0.25);       // after the analysis window is past the onset
    for (let i = 4; i < rising.length; i++) expect(rising[i], curve).toBeGreaterThan(rising[i - 4] - 1);   // only rises
  }
});

test("Top voice: a note below a held key doesn't scoop; on its own it does (D28)", async ({ page }) => {
  await setup(page);
  // Divide at middle C with no treble stops, so C5 is a silent key that is still held.
  await page.selectOption("#split", "bc");
  await toggleStop(page, "Treble Melodia 8′");
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 200);
  await midi(page, on(C5)); await page.waitForTimeout(100);
  const under = await play(page, 300, [on(A3)], [A3, C5]);
  expect(Math.min(...span(under, ref, 0, 0.3))).toBeGreaterThan(-8);
  const alone = await play(page, 300, [on(A3)], [A3]);
  expect(Math.min(...span(alone, ref, 0, 0.07))).toBeLessThan(-45);
  // Every note scoops whatever else is held.
  await choose(page, "scoopMode", "all");
  await midi(page, on(C5)); await page.waitForTimeout(100);
  const every = await play(page, 300, [on(A3)], [A3, C5]);
  expect(Math.min(...span(every, ref, 0, 0.07))).toBeLessThan(-45);
});

test("a chord's lower note gives up its scoop when a higher one follows at once (D28)", async ({ page }) => {
  await setup(page);
  await page.selectOption("#split", "bc");
  await toggleStop(page, "Treble Melodia 8′");
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 300);
  // A3 then C5 in the same MIDI burst: A3 was the top voice for an instant only.
  const chord = await play(page, 300, [on(A3), on(C5)], [A3, C5]);
  const solo = await play(page, 300, [on(A3)], [A3]);
  const c = median(span(chord, ref, 0.06, 0.12)), s = median(span(solo, ref, 0.06, 0.12));
  expect(c).toBeGreaterThan(-8);
  expect(s).toBeLessThan(-30);
});

test("Leaps up: the top voice scoops only when it jumps up a minor third or more (D28)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 200);
  await choose(page, "scoopMode", "leaps");
  await midi(page, on(55)); await page.waitForTimeout(150); await midi(page, off(55)); await page.waitForTimeout(400);
  const step = await play(page, 300, [on(A3)], [A3]);         // G3 → A3, a step
  expect(Math.min(...span(step, ref, 0, 0.3))).toBeGreaterThan(-8);
  await midi(page, on(52)); await page.waitForTimeout(150); await midi(page, off(52)); await page.waitForTimeout(400);
  const leap = await play(page, 300, [on(A3)], [A3]);         // E3 → A3, a fourth
  expect(Math.min(...span(leap, ref, 0, 0.07))).toBeLessThan(-45);
});

test("Velocity: harder notes scoop deeper (D28)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 250);
  await choose(page, "scoopMode", "velocity");
  const hard = await play(page, 300, [on(A3, 127)], [A3]);
  const soft = await play(page, 300, [on(A3, 40)], [A3]);
  const h = median(span(hard, ref, 0.04, 0.1)), s = median(span(soft, ref, 0.04, 0.1));
  expect(h).toBeLessThan(s * 2);           // both negative; hard is about three times as deep
  expect(s).toBeLessThan(-5);
});

test("coupled octaves scoop with the key, so the sound stays one clear pitch (D28)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await toggleStop(page, "Super octave coupler");
  await setSlider(page, "scoopDepthAmt", 200); await setSlider(page, "scoopTimeAmt", 250);
  const tr = await play(page, 400, [on(A3)], [A3]);
  const during = tr.filter((f) => f[0] > 0.06 && f[0] < 0.2);   // after the analysis window is past the onset
  expect(Math.min(...during.map((f) => cents(f[1], ref)))).toBeLessThan(-60);
  expect(median(during.map((f) => f[2]))).toBeGreaterThan(0.97);   // A3 and A4 still move as one
});

test("the pitch wheel bends sounding notes by the Bend range (D28)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await midi(page, on(A3)); await page.waitForTimeout(500);
  const held = async () => median(span(await pitchTrace(page, 250), ref, 0.05, 0.25));
  await midi(page, [0xe0, 127, 127]); await page.waitForTimeout(150);
  expect(await held()).toBeCloseTo(200, 0);
  await midi(page, [0xe0, 0, 0]); await page.waitForTimeout(150);
  expect(await held()).toBeCloseTo(-200, 0);
  await setSlider(page, "bendRangeAmt", 1); await page.waitForTimeout(150);
  expect(await held()).toBeCloseTo(-100, 0);
  await midi(page, [0xe0, 0, 64]); await page.waitForTimeout(150);
  expect(Math.abs(await held())).toBeLessThan(0.5);
  await midi(page, off(A3));
});

test("the mod wheel sets Scoop; Expression settings are remembered (D28)", async ({ page }) => {
  await setup(page);
  await midi(page, [0xb0, 1, 127]);
  await expect(page.locator("#scoopDepthOut")).toHaveText("a whole tone");
  await midi(page, [0xb0, 1, 64]);
  await expect(page.locator("#scoopDepthOut")).toHaveText("a semitone");
  await page.locator("#exprPanel summary").click();
  await page.selectOption("#scoopMode", "leaps");
  await page.selectOption("#scoopCurve", "smooth");
  await setSlider(page, "scoopTimeAmt", 180);
  await page.reload();
  await expect(page.locator("#exprPanel")).toHaveAttribute("open", "");
  expect(await page.locator("#scoopMode").inputValue()).toBe("leaps");
  expect(await page.locator("#scoopCurve").inputValue()).toBe("smooth");
  await expect(page.locator("#scoopDepthOut")).toHaveText("a semitone");
  await expect(page.locator("#scoopTimeOut")).toHaveText("180 ms");
});

/* ---------- D29: the accent trigger, Late snap and delayed vibrato ---------- */
// half the peak-to-peak swing in cents over the clear frames between t0 and t1
const swing = (trace, ref, t0, t1) => { const c = span(trace, ref, t0, t1); return (Math.max(...c) - Math.min(...c)) / 2; };
// the vibrato's rate in Hz from its upward zero crossings after t0
function rate(trace, ref, t0) {
  const xs = clear(trace).filter((f) => f[0] > t0).map((f) => [f[0], cents(f[1], ref)]), ups = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1][1] < 0 && xs[i][1] >= 0) ups.push(xs[i - 1][0] + (xs[i][0] - xs[i - 1][0]) * -xs[i - 1][1] / (xs[i][1] - xs[i - 1][1]));
  return (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
}
async function vibrato(page, settings = {}) {
  const s = { vibDepthAmt: 40, vibNaturalAmt: 0, vibColourAmt: 0, vibDelayAmt: 400, vibFadeAmt: 300, ...settings };
  for (const [id, v] of Object.entries(s)) await setSlider(page, id, v);
}

test("Accents: notes struck past the Crossover scoop fully, softer ones not at all (D29)", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#scoopCrossAmt")).toBeDisabled();             // only used by Accents
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 250);
  await choose(page, "scoopMode", "accent");
  await expect(page.locator("#scoopCrossAmt")).toBeEnabled();
  await expect(page.locator("#scoopCrossOut")).toHaveText("velocity 90");
  const hard = await play(page, 300, [on(A3, 95)], [A3]);
  const soft = await play(page, 300, [on(A3, 85)], [A3]);
  expect(median(span(hard, ref, 0.04, 0.1))).toBeLessThan(-45);           // just past: the full scoop
  expect(Math.min(...span(soft, ref, 0, 0.3))).toBeGreaterThan(-8);       // just short: none
  await setSlider(page, "scoopCrossAmt", 80);
  const now = await play(page, 300, [on(A3, 85)], [A3]);
  expect(median(span(now, ref, 0.04, 0.1))).toBeLessThan(-45);
});

test("Late snap holds below longest, then lands exactly (D29)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 100); await setSlider(page, "scoopTimeAmt", 250);
  await choose(page, "scoopCurve", "snap");
  const tr = await play(page, 600, [on(A3)], [A3]);
  expect(median(span(tr, ref, 0.12, 0.14))).toBeLessThan(-70);           // halfway: still 7/8 of the way down (ease: 1/4)
  const landed = span(tr, ref, 0.3, 0.6);
  expect(Math.max(...landed)).toBeLessThan(0.5);
  expect(Math.min(...landed)).toBeGreaterThan(-0.5);
});

test("vibrato is off by default (D29)", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#vibDepthOut")).toHaveText("Off");
  await expect(page.locator("#vibRateOut")).toHaveText("5.5 Hz");
  await expect(page.locator("#vibDelayOut")).toHaveText("400 ms");
  await expect(page.locator("#vibCC")).toHaveText("No controller");
  const ref = await reference(page);
  const tr = await play(page, 1500, [on(A3)], [A3]);
  expect(swing(tr, ref, 0.3, 1.5)).toBeLessThan(1);
});

test("vibrato waits for the delay, grows in, and reaches its width at its rate (D29)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await vibrato(page);
  const tr = await play(page, 2200, [on(A3)], [A3]);
  expect(swing(tr, ref, 0.05, 0.38)).toBeLessThan(1.5);                    // still during the delay
  expect(swing(tr, ref, 0.42, 0.52)).toBeLessThan(25);                    // just starting to grow
  expect(swing(tr, ref, 1, 2.2)).toBeGreaterThan(36);                     // full width, ±40 ¢
  expect(swing(tr, ref, 1, 2.2)).toBeLessThan(44);
  expect(rate(tr, ref, 1)).toBeGreaterThan(5.2);
  expect(rate(tr, ref, 1)).toBeLessThan(5.8);
  expect(Math.abs(median(span(tr, ref, 1, 2.2)))).toBeLessThan(5);        // centred on the note
});

test("vibrato's delay counts from when the scoop lands (D29)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await setSlider(page, "scoopDepthAmt", 60); await setSlider(page, "scoopTimeAmt", 300);
  await vibrato(page, { vibDelayAmt: 300 });
  const tr = await play(page, 1600, [on(A3)], [A3]);
  expect(swing(tr, ref, 0.33, 0.58)).toBeLessThan(2);                     // landed, waiting
  expect(swing(tr, ref, 1, 1.6)).toBeGreaterThan(30);
});

test("Top voice: the vibrato moves to each new top note; a note under it gets none (D29)", async ({ page }) => {
  await setup(page);
  // Divide at middle C with no treble stops, so C5 is a silent key that is still held.
  await page.selectOption("#split", "bc");
  await toggleStop(page, "Treble Melodia 8′");
  const ref = await reference(page);
  await vibrato(page, { vibDelayAmt: 0, vibFadeAmt: 100 });
  await midi(page, on(C5)); await page.waitForTimeout(100);
  const under = await play(page, 1000, [on(A3)], [A3, C5]);
  expect(swing(under, ref, 0.3, 1)).toBeLessThan(1.5);
  // A3 alone takes the vibrato; when C5 arrives above it, A3's fades away.
  const tr = await pitchTrace(page, 1600, [on(A3)]);
  const handover = await pitchTrace(page, 1000, [on(C5)]);
  await midi(page, off(A3), off(C5)); await page.waitForTimeout(700);
  expect(swing(tr, ref, 0.5, 1.6)).toBeGreaterThan(30);
  expect(swing(handover, ref, 0.4, 1)).toBeLessThan(2);
  // Every note keeps its own.
  await choose(page, "vibMode", "all");
  await midi(page, on(C5)); await page.waitForTimeout(100);
  const every = await play(page, 1000, [on(A3)], [A3, C5]);
  expect(swing(every, ref, 0.4, 1)).toBeGreaterThan(30);
});

test("a learned controller sets the delay: down is Never, pushing it up brings vibrato in on a held note (D29)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  await vibrato(page, { vibFadeAmt: 200 });
  await page.locator("#exprPanel summary").click();
  await page.click("#vibLearn");
  await expect(page.locator("#vibCC")).toHaveText("Move a knob or slider…");
  await midi(page, [0xb0, 1, 5]);                                         // moving the mod wheel binds it (as Direct wind's Learn, D27)
  await expect(page.locator("#vibCC")).toHaveText("MIDI CC1 (mod wheel)");
  await expect(page.locator("#vibDelayOut")).toHaveText("400 ms");
  await midi(page, [0xb0, 1, 0]);                                         // then all the way down
  await expect(page.locator("#vibDelayOut")).toHaveText("Never");
  await expect(page.locator("#scoopDepthOut")).toHaveText("Off");         // the mod wheel no longer sets Scoop
  const waiting = await pitchTrace(page, 1500, [on(A3)]);
  expect(swing(waiting, ref, 0.3, 1.5)).toBeLessThan(1.5);
  const pushed = await pitchTrace(page, 1200, [[0xb0, 1, 127]]);          // all the way up, while holding
  await midi(page, off(A3)); await page.waitForTimeout(700);
  await expect(page.locator("#vibDelayOut")).toHaveText("0 ms");
  expect(swing(pushed, ref, 0.5, 1.2)).toBeGreaterThan(30);
  // Clear unbinds it, and the mod wheel sets Scoop again.
  await page.click("#vibForget");
  await expect(page.locator("#vibCC")).toHaveText("No controller");
  await midi(page, [0xb0, 1, 64]);
  await expect(page.locator("#scoopDepthOut")).toHaveText("a semitone");
  await expect(page.locator("#vibDelayOut")).toHaveText("0 ms");
});

test("coupled octaves share the vibrato, so the sound stays one clear pitch (D29)", async ({ page }) => {
  await setup(page);
  await toggleStop(page, "Super octave coupler");
  await vibrato(page, { vibDepthAmt: 80, vibDelayAmt: 0, vibFadeAmt: 100, vibNaturalAmt: 100 });
  const ref = 220;
  const tr = await play(page, 1500, [on(A3)], [A3]);
  const during = tr.filter((f) => f[0] > 0.4);
  expect(swing(tr, ref, 0.4, 1.5)).toBeGreaterThan(55);
  expect(median(during.map((f) => f[2]))).toBeGreaterThan(0.98);
  expect(Math.min(...during.map((f) => f[2]))).toBeGreaterThan(0.9);
});

test("Natural variation makes the vibrato's timing and width wander (D29)", async ({ page }) => {
  await setup(page);
  const ref = await reference(page);
  // spread of the vibrato's cycle lengths, and of its width from one 0.4 s stretch to the next.
  // 6.5 s windows: the wander is random, and shorter ones sometimes caught a calm stretch.
  const wander = async () => {
    const tr = await play(page, 6500, [on(A3)], [A3]);
    const xs = clear(tr).filter((f) => f[0] > 0.3).map((f) => [f[0], cents(f[1], ref)]), ups = [];
    for (let i = 1; i < xs.length; i++) if (xs[i - 1][1] < 0 && xs[i][1] >= 0) ups.push(xs[i - 1][0] + (xs[i][0] - xs[i - 1][0]) * -xs[i - 1][1] / (xs[i][1] - xs[i - 1][1]));
    const per = ups.slice(1).map((u, i) => u - ups[i]), m = per.reduce((a, b) => a + b) / per.length;
    const widths = []; for (let t = 0.3; t < 6.3; t += 0.4) widths.push(swing(tr, ref, t, t + 0.4));
    return { sd: Math.sqrt(per.reduce((a, p) => a + (p - m) ** 2, 0) / per.length), widthRange: Math.max(...widths) - Math.min(...widths) };
  };
  await vibrato(page, { vibDelayAmt: 0, vibFadeAmt: 0, vibNaturalAmt: 0 });
  const machine = await wander();
  await setSlider(page, "vibNaturalAmt", 100);
  const natural = await wander();
  // measured over 16 runs: machine 1.1–4.0 ms (the tracker's own noise), natural 6.4–8.7 ms
  expect(machine.sd).toBeLessThan(0.005);
  expect(natural.sd).toBeGreaterThan(0.0052);
  expect(machine.widthRange).toBeLessThan(2);
  expect(natural.widthRange).toBeGreaterThan(5);
});

test("Voice colour moves the upper harmonics with the vibrato, not the bass (D29)", async ({ page }) => {
  await openOrgan(page);
  await page.click("#midiBtn");
  await toggleStop(page, "Melodia 8′");                                   // Diapason alone: plenty of harmonics
  await vibrato(page, { vibDepthAmt: 40, vibDelayAmt: 0, vibFadeAmt: 0 });
  await page.waitForTimeout(1500);
  const flicker = async () => {
    await midi(page, on(A3)); await page.waitForTimeout(800);
    const r = await measure(page, 1500);
    await midi(page, off(A3)); await page.waitForTimeout(700);
    return r;
  };
  const plain = await flicker();
  await setSlider(page, "vibColourAmt", 100);
  const coloured = await flicker();
  expect(plain.treble).toBeLessThan(3);
  expect(coloured.treble).toBeGreaterThan(plain.treble + 4);
  expect(coloured.bass).toBeLessThan(coloured.treble / 3);
});

test("vibrato and accent settings are remembered (D29)", async ({ page }) => {
  await setup(page);
  await page.locator("#exprPanel summary").click();
  await page.selectOption("#scoopMode", "accent");
  await page.selectOption("#scoopCurve", "snap");
  await page.selectOption("#vibMode", "all");
  for (const [id, v] of [["scoopCrossAmt", 70], ["vibDepthAmt", 30], ["vibRateAmt", 6.2], ["vibFadeAmt", 800], ["vibNaturalAmt", 75], ["vibColourAmt", 10]]) await setSlider(page, id, v);
  await page.click("#vibLearn");
  await midi(page, [0xb0, 20, 64]);                                       // binds CC20
  await midi(page, [0xb0, 20, 64]);                                       // and sets the delay to halfway
  await page.reload();
  expect(await page.locator("#scoopMode").inputValue()).toBe("accent");
  expect(await page.locator("#scoopCurve").inputValue()).toBe("snap");
  expect(await page.locator("#vibMode").inputValue()).toBe("all");
  for (const [id, text] of [["scoopCrossOut", "velocity 70"], ["vibDepthOut", "±30 ¢"], ["vibRateOut", "6.2 Hz"], ["vibDelayOut", "1.25 s"], ["vibFadeOut", "800 ms"], ["vibNaturalOut", "75%"], ["vibColourOut", "10%"], ["vibCC", "MIDI CC20"]]) await expect(page.locator("#" + id)).toHaveText(text);
});

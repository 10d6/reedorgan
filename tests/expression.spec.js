// Expression (D28): the musical scoop and the MIDI pitch and mod wheels. Pitch
// is measured from the speakers by autocorrelation (window.__pitch in organ.js),
// on the Melodia alone with Reed scatter, Pitch drift, Speech glide and Tone
// bloom at zero, so the only pitch movement is the one under test. A scoop is
// tens of cents; "doesn't scoop" allows a few cents of tracker noise at the onset.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, toggleStop, pitchTrace, cents } from "./organ.js";

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

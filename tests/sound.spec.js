// Measured sound. Each test plays a held note with steady wind and checks a
// property recorded in docs/decisions.md, with tolerances wide enough for
// real-time audio on a busy CI machine.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, toggleStop, hold, letGo, rms, centroid, measure, db } from "./organ.js";

// One A3 on the Diapason alone: no beating between ranks, plenty of harmonics.
async function diapasonA3(page) {
  await toggleStop(page, "Melodia 8′");
  await hold(page, "n");
  await page.waitForTimeout(1500);
}
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const avg = async (page, fn, n = 8) => { let s = 0; for (let i = 0; i < n; i++) { s += await fn(page); await page.waitForTimeout(40); } return s / n; };
// average power in a band over 400 ms: 0 = below 400 Hz, 1 = above 2 kHz, 3 = below 160 Hz
const bandPower = (page, k) => page.evaluate((k) => window.__sample(400).then((f) => f.reduce((s, [l, r]) => s + l[k] + r[k], 0) / f.length), k);

test("silent until a key is played, then sounding", async ({ page }) => {
  await openOrgan(page);
  await settle(page);
  expect(await rms(page)).toBeLessThan(1e-4);
  await diapasonA3(page);
  expect(await rms(page)).toBeGreaterThan(0.005);
  await letGo(page, "n");
  await settle(page, 1200);
  expect(await rms(page)).toBeLessThan(1e-3);
});

test("rank Level 50% is 6 dB down, 0% is silent (D4)", async ({ page }) => {
  await openOrgan(page);
  await diapasonA3(page);
  const full = await avg(page, rms);
  await setSlider(page, "lvDiapasonAmt", 50); await settle(page);
  expect(db((await avg(page, rms)) / full)).toBeCloseTo(-6, 0);
  await setSlider(page, "lvDiapasonAmt", 0); await settle(page);
  expect(await avg(page, rms)).toBeLessThan(full * 0.02);
});

test("Brightness changes the tone but not the volume (D4)", async ({ page }) => {
  await openOrgan(page);
  await diapasonA3(page);
  const base = { level: await avg(page, rms), tone: await avg(page, centroid) };
  await setSlider(page, "brDiapasonAmt", 100); await settle(page);
  const bright = { level: await avg(page, rms), tone: await avg(page, centroid) };
  await setSlider(page, "brDiapasonAmt", -100); await settle(page);
  const dark = { level: await avg(page, rms), tone: await avg(page, centroid) };
  expect(bright.tone).toBeGreaterThan(base.tone * 1.2);
  expect(dark.tone).toBeLessThan(base.tone * 0.85);
  expect(Math.abs(db(bright.level / base.level))).toBeLessThan(3.5);
  expect(Math.abs(db(dark.level / base.level))).toBeLessThan(3.5);
});

test("the knee swell opens louder and brighter", async ({ page }) => {
  await openOrgan(page);
  await diapasonA3(page);
  const closed = { level: await avg(page, rms), treble: await bandPower(page, 1) };
  await setSlider(page, "swellAmt", 100); await settle(page, 1200);
  const open = { level: await avg(page, rms), treble: await bandPower(page, 1) };
  expect(db(open.level / closed.level)).toBeGreaterThan(1);
  expect(10 * Math.log10(open.treble / closed.treble)).toBeGreaterThan(4);   // treble rises more than the whole
});

test("Sub octave coupler adds bass", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Sub octave coupler");
  await diapasonA3(page);
  // Power below 160 Hz (the coupled A2's fundamental, 110 Hz; A3 has nothing
  // there) with the coupler drawn, then retired under the held key. Measured
  // below 160 Hz because the coupled note starts at its own phase (D14), so its
  // 2nd harmonic can add to or partly cancel A3's fundamental at 220 Hz.
  const withSub = await bandPower(page, 3);
  await page.getByRole("button", { name: "Sub octave coupler", exact: true }).click();
  await settle(page, 800);
  const without = await bandPower(page, 3);
  expect(10 * Math.log10(withSub / without)).toBeGreaterThan(10);
});

test.describe("Vox Humana fan (D8)", () => {
  test("stopped fan leaves the sound untouched", async ({ page }) => {
    await openOrgan(page);
    await diapasonA3(page);
    const m = await measure(page);
    expect(m.bass).toBeLessThan(0.5);
    expect(m.treble).toBeLessThan(0.5);
  });

  test("default fan flickers the treble and leaves the bass and loudness steady", async ({ page }) => {
    await openOrgan(page);
    await toggleStop(page, "Vox Humana tremolo");
    await diapasonA3(page);
    await settle(page, 1500);                                 // fan spins up
    const m = await measure(page);
    expect(m.bass).toBeLessThan(0.6);
    expect(m.overall).toBeLessThan(0.8);
    expect(m.treble).toBeGreaterThan(3);
    expect(m.treble).toBeLessThan(9);
  });

  test("stereo sweep moves only the upper harmonics", async ({ page }) => {
    await openOrgan(page);
    await setSlider(page, "voxStereoAmt", 100);
    await toggleStop(page, "Vox Humana tremolo");
    await diapasonA3(page);
    await settle(page, 1500);
    const m = await measure(page);
    expect(m.trebleLR).toBeGreaterThan(10);
    expect(m.bassLR).toBeLessThan(0.6);
  });

  test("whole-sound wobble still pulses everything when asked for", async ({ page }) => {
    await openOrgan(page);
    await setSlider(page, "voxShadowAmt", 0);
    await setSlider(page, "voxShimmerAmt", 0);
    await setSlider(page, "voxWholeAmt", 22);
    await toggleStop(page, "Vox Humana tremolo");
    await diapasonA3(page);
    await settle(page, 1500);
    const m = await measure(page);
    expect(m.bass).toBeGreaterThan(2);
  });

  test("retired fan coasts to a stop", async ({ page }) => {
    await openOrgan(page);
    await toggleStop(page, "Vox Humana tremolo");
    await diapasonA3(page);
    await settle(page, 1500);
    await page.getByRole("button", { name: "Vox Humana tremolo", exact: true }).click();
    await hold(page, "n");
    expect((await measure(page, 500)).treble).toBeGreaterThan(1);   // still turning
    await settle(page, 5000);
    expect((await measure(page, 800)).treble).toBeLessThan(0.5);   // stopped
  });
});

test("full wind reads flat on the pitch readout, like a free reed (D12)", async ({ page }) => {
  await openOrgan(page);            // helper at 100% holds the wind near the top of the gauge
  await hold(page, "y");
  await page.waitForTimeout(2500);
  const text = await page.locator("#rPitch").textContent();
  expect(text).toMatch(/^−\d+ ¢$/);
});

// The opening stops on A4 with the default reed set (seed 1): the two 8′ ranks are
// about 0.8 ¢ apart there, a 2.9 s beat when they're left to beat freely.
test("Unison pull holds Diapason and Melodia in step; Off lets them beat (D14)", async ({ page }) => {
  await openOrgan(page);
  await hold(page, "y");
  await page.waitForTimeout(1200);
  const locked = await measure(page, 3000);
  await letGo(page, "y");
  await setSlider(page, "pullAmt", 0);
  await hold(page, "y");
  await page.waitForTimeout(1200);
  const free = await measure(page, 3000);
  expect(locked.overall).toBeLessThan(1);
  expect(free.overall).toBeGreaterThan(3);
});

// Samples level and spectral centroid every few ms from just before a key goes
// down, and returns them with times relative to the first sound.
async function onset(page, key, ms = 500) {
  await page.evaluate(() => { window.__on = []; window.__oi = setInterval(() => window.__on.push([performance.now(), window.__rms(), window.__centroid()]), 4); });
  await page.waitForTimeout(80);
  await hold(page, key);
  await page.waitForTimeout(ms);
  const f = await page.evaluate(() => { clearInterval(window.__oi); return window.__on; });
  await letGo(page, key);
  await page.waitForTimeout(600);
  const final = f.slice(-20).reduce((s, x) => s + x[1], 0) / 20;
  const start = f.findIndex((x) => x[1] > final * 0.02);
  return f.slice(start).map(([t, r, c]) => ({ t: t - f[start][0], r: r / final, c }));
}
const timeTo = (fr, level) => fr.find((x) => x.r >= level).t;

test("low reeds speak more slowly than high ones (D16)", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Melodia 8′");          // Diapason alone
  await page.waitForTimeout(1500);               // let the reservoir fill
  const low = await onset(page, "z", 700), high = await onset(page, "i", 700);   // C3, C5
  const lowT = timeTo(low, 0.9), highT = timeTo(high, 0.9);
  expect(lowT).toBeGreaterThan(highT * 1.8);
});

test("notes start dark and brighten as the reed speaks; Tone bloom Off doesn't (D17)", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Melodia 8′");
  await page.waitForTimeout(1500);
  const early = (fr) => fr.filter((x) => x.r >= 0.15 && x.r <= 0.5).map((x) => x.c);
  const steady = (fr) => fr.slice(-20).reduce((s, x) => s + x.c, 0) / 20;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const bloom = await onset(page, "z", 700);
  await setSlider(page, "bloomAmt", 0);
  const flat = await onset(page, "z", 700);
  expect(mean(early(bloom))).toBeLessThan(steady(bloom) * 0.85);
  expect(mean(early(flat))).toBeGreaterThan(steady(flat) * 0.9);
});

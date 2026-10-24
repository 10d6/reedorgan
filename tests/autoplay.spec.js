// Pedal autoplay (D22): defaults, rhythm, wind, editing and saving.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, hold, letGo, readout } from "./organ.js";

const beats = (page) => page.locator("#autoGrid .beat");
const values = (page) => beats(page).evaluateAll((els) => els.map((e) => e.dataset.v));

// Samples which treadles are in a stroke and where the playhead is, every 15 ms.
async function watch(page, ms) {
  return page.evaluate((ms) => new Promise((done) => {
    const out = [], t0 = performance.now();
    const iv = setInterval(() => {
      const now = document.querySelector("#autoGrid .beat.now");
      // a stroke shows as attack then decay (about 0.36 s); readouts refresh at 10 Hz
      const stroke = (id) => /^(attack|decay)/.test(document.getElementById(id).textContent);
      out.push({ t: performance.now() - t0, L: stroke("flowL"), R: stroke("flowR"), i: now ? +now.dataset.i : -1 });
    }, 15);
    setTimeout(() => { clearInterval(iv); done(out); }, ms);
  }), ms);
}
const onsets = (frames, side) => frames.filter((f, k) => f[side] && !(k && frames[k - 1][side])).map((f) => f.t);

test("defaults: on, one bar of 4/4 at 100 bpm, R and L quarter notes then a half rest; helper 2%", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#autoOn")).toBeChecked();
  await expect(page.locator("#tempoOut")).toHaveText("100 bpm");
  await expect(page.locator("#meter")).toHaveValue("4/4");
  await expect(page.locator("#measures")).toHaveValue("1");
  expect(await values(page)).toEqual(["R", "L", "-", "-"]);
  await expect(page.locator("#helperOut")).toHaveText("2% · 0.01/s");
  await expect(beats(page).first()).toHaveAttribute("aria-label", "Measure 1, beat 1: Right");
});

test("waits for the first note, then pumps right, left, rest on the beat", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await page.waitForTimeout(800);
  await expect(page.locator("#flowR")).toHaveText("idle");          // no sound allowed yet, so no pumping
  await hold(page, "q");
  const f = await watch(page, 5200);
  await letGo(page, "q");
  const R = onsets(f, "R"), L = onsets(f, "L");
  expect(R.length).toBeGreaterThanOrEqual(2);
  expect(L.length).toBeGreaterThanOrEqual(2);
  expect(L[0] - R[0]).toBeGreaterThan(450); expect(L[0] - R[0]).toBeLessThan(750);   // 0.6 s: one beat
  expect(R[1] - R[0]).toBeGreaterThan(2250); expect(R[1] - R[0]).toBeLessThan(2550); // 2.4 s: one bar
  expect(new Set(f.map((x) => x.i).filter((i) => i >= 0))).toEqual(new Set([0, 1, 2, 3]));   // the playhead visits every beat
  await expect(page.locator("#status")).toHaveText("Autoplay pumping");
});

test("autoplay alone keeps the wind up for a single note; off, it runs down", async ({ page }) => {
  await openOrgan(page);                                          // quiet: autoplay off, helper 100%
  await setSlider(page, "helper", 0);
  await setSlider(page, "resAmt", 0);                             // smallest reservoir: changes fast
  await page.locator("#autoOn").check();
  await hold(page, "q");
  await page.waitForTimeout(8000);
  expect(parseFloat(await readout(page, "rWind"))).toBeGreaterThan(1);
  await page.locator("#autoOn").uncheck();
  await expect.poll(async () => parseFloat(await readout(page, "rWind")), { timeout: 15000 }).toBeLessThan(0.3);
  await expect(page.locator("#flowL")).toHaveText("idle");
  await expect(page.locator("#flowR")).toHaveText("idle");
  await expect(page.locator("#autoGrid .beat.now")).toHaveCount(0);
  await letGo(page, "q");
});

test("editing the pattern, meter and measures, and it's remembered", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await beats(page).nth(2).click();                               // rest → left
  await beats(page).nth(3).click(); await beats(page).nth(3).click(); await beats(page).nth(3).click();   // rest → L → R → tie
  expect(await values(page)).toEqual(["R", "L", "L", "~"]);
  await expect(beats(page).nth(3)).toHaveAttribute("aria-label", "Measure 1, beat 4: Tie");
  await page.selectOption("#meter", "3/4");
  expect(await values(page)).toEqual(["R", "L", "L"]);
  await page.selectOption("#measures", "2");
  expect(await values(page)).toEqual(["R", "L", "L", "-", "-", "-"]);
  await expect(page.locator("#autoGrid .measure")).toHaveCount(2);
  await page.selectOption("#meter", "6/8");
  await expect(beats(page)).toHaveCount(12);
  await setSlider(page, "tempoAmt", 72);
  await page.locator("#autoOn").uncheck();
  await page.reload();
  await expect(page.locator("#meter")).toHaveValue("6/8");
  await expect(page.locator("#measures")).toHaveValue("2");
  await expect(page.locator("#tempoOut")).toHaveText("72 bpm");
  await expect(page.locator("#autoOn")).not.toBeChecked();
  expect((await values(page)).slice(0, 3)).toEqual(["R", "L", "L"]);
});

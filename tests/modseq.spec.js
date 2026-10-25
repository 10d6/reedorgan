// The modulation sequencer (D30): its piano roll, and how it moves Direct wind.
// The wind is read from the gauge's needle every frame (window.__gaugeTrace in
// organ.js). Patterns run at 120 bpm, so one bar is 2 s and a 16th is 125 ms.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, gaugeTrace, readout } from "./organ.js";

const A3 = 57, C4 = 60;
const on = (m) => [0x90, m, 100], off = (m) => [0x80, m, 0];
const midi = (page, ...msgs) => page.evaluate((ms) => ms.forEach(([a, b, c]) => window.__midi(a, b, c)), msgs);
const notes = (page) => page.$$eval("#seqGrid .seq-note", (els) => els.map((e) => e.getAttribute("aria-label")));
const cell = (page, row, step) => page.locator(`#seqGrid .seq-cell[data-row="${row}"][data-step="${step}"]`);
const at = (trace, t) => trace.find((f) => f[0] >= t)[1];
const between = (trace, t0, t1) => trace.filter((f) => f[0] >= t0 && f[0] < t1).map((f) => f[1]);

async function setup(page) {
  await openOrgan(page);
  await page.click("#midiBtn");
  await page.locator("#seqPanel summary").click();
  await setSlider(page, "tempoAmt", 120);
}
async function pattern(page, list) {
  await page.click("#seqClear");
  for (const [row, start, len] of list) {
    await cell(page, row, start).click();
    for (let k = 1; k < len; k++) await page.keyboard.press("Shift+ArrowRight");
  }
}

test("the sequencer is off by default and leaves Direct wind alone (D30)", async ({ page }) => {
  await openOrgan(page);
  await expect(page.locator("#seqOn")).not.toBeChecked();
  await expect(page.locator("#seqPanel")).not.toHaveAttribute("open", "");
  await expect(page.locator("#directOn")).not.toBeChecked();
  expect(await page.locator("#seqTrigger").inputValue()).toBe("first");
  expect(await page.locator("#seqBars").inputValue()).toBe("1");
  await expect(page.locator("#seqAmountOut")).toHaveText("25% · 0.9″");
  expect(await notes(page)).toEqual(["Sweep up, S-curve, 8 sixteenths from bar 1, beat 1, 16th 1", "Sweep down, S-curve, 8 sixteenths from bar 1, beat 3, 16th 1"]);
});

test("turning the sequencer on turns Direct wind on (D30)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await expect(page.locator("#directOn")).toBeChecked();
  await expect(page.locator("#airAmt")).toBeEnabled();
  await page.reload();
  await expect(page.locator("#seqOn")).toBeChecked();
  await expect(page.locator("#directOn")).toBeChecked();
});

test("the default pattern swells the wind up and back each bar, from the Direct wind setting (D30)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await setSlider(page, "airAmt", 10);                       // 1.0″
  await page.waitForTimeout(400);
  const tr = await gaugeTrace(page, 4600, [on(A3)]);
  expect(at(tr, 0.02)).toBeCloseTo(1.0, 1);
  expect(at(tr, 1.0)).toBeCloseTo(1.9, 1);                   // Amount 25% is 0.9″
  expect(at(tr, 2.0)).toBeCloseTo(1.0, 1);
  expect(at(tr, 3.0)).toBeCloseTo(1.9, 1);                   // it loops while the key is held
  expect(Math.max(...between(tr, 0, 4.6))).toBeLessThan(1.95);
  await expect(page.locator("#status")).toHaveText("Sequencer moving the wind");
  // letting go stops it, and the wind eases back to its setting
  const after = await gaugeTrace(page, 1500, [off(A3)]);
  expect(between(after, 0.5, 1.5).every((v) => Math.abs(v - 1.0) < 0.03)).toBe(true);
  await expect(page.locator("#status")).toHaveText("Direct wind");
});

test("each note builds on the last, holds between notes, and sweeps stop at the limits (D30)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await setSlider(page, "airAmt", 30);                       // 3.0″
  // up 4 sixteenths (would reach 3.9″: stops at 3.6″), a gap, then down 4
  await pattern(page, [["up-linear", 0, 4], ["down-linear", 8, 4]]);
  expect(await notes(page)).toHaveLength(2);
  await page.waitForTimeout(400);
  const tr = await gaugeTrace(page, 1900, [on(A3)]);
  await midi(page, off(A3));
  expect(at(tr, 0.25)).toBeCloseTo(3.45, 1);                 // halfway up: 0.45″ of the 0.9″
  expect(Math.max(...between(tr, 0.5, 1))).toBeLessThan(3.62);
  expect(Math.min(...between(tr, 0.55, 0.98))).toBeGreaterThan(3.55);   // held at the top through the gap
  expect(at(tr, 1.6)).toBeCloseTo(2.7, 1);                   // down 0.9″ from the top, not from 3.9″
});

test("First note starts once per phrase; Each note restarts on every key (D30)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await setSlider(page, "airAmt", 10);
  await setSlider(page, "seqAmountAmt", 50);                 // 1.8″ over the bar
  await pattern(page, [["up-linear", 0, 16]]);
  await page.waitForTimeout(400);
  const first = await gaugeTrace(page, 1100, [on(A3)]);
  const more = await gaugeTrace(page, 500, [on(C4)]);         // a second key 1.1 s in
  await midi(page, off(A3), off(C4)); await page.waitForTimeout(600);
  expect(at(first, 1.0)).toBeCloseTo(1.9, 1);
  expect(at(more, 0.4)).toBeCloseTo(2.35, 1);                // still climbing, 1.5 s into the bar
  await page.selectOption("#seqTrigger", "each");
  const first2 = await gaugeTrace(page, 1100, [on(A3)]);
  const again = await gaugeTrace(page, 500, [on(C4)]);
  await midi(page, off(A3), off(C4));
  expect(at(first2, 1.0)).toBeCloseTo(1.9, 1);
  expect(at(again, 0.4)).toBeCloseTo(1.36, 1);               // started again: 0.4 s into the bar
});

test("the piano roll: place, replace, stretch, shorten, delete, clear and length (D30)", async ({ page }) => {
  await setup(page);
  await page.click("#seqClear");
  expect(await notes(page)).toEqual([]);
  await cell(page, "up-fast", 4).click();
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 1 sixteenth from bar 1, beat 2, 16th 1"]);
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 4 sixteenths from bar 1, beat 1, 16th 4"]);
  await page.keyboard.press("Alt+ArrowLeft");                // shorten from the end
  await page.keyboard.press("Alt+ArrowRight");               // and from the start
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 2 sixteenths from bar 1, beat 2, 16th 1"]);
  // drag the end handle forwards to beat 3
  await page.locator("#seqGrid .seq-note").click();
  const end = await page.locator("#seqGrid .seq-note .seq-handle.end").boundingBox();
  const target = await cell(page, "up-fast", 8).boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x + 2, target.y + 8, { steps: 6 }); await page.mouse.up();
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 4 sixteenths from bar 1, beat 2, 16th 1"]);
  // a note on another row over the same time replaces it
  await cell(page, "down-s", 6).click();
  expect(await notes(page)).toEqual(["Sweep down, S-curve, 1 sixteenth from bar 1, beat 2, 16th 3"]);
  // Backspace removes it, and doesn't play a note or pump a treadle
  await page.keyboard.press("Backspace");
  expect(await notes(page)).toEqual([]);
  expect(await readout(page, "rReeds")).toBe("0");
  // two bars, then back to one keeps what fits
  await page.selectOption("#seqBars", "2");
  expect(await page.locator("#seqGrid .seq-cell").count()).toBe(8 * 32);
  await cell(page, "up-s", 12).click();
  for (let k = 0; k < 7; k++) await page.keyboard.press("Shift+ArrowRight");
  await cell(page, "down-s", 24).click();
  expect(await notes(page)).toHaveLength(2);
  await page.selectOption("#seqBars", "1");
  expect(await notes(page)).toEqual(["Sweep up, S-curve, 4 sixteenths from bar 1, beat 4, 16th 1"]);
  await page.reload();
  expect(await notes(page)).toEqual(["Sweep up, S-curve, 4 sixteenths from bar 1, beat 4, 16th 1"]);
});

test("keys on a selected note stay out of the organ; other keys still play (D30)", async ({ page }) => {
  await setup(page);
  await page.locator("#seqGrid .seq-note").first().click();
  await page.keyboard.down("Shift"); await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(200);
  await expect(page.locator("#flowR")).toHaveText("idle");    // the right treadle didn't move
  await page.keyboard.up("ArrowRight"); await page.keyboard.up("Shift");
  await page.keyboard.down("n");                              // A3 still plays with a note selected
  await expect(page.locator('#keys .key[data-midi="57"]')).toHaveClass(/down/);
  await page.keyboard.up("n");
});

test("the sequencer only moves the wind while Direct wind is on (D30)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await page.uncheck("#directOn");
  await page.waitForTimeout(800);
  const tr = await gaugeTrace(page, 1200, [on(A3)]);         // helper pump at 100% holds the wind steady
  await midi(page, off(A3));
  const v = between(tr, 0.3, 1.2);
  expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.2);
  await expect(page.locator("#status")).not.toHaveText("Sequencer moving the wind");
});

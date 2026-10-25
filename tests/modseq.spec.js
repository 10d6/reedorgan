// The modulation sequencer (D30–D32): its lanes and piano roll, how it pumps the
// treadles (in place of Pedal autoplay), and how it moves Direct wind, the Vox
// Humana fan's speed and the knee swell.
// The wind is read from the gauge's needle every frame (window.__gaugeTrace in
// organ.js). Patterns run at 120 bpm, so one bar is 2 s and a 16th is 125 ms.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, gaugeTrace, readout, toggleStop, rms, db, hold, letGo, stopPumping } from "./organ.js";

const A3 = 57, C4 = 60;
const on = (m) => [0x90, m, 100], off = (m) => [0x80, m, 0];
const midi = (page, ...msgs) => page.evaluate((ms) => ms.forEach(([a, b, c]) => window.__midi(a, b, c)), msgs);
const notes = (page) => page.$$eval("#seqGrid .seq-note", (els) => els.map((e) => e.getAttribute("aria-label")));
const cell = (page, row, step) => page.locator(`#seqGrid .seq-cell[data-row="${row}"][data-step="${step}"]`);
const at = (trace, t) => trace.find((f) => f[0] >= t)[1];
const between = (trace, t0, t1) => trace.filter((f) => f[0] >= t0 && f[0] < t1).map((f) => f[1]);

// Shows a lane's pattern in the editor: left, right, direct, fan or swell.
const showLane = (page, id) => page.click(`#seqLanes .seq-tab[data-lane="${id}"]`);
// Shows a lane and turns it on.
async function playLane(page, id) { await showLane(page, id); await page.check("#seqOn"); }
// The quiet setup turns the treadle patterns off; most tests then show one lane.
async function setup(page, lane = "direct") {
  await openOrgan(page);
  await page.click("#midiBtn");
  await setSlider(page, "tempoAmt", 120);
  await showLane(page, lane);
}
async function pattern(page, list) {
  await page.click("#seqClear");
  for (const [row, start, len] of list) {
    await cell(page, row, start).click();
    for (let k = 1; k < len; k++) await page.keyboard.press("Shift+ArrowRight");
  }
}

test("the sequencer's other patterns are off by default and leave Direct wind alone (D30, D32)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#directOn")).not.toBeChecked();
  for (const id of ["direct", "fan", "swell"]) await expect(page.locator(`#seqLanes .seq-tab[data-lane="${id}"]`)).not.toHaveClass(/\bon\b/);
  await showLane(page, "direct");
  await expect(page.locator("#seqOn")).not.toBeChecked();
  await expect(page.locator("#seqAmountOut")).toHaveText("25% · 0.9″");
  expect(await notes(page)).toEqual(["Sweep up, S-curve, 8 sixteenths from bar 1, beat 1, 16th 1", "Sweep down, S-curve, 8 sixteenths from bar 1, beat 3, 16th 1"]);
});

test("turning on the Direct wind pattern turns Direct wind on; turning on a treadle pattern turns it off (D30, D32)", async ({ page }) => {
  await setup(page);
  await page.check("#seqOn");
  await expect(page.locator("#directOn")).toBeChecked();
  await expect(page.locator("#airAmt")).toBeEnabled();
  await page.reload();
  await showLane(page, "direct");
  await expect(page.locator("#seqOn")).toBeChecked();
  await expect(page.locator("#directOn")).toBeChecked();
  await playLane(page, "left");
  await expect(page.locator("#directOn")).not.toBeChecked();
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
  // still climbing, about 1.5 s into the bar (2.35″); a restart would read about 1.36″.
  // Ranges, not exact values: the second call starts a few tens of ms after the first ends.
  expect(at(more, 0.4)).toBeGreaterThan(2.2); expect(at(more, 0.4)).toBeLessThan(2.6);
  await page.selectOption("#seqTrigger", "each");
  const first2 = await gaugeTrace(page, 1100, [on(A3)]);
  const again = await gaugeTrace(page, 500, [on(C4)]);
  await midi(page, off(A3), off(C4));
  expect(at(first2, 1.0)).toBeCloseTo(1.9, 1);
  expect(at(again, 0.4)).toBeGreaterThan(1.25); expect(at(again, 0.4)).toBeLessThan(1.55);   // started again: 0.4 s into the bar
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
  await setup(page, "right");                                 // a treadle pattern, turned off by the quiet setup
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

/* ---------- D31: the fan and the swell ---------- */
// How fast the treble flickers (the fan's blade passes), from the speakers' upper
// band sampled every 8 ms: crossings of its median level, between t0 and t1 s.
function flickerHz(frames, t0, t1) {
  const v = frames.slice(Math.round(t0 / 0.008), Math.round(t1 / 0.008)).map(([l, r]) => 10 * Math.log10(l[1] + r[1]));
  const m = [...v].sort((a, b) => a - b)[v.length >> 1];
  let c = 0; for (let i = 1; i < v.length; i++) if ((v[i - 1] < m) !== (v[i] < m)) c++;
  return c / 2 / (t1 - t0);
}
const avgRms = async (page, n = 8) => { let s = 0; for (let i = 0; i < n; i++) { s += await rms(page); await page.waitForTimeout(60); } return s / n; };
const fanSpeed = (page, v) => page.$eval("#voxRate", (el, x) => { el.value = x; el.dispatchEvent(new Event("input", { bubbles: true })); }, v);

test("turning on the fan pattern draws the Vox Humana; the swell needs nothing (D31, D32)", async ({ page }) => {
  await setup(page, "fan");
  await expect(page.locator("#seqLanes .seq-tab")).toHaveText(["Left treadle", "Right treadle", "Direct wind", "Fan speed", "Knee swell"]);
  await expect(page.getByRole("button", { name: "Vox Humana tremolo" })).toHaveAttribute("aria-pressed", "false");   // showing it changes nothing
  await expect(page.locator("#seqAmountOut")).toHaveText("25% · 2.8 Hz");
  await page.check("#seqOn");
  await expect(page.getByRole("button", { name: "Vox Humana tremolo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#voxPanel")).toHaveAttribute("open", "");
  await expect(page.locator("#directOn")).not.toBeChecked();
  await expect(page.locator('#seqLanes .seq-tab[data-lane="fan"]')).toHaveClass(/\bon\b/);
  await playLane(page, "swell");
  await expect(page.locator("#seqAmountOut")).toHaveText("25% of the swell");
  await expect(page.locator("#directOn")).not.toBeChecked();
  await page.reload();
  await showLane(page, "fan");
  await expect(page.locator("#seqOn")).toBeChecked();
  await expect(page.locator("#seqAmountOut")).toHaveText("25% · 2.8 Hz");
});

test("the sequencer drives the fan's speed, then lets it ease back to its slider (D31)", async ({ page }) => {
  await setup(page);
  await toggleStop(page, "Melodia 8′");                          // Diapason alone: plenty of treble for the fan
  await fanSpeed(page, 3);
  await playLane(page, "fan");                                    // draws the Vox Humana
  await setSlider(page, "seqAmountAmt", 50);                      // 5.5 Hz
  await page.click("#seqClear");
  await cell(page, "up-linear", 0).click();                      // straight up in one 16th, then hold
  await page.waitForTimeout(2500);                                // the fan spins up to 3 Hz
  await midi(page, on(A3));
  const playing = await page.evaluate(() => window.__sample(2000));
  await midi(page, off(A3));
  await page.waitForTimeout(3000);                                // the fan coasts back to its slider
  await page.uncheck("#seqOn");
  await midi(page, on(A3));
  const plain = await page.evaluate(() => window.__sample(2000));
  await midi(page, off(A3));
  expect(flickerHz(playing, 0.3, 1.9)).toBeGreaterThan(7.8);      // 3 + 5.5 = 8.5 Hz
  expect(flickerHz(playing, 0.3, 1.9)).toBeLessThan(9.2);
  expect(flickerHz(plain, 0.3, 1.9)).toBeGreaterThan(2.5);        // its own 3 Hz
  expect(flickerHz(plain, 0.3, 1.9)).toBeLessThan(3.6);
  expect(await page.locator("#voxOut").textContent()).toBe("3.0 Hz");   // the slider didn't move
});

test("the sequencer opens the knee swell without moving its slider, and lets it close again (D31)", async ({ page }) => {
  await setup(page, "swell");
  await toggleStop(page, "Melodia 8′");
  await setSlider(page, "seqAmountAmt", 100);
  await page.click("#seqClear");
  await cell(page, "up-linear", 0).click();                      // fully open in one 16th, then hold
  await midi(page, on(A3)); await page.waitForTimeout(900);
  const closed = await avgRms(page);
  await midi(page, off(A3)); await page.waitForTimeout(700);
  await page.check("#seqOn");
  await midi(page, on(A3)); await page.waitForTimeout(900);
  const open = await avgRms(page);
  await midi(page, off(A3)); await page.waitForTimeout(900);
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await page.uncheck("#seqOn");
  await midi(page, on(A3)); await page.waitForTimeout(900);
  const after = await avgRms(page);
  await midi(page, off(A3));
  expect(db(open / closed)).toBeGreaterThan(4.5);                 // fully open is about 6 dB louder (D21)
  expect(db(open / closed)).toBeLessThan(7.5);
  expect(Math.abs(db(after / closed))).toBeLessThan(1);           // and it closed again
});

test("the fan only follows the sequencer while the Vox Humana is drawn (D31)", async ({ page }) => {
  await setup(page, "fan");
  await page.check("#seqOn");
  await toggleStop(page, "Vox Humana tremolo");                    // retire it again
  await midi(page, on(A3)); await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: "Vox Humana tremolo" })).toHaveAttribute("aria-pressed", "false");   // playing doesn't redraw it
  await expect(page.locator("#seqGrid .seq-play")).toBeHidden();
  await midi(page, off(A3));
});

/* ---------- D32: the treadle patterns pump the organ ---------- */
// Each pedal's position every frame, from how far it's drawn tilted (24° fully down).
const pedalTrace = (page, ms) => page.evaluate((ms) => new Promise((done) => {
  const out = [], t0 = performance.now(), deg = (id) => +(/rotateX\(([-\d.]+)deg/.exec(document.getElementById(id).style.transform) || [0, 0])[1];
  const f = () => { out.push([(performance.now() - t0) / 1000, deg("tL") / 24, deg("tR") / 24]); if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(out); };
  requestAnimationFrame(f);
}), ms);
// when each pedal starts a stroke (leaves the top); k is 1 for left, 2 for right
const strokes = (trace, k) => trace.filter((f, i) => i && f[k] > 0.1 && trace[i - 1][k] <= 0.1).map((f) => f[0]);

test("out of the box the treadle patterns pump: right then left a beat apart, every bar, from the first touch (D32)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#tempoOut")).toHaveText("100 bpm");
  expect(await page.locator("#seqMeter").inputValue()).toBe("4/4");
  expect(await page.locator("#seqBars").inputValue()).toBe("1");
  expect(await page.locator("#seqTrigger").inputValue()).toBe("first");
  await expect(page.locator("#helperOut")).toHaveText("2% · 0.01/s");
  for (const id of ["left", "right"]) await expect(page.locator(`#seqLanes .seq-tab[data-lane="${id}"]`)).toHaveClass(/\bon\b/);
  await expect(page.locator('#seqLanes .seq-tab[data-lane="left"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#seqAmountOut")).toHaveText("100% of a stroke");
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 1 sixteenth from bar 1, beat 2, 16th 1", "Sweep down, Fast start, 2 sixteenths from bar 1, beat 2, 16th 2"]);
  await showLane(page, "right");
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 1 sixteenth from bar 1, beat 1, 16th 1", "Sweep down, Fast start, 2 sixteenths from bar 1, beat 1, 16th 2"]);
  // nothing moves until the first touch (browsers allow no sound before one)
  const before = await pedalTrace(page, 800);
  expect(Math.max(...before.map((f) => Math.max(f[1], f[2])))).toBe(0);
  await hold(page, "q");
  const tr = await pedalTrace(page, 5300);
  await letGo(page, "q");
  const R = strokes(tr, 2), L = strokes(tr, 1);
  expect(R.length).toBeGreaterThanOrEqual(2);
  expect(L.length).toBeGreaterThanOrEqual(2);
  expect(R[1] - R[0]).toBeCloseTo(2.4, 1);                    // one bar at 100 bpm
  const gap = L.find((t) => t > R[0]) - R[0];
  expect(gap).toBeGreaterThan(0.5); expect(gap).toBeLessThan(0.7);   // left a beat (0.6 s) after right
  await expect(page.locator("#status")).toHaveText("Sequencer pumping");
  // it keeps pumping between phrases
  const after = await pedalTrace(page, 2600);
  expect(strokes(after, 2).length).toBeGreaterThanOrEqual(1);
});

test("the treadle patterns hold the wind up for one note; turned off, a chord runs out (D32)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await hold(page, "q");
  await page.waitForTimeout(8000);
  const held = await gaugeTrace(page, 4000);
  await letGo(page, "q");
  const v = held.map((f) => f[1]), mean = v.reduce((a, b) => a + b) / v.length;
  expect(mean).toBeGreaterThan(3.0);                          // about 3.5″ (D22)
  await stopPumping(page);
  await hold(page, "q", "e", "t");                            // a three-note chord on the helper pump alone
  await page.waitForTimeout(6000);
  const out = await gaugeTrace(page, 500);
  await letGo(page, "q", "e", "t");
  expect(Math.max(...out.map((f) => f[1]))).toBeLessThan(1.0);
});

test("time signatures and bars: the grid follows them, and each bar keeps its notes (D32)", async ({ page }) => {
  await setup(page, "right");
  await expect(page.locator("#seqBars option")).toHaveText(["1 bar", "2 bars", "3 bars", "4 bars"]);
  await page.selectOption("#seqBars", "2");
  await cell(page, "up-linear", 17).click();                  // 4/4: bar 2, beat 1, its 2nd 16th
  expect((await notes(page))[2]).toBe("Sweep up, Linear, 1 sixteenth from bar 2, beat 1, 16th 2");
  await page.selectOption("#seqMeter", "3/4");                // the note keeps its place in bar 2
  expect(await page.locator("#seqGrid .seq-cell").count()).toBe(8 * 24);
  await expect(page.locator("#seqGrid .seq-beat")).toHaveText(["1.1", "2", "3", "2.1", "2", "3"]);
  expect((await notes(page))[2]).toBe("Sweep up, Linear, 1 sixteenth from bar 2, beat 1, 16th 2");
  await page.selectOption("#seqMeter", "6/8");                // eighth-note beats: two 16ths each
  await expect(page.locator("#seqGrid .seq-beat")).toHaveText(["1.1", "2", "3", "4", "5", "6", "2.1", "2", "3", "4", "5", "6"]);
  expect((await notes(page))[2]).toBe("Sweep up, Linear, 1 sixteenth from bar 2, beat 1, 16th 2");
  await page.selectOption("#seqBars", "1");                   // one bar keeps what fits
  expect(await notes(page)).toHaveLength(2);
  expect(await page.locator("#seqGrid .seq-cell").count()).toBe(8 * 12);
  await page.reload();
  expect(await page.locator("#seqMeter").inputValue()).toBe("6/8");
  expect(await page.locator("#seqBars").inputValue()).toBe("1");
});

test("a saved autoplay pattern and tempo become the treadle patterns, and an old sequencer pattern its lane (D32)", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("reed-seq")) return;
    localStorage.setItem("reed-autoplay", JSON.stringify({ on: true, meter: "3/4", measures: 2, cells: ["R", "~", "L", "R", "-", "-"] }));
    localStorage.setItem("reed-autoTempo", "80");
    localStorage.setItem("reed-modseq", JSON.stringify({ on: true, target: "fan", bars: 1, trigger: "each", notes: [{ row: "up-s", start: 2, len: 4 }] }));
    localStorage.setItem("reed-seqAmount", "40");
  });
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#tempoOut")).toHaveText("80 bpm");
  expect(await page.locator("#seqMeter").inputValue()).toBe("3/4");
  expect(await page.locator("#seqBars").inputValue()).toBe("2");
  expect(await page.locator("#seqTrigger").inputValue()).toBe("each");
  await showLane(page, "right");
  expect(await notes(page)).toEqual([
    "Sweep up, Fast start, 2 sixteenths from bar 1, beat 1, 16th 1", "Sweep down, Fast start, 5 sixteenths from bar 1, beat 1, 16th 3",   // a tied, slower stroke
    "Sweep up, Fast start, 1 sixteenth from bar 2, beat 1, 16th 1", "Sweep down, Fast start, 2 sixteenths from bar 2, beat 1, 16th 2",
  ]);
  await showLane(page, "left");
  expect(await notes(page)).toEqual(["Sweep up, Fast start, 1 sixteenth from bar 1, beat 3, 16th 1", "Sweep down, Fast start, 2 sixteenths from bar 1, beat 3, 16th 2"]);
  await showLane(page, "fan");
  await expect(page.locator("#seqOn")).toBeChecked();
  await expect(page.locator("#seqAmountOut")).toHaveText("40% · 4.4 Hz");
  expect(await notes(page)).toEqual(["Sweep up, S-curve, 4 sixteenths from bar 1, beat 1, 16th 3"]);
});

test("the treadle patterns rest while Direct wind is on and pump again when it's off (D32)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await hold(page, "q"); await page.waitForTimeout(300); await letGo(page, "q");
  await page.check("#directOn");
  const resting = await pedalTrace(page, 2600);
  expect(Math.max(...resting.slice(10).map((f) => Math.max(f[1], f[2])))).toBe(0);
  await page.uncheck("#directOn");
  const pumping = await pedalTrace(page, 2600);
  expect(strokes(pumping, 2).length + strokes(pumping, 1).length).toBeGreaterThanOrEqual(1);
});

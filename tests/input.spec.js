// Playing with the mouse, the computer keyboard, the treadles and a MIDI keyboard.
import { test, expect } from "@playwright/test";
import { openOrgan, hold, letGo, keysDown, readout, focusKeys, setSlider, rms, toggleStop } from "./organ.js";

test("clicking and dragging across keys plays them in turn", async ({ page }) => {
  await openOrgan(page);
  const key = (m) => page.locator(`#keys [data-midi="${m}"]`);
  await key(60).scrollIntoViewIfNeeded();
  const a = await key(60).boundingBox(), b = await key(62).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height * 0.85);
  await page.mouse.down();
  expect(await keysDown(page)).toEqual([60]);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.85, { steps: 4 });
  expect(await keysDown(page)).toEqual([62]);
  await page.mouse.up();
  expect(await keysDown(page)).toEqual([]);
});

test("computer keys map to the keyboard rows", async ({ page }) => {
  await openOrgan(page);
  await hold(page, "z", "s", "q", "2", "i");
  expect(await keysDown(page)).toEqual([48, 49, 60, 61, 72]);
  await letGo(page, "z", "s", "q", "2", "i");
  expect(await keysDown(page)).toEqual([]);
});

test("treadles fill the reservoir and the wind runs out without them", async ({ page }) => {
  await openOrgan(page);
  await setSlider(page, "helper", 0);
  await setSlider(page, "resAmt", 0);                          // smallest reservoir: drains fast
  await hold(page, "z", "q", "e", "t");
  await expect.poll(async () => parseFloat(await readout(page, "rWind")), { timeout: 15000 }).toBeLessThan(0.15);
  await expect(page.locator("#status")).toHaveText("Out of wind. Pump!");
  for (let i = 0; i < 6; i++) {                                 // alternate feet
    const k = i % 2 ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.down(k); await page.waitForTimeout(150); await page.keyboard.up(k);
  }
  await expect.poll(async () => parseFloat(await readout(page, "rWind")), { timeout: 3000 }).toBeGreaterThan(1);
  await letGo(page, "z", "q", "e", "t");
});

test("MIDI notes, sustain pedal, expression pedal and all-notes-off", async ({ page }) => {
  await openOrgan(page);
  await page.click("#midiBtn");
  await expect(page.locator("#midiStatus")).toHaveText("Listening to Test Keyboard");
  const midi = (a, b, c) => page.evaluate(([a, b, c]) => window.__midi(a, b, c), [a, b, c]);

  await midi(0x90, 60, 100); await midi(0x90, 64, 90);
  expect(await keysDown(page)).toEqual([60, 64]);
  await midi(0x80, 64, 0);
  expect(await keysDown(page)).toEqual([60]);

  await midi(0xb0, 64, 127);                                   // sustain down
  await midi(0x80, 60, 0);
  expect(await keysDown(page)).toEqual([60]);                  // held by the pedal
  await midi(0xb0, 64, 0);
  expect(await keysDown(page)).toEqual([]);

  await midi(0xb0, 11, 64);
  await expect(page.locator("#swellOut")).toHaveText("50%");
  await midi(0xb0, 4, 127);
  await expect(page.locator("#swellOut")).toHaveText("Full");

  await midi(0x90, 48, 80); await midi(0x90, 52, 80);
  await midi(0xb0, 123, 0);
  expect(await keysDown(page)).toEqual([]);
});

test("Space pumps the next foot and the treadle envelope shows its stage", async ({ page }) => {
  await openOrgan(page);
  await focusKeys(page);
  await page.keyboard.down(" ");
  await expect(page.locator("#flowL")).toContainText(/attack|decay|sustain/);
  await page.keyboard.up(" ");
});

test("All notes off, and Escape, silence everything and clear held keys (D18)", async ({ page }) => {
  await openOrgan(page);
  await page.click("#midiBtn");
  const midi = (a, b, c) => page.evaluate(([a, b, c]) => window.__midi(a, b, c), [a, b, c]);
  await hold(page, "q", "e");
  await midi(0xb0, 64, 127); await midi(0x90, 67, 90); await midi(0x80, 67, 0);   // a note held by the sustain pedal
  await page.waitForTimeout(600);
  expect(await keysDown(page)).toEqual([60, 64, 67]);
  await page.click("#panicBtn");
  await page.waitForTimeout(800);
  expect(await keysDown(page)).toEqual([]);
  expect(await rms(page)).toBeLessThan(1e-3);
  await letGo(page, "q", "e"); await midi(0xb0, 64, 0);   // late releases are harmless
  await hold(page, "q"); await page.waitForTimeout(400);
  expect(await keysDown(page)).toEqual([60]);            // and playing works again
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  expect(await keysDown(page)).toEqual([]);
  expect(await rms(page)).toBeLessThan(1e-3);
  await letGo(page, "q");
});

test("Shift and Command can't leave computer keys stuck (D18)", async ({ page }) => {
  await openOrgan(page);
  await hold(page, "2");                                 // C#4
  await page.keyboard.down("Shift");
  await page.keyboard.up("2");                          // comes up as "@"
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  expect(await keysDown(page)).toEqual([]);
  await hold(page, "q");
  await page.keyboard.down("Meta"); await page.keyboard.up("Meta");   // a Mac drops the key-up after Command
  await page.waitForTimeout(300);
  expect(await keysDown(page)).toEqual([]);
  await letGo(page, "q");
});

test("Keyboard compass: Full range plays deep MIDI notes, Reed organ doesn't (D19)", async ({ page }) => {
  await openOrgan(page);
  await page.click("#midiBtn");
  const midi = (a, b, c) => page.evaluate(([a, b, c]) => window.__midi(a, b, c), [a, b, c]);
  await midi(0x90, 24, 100); await page.waitForTimeout(800);   // C1
  expect(await page.locator("#rReeds").textContent()).toBe("2");
  await midi(0x80, 24, 0); await page.waitForTimeout(300);
  await page.selectOption("#compass", "organ");
  await midi(0x90, 24, 100); await page.waitForTimeout(500);
  expect(await page.locator("#rReeds").textContent()).toBe("0");
  await midi(0x80, 24, 0);
  await midi(0x90, 29, 100); await page.waitForTimeout(500);   // F1, the bottom key
  expect(await page.locator("#rReeds").textContent()).toBe("2");
  await midi(0x80, 29, 0);
});

test("Easy wind: a full-organ chord drains like three reeds, and is remembered (D23)", async ({ page }) => {
  await openOrgan(page);                                         // autoplay off, helper 100%
  for (const s of ["Bourdon 16′", "Celeste 8′", "Principal 4′"]) await toggleStop(page, s);
  await hold(page, "z", "b", "q", "e", "t", "i");               // six notes × five stops = 30 reeds
  await page.waitForTimeout(400);
  expect(await readout(page, "rReeds")).toBe("30");
  expect(await readout(page, "rUse")).toBe("0.65/s");
  await page.locator("#easyWind").check();
  await page.waitForTimeout(300);
  expect(await readout(page, "rReeds")).toBe("30");             // the reeds still sound
  expect(await readout(page, "rUse")).toBe("0.08/s");           // but use the air of three
  await letGo(page, "z", "b", "q", "e", "t", "i");
  await page.reload();
  await expect(page.locator("#easyWind")).toBeChecked();
});

test("Direct wind: the slider alone sets the reservoir; treadles, autoplay and playing don't move it (D26)", async ({ page }) => {
  await openOrgan(page, { quiet: false });                      // autoplay on, helper 2%
  await expect(page.locator("#directOn")).not.toBeChecked();
  await expect(page.locator("#airAmt")).toBeDisabled();
  await page.locator("#directOn").check();
  await expect(page.locator("#airAmt")).toBeEnabled();
  await setSlider(page, "airAmt", 30);
  for (const s of ["Bourdon 16′", "Celeste 8′", "Principal 4′"]) await toggleStop(page, s);
  await hold(page, "z", "b", "q", "e", "t", "i");              // a big chord that would drain the wind
  await page.waitForTimeout(1500);
  expect(await readout(page, "rWind")).toBe("3.0″");
  await expect(page.locator("#flowR")).toHaveText("idle");      // autoplay rests
  await expect(page.locator("#status")).toHaveText("Direct wind");
  for (let i = 0; i < 4; i++) { const k = i % 2 ? "ArrowRight" : "ArrowLeft"; await page.keyboard.down(k); await page.waitForTimeout(120); await page.keyboard.up(k); }
  expect(await readout(page, "rWind")).toBe("3.0″");           // pumping adds nothing
  const loud = await rms(page);
  await setSlider(page, "airAmt", 0);
  await page.waitForTimeout(600);
  expect(await readout(page, "rWind")).toBe("0.0″");
  await page.waitForTimeout(1800);                              // let the room's reverb tail die away
  expect(await rms(page)).toBeLessThan(loud * 0.02);             // no wind, no sound
  await page.click("#midiBtn");
  await page.evaluate(() => window.__midi(0xb0, 2, 127));       // breath controller full
  await expect(page.locator("#airOut")).toHaveText("3.6″");
  await letGo(page, "z", "b", "q", "e", "t", "i");
  await page.reload();
  await expect(page.locator("#directOn")).toBeChecked();
  await expect(page.locator("#airOut")).toHaveText("3.6″");
});

test("the MIDI volume knob drives Direct wind when it's on and Volume when it's off; Learn binds another knob (D27)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const cc = (n, v) => page.evaluate(([n, v]) => window.__midi(0xb0, n, v), [n, v]);
  await page.click("#midiBtn");
  await expect(page.locator("#directCC")).toHaveText("MIDI CC7 (volume knob)");
  await cc(7, 64);                                              // Direct wind off: the knob is Volume
  await expect(page.locator("#volumeOut")).toHaveText("50%");
  await page.locator("#directOn").check();
  await cc(7, 127);                                             // on: the knob is the wind
  await expect(page.locator("#airOut")).toHaveText("3.6″");
  await expect(page.locator("#volumeOut")).toHaveText("50%");   // and Volume stays put
  await page.click("#directLearn");
  await expect(page.locator("#directCC")).toHaveText("Move a knob or slider…");
  await cc(21, 0);                                              // the knob that moves next is bound
  await expect(page.locator("#directCC")).toHaveText("MIDI CC21");
  await expect(page.locator("#directLearn")).toHaveText("Learn");
  await cc(21, 71);
  await expect(page.locator("#airOut")).toHaveText("2.0″");
  await cc(7, 127);                                             // CC7 goes back to Volume once something else is learned
  await expect(page.locator("#volumeOut")).toHaveText("100%");
  await page.reload();
  await expect(page.locator("#directCC")).toHaveText("MIDI CC21");
});

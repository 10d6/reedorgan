// Playing with the mouse, the computer keyboard, the treadles and a MIDI keyboard.
import { test, expect } from "@playwright/test";
import { openOrgan, hold, letGo, keysDown, readout, focusKeys, setSlider } from "./organ.js";

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

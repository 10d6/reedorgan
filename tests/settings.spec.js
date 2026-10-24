// Settings are remembered in the browser; resets and readouts work.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, readout } from "./organ.js";

test("slider, select and drawer settings survive a reload", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "swellAmt", 40);
  await setSlider(page, "resAmt", 100);
  await setSlider(page, "scatterAmt", 2.5);
  await setSlider(page, "voxShadowAmt", 70);
  await setSlider(page, "brMelodiaAmt", -40);
  await setSlider(page, "aL", 900);                            // left treadle attack
  await page.selectOption("#split", "bc");
  await page.selectOption("#toneModel", "sweep");
  await page.selectOption("#voxShape", "fan");
  await page.$eval("#voicing", (d) => { d.open = true; d.dispatchEvent(new Event("toggle")); });
  await page.reload();
  await expect(page.locator("#swellOut")).toHaveText("40%");
  await expect(page.locator("#resOut")).toHaveText("3.0×");
  await expect(page.locator("#scatterOut")).toHaveText("±2.5 ¢");
  await expect(page.locator("#voxShadowOut")).toHaveText("70%");
  await expect(page.locator("#brMelodiaOut")).toHaveText("−40");
  await expect(page.locator("#aoL")).not.toHaveText("60 ms");
  await expect(page.locator("#split")).toHaveValue("bc");
  await expect(page.locator("#toneModel")).toHaveValue("sweep");
  await expect(page.locator("#voxShape")).toHaveValue("fan");
  expect(await page.$eval("#voicing", (d) => d.open)).toBe(true);
});

test("linked treadle envelopes move together, unlinked ones don't", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "aL", 1000);
  await expect(page.locator("#aoR")).toHaveText("30.0 s");
  await page.uncheck("#link");
  await setSlider(page, "aL", 0);
  await expect(page.locator("#aoL")).toHaveText("5 ms");
  await expect(page.locator("#aoR")).toHaveText("30.0 s");
});

test("restore factory voicing resets every rank", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "lvBourdonAmt", 130);
  await setSlider(page, "tuCelesteAmt", -7.5);
  await setSlider(page, "brPrincipalAmt", 60);
  await page.$eval("#voicing", (d) => { d.open = true; });
  await page.click("#voicingReset");
  await expect(page.locator("#lvBourdonOut")).toHaveText("100%");
  await expect(page.locator("#tuCelesteOut")).toHaveText("0 ¢");
  await expect(page.locator("#brPrincipalOut")).toHaveText("Factory");
});

test("fitting new reeds changes the saved reed set", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await page.click("#newReeds");
  const first = await page.evaluate(() => localStorage.getItem("reed-reedSeed"));
  await page.click("#newReeds");
  const second = await page.evaluate(() => localStorage.getItem("reed-reedSeed"));
  expect(first).not.toBeNull();
  expect(second).not.toBe(first);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem("reed-reedSeed"))).toBe(second);
});

test("readouts use the documented formats", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  expect(await readout(page, "resOut")).toBe("1.0×");
  expect(await readout(page, "speechOut")).toBe("1.0×");
  expect(await readout(page, "toneRespOut")).toBe("250 ms");
  expect(await readout(page, "toneQOut")).toBe("Q 0.70");
  expect(await readout(page, "voxBladeOut")).toBe("above 1.5 kHz");
  expect(await readout(page, "swellOut")).toBe("Closed");
});

// Settings are kept in saved patches (D33), the page layout is remembered on its
// own, and resets and readouts work.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, readout, savePatch } from "./organ.js";

test("slider and select settings come back with their saved patch; open drawers are remembered on their own", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "swellAmt", 40);
  await setSlider(page, "resAmt", 100);
  await setSlider(page, "scatterAmt", 2.5);
  await setSlider(page, "voxShadowAmt", 70);
  await setSlider(page, "brMelodiaAmt", -40);
  await setSlider(page, "aL", 900);                            // left treadle attack
  await page.selectOption("#split", "bc");
  await page.selectOption("#toneModel", "sweep");
  await page.click("#voxPanel summary");                      // the fan's controls fold away (D25)
  await page.selectOption("#voxShape", "fan");
  await page.$eval("#voicing", (d) => { d.open = true; d.dispatchEvent(new Event("toggle")); });
  await savePatch(page, "Everything");
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("Everything");
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
  expect(await page.$eval("#voxPanel", (d) => d.open)).toBe(true);
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

test("fitting new reeds changes the sound's reed set, which is kept in the patch", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const seed = (name) => page.evaluate((n) => JSON.parse(localStorage.getItem("reed-patches"))[n].settings.reedSeed, name);
  await page.click("#newReeds");
  await expect(page.locator("#patchEdited")).toBeVisible();   // a new reed set is a change to the sound
  await savePatch(page, "Reeds A");
  const first = await seed("Reeds A");
  await page.click("#newReeds");
  await savePatch(page, "Reeds B");
  const second = await seed("Reeds B");
  expect(first).not.toBe(1);
  expect(second).not.toBe(first);
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("Reeds B");
  await expect(page.locator("#patchEdited")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("reed-reedSeed"))).toBeNull();   // nothing saves itself any more
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

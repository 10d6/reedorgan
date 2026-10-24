// Stops, divided stops and octave couplers: what the player sees and which reeds speak.
import { test, expect } from "@playwright/test";
import { openOrgan, toggleStop, hold, letGo, keysDown, readout, focusKeys } from "./organ.js";

const knobs = (page) => page.$$eval("#stops .stop", (els) => els.map((e) => e.getAttribute("aria-label")));
const pressed = (page, label) => page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed");

test("opens with Diapason and Melodia drawn, stops not divided", async ({ page }) => {
  await openOrgan(page);
  expect(await knobs(page)).toEqual(["Bourdon 16′", "Diapason 8′", "Melodia 8′", "Celeste 8′", "Principal 4′",
    "Vox Humana tremolo", "Sub octave coupler", "Super octave coupler"]);
  expect(await pressed(page, "Diapason 8′")).toBe("true");
  expect(await pressed(page, "Melodia 8′")).toBe("true");
  expect(await pressed(page, "Bourdon 16′")).toBe("false");
});

test("a held key sounds one reed per drawn stop", async ({ page }) => {
  await openOrgan(page);
  await hold(page, "q");
  await expect(page.locator("#rReeds")).toHaveText("2");
  await toggleStop(page, "Principal 4′");
  await hold(page, "q");
  await expect(page.locator("#rReeds")).toHaveText("3");
  await letGo(page, "q");
  await expect(page.locator("#rReeds")).toHaveText("0");
});

for (const [mode, splitKey, labels] of [
  ["ef", 53, ["Bass · up to E below middle C", "Treble · from F below middle C", "Whole keyboard"]],
  ["bc", 60, ["Bass · below middle C", "Treble · from middle C", "Whole keyboard"]],
]) {
  test(`divided at ${mode}: halves draw separately`, async ({ page }) => {
    await openOrgan(page);
    await page.selectOption("#split", mode);
    expect((await knobs(page)).length).toBe(13);
    expect(await page.$$eval(".group-label", (els) => els.map((e) => e.textContent))).toEqual(labels);
    expect(Number(await page.locator(".white.split").getAttribute("data-midi"))).toBe(splitKey);
    await toggleStop(page, "Bass Melodia 8′");
    await hold(page, "z");                                     // C3: always in the bass half
    await expect(page.locator("#rReeds")).toHaveText("1");
    await hold(page, "w");                                     // D4: always in the treble half
    await expect(page.locator("#rReeds")).toHaveText("3");
    await letGo(page, "z", "w");
  });
}

test("undividing keeps any rank drawn in either half", async ({ page }) => {
  await openOrgan(page);
  await page.selectOption("#split", "bc");
  await toggleStop(page, "Treble Melodia 8′");                 // Melodia now only in the bass
  await toggleStop(page, "Treble Celeste 8′");                 // Celeste now only in the treble
  await page.selectOption("#split", "none");
  expect(await pressed(page, "Melodia 8′")).toBe("true");
  expect(await pressed(page, "Celeste 8′")).toBe("true");
});

test("couplers pull down the octave keys, and follow a held chord", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Sub octave coupler");
  await hold(page, "q");                                       // C4
  expect(await keysDown(page)).toEqual([48, 60]);
  await expect(page.locator("#rReeds")).toHaveText("4");
  await page.getByRole("button", { name: "Super octave coupler", exact: true }).click();
  expect(await keysDown(page)).toEqual([48, 60, 72]);
  await page.getByRole("button", { name: "Sub octave coupler", exact: true }).click();
  expect(await keysDown(page)).toEqual([60, 72]);
  await focusKeys(page);
  await letGo(page, "q");
  expect(await keysDown(page)).toEqual([]);
  await expect(page.locator("#rReeds")).toHaveText("0");
});

test("a note held directly and through a coupler sounds once and stays down", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Super octave coupler");
  await hold(page, "z", "q");                                  // C3 couples C4; C4 is also played
  expect(await keysDown(page)).toEqual([48, 60, 72]);
  await expect(page.locator("#rReeds")).toHaveText("6");      // three notes × two ranks
  await letGo(page, "z");
  expect(await keysDown(page)).toEqual([60, 72]);              // C4 still held by its own key
  await letGo(page, "q");
  expect(await keysDown(page)).toEqual([]);
});

test("Vox Humana and coupler knobs toggle", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Vox Humana tremolo");
  expect(await pressed(page, "Vox Humana tremolo")).toBe("true");
  expect(await readout(page, "voxSub")).toContain("sway");
});

// The page loads cleanly and lays out at desktop and phone widths.
import { test, expect } from "@playwright/test";
import { openOrgan } from "./organ.js";

test("loads without script errors", async ({ page }) => {
  const errors = await openOrgan(page, { quiet: false });
  await expect(page).toHaveTitle("Parlor Reed Organ");
  await expect(page.locator("#status")).toHaveText("Press a key to start");
  expect(errors).toEqual([]);
});

test("every slider shows its value", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const missing = await page.$$eval("input[type=range][id$=Amt]", (els) =>
    els.filter((el) => { const out = document.getElementById(el.id.replace(/Amt$/, "Out")); return !out || !out.textContent.trim(); }).map((el) => el.id));
  expect(missing).toEqual([]);
});

for (const width of [1280, 700, 390]) {
  test(`no sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openOrgan(page, { quiet: false });
    await page.$eval("#voicing", (d) => { d.open = true; });
    await page.selectOption("#split", "ef");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("keyboard shows 25 keys on a phone and 37 on a desktop", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#keys .key")).toHaveCount(37);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator("#keys .key")).toHaveCount(25);
});

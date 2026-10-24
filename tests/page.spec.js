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

test("top bar: title on the left, then the gauge, then volume, MIDI and All notes off (D24)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const box = async (sel) => page.locator(sel).boundingBox();
  const title = await box(".plate"), gauge = await box("#gauge"), vol = await box("#volumeAmt"), midi = await box("#midiBtn"), panic = await box("#panicBtn"), stops = await box("#stops");
  expect(title.x).toBeLessThan(gauge.x);
  expect(gauge.x + gauge.width).toBeLessThanOrEqual(vol.x);
  for (const b of [gauge, vol, midi, panic]) expect(b.y + b.height).toBeLessThan(stops.y);   // all above the stops
  expect(Math.abs(midi.y - panic.y)).toBeLessThan(4);                                        // side by side
});

test("Rank voicing sits right under the draw stops, closed by default (D24)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  expect(await page.$eval("#voicing", (d) => d.open)).toBe(false);
  expect(await page.$eval("#stops", (s) => s.nextElementSibling.id)).toBe("voicing");
});

test("info buttons show and hide each section's explanations, and are remembered (D24)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const shown = () => page.evaluate(() => [...document.querySelectorAll(".sub, .hint")].filter((e) => !e.hidden).length);
  expect(await page.locator(".info-btn").count()).toBeGreaterThanOrEqual(10);
  expect(await shown()).toBe(0);                                                             // hidden to start
  const wind = page.locator('.info-btn[data-key="wind"]');
  await expect(wind).toHaveAttribute("aria-label", "About Wind");
  await wind.click();
  await expect(wind).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("A bigger reservoir holds a chord longer")).toBeVisible();
  await expect(page.getByText("How quickly the tone follows the wind")).toBeHidden();       // Wind tone has its own button
  await page.locator('.info-btn[data-key="voicing"]').click();                               // in the drawer's heading
  expect(await page.$eval("#voicing", (d) => d.open)).toBe(false);                           // doesn't open the drawer
  await page.reload();
  await expect(page.locator('.info-btn[data-key="wind"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("A bigger reservoir holds a chord longer")).toBeVisible();
  await page.locator('.info-btn[data-key="wind"]').click();
  await expect(page.getByText("A bigger reservoir holds a chord longer")).toBeHidden();
});

test("the status line sits under the gauge, so a long message doesn't move it (D25)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const pos = await page.evaluate(() => {
    const st = document.getElementById("status"), g = () => { const r = document.getElementById("gauge").getBoundingClientRect(); return [r.x, r.y]; };
    st.textContent = "Wind is low"; const a = g(), sb = st.getBoundingClientRect();
    st.textContent = "Helper can’t keep up; wind falling"; const b = g();
    st.textContent = "Relief valve venting"; const c = g();
    return { a, b, c, under: sb.top >= document.getElementById("gauge").getBoundingClientRect().bottom - 1 };
  });
  expect(pos.b).toEqual(pos.a);
  expect(pos.c).toEqual(pos.a);
  expect(pos.under).toBe(true);
});

test("Vox Humana controls fold away; drawing the stop opens them, retiring it doesn't close them (D25)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  const open = () => page.$eval("#voxPanel", (d) => d.open);
  expect(await open()).toBe(false);
  await expect(page.locator("#voxRate")).toBeHidden();
  await page.getByRole("button", { name: "Vox Humana tremolo", exact: true }).click();
  expect(await open()).toBe(true);
  await expect(page.locator("#voxRate")).toBeVisible();
  await page.getByRole("button", { name: "Vox Humana tremolo", exact: true }).click();
  expect(await open()).toBe(true);                             // stays open when the stop is pushed in
  await page.click("#voxPanel summary");
  expect(await open()).toBe(false);                            // and folds by hand
});

test("Connect MIDI glows orange until an input is listening (D25)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#midiBtn")).toHaveClass(/attention/);
  await page.click("#midiBtn");
  await expect(page.locator("#midiStatus")).toHaveText("Listening to Test Keyboard");
  await expect(page.locator("#midiBtn")).not.toHaveClass(/attention/);
});

test("new defaults: fan 9 Hz, blade shadow 50%, shimmer 10%; treadle noise 30% (D25)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#voxOut")).toHaveText("9.0 Hz");
  await expect(page.locator("#voxShadowOut")).toHaveText("50%");
  await expect(page.locator("#voxShimmerOut")).toHaveText("10%");
  await expect(page.locator("#thumpOut")).toHaveText("30%");
});

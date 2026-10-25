// Patches (D33): the sound saved by name. Nothing about the sound saves itself;
// the organ opens with the patch last loaded or saved; Factory is built in;
// patches go to files and come back; old automatic settings carry over.
import { test, expect } from "@playwright/test";
import { openOrgan, setSlider, savePatch, toggleStop, hold, letGo } from "./organ.js";

const options = (page) => page.$$eval("#patchSel option", (els) => els.map((e) => e.value));
const stopOn = (page, label) => page.getByRole("button", { name: label, exact: true });

test("out of the box: Factory, nothing edited; a change shows as edited and Revert undoes it (D33)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#patchSel")).toHaveValue("Factory");
  expect(await options(page)).toEqual(["Factory"]);
  await expect(page.locator("#patchEdited")).toBeHidden();
  for (const id of ["patchSave", "patchRename", "patchDelete", "patchRevert"]) await expect(page.locator("#" + id)).toBeDisabled();   // Factory can't be overwritten
  await setSlider(page, "swellAmt", 40);
  await expect(page.locator("#patchEdited")).toBeVisible();
  await expect(page.locator("#patchRevert")).toBeEnabled();
  await toggleStop(page, "Celeste 8′");
  await page.click("#patchRevert");
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await expect(stopOn(page, "Celeste 8′")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#patchEdited")).toBeHidden();
  await page.click('#seqLanes .seq-tab[data-lane="fan"]');             // which pattern is on show isn't part of the sound
  await page.waitForTimeout(400);
  await expect(page.locator("#patchEdited")).toBeHidden();
});

test("without saving, a reload brings back the factory sound, but Volume and open drawers are remembered (D33)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "swellAmt", 40);
  await setSlider(page, "volumeAmt", 70);
  await page.selectOption("#toneModel", "sweep");
  await page.click("#voxPanel summary");
  await toggleStop(page, "Principal 4′");
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("Factory");
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await expect(page.locator("#toneModel")).toHaveValue("tilt");
  await expect(stopOn(page, "Principal 4′")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#volumeOut")).toHaveText("70%");      // your setup
  expect(await page.$eval("#voxPanel", (d) => d.open)).toBe(true);  // and the layout
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual(["reed-patch", "reed-patches", "reed-volume", "reed-voxOpen"]);
});

test("a saved patch keeps the whole sound, stops and sequencer included, and the organ opens with it (D33)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await toggleStop(page, "Celeste 8′");
  await toggleStop(page, "Sub octave coupler");
  await page.selectOption("#split", "bc");
  await setSlider(page, "brDiapasonAmt", -40);
  await setSlider(page, "aL", 900);
  await page.selectOption("#seqMeter", "3/4");
  await page.click('#seqLanes .seq-tab[data-lane="swell"]');
  await page.check("#seqOn");
  await savePatch(page, "Sunday");
  await expect(page.locator("#patchEdited")).toBeHidden();
  await expect(page.locator("#patchSave")).toBeEnabled();
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("Sunday");
  await expect(page.locator("#patchEdited")).toBeHidden();
  await expect(stopOn(page, "Treble Celeste 8′")).toHaveAttribute("aria-pressed", "true");
  await expect(stopOn(page, "Bass Celeste 8′")).toHaveAttribute("aria-pressed", "true");
  await expect(stopOn(page, "Sub octave coupler")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#split")).toHaveValue("bc");
  await expect(page.locator("#brDiapasonOut")).toHaveText("−40");
  await expect(page.locator("#aoL")).not.toHaveText("60 ms");
  expect(await page.locator("#seqMeter").inputValue()).toBe("3/4");
  await expect(page.locator('#seqLanes .seq-tab[data-lane="swell"]')).toHaveClass(/\bon\b/);
  // Save writes over it; Factory and the patch switch back and forth
  await setSlider(page, "swellAmt", 40);
  await page.click("#patchSave");
  await page.selectOption("#patchSel", "Factory");
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await expect(stopOn(page, "Celeste 8′")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#split")).toHaveValue("none");
  expect(await page.locator("#seqMeter").inputValue()).toBe("4/4");
  await page.selectOption("#patchSel", "Sunday");
  await expect(page.locator("#swellOut")).toHaveText("40%");
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("Sunday");   // the last one loaded
});

test("loading a patch while holding a chord changes the sound at once (D33)", async ({ page }) => {
  await openOrgan(page);
  await toggleStop(page, "Principal 4′");
  await savePatch(page, "Bright");
  await page.selectOption("#patchSel", "Factory");
  await hold(page, "q", "e");
  await page.waitForTimeout(400);
  await expect(page.locator("#rReeds")).toHaveText("4");           // Diapason and Melodia on two keys
  await page.selectOption("#patchSel", "Bright");
  await page.waitForTimeout(400);
  await expect(page.locator("#rReeds")).toHaveText("6");           // the Principal comes in
  await letGo(page, "q", "e");
});

test("Save as, Rename and Delete: names stay unique, Factory is protected (D33)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await page.click("#patchSaveAs");
  await expect(page.locator("#patchName")).toBeFocused();
  await page.fill("#patchName", "Factory");
  await expect(page.locator("#patchOk")).toBeDisabled();
  await page.fill("#patchName", "");
  await page.keyboard.down("q");                                       // a letter that plays C4 on the keyboard
  await expect(page.locator("#keys .key.down")).toHaveCount(0);       // typing in the name box plays no notes
  await page.keyboard.up("q");
  await page.fill("#patchName", "");
  await page.keyboard.type("  Evening   hymn ");
  await page.keyboard.press("Enter");
  await expect(page.locator("#patchSel")).toHaveValue("Evening hymn");
  await setSlider(page, "swellAmt", 30);
  await savePatch(page, "Choir");
  await page.click("#patchSaveAs");                                    // an existing name is replaced, and says so
  await page.fill("#patchName", "Evening hymn");
  await expect(page.locator("#patchOk")).toHaveText("Replace");
  await page.click("#patchCancel");
  await expect(page.locator("#patchAsk")).toBeHidden();
  await page.click("#patchRename");
  await expect(page.locator("#patchName")).toHaveValue("Choir");
  await page.fill("#patchName", "Evening hymn");
  await expect(page.locator("#patchOk")).toBeDisabled();               // can't rename onto another patch
  await page.fill("#patchName", "Full choir");
  await page.click("#patchOk");
  expect(await options(page)).toEqual(["Factory", "Evening hymn", "Full choir"]);
  await expect(page.locator("#patchSel")).toHaveValue("Full choir");
  await page.click("#patchDelete");
  await expect(page.locator("#patchAskLabel")).toHaveText("Delete “Full choir”?");
  await page.click("#patchOk");
  expect(await options(page)).toEqual(["Factory", "Evening hymn"]);
  await expect(page.locator("#patchSel")).toHaveValue("Factory");
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await page.reload();
  expect(await options(page)).toEqual(["Factory", "Evening hymn"]);
  await expect(page.locator("#patchSel")).toHaveValue("Factory");
});

test("a patch downloads as a file and loads back from one; other files are refused (D33)", async ({ page }) => {
  await openOrgan(page, { quiet: false });
  await setSlider(page, "swellAmt", 55);
  await toggleStop(page, "Bourdon 16′");
  await savePatch(page, "Deep swell");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#patchDownload")]);
  expect(download.suggestedFilename()).toBe("deep-swell.reedorgan.json");
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  const file = JSON.parse(text);
  expect(file.app).toBe("parlor-reed-organ");
  expect(file.name).toBe("Deep swell");
  expect(file.settings.swell).toBe(55);
  expect(file.settings.stops.bass.bourdon).toBe(true);
  // a fresh browser: load the file
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#swellOut")).toHaveText("Closed");
  await page.setInputFiles("#patchFile", { name: "deep-swell.reedorgan.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("#patchSel")).toHaveValue("Deep swell");
  await expect(page.locator("#swellOut")).toHaveText("55%");
  await expect(stopOn(page, "Bourdon 16′")).toHaveAttribute("aria-pressed", "true");
  await page.setInputFiles("#patchFile", { name: "deep-swell.reedorgan.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("#patchSel")).toHaveValue("Deep swell (2)");   // loading it again doesn't overwrite
  await page.setInputFiles("#patchFile", { name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator("#patchMsg")).toHaveText("That file isn’t a reed organ patch.");
  await expect(page.locator("#patchSel")).toHaveValue("Deep swell (2)");
});

test("settings saved automatically before patches become “My settings”, then the old entries go (D33)", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("reed-patches")) return;
    localStorage.setItem("reed-swell", "40");
    localStorage.setItem("reed-toneModel", JSON.stringify("sweep"));
    localStorage.setItem("reed-envL", JSON.stringify({ a: 2, d: 0.3, s: 0, r: 0.15 }));
    localStorage.setItem("reed-autoplay", JSON.stringify({ on: true, meter: "3/4", measures: 1, cells: ["R", "L", "-"] }));
    localStorage.setItem("reed-volume", "80");
    localStorage.setItem("reed-voxOpen", "true");
  });
  await openOrgan(page, { quiet: false });
  await expect(page.locator("#patchSel")).toHaveValue("My settings");
  await expect(page.locator("#patchEdited")).toBeHidden();
  await expect(page.locator("#swellOut")).toHaveText("40%");
  await expect(page.locator("#toneModel")).toHaveValue("sweep");
  await expect(page.locator("#aoL")).toHaveText("2.00 s");
  expect(await page.locator("#seqMeter").inputValue()).toBe("3/4");
  await expect(page.locator("#volumeOut")).toHaveText("80%");
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual(["reed-patch", "reed-patches", "reed-volume", "reed-voxOpen"]);
  await page.reload();
  await expect(page.locator("#patchSel")).toHaveValue("My settings");
  await expect(page.locator("#swellOut")).toHaveText("40%");
});

test("old automatic settings that come to the factory sound don't make a patch (D33)", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("reed-patches")) return;
    localStorage.setItem("reed-swell", "0");
    localStorage.setItem("reed-volume", "90");
  });
  await openOrgan(page, { quiet: false });
  expect(await options(page)).toEqual(["Factory"]);
  await expect(page.locator("#volumeOut")).toHaveText("90%");
});

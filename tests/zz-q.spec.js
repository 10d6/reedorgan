import { test } from "@playwright/test";
test("q", async ({ page }) => {
  const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(() => { window.__midi = () => {}; });
  await page.goto("/");
  await page.keyboard.down("q"); await page.waitForTimeout(3000);
  const s = await page.evaluate(() => ({ status: document.getElementById("status").textContent, wind: document.getElementById("rWind").textContent, flowR: document.getElementById("flowR").textContent, flowL: document.getElementById("flowL").textContent }));
  await page.keyboard.up("q");
  console.log(JSON.stringify(s), JSON.stringify(errs.filter(e => !/fonts|ERR_|Failed to load/.test(e))));
  await page.locator("#seq").screenshot({ path: "/tmp/claude-0/-home-claude/d08a2d24-277d-5b81-bc4d-b94bcde4fac2/scratchpad/seq-rail.png" });
});

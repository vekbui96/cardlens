import { chromium, devices } from "@playwright/test";
const B = "http://localhost:4173/cardlens";
const OUT = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
await ctx.addInitScript(() => {
  const now = Date.now();
  const rows = [];
  for (let n = 1; n <= 12; n++) rows.push({ cardId: `me5-${n}`, setId: "me5", finish: "normal", at: now });
  localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
  localStorage.setItem("cardlens:v1:binders", JSON.stringify([{
    id: "b1", name: "Vault X Masters", format: "9", createdAt: now, updatedAt: now,
    pages: [{ slots: {
      0: { kind: "card", cardId: "me5-1", finish: "normal", name: "Owned One", collectorNumber: "1" },
      1: { kind: "card", cardId: "me5-2", finish: "normal", name: "Owned Two", collectorNumber: "2" },
      4: { kind: "card", cardId: "me5-999", finish: "normal", name: "Chase Card", collectorNumber: "999" },
    } }],
  }]));
});
const page = await ctx.newPage();
await page.goto(`${B}/#/binder/b1`);
await page.waitForTimeout(7000);
await page.screenshot({ path: OUT });
console.log("shot");
await browser.close();

/**
 * Screenshot the home page with a plausible collection history.
 *
 * The growth chart reads localStorage, not the API, so this needs no server —
 * which matters because a chart has to be looked at, and the validator only
 * checks colour.
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.SHOT_BASE ?? "http://localhost:4173/cardlens";
const OUT = process.argv[2] ?? "home.png";
const DAY = 24 * 60 * 60_000;

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"] });

// ~400 printings acquired over a year, in bursts — what a real collection
// looks like, rather than a smooth synthetic ramp.
await context.addInitScript((day) => {
  const now = Date.now();
  const rows = [];
  let n = 0;
  for (let d = 365; d >= 0; d--) {
    const burst = d % 37 === 0 ? 40 : d % 11 === 0 ? 6 : Math.random() < 0.12 ? 2 : 0;
    for (let i = 0; i < burst; i++) {
      n++;
      rows.push({
        cardId: `sv8pt5-${n}`,
        setId: "sv8pt5",
        finish: i % 2 ? "reverse" : "normal",
        at: now - d * day + i * 1000,
      });
    }
  }
  localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
}, DAY);

const page = await context.newPage();
await page.goto(`${BASE}/#/`);
await page.waitForTimeout(6000);
await page.screenshot({ path: OUT });
console.log("shot", OUT);
await browser.close();

/**
 * Screenshot the live site at phone size, for layout problems that only show
 * up on a real viewport.
 *
 * Hits the deployed build rather than the dev server: the point is to see what
 * the user sees, and the two differ (lazy chunks, minified CSS, real data).
 * The showcase link is produced by the app's own Share button rather than
 * hand-built, so the payload encoding cannot drift from what users get.
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Point at a local preview to see a fix before it ships.
const BASE = process.env.SHOT_BASE ?? "https://vekbui96.github.io/cardlens";
const OUT = process.argv[2] ?? "shots";
mkdirSync(OUT, { recursive: true });

const SET_ID = process.env.SET_ID ?? "sv8pt5";
const SET_NAME = process.env.SET_NAME ?? "Prismatic Evolutions";

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"],
  permissions: ["clipboard-read", "clipboard-write"],
});

// Own a few printings so the screens have something to render. Card ids must
// match the real catalog (`<setId>-<number>`), or the share payload encodes
// nothing and the showcase renders an empty set.
await context.addInitScript((setId) => {
  const now = Date.now();
  const rows = [];
  for (let n = 1; n <= 8; n++) {
    rows.push({ cardId: `${setId}-${n}`, setId, finish: "normal", at: now });
    if (n % 2 === 0) rows.push({ cardId: `${setId}-${n}`, setId, finish: "reverse", at: now });
  }
  localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
}, SET_ID);

const page = await context.newPage();

async function shoot(name, ms = 3000) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

await page.goto(`${BASE}/#/set/${SET_ID}/${encodeURIComponent(SET_NAME)}`);
await page.waitForTimeout(8000);
await shoot("01-set-screen", 1000);

// Share, then follow the link the app produced.
try {
  await page.getByRole("button", { name: "Share" }).click({ timeout: 5000 });
  const url = await page.evaluate(() => navigator.clipboard.readText());
  console.log("showcase url length:", url.length);
  await page.goto(url);
  await page.waitForTimeout(8000);
  await shoot("02-showcase", 1000);

  // The enlarged card — the thing that looks wrong on mobile.
  const first = page.getByRole("button", { name: /^View / }).first();
  if (await first.count()) {
    await first.click();
    await shoot("03-showcase-viewer", 1500);
  } else {
    console.log("no View buttons found");
  }
} catch (err) {
  console.log("share/showcase step failed:", err.message);
}

await browser.close();

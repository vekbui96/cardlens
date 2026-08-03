/**
 * Drive the exclusion flow against the DEPLOYED site and assert what it does.
 *
 * Unit tests run against mock printings and jsdom; this runs against the real
 * catalog, the real bundle and a real browser, which is where the differences
 * that matter have shown up before. Local storage only — a fresh browser with
 * no sync token, so nothing here touches the real collection on the server.
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.SHOT_BASE ?? "https://vekbui96.github.io/cardlens";
const SET_ID = "sv8pt5";
const SET_NAME = "Prismatic Evolutions";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"] });

// Own card 1's normal printing, so we can prove excluding an OWNED printing
// also un-owns it.
await context.addInitScript((setId) => {
  localStorage.setItem(
    "cardlens:v1:collection",
    JSON.stringify([{ cardId: `${setId}-1`, setId, finish: "normal", at: Date.now() }]),
  );
}, SET_ID);

const page = await context.newPage();
const url = `${BASE}/#/set/${SET_ID}/${encodeURIComponent(SET_NAME)}`;

const marked = (n, f) => new RegExp(`, ${n}, ${f}, (not )?owned$`);
const detailsFor = (n, f) => new RegExp(`^Details for .*, ${n}, ${f}$`);
const excludedTile = (n, f) => new RegExp(`, ${n}, ${f}, excluded$`);

async function loadSet() {
  await page.goto(url);
  await page
    .getByRole("button", { name: marked("1", "Normal") })
    .first()
    .waitFor({ timeout: 60_000 });
}

await loadSet();

// --- Baseline -------------------------------------------------------------
check(
  "no Excluded chip before anything is excluded",
  (await page.getByRole("button", { name: /^Excluded \(/ }).count()) === 0,
);
check(
  "owned printing shows as owned",
  (await page.getByRole("button", { name: /, 1, Normal, owned$/ }).count()) === 1,
);
/** The "held/total" figure in the screen header. */
async function progress() {
  const el = page.getByText(/^\d+\/\d+$/).first();
  return (await el.count()) ? (await el.innerText()).trim() : null;
}
const progressBefore = await progress();

// --- Exclude an UNOWNED printing -----------------------------------------
await page
  .getByRole("button", { name: detailsFor("1", "Reverse Holo") })
  .first()
  .click();
await page.getByRole("button", { name: "Exclude Reverse Holo" }).click();
await page.getByRole("button", { name: "Done" }).click();

check(
  "excluded tile disappears from the grid",
  (await page.getByRole("button", { name: marked("1", "Reverse Holo") }).count()) === 0,
);
check(
  "Excluded chip appears with a count",
  (await page.getByRole("button", { name: "Excluded (1)" }).count()) === 1,
);

// --- Reveal ---------------------------------------------------------------
await page.getByRole("button", { name: "Excluded (1)" }).click();
check(
  "reveal shows it, labelled excluded",
  (await page.getByRole("button", { name: excludedTile("1", "Reverse Holo") }).count()) === 1,
);
await page.getByRole("button", { name: "Excluded (1)" }).click();
check(
  "hiding again works",
  (await page.getByRole("button", { name: marked("1", "Reverse Holo") }).count()) === 0,
);

// --- Survives a reload ----------------------------------------------------
await loadSet();
check(
  "exclusion survives a reload",
  (await page.getByRole("button", { name: "Excluded (1)" }).count()) === 1,
);
check(
  "still hidden after reload",
  (await page.getByRole("button", { name: marked("1", "Reverse Holo") }).count()) === 0,
);

// --- Missing-only must not resurface it ----------------------------------
await page.getByRole("button", { name: "Missing only" }).click();
check(
  "excluded is not 'missing'",
  (await page.getByRole("button", { name: /, 1, Reverse Holo/ }).count()) === 0,
);
await page.getByRole("button", { name: "Missing only" }).click();

// --- Excluding an OWNED printing un-owns it ------------------------------
await page
  .getByRole("button", { name: detailsFor("1", "Normal") })
  .first()
  .click();
await page.getByRole("button", { name: "Exclude Normal" }).click();
await page.getByRole("button", { name: "Done" }).click();
check(
  "excluding an owned printing removes it from the grid",
  (await page.getByRole("button", { name: marked("1", "Normal") }).count()) === 0,
);
check("chip counts both", (await page.getByRole("button", { name: "Excluded (2)" }).count()) === 1);

const progressAfter = await progress();
const held = (p) => (p ? Number(p.split("/")[0]) : NaN);
check(
  "owned count dropped when an owned printing was excluded",
  progressBefore !== null && progressAfter !== null && held(progressAfter) === held(progressBefore) - 1,
  `${progressBefore} -> ${progressAfter}`,
);

// --- Include restores it --------------------------------------------------
await page.getByRole("button", { name: "Excluded (2)" }).click();
await page
  .getByRole("button", { name: detailsFor("1", "Normal") })
  .first()
  .click();
await page.getByRole("button", { name: "Include Normal" }).click();
await page.getByRole("button", { name: "Done" }).click();
check(
  "included printing returns to the grid",
  (await page.getByRole("button", { name: marked("1", "Normal") }).count()) === 1,
);
check(
  "and it comes back UNOWNED, not owned",
  (await page.getByRole("button", { name: /, 1, Normal, not owned$/ }).count()) === 1,
);

await page.screenshot({ path: process.argv[2] ?? "exclude-check.png" });
await browser.close();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Sealed prices, from `docs/v2/specs/08-target-sealed.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * ## What the e2e setup actually serves, and why two tests seed storage directly
 *
 * The suite runs with `VITE_USE_MOCKS=true`, and the mock catalog knows six
 * sets: sv3, sv2, base1, swsh1, swsh3, swsh7. The `collection` fixture marks
 * five printings from base2, ecard3, ex2, ex10 and pop3 — NONE of which the
 * mock catalog has heard of. `useSealed` disables a set's query until the
 * catalog gives it a name, so under that fixture this screen can never issue a
 * single request, and the only honest thing it can show is that those sets
 * could not be matched. That is a real state and it is asserted below.
 *
 * It is not the only state, so the priced tests seed `cardlens:v1:collection`
 * with a set the mock catalog DOES know and answer `/api/sealed/*` at the
 * network edge. Seeding through `?seed=` cannot express this: the fixtures live
 * in `src/dev/`, which this stream does not own, and adding a set to them would
 * change what every other v2 spec sees.
 *
 * The real API server would otherwise reach tcgcsv.com over the public internet
 * for these, which is a live third party and not a fixture.
 */

const KEY = "cardlens:v1:collection";

/** Rows in `storage/printings.ts` shape, which is what `Repositories` reads. */
function ownRows(now: number) {
  return [
    { cardId: "sv3-223", setId: "sv3", finish: "holo", at: now, number: "223" },
    { cardId: "sv3-125", setId: "sv3", finish: "normal", at: now, number: "125" },
    { cardId: "base1-4", setId: "base1", finish: "holo", at: now, number: "4" },
  ];
}

const HOUR = 60 * 60_000;

/**
 * One set's sealed answer.
 *
 * Deliberately incomplete: a pack with a price, an ETB the feed has no price
 * for, and no booster box at all. Those are three different facts and the screen
 * has to say three different things about them.
 */
function obsidianFlames(updatedMsAgo = 2 * HOUR) {
  return {
    setId: "sv3",
    updated: new Date(Date.now() - updatedMsAgo).toISOString(),
    prices: [
      { kind: "pack", productName: "Obsidian Flames Booster Pack", price: 4.63 },
      { kind: "etb", productName: "Obsidian Flames Elite Trainer Box" },
      { kind: "bundle", productName: "Obsidian Flames Booster Bundle", price: 22.4 },
    ],
  };
}

function baseSet() {
  return {
    setId: "base1",
    updated: new Date(Date.now() - 3 * HOUR).toISOString(),
    prices: [
      { kind: "pack", productName: "Base Set Booster Pack", price: 289.99 },
      { kind: "box", productName: "Base Set Booster Box" },
    ],
  };
}

/** "This set answered with nothing" — a 404, or a failure, indistinguishably. */
const NOTHING = "nothing";

/**
 * Seed a collection the mock catalog can actually name, before React mounts.
 *
 * `addInitScript` rather than `?seed=`: see the note at the top of the file.
 */
async function seedKnownSets(page: Page): Promise<void> {
  await page.addInitScript(
    (payload: { key: string; rows: unknown }) => {
      window.localStorage.setItem(payload.key, JSON.stringify(payload.rows));
    },
    { key: KEY, rows: ownRows(Date.now()) },
  );
}

/** Answer the sealed route locally. The real one reaches tcgcsv.com. */
async function stubSealed(
  page: Page,
  answer: { sv3?: unknown; base1?: unknown; status?: number } = {},
): Promise<string[]> {
  const sv3 = answer.sv3 ?? obsidianFlames();
  const base1 = answer.base1 ?? baseSet();
  const urls: string[] = [];

  await page.route("**/api/sealed/**", (route) => {
    const url = route.request().url();
    urls.push(url);
    const body = url.includes("/sealed/sv3") ? sv3 : base1;
    if (body === NOTHING) {
      return route.fulfill({
        status: answer.status ?? 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "no_sealed_products" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return urls;
}

test.describe("nothing collected", () => {
  test("says why there is nothing here, and offers the way in", async ({ page }) => {
    await openV2(page, "/sealed", { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Sealed prices", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Nothing collected yet");

    const browse = page.getByRole("link", { name: /Browse sets/ });
    await expect(browse).toBeVisible();
    await browse.click();
    expect(page.url()).toContain("#/sets");
  });

  test("asks for nothing at all when there are no sets", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openV2(page, "/sealed", { seed: "empty" });
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => u.includes("/api/sealed/"))).toEqual([]);
  });
});

test.describe("sets the catalog cannot name", () => {
  test("says so, instead of loading forever", async ({ page }) => {
    /*
     * `useSealed` counts a DISABLED query as pending, and a set's query is
     * disabled while its name is unknown — so the obvious implementation says
     * "loading 5 more…" for as long as the screen is open, waiting on a request
     * nobody will ever make. The five fixture sets are exactly that case.
     */
    await openV2(page, "/sealed", { seed: "collection" });
    const main = page.getByRole("main");
    await expect(main).toContainText("could not be matched to the catalog");
    await expect(main).toContainText("base2");
    await expect(main).not.toContainText(/Waiting on|still being fetched/);
  });

  test("never renders a zero for a price it does not have", async ({ page }) => {
    await openV2(page, "/sealed", { seed: "collection" });
    await expect(page.getByRole("main")).toContainText("No sealed prices");
    await expect(page.getByRole("main")).not.toContainText("$0.00");
  });
});

test.describe("prices", () => {
  test("tells 'not sold' apart from 'no price', and never shows zero", async ({ page }) => {
    await seedKnownSets(page);
    await stubSealed(page);
    await openV2(page, "/sealed");

    await expect(page.getByRole("heading", { name: "Obsidian Flames", level: 2 })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("$4.63");
    // The ETB is listed upstream with no market price; the booster box is not
    // listed at all. One is a fact about the feed, the other about the set.
    await expect(main).toContainText("No price");
    await expect(main).toContainText("Not sold");
    await expect(main).not.toContainText("$0.00");
    await expect(main).toContainText("Booster Box");
  });

  test("keeps the denominator on a page made entirely of prices", async ({ page }) => {
    await seedKnownSets(page);
    await stubSealed(page);
    await openV2(page, "/sealed");
    // Three of the five products these two sets actually sell have a price; the
    // other two are listed upstream with no market figure.
    await expect(page.getByRole("main")).toContainText("3 of 5 products priced");
  });

  test("says how old a reading is, and calls out one past the refresh window", async ({ page }) => {
    /*
     * The server keeps serving a cached reading when the daily refresh fails
     * ("yesterday's price beats no price", server/sealedStore.ts). That is right
     * for the data and a lie if the screen does not say so.
     */
    await seedKnownSets(page);
    await stubSealed(page, { sv3: obsidianFlames(40 * HOUR) });
    await openV2(page, "/sealed");
    await expect(page.getByRole("main")).toContainText("not today's numbers");
  });

  test("the set name goes to that set", async ({ page }) => {
    await seedKnownSets(page);
    await stubSealed(page);
    await openV2(page, "/sealed");
    await page.getByRole("link", { name: "Obsidian Flames" }).click();
    expect(page.url()).toContain("#/set/sv3");
  });

  test("asks once per set held, and no more", async ({ page }) => {
    // The measured budget: one request per set, twelve-hour staleTime against a
    // source that republishes daily. Two sets held is two requests.
    await seedKnownSets(page);
    const urls = await stubSealed(page);
    await openV2(page, "/sealed");
    await expect(page.getByRole("heading", { name: "Obsidian Flames", level: 2 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(urls.length).toBeLessThanOrEqual(2);
  });
});

test.describe("a set that came back with nothing", () => {
  test("names every possibility and offers to ask again", async ({ page }) => {
    /*
     * A 404 and a failed request reach the screen identically — and `useSealed`,
     * whose memo is keyed on `dataUpdatedAt`, cannot even be trusted to say
     * whether the query has settled, because a FAILED query never moves that
     * off zero. So the note names all three, and the button resolves it.
     */
    await seedKnownSets(page);
    await stubSealed(page, { base1: NOTHING });
    await openV2(page, "/sealed");

    const main = page.getByRole("main");
    await expect(main).toContainText("1 set has not come back");
    await expect(main).toContainText("not sold sealed");
    await expect(main).toContainText("lookup failed");
    await expect(page.getByRole("button", { name: "Look those sets up again" })).toBeVisible();
  });

  test("a failing price service does not empty the sets that worked", async ({ page }) => {
    await seedKnownSets(page);
    await stubSealed(page, { base1: NOTHING, status: 502 });
    await openV2(page, "/sealed");
    await expect(page.getByRole("heading", { name: "Obsidian Flames", level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("$4.63");
  });
});

test.describe("sealed @visual", () => {
  /**
   * The whole page, not `main` — the shell's header is sticky, and an element
   * screenshot of a taller-than-viewport `main` scrolls it up over the `<h1>`.
   * Every "read N ago" line carries `data-snapshot="volatile"`.
   */
  test("looks like itself", async ({ page }) => {
    await seedKnownSets(page);
    await stubSealed(page);
    await openV2(page, "/sealed");
    await expect(page.getByRole("heading", { name: "Obsidian Flames", level: 2 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("sealed.png", { fullPage: true });
  });
});

import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Search and card details, from `docs/v2/specs/09-search-details.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * ## What the fixtures can and cannot show
 *
 * The e2e run sets `VITE_USE_MOCKS=true`, so the catalog is the eight-card mock
 * in `src/integrations/pokemon/fixtures.ts`. Five of those eight are Charizards
 * across five sets, which is exactly the shape this screen exists for — one
 * name, several printings, different sets — so "Charizard" is the query
 * throughout. Anything outside those eight returns nothing.
 *
 * The mock provider is IN-PROCESS: a search issues no HTTP request at all, so
 * "typing costs zero requests" cannot be counted off the wire here. `?sim=slow`
 * proves it behaviourally instead — with two seconds of latency in front of the
 * catalog, a query that was issued is visible as a loading state and a query
 * that was not is visible as its absence. The details screen's printings DO go
 * over HTTP (`useSetPrintings` hits `${companionBase()}/printings/:setId`
 * whatever `VITE_USE_MOCKS` says), so that budget is counted for real.
 *
 * `?sim=empty` works here and nowhere else: `forceEmpty` in
 * `MockPokemonProvider` is honoured by `searchCards` only.
 */

const SEARCH = "/search";
const CHARIZARD = "/search/Charizard";
const CARD = "/card/sv3-223";

/**
 * Six printings on Obsidian Flames 223, two of them priced.
 *
 * `reverse:pokeball` is a PATTERN foil, which may borrow the plain reverse's
 * price — there is none here, so it stays unpriced rather than inventing one.
 * `reverse:sparkle-crown` is a foil nothing in the codebase has ever heard of,
 * which is the point: sets keep inventing them and it has to arrive as words.
 */
const PRINTINGS = [
  { type: "normal", price: 8.11 },
  { type: "reverse" },
  { type: "holo", price: 58.42 },
  { type: "reverse", foil: "pokeball" },
  { type: "reverse", foil: "sparkle-crown" },
];

/** Answer the TCGdex-backed printings endpoint locally, before anything loads. */
async function servePrintings(page: Page, byNumber: Record<string, unknown[]>): Promise<void> {
  await page.route("**/api/printings/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ tcgdexSetId: "sv3", byNumber }),
    }),
  );
}

/**
 * The set has no printings on file — a 404, which `loadPrintings` treats as
 * "genuinely unknown upstream" and does not retry direct. It is the state a
 * card link lands in whenever our own server is off, and it is what makes the
 * per-printing price fall back to the numbers riding on the card itself.
 */
async function noPrintings(page: Page): Promise<void> {
  await page.route("**/api/printings/**", (route) => route.fulfill({ status: 404, body: "{}" }));
}

/** Every request the page makes, so a budget can be asserted rather than assumed. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

test.describe("submitting is what searches", () => {
  /**
   * The acceptance criterion, behaviourally: eight characters issue nothing,
   * and pressing Search issues one thing.
   *
   * pokemontcg.io fails ~25% of the time in bursts and rate-limits on top of
   * that, so a request per keystroke spends the whole budget on prefixes nobody
   * asked about and then fails the search the user actually meant.
   */
  test("typing eight characters does nothing at all; pressing Search does", async ({ page }) => {
    await openV2(page, SEARCH, { seed: "empty", sim: "slow" });

    const box = page.getByRole("searchbox", { name: "Search cards" });
    await box.fill("Charizar");

    // Nothing on the wire, nothing on the screen, and the URL has not moved.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Search cards", level: 1 })).toBeVisible();
    expect(page.url()).toContain("#/search");
    expect(page.url()).not.toContain("Charizar");

    await page.getByRole("button", { name: "Search" }).click();

    // Now something IS happening — and it resolves into what it stood in for.
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: /Charizar/, level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test("an empty box cannot be submitted, so it cannot open a search that never runs", async ({ page }) => {
    await openV2(page, SEARCH, { seed: "empty" });

    const submit = page.getByRole("button", { name: "Search" });
    await expect(submit).toBeDisabled();

    await page.getByRole("searchbox", { name: "Search cards" }).fill("   ");
    await expect(submit).toBeDisabled();

    await page.getByRole("searchbox", { name: "Search cards" }).fill("Charizard");
    await expect(submit).toBeEnabled();
  });
});

test.describe("results", () => {
  test("every result states its set and its collector number", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });

    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();

    // The name is never enough: five of these are called some kind of
    // Charizard and two of them share a name exactly.
    for (const [name, set, number] of [
      ["Charizard ex", "Obsidian Flames", "223"],
      ["Charizard ex", "Obsidian Flames", "125"],
      ["Charizard", "Base", "4"],
      // A straight apostrophe: that is what the catalog actually returns, and
      // the screen must not quietly prettify data it did not author.
      ["Charizard V", "Champion's Path", "25"],
    ] as const) {
      await expect(page.getByRole("link", { name: new RegExp(`${name} ${set} · ${number}`) })).toHaveCount(1);
    }
  });

  test("prices each result, and never renders $0.00", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });
    const main = page.getByRole("main");

    await expect(main).toContainText("$58.42");
    await expect(main).toContainText("$289.99");
    await expect(main).not.toContainText("$0.00");
  });

  test("every result is a target at least 44px, on a phone and on a laptop", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();

    const tiles = page.getByRole("link", { name: /Charizard/ });
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await tiles.nth(i).boundingBox();
      expect(box, `result ${i} has no box`).not.toBeNull();
      // The reason is a thumb, so it does not shrink on a wide window.
      expect(box!.height, `result ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `result ${i} width`).toBeGreaterThanOrEqual(44);
    }
  });

  /**
   * The rarity chips filter IN MEMORY. v1 hands `rarities` down to the query,
   * which makes each chip a fresh round trip against the flakiest endpoint in
   * the app for a list the browser is already holding.
   */
  test("a rarity chip narrows the list and keeps both numbers", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });

    const rarities = page.getByRole("group", { name: "Filter by rarity" });
    await rarities.getByRole("button", { name: "Special Illustration Rare" }).click();

    // Both numbers: a bare "1 result" under an active filter reads as a search
    // that found one card.
    await expect(
      page.getByRole("heading", { name: "1 of 5 results · Special Illustration Rare", level: 2 }),
    ).toBeVisible();

    await rarities.getByRole("button", { name: "All rarities" }).click();
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();
  });

  test("a filter that matches nothing blames the filter, not the search", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });

    // The mock catalog has a Special Illustration Rare and no plain
    // Illustration Rare at all.
    await page.getByRole("button", { name: "Illustration Rare", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No Illustration Rare cards among these results", level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText("clear the filter");
  });
});

test.describe("the idle screen", () => {
  test("offers what you searched before, and can forget it", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();

    // Recorded on arrival, so every route into a search is remembered — not
    // only the ones that started in this box.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
    const recents = page.getByRole("list", { name: "Recent searches" });
    await expect(recents.getByRole("link", { name: "Charizard" })).toBeVisible();

    // And it is a real link back to that search.
    await recents.getByRole("link", { name: "Charizard" }).click();
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("list", { name: "Recent searches" })).toHaveCount(0);
  });

  test("is never a dead end, even with nothing searched yet", async ({ page }) => {
    await openV2(page, SEARCH, { seed: "empty" });

    // An idle box with nothing under it asks the reader to think of something.
    const popular = page.getByRole("list", { name: "Popular searches" });
    await expect(popular.getByRole("link", { name: "Charizard" })).toBeVisible();
    await popular.getByRole("link", { name: "Charizard" }).click();
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();
  });
});

test.describe("when the catalog does not co-operate", () => {
  test("says nothing matched, and how to ask better — without blaming the typist", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty", sim: "empty" });

    await expect(page.getByRole("heading", { name: /Nothing matched/, level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("collector number");
  });

  test("says the catalog failed, offers a retry, and does not blame the user", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty", sim: "fail" });

    await expect(page.getByRole("heading", { name: "The catalog didn’t answer", level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Nothing is wrong with what you typed");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // The simulation is sticky, so retrying keeps failing — what matters is
    // that it stays honest rather than blanking.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "The catalog didn’t answer", level: 2 })).toBeVisible();
  });

  /**
   * Offline is not a catalog failure, and React Query does not report it as
   * one: under the default `networkMode` the query PAUSES, reporting neither an
   * error nor a finished load. Without a branch for it, an offline search is a
   * skeleton that spins until the wifi comes back.
   */
  test("calls offline offline, and recovers when the network does", async ({ page, context }) => {
    await openV2(page, SEARCH, { seed: "empty" });
    await context.setOffline(true);

    await page.getByRole("searchbox", { name: "Search cards" }).fill("Charizard");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByRole("heading", { name: "You’re offline", level: 2 })).toBeVisible();
    // No retry: a button that cannot possibly work trains people to press it.
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("card details", () => {
  test("gives every printing its own row, priced separately, n/a where unknown", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });

    await expect(page.getByRole("heading", { name: "Charizard ex", level: 1 })).toBeVisible();
    // The number as it is printed on the card: Obsidian Flames has 230 cards
    // numbered out of 197, so "223/230" is a number that appears nowhere.
    await expect(page.getByRole("main")).toContainText("223/197");

    const main = page.getByRole("main");
    await expect(main).toContainText("$8.11");
    await expect(main).toContainText("$58.42");
    // The plain reverse has no price, and neither does the Poké Ball reverse
    // that would borrow it. A foil nothing has heard of arrives as words.
    await expect(main).toContainText("n/a");
    await expect(main).toContainText("Sparkle crown Reverse");
    await expect(main).not.toContainText("sparkle-crown");
    await expect(main).not.toContainText("$0.00");
    // And the denominator, always: two of five is a card half as priced as it
    // looks, and a column of grey is what a worthless card looks like too.
    await expect(main).toContainText("2 of 5 priced");
  });

  /**
   * Our own server is a home machine that spends days at a time powered off.
   * When it cannot answer, the per-printing price falls back to the numbers
   * already riding on the card — which is a third request avoided, not a price
   * invented.
   */
  test("still prices a printing when the printings server has nothing", async ({ page }) => {
    await noPrintings(page);
    await openV2(page, CARD, { seed: "empty" });

    await expect(page.getByRole("heading", { name: "Charizard ex", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("$58.42");
    await expect(page.getByRole("main")).not.toContainText("$0.00");
  });

  test("marks one printing without marking the card, and the set screen agrees", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });

    const normal = page.getByRole("button", { name: /^Normal/ });
    await expect(normal).toHaveAccessibleName(/not owned/);
    await normal.click();
    await expect(page.getByRole("button", { name: /^Normal/ })).toHaveAccessibleName(/(?<!not )owned/);
    // The other printing of the same card is untouched.
    await expect(page.getByRole("button", { name: /^Holofoil/ })).toHaveAccessibleName(/not owned/);

    // Reflected on the set screen without a reload — same session, same store.
    await page.getByRole("link", { name: "Open Obsidian Flames" }).click();
    await expect(page.getByRole("button", { name: /Charizard ex 223 · Normal/ })).toHaveAccessibleName(
      /(?<!not )owned/,
    );
  });

  /**
   * The gap this screen was built to close.
   *
   * TCGdex lists every printing ever made, so a master set contains box toppers
   * and staff promos nobody is chasing — and until one can be excluded, the
   * completion figure has an unreachable denominator. v2's set grid DRAWS an
   * excluded printing and, before this screen, nothing in v2 could produce one.
   */
  test("takes a printing out of the set, and puts it back", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });

    await page.getByRole("button", { name: "Exclude Reverse Holo from this set" }).click();
    await expect(page.getByRole("button", { name: /^Reverse Holo/ })).toHaveAccessibleName(/Not in this set/);

    // The set grid is where the consequence shows up.
    await page.getByRole("link", { name: "Open Obsidian Flames" }).click();
    await expect(page.getByRole("button", { name: /Charizard ex 223 · Reverse Holo/ })).toHaveAccessibleName(
      /Excluded/,
    );

    await page.goBack();
    await page.getByRole("button", { name: "Include Reverse Holo in this set" }).click();
    await expect(page.getByRole("button", { name: /^Reverse Holo/ })).not.toHaveAccessibleName(
      /Not in this set/,
    );
  });

  test("says so when prices could not be reached, without looking broken", async ({ page }) => {
    // Our own server unreachable: not a 404, which means "no such set", but a
    // failure — the card still draws and marking still works.
    await page.route("**/api/printings/**", (route) => route.abort());
    await openV2(page, CARD, { seed: "empty", sim: "fail" });

    await expect(page.getByRole("heading", { name: "Couldn’t load this card", level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Nothing you have marked is affected");
    await expect(page.getByRole("link", { name: "Search for it instead" })).toBeVisible();
  });
});

test.describe("moving between the two", () => {
  test("a result opens its card, and Back returns to the results", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CHARIZARD, { seed: "empty" });

    await page.getByRole("link", { name: /Charizard ex Obsidian Flames · 223/ }).click();
    await expect(page.getByRole("heading", { name: "Charizard ex", level: 1 })).toBeVisible();
    expect(page.url()).toContain("#/card/sv3-223");

    await page.goBack();
    // The same list, with the query still in the box.
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search cards" })).toHaveValue("Charizard");
  });

  test("what you mark on a card shows up in the next search for it", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });

    await page.getByRole("button", { name: /^Normal/ }).click();
    await page.getByRole("link", { name: "Every Charizard ex card" }).click();

    // Which of the results you already have is most of what you came to find
    // out — and it is a word, not a tint.
    await expect(page.getByRole("link", { name: /Charizard ex Obsidian Flames · 223.*Owned/ })).toBeVisible();
  });
});

test.describe("the request budget", () => {
  /**
   * Card details asks our own server for the set's printings ONCE, whatever the
   * card has. Building a set's printings upstream costs 120–295 requests, which
   * is why nothing here may fan out per printing — and why this screen does not
   * call `getPrices` at all: the index it already has prices every row.
   */
  test("asks one URL for every printing of the card, and nothing more to mark them", async ({ page }) => {
    const urls = recordRequests(page);
    const printings = () => urls.filter((u) => u.includes("/api/printings/"));

    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Charizard ex", level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    /*
     * ONE URL, not one per printing. The COUNT is allowed to be two rather than
     * one because `src/main.tsx` mounts under `StrictMode` and the dev server
     * runs unminified React: the double mount aborts the first fetch and
     * repeats it. That is an artefact of the harness, not of the screen — the
     * distinct URL count is the part that measures the screen.
     */
    expect(new Set(printings()).size).toBe(1);
    expect(printings().length).toBeLessThanOrEqual(2);
    const before = printings().length;

    for (const printing of ["Normal", "Holofoil", "Reverse Holo"]) {
      await page.getByRole("button", { name: new RegExp(`^${printing}`) }).click();
    }
    await page.waitForLoadState("networkidle");

    // Marking is local-first: three marks, zero requests.
    expect(printings().length).toBe(before);
    // And nothing upstream at all — everything came from our own server or the
    // payload that was already in hand.
    expect(urls.filter((u) => u.includes("api.pokemontcg.io"))).toEqual([]);
    expect(urls.filter((u) => u.includes("api.tcgdex.net"))).toEqual([]);
  });
});

test.describe("search and details @visual", () => {
  /**
   * The whole page, not the `main` element.
   *
   * The shell's header is `position: sticky`, so an element screenshot of a
   * `main` taller than the viewport scrolls it up until the header sits on top
   * of the screen's own `<h1>`. `fullPage` starts at the top of the document,
   * where the sticky header belongs; the sync label inside it is hidden by
   * `stabiliseForSnapshot` because its text counts real minutes.
   */
  test("results look like themselves", async ({ page }) => {
    await openV2(page, CHARIZARD, { seed: "empty" });
    await expect(page.getByRole("heading", { name: "5 results", level: 2 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("search-results.png", { fullPage: true });
  });

  test("card details looks like itself", async ({ page }) => {
    await servePrintings(page, { "223": PRINTINGS });
    await openV2(page, CARD, { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Charizard ex", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("2 of 5 priced");
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("card-details.png", { fullPage: true });
  });
});

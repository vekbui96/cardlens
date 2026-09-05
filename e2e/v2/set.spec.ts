import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Set cards, from `docs/v2/specs/03-set-cards.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * ## What the fixtures can and cannot show
 *
 * The e2e run sets `VITE_USE_MOCKS=true`, so the catalog is the eight-card mock
 * set in `src/integrations/pokemon/fixtures.ts`. Obsidian Flames (`sv3`) is the
 * only mock set with more than one card, and neither of its cards has more than
 * one finish — a Special Illustration Rare really does only print one way — so
 * the mock catalog on its own can never produce a card with three printings, a
 * per-printing price, or a second binder page.
 *
 * `useSetPrintings` is the way in. It hits `${companionBase()}/printings/:setId`
 * regardless of `VITE_USE_MOCKS`, and `useSetView` prefers that index over the
 * mock's variants fallback the moment it answers — so routing that one endpoint
 * controls exactly what the screen renders without touching a card fixture. The
 * same trick is already used by `e2e/phone-layout.spec.ts`.
 *
 * `?seed=collection` marks five cards in five sets the mock catalog has never
 * heard of (`base2`, `ecard3`, `ex2`, `ex10`, `pop3`), so it contributes nothing
 * to this set — it is seeded anyway because it is what fills the set switcher.
 */

const SET = "/set/sv3/Obsidian%20Flames";

/**
 * Six printings on each of the set's two cards: twelve pockets, which is one
 * full nine-pocket page plus a short one. Two pages is the smallest number that
 * can show a page marker being right, a short last page being marked full, and
 * pages sitting side by side on a wide window.
 *
 * `reverse:pokeball` is a PATTERN foil, which may borrow the plain reverse
 * price — there is none here, so it stays unpriced rather than inventing one.
 * `reverse:sparkle-crown` is a foil nothing in the codebase has ever heard of,
 * which is the point: sets keep inventing them, and it has to arrive as words.
 */
const PRINTINGS = [
  { type: "normal", price: 8.11 },
  { type: "reverse" },
  { type: "holo", price: 58.42 },
  { type: "reverse", foil: "pokeball" },
  { type: "reverse", foil: "sparkle-crown" },
  { type: "holo", foil: "tinsel" },
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

/** Both mock collector numbers, so nothing depends on render order. */
const FULL = { "125": PRINTINGS, "223": PRINTINGS };

/** Every request the page makes, so a budget can be asserted rather than assumed. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

test.describe("the binder page", () => {
  test("draws the set as nine-pocket pages in collector order", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    await expect(page.getByRole("heading", { name: "Obsidian Flames", level: 1 })).toBeVisible();
    // Twelve printings: one full page, then a short one. A short last page is
    // still a page — refusing to draw it would lose three pockets.
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page 2", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page 3", level: 2 })).toHaveCount(0);
  });

  test("gives a card with six printings six independent targets", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    // One card, six pockets, six different printing names. A single tile saying
    // "1 of 6 printings" would describe a pocket that does not exist.
    const pockets = page.getByRole("button", { name: /Charizard ex 125 · / });
    await expect(pockets).toHaveCount(6);
    // Not "Holofoil": it is a prefix of "Holofoil — Tinsel", and a substring
    // match would find two pockets and prove nothing.
    for (const printing of ["Normal", "Reverse Holo", "Poké Ball Reverse", "Sparkle crown Reverse"]) {
      await expect(
        page.getByRole("button", { name: `Charizard ex 125 · ${printing}`, exact: false }),
      ).toHaveCount(1);
    }
  });

  test("humanises a foil nothing has ever heard of, rather than showing a key", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    // Three 2025-26 sets introduced nine new foils between them; anything
    // hardcoded is wrong by the next release.
    await expect(page.getByRole("main")).toContainText("Sparkle crown Reverse");
    await expect(page.getByRole("main")).not.toContainText("sparkle-crown");
  });

  test("prices each printing separately, and never renders $0.00", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });
    const main = page.getByRole("main");

    await expect(main).toContainText("$8.11");
    await expect(main).toContainText("$58.42");
    /*
     * The plain reverse has no price of its own, and neither does the Poké Ball
     * reverse that would borrow it. `holo:tinsel` DOES take the holo price:
     * a pattern is the same print run pressed differently, so borrowing there is
     * an approximation rather than an invention. Both outcomes are the domain
     * layer's (`models/finishes.ts`), and the screen shows whichever it gets.
     */
    await expect(main).toContainText("Unavailable");
    await expect(main).not.toContainText("$0.00");
    // And the denominator, always: six of twelve is a set half as priced as it
    // looks, and a grid of grey is what a worthless set looks like too.
    await expect(main).toContainText("6 of 12 printings priced");
  });

  test("every printing target is at least 44px, on a phone and on a laptop", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });
    // `count()` does not retry, so the pages have to be on screen first.
    await expect(page.getByRole("heading", { name: "Page 2", level: 2 })).toBeVisible();

    const pockets = page.getByRole("button", { name: /Charizard ex 125 · / });
    const count = await pockets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await pockets.nth(i).boundingBox();
      expect(box, `pocket ${i} has no box`).not.toBeNull();
      // The reason is a thumb, so it does not shrink on a wide window.
      expect(box!.height, `pocket ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `pocket ${i} width`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("marking", () => {
  test("marks one printing without marking the card, and survives a reload", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    const normal = page.getByRole("button", { name: /Charizard ex 125 · Normal/ });
    const reverse = page.getByRole("button", { name: /Charizard ex 125 · Reverse Holo/ });
    await expect(normal).toHaveAccessibleName(/not owned/);

    await normal.click();
    await expect(page.getByRole("button", { name: /Charizard ex 125 · Normal/ })).toHaveAccessibleName(
      /(?<!not )owned/,
    );
    // The other printing of the same card is untouched — this is per-printing
    // marking, which is the whole difference between a set list and a binder.
    await expect(reverse).toHaveAccessibleName(/not owned/);

    // Local-first: the mark is in storage before any network round trip, so a
    // reload has to find it there.
    await page.reload();
    await expect(page.getByRole("button", { name: /Charizard ex 125 · Normal/ })).toHaveAccessibleName(
      /(?<!not )owned/,
    );
  });

  test("a marked page counts itself, and says complete in words when it is", async ({ page }) => {
    // One card, one printing each, so a whole page can actually be finished.
    await servePrintings(page, { "125": [{ type: "normal" }], "223": [{ type: "normal" }] });
    await openV2(page, SET, { seed: "collection" });

    await expect(page.getByRole("main")).toContainText("0/2");
    for (const number of ["125", "223"]) {
      await page.getByRole("button", { name: new RegExp(`Charizard ex ${number} · Normal`) }).click();
    }
    // Gold is the reward for noticing; the word is the information.
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  });
});

test.describe("filters", () => {
  test("a filter swaps the pages for a flat grid, and clearing it puts them back", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();

    const rarities = page.getByRole("group", { name: "Filter by rarity" });
    await rarities.getByRole("button", { name: "Special Illustration Rare" }).click();

    // A "Page 2" drawn over a discontinuous run names a sheet that does not
    // exist, so the pages go and a plain count takes their place.
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "6 printings · Special Illustration Rare", level: 2 }),
    ).toBeVisible();

    await rarities.getByRole("button", { name: "All rarities" }).click();
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
  });

  test("a filter that matches nothing says which kind of nothing it is", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    // The set has a Special Illustration Rare and a Double Rare, and no
    // Illustration Rare at all.
    await page.getByRole("button", { name: "Illustration Rare", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No Illustration Rare cards in this set", level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Try another rarity");
  });

  test("finishing a set reads as good news, not as an empty search", async ({ page }) => {
    await servePrintings(page, { "125": [{ type: "normal" }], "223": [{ type: "normal" }] });
    await openV2(page, SET, { seed: "collection" });

    await page.getByRole("button", { name: "Missing only" }).click();
    await expect(page.getByRole("button", { name: /Charizard ex 125 · Normal/ })).toBeVisible();

    for (const number of ["125", "223"]) {
      await page.getByRole("button", { name: new RegExp(`Charizard ex ${number} · Normal`) }).click();
    }
    await expect(page.getByRole("heading", { name: "Nothing missing", level: 2 })).toBeVisible();
  });
});

test.describe("a set with no variant data", () => {
  test("still marks, and says its prices are unavailable rather than zero", async ({ page }) => {
    // Pitch Black returns `prices: {}` for all 120 of its cards. The cards must
    // still be markable — that is the whole job of the screen — and the prices
    // have to say so rather than reading as free.
    await servePrintings(page, {});
    await openV2(page, SET, { seed: "collection" });

    const main = page.getByRole("main");
    await expect(main).toContainText("No prices for any of the 2 printings in this set");
    await expect(main).not.toContainText("$0.00");

    const pocket = page.getByRole("button", { name: /Charizard ex 125 · Holofoil/ });
    await pocket.click();
    await expect(page.getByRole("button", { name: /Charizard ex 125 · Holofoil/ })).toHaveAccessibleName(
      /(?<!not )owned/,
    );
  });
});

test.describe("when the catalog does not co-operate", () => {
  test("waits with page-shaped skeletons rather than a spinner", async ({ page }) => {
    await servePrintings(page, FULL);
    // `?sim=slow` puts 2s of latency in front of the catalog — long enough to
    // see what the screen does while it has nothing.
    await openV2(page, SET, { seed: "collection", sim: "slow" });

    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    // And it resolves into the thing it was standing in for, so nothing jumps.
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible({ timeout: 15_000 });
  });

  test("says what could not be reached, and offers a retry", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection", sim: "fail" });

    // Names the set, does not blame the user, and says what is still safe.
    await expect(page.getByRole("heading", { name: /Couldn’t load this set/, level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("safe on this device");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("an empty set is a dead end unless it offers a way out", async ({ page }) => {
    /*
     * A set the catalog has nothing indexed for, reached by opening one of the
     * five `?seed=collection` marks — those live in sets the mock catalog has
     * never heard of, which is exactly this state.
     *
     * NOT `?sim=empty`: `forceEmpty` in `MockPokemonProvider` is honoured by
     * `searchCards` alone, so `getCardsBySet` returns the set's cards anyway and
     * the simulation quietly does nothing here. Reported, not fixed.
     */
    await servePrintings(page, {});
    await openV2(page, "/set/base2/Base%20Set%202", { seed: "collection" });

    await expect(page.getByRole("heading", { name: "No cards for this set", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse all sets" })).toBeVisible();
    // It still says what it knows: one card of yours is filed under this set.
    await expect(page.getByRole("main")).toContainText("1 card");
  });
});

test.describe("the set switcher", () => {
  test("moves to another set without going back first", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });

    await page.getByRole("button", { name: "Switch set" }).click();
    const sheet = page.getByRole("dialog", { name: "Switch set" });
    await expect(sheet).toBeVisible();
    // The set being viewed is always in its own switcher, even at zero owned.
    await expect(sheet.getByRole("button", { name: /you are here/ })).toBeVisible();

    // The five seeded sets are sets the mock catalog cannot name, so they keep
    // their ids as labels rather than dropping out of the list.
    await sheet.getByRole("button", { name: /base2/ }).click();
    await expect(sheet).toHaveCount(0);
    expect(page.url()).toContain("#/set/base2");
  });
});

test.describe("the request budget", () => {
  /**
   * A set of 120 cards issues ONE printings request, not 120. Building a set's
   * printings upstream costs 120–295 requests, which is why our own server
   * caches them on disk and why nothing on this screen may fan out per card.
   *
   * The rarity filter is the part worth checking: v1 hands `rarities` to
   * `useSetView`, which on the fallback path opens a fresh `set-cards` query per
   * rarity. v2 filters in memory over a list it already holds, so pressing every
   * chip costs nothing at all.
   */
  test("asks one URL for every printing in the set, and nothing more for a filter", async ({ page }) => {
    const urls = recordRequests(page);
    const printings = () => urls.filter((u) => u.includes("/api/printings/"));

    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    /*
     * ONE URL, not one per card. Building a set's printings upstream costs
     * 120–295 requests, which is why our own server caches them on disk.
     *
     * The COUNT is asserted at two rather than one because `src/main.tsx` mounts
     * under `StrictMode` and the dev server runs unminified React: the double
     * mount aborts the first fetch and repeats it. That is a development
     * artefact of the harness, not something the screen does — the distinct URL
     * count is the part that measures the screen.
     */
    expect(new Set(printings()).size).toBe(1);
    expect(printings().length).toBeLessThanOrEqual(2);
    const beforeFilters = printings().length;

    const rarities = page.getByRole("group", { name: "Filter by rarity" });
    for (const label of ["Special Illustration Rare", "Full Art / Ultra", "All rarities"]) {
      await rarities.getByRole("button", { name: label }).click();
    }
    await page.getByRole("button", { name: "Missing only" }).click();
    await page.waitForLoadState("networkidle");

    /*
     * Zero requests for four filter changes. This is the departure from v1
     * worth measuring: v1 passes `rarities` into `useSetView`, which on the
     * fallback path opens a fresh `set-cards` query per rarity, so five chips
     * are five round trips over a list already in the browser.
     */
    expect(printings().length).toBe(beforeFilters);
    // And nothing upstream at all — the set arrived from our own server.
    expect(urls.filter((u) => u.includes("api.pokemontcg.io"))).toEqual([]);
    expect(urls.filter((u) => u.includes("api.tcgdex.net"))).toEqual([]);
  });
});

test.describe("set cards @visual", () => {
  /**
   * The whole page, not the `main` element.
   *
   * The shell's header is `position: sticky`, so an element screenshot of a
   * `main` taller than the viewport scrolls it up until the header sits on top
   * of the screen's own `<h1>`. `fullPage` starts at the top of the document,
   * where the sticky header belongs; the sync label inside it is hidden by
   * `stabiliseForSnapshot` because its text counts real minutes.
   */
  test("looks like itself", async ({ page }) => {
    await servePrintings(page, FULL);
    await openV2(page, SET, { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Page 2", level: 2 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("set-cards.png", { fullPage: true });
  });
});

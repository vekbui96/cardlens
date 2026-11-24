import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Card details, driven the way a person drives it.
 *
 * Unlike the catalog, `/api/printings/:setId` is OUR server and is real HTTP
 * even under `VITE_USE_MOCKS` — so this file can intercept it, count the
 * requests, and make it fail exactly twice. That is what makes "a 500 shows a
 * retry, and retrying works" an end-to-end fact here rather than an inference.
 */

/**
 * Three printings with three different price provenances:
 *
 * - `normal` priced by TCGdex,
 * - `holo` priced by nothing here, so it falls back to the card's own catalog
 *   market price,
 * - `reverse:pokeball` priced by neither, because pokemontcg.io has never
 *   reported a pattern foil and a patterned reverse must not borrow a plain
 *   one's number across a stamp.
 */
const PRINTINGS = {
  tcgdexSetId: "sv03",
  byNumber: {
    "223": [{ type: "normal", price: 1.5 }, { type: "holo" }, { type: "reverse", foil: "pokeball" }],
  },
};

async function servePrintings(page: Page, options: { failFirst?: number } = {}): Promise<() => number> {
  let calls = 0;
  // Our server failing falls through to TCGdex directly. Blocking it is what
  // makes a simulated failure actually fail, rather than quietly succeeding
  // against the live internet and making the test depend on the weather.
  await page.route(/api\.tcgdex\.net/, (route) => route.abort("failed"));
  await page.route("**/api/printings/**", async (route) => {
    calls += 1;
    if (calls <= (options.failFirst ?? 0)) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "printings_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PRINTINGS),
    });
  });
  return () => calls;
}

const CARD = "/card/sv3-223";

test.describe("everything about this printing", () => {
  test("names the card, its set, its number and the printed denominator", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);

    await expect(page.getByRole("heading", { level: 1, name: "Charizard ex" })).toBeVisible();
    await expect(page.getByText("Obsidian Flames")).toBeVisible();
    // 223 of a printed 197 — the denominator is what says "secret rare".
    await expect(page.getByText("223/197")).toBeVisible();
    await expect(page.getByText("Special Illustration Rare")).toBeVisible();
  });

  test("lists every printing with its own price, and Unpriced where there is none", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);

    const printings = page.getByRole("heading", { name: "Printings" });
    await expect(printings).toBeVisible();

    await expect(page.getByRole("button", { name: /^Normal/ })).toHaveAccessibleName(/\$1\.50/);
    await expect(page.getByRole("button", { name: /^Holofoil/ })).toHaveAccessibleName(/\$58\.42/);

    // A blank would read as loading forever and $0.00 would read as free.
    const pokeball = page.getByRole("button", { name: /Poké Ball Reverse/ });
    await expect(pokeball).toHaveAccessibleName(/Unpriced/);
    await expect(pokeball).not.toHaveAccessibleName(/\$0\.00/);
  });

  test("marks one printing without touching the others, and remembers it", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);

    const normal = page.getByRole("button", { name: /^Normal/ });
    await expect(normal).toHaveAccessibleName(/Not owned/);
    await normal.click();
    await expect(page.getByRole("button", { name: /^Normal Owned/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Holofoil/ })).toHaveAccessibleName(/Not owned/);

    /*
     * The row the set screen reads. It is written through the shared
     * `LibraryProvider` — the same instance both versions of the app mount
     * once, above the router — so a set screen already on the stack re-renders
     * from it with no reload and no refetch. What matters for THAT screen is
     * that the row carries its set and its collector number; without them it
     * cannot place the mark. (The no-reload half is asserted directly against
     * the provider in src/v2/screens/details/CardDetailsScreen.test.tsx, which
     * can hold a second consumer of it on screen at once.)
     */
    const rows = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(":collection"));
      return key ? (JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[]) : null;
    });
    expect(rows).toEqual([
      expect.objectContaining({ cardId: "sv3-223", setId: "sv3", finish: "normal", number: "223" }),
    ]);

    // And it survives leaving and coming back, without a reload.
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.goBack();
    await expect(page.getByRole("button", { name: /^Normal Owned/ })).toBeVisible();
  });
});

test.describe("next and previous card", () => {
  test("steps through the search results, and Back returns to them", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, "/search/charizard");
    const tiles = page.getByRole("link", { name: /#\d/ });
    await expect(tiles).toHaveCount(5);
    await tiles.first().click();

    const previous = page.getByRole("button", { name: "Previous card" });
    const next = page.getByRole("button", { name: "Next card" });
    await expect(page.getByText("1 of 5 · Search results")).toBeVisible();
    await expect(previous).toBeDisabled();
    // A real tap target on both shells.
    expect((await next.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const firstUrl = page.url();
    await next.click();
    await expect(page.getByText("2 of 5 · Search results")).toBeVisible();
    expect(page.url()).not.toBe(firstUrl);
    await expect(previous).toBeEnabled();

    // One Back, straight to the results — not to the card stepped past.
    await page.goBack();
    await expect(page.getByRole("heading", { name: /for “charizard”/ })).toBeVisible();
  });

  test("a card opened by its link has no list to step through", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);
    await expect(page.getByRole("heading", { level: 1, name: "Charizard ex" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next card" })).toHaveCount(0);
  });
});

test.describe("a flaky printing list", () => {
  test("a 500 shows a retry that works", async ({ page }) => {
    // Two failures, because the hook already retries once on its own — so the
    // error state only appears during a genuine burst.
    const calls = await servePrintings(page, { failFirst: 2 });
    await openV2(page, CARD);

    await expect(page.getByText(/printing list could not be reached/i)).toBeVisible();
    await expect(page.getByText(/nothing here is wrong with the card/i)).toBeVisible();

    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByRole("button", { name: /Poké Ball Reverse/ })).toBeVisible();
    await expect(page.getByText(/printing list could not be reached/i)).toHaveCount(0);
    expect(calls()).toBe(3);
  });
});

test.describe("details @visual", () => {
  test("look like themselves", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);
    await expect(page.getByRole("button", { name: /Poké Ball Reverse/ })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("card-details.png");
  });

  test("a marked printing looks like itself", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, CARD);
    await page.getByRole("button", { name: /^Normal/ }).click();
    await expect(page.getByRole("button", { name: /^Normal Owned/ })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("card-details-marked.png");
  });

  test("opened from search results looks like itself", async ({ page }) => {
    await servePrintings(page);
    await openV2(page, "/search/charizard");
    await page.getByRole("link", { name: /obsidian flames.*#223/i }).click();
    await expect(page.getByRole("button", { name: /Poké Ball Reverse/ })).toBeVisible();
    await stabiliseForSnapshot(page);
    // The viewport, not `main`: a full-height capture of main slides the sticky
    // header over its top on the phone, which is exactly where this screen's
    // previous / next bar sits.
    await expect(page).toHaveScreenshot("card-details-from-search.png");
  });

  test("opened from Home after a list was browsed looks like itself", async ({ page }) => {
    await servePrintings(page);
    // A list left over from earlier browsing in this tab, holding this very card.
    await page.addInitScript(() => {
      const stale = JSON.stringify({ label: "Search results", cardIds: ["sv3-1", "sv3-223", "sv3-224"] });
      sessionStorage.setItem("cardlens:v1:browse-list", stale);
      sessionStorage.setItem("cardlens:v2:browse-list", stale);
    });
    await openV2(page, "/");
    await page.evaluate(() => {
      window.location.hash = "#/card/sv3-223";
    });
    await expect(page.getByRole("button", { name: /Poké Ball Reverse/ })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("navigation", { name: "Step through this list" })).toHaveCount(0);
    await expect(page).toHaveScreenshot("card-details-from-home.png");
  });

  test("the printing-list failure looks like itself", async ({ page }) => {
    await servePrintings(page, { failFirst: 99 });
    await openV2(page, CARD);
    await expect(page.getByText(/printing list could not be reached/i)).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("card-details-printings-failure.png");
  });
});

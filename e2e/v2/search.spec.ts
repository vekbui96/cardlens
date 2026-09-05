import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Search, driven the way a person drives it.
 *
 * The rule this suite exists to hold is the first one: **typing does not
 * search**. It is asserted three ways, because each is weak on its own —
 *
 * 1. The URL. The query that gets fetched is the one in the hash, so a hash
 *    that has not changed is a search that has not happened. This is the strong
 *    one: it is the actual mechanism, not a symptom.
 * 2. The screen. Under `?sim=slow` a real search takes two seconds and shows a
 *    busy skeleton the whole time. Eight keystrokes producing no busy state at
 *    all is a behavioural discriminator, not an inference.
 * 3. A request count. Honest caveat: the e2e build runs `VITE_USE_MOCKS=true`,
 *    so the catalog never reaches the network here and this count is zero
 *    whatever the screen does. It is kept as a tripwire for the day the mock is
 *    swapped out. The number that actually proves the rule is counted at the
 *    provider in `src/v2/screens/search/SearchScreen.test.tsx`.
 */

/** Counts every call to any of our APIs, so "zero" is assertable. */
async function countApiCalls(page: Page): Promise<() => number> {
  let calls = 0;
  await page.route("**/api/**", async (route) => {
    calls += 1;
    await route.continue();
  });
  return () => calls;
}

const searchBox = (page: Page) => page.getByRole("searchbox", { name: /card name or number/i });
const searchButton = (page: Page) => page.getByRole("button", { name: "Search", exact: true });

test.describe("typing does not search", () => {
  test("eight characters change nothing; the submit is what searches", async ({ page }) => {
    const apiCalls = await countApiCalls(page);
    await openV2(page, "/search");

    await expect(page.getByRole("heading", { name: /nothing searched yet/i })).toBeVisible();

    await searchBox(page).pressSequentially("charizar", { delay: 30 });

    // The URL is the query. It has not moved, so no search has been issued.
    expect(page.url()).toContain("#/search");
    expect(page.url()).not.toContain("charizar");
    await expect(page.getByRole("heading", { name: /nothing searched yet/i })).toBeVisible();
    expect(apiCalls()).toBe(0);

    await searchButton(page).click();

    await expect(page.getByRole("heading", { name: /for “charizar”/ })).toBeVisible();
    expect(page.url()).toContain("#/search/charizar");
  });

  test("a two-second catalog never even starts while keys are being pressed", async ({ page }) => {
    // ?sim=slow puts 2s of latency on every catalog call, so a search in flight
    // is visible for long enough to catch. Eight keystrokes, no busy state.
    await openV2(page, "/search", { sim: "slow" });

    await searchBox(page).pressSequentially("charizar", { delay: 30 });
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);

    await searchButton(page).click();

    // And the moment it IS submitted, the wait becomes visible.
    await expect(page.getByRole("heading", { name: /searching for “charizar”/i })).toBeVisible();
    await expect(page.locator("[aria-busy='true']")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /for “charizar”/ })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("results", () => {
  test("are a grid, and every card states its set and number", async ({ page }) => {
    await openV2(page, "/search/charizard");

    const tiles = page.getByRole("button", { name: /charizard/i });
    await expect(tiles).toHaveCount(5);

    // Two of the five are from the same set. The name cannot tell them apart —
    // and with 108 real Charizards, neither could a list that omitted either.
    await expect(page.getByRole("button", { name: /obsidian flames.*#223/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /obsidian flames.*#125/i })).toBeVisible();
  });

  test("say when nothing matched, rather than showing an empty strip", async ({ page }) => {
    await openV2(page, "/search/charizard", { sim: "empty" });
    await expect(page.getByRole("heading", { name: /nothing matched “charizard”/i })).toBeVisible();
  });
});

test.describe("a flaky catalog", () => {
  test("offers a retry inline and does not blame the query", async ({ page }) => {
    await openV2(page, "/search/charizard", { sim: "fail" });

    await expect(page.getByRole("heading", { name: /the card catalog did not answer/i })).toBeVisible();
    await expect(page.getByText(/nothing wrong with “charizard”/i)).toBeVisible();

    // The retry is a real button and re-runs the search. ?sim=fail is a
    // permanent outage rather than a burst, so it fails again — that a retry
    // RECOVERS is proven where a transient failure can be arranged, in
    // src/v2/screens/search/SearchScreen.test.tsx and in details.spec.ts.
    const retry = page.getByRole("button", { name: /try again/i });
    await retry.click();
    await expect(page.getByRole("heading", { name: /the card catalog did not answer/i })).toBeVisible();
    await expect(retry).toBeEnabled();
  });
});

test.describe("recent searches", () => {
  test("are offered on the idle screen and run when pressed", async ({ page }) => {
    const shell = await openV2(page, "/search");
    await searchBox(page).fill("charizard");
    await searchButton(page).click();
    await expect(page.getByRole("heading", { name: /for “charizard”/ })).toBeVisible();

    await shell.goTo("Search");
    const recent = page.getByRole("button", { name: "charizard", exact: true });
    await expect(recent).toBeVisible();

    await recent.click();
    await expect(page.getByRole("heading", { name: /for “charizard”/ })).toBeVisible();
  });
});

test.describe("back from a card", () => {
  test("returns to the results scrolled where they were left", async ({ page }) => {
    // Forced narrow AND short, in both projects, so there is definitely a page
    // to scroll. A test that passes because 0 equals 0 is not a test.
    await page.setViewportSize({ width: 390, height: 500 });
    // The details screen this presses through to asks our server for printings.
    // Stubbed so this test measures scrolling and not the weather.
    await page.route("**/api/printings/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tcgdexSetId: "x", byNumber: {} }),
      }),
    );
    await openV2(page, "/search/charizard");

    const tiles = page.getByRole("button", { name: /#\d/ });
    await expect(tiles).toHaveCount(5);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const left = await page.evaluate(() => Math.round(window.scrollY));
    expect(left).toBeGreaterThan(100);

    /*
     * The LAST tile, deliberately. At the bottom of a page already scrolled to
     * the bottom it is fully in view, so pressing it moves nothing — press one
     * higher up and Playwright scrolls it into view first, and the assertion
     * below would be measuring its scroll rather than the user's.
     */
    await tiles.last().click();
    await expect(page.getByRole("heading", { name: "Printings" })).toBeVisible();

    await page.goBack();
    await expect(tiles.first()).toBeVisible();

    // Within a row of where it was — the point is landing back on the same
    // cards, not pixel-exactness after a reflow.
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 5_000 })
      .toBeGreaterThan(left - 40);
  });
});

test.describe("search @visual", () => {
  test("results look like themselves", async ({ page }) => {
    await openV2(page, "/search/charizard");
    await expect(page.getByRole("heading", { name: /for “charizard”/ })).toBeVisible();
    await stabiliseForSnapshot(page);
    // The main region only: the header is the shell's snapshot, not this one's.
    await expect(page.getByRole("main")).toHaveScreenshot("search-results.png");
  });
});

import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Home, from `docs/v2/specs/01-home.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * ## What the fixtures can and cannot show
 *
 * The e2e run sets `VITE_USE_MOCKS=true`, and the mock catalog knows six sets,
 * none of which are the five `?seed=collection` marks. So under test the whole
 * collection is a collection the pricing oracles have never heard of — which is
 * exactly the state the spec calls "No prices at all", and the one where a
 * lesser screen renders `$0.00` and a total of nothing. The priced and partly
 * priced wordings are asserted directly in `src/v2/screens/home/homeSummary.test.ts`,
 * where they can be driven without a catalog.
 */

/** Every request the page makes, so a budget can be asserted rather than assumed. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

test.describe("nothing tracked yet", () => {
  test("offers both ways in", async ({ page }) => {
    await openV2(page, "/", { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Nothing tracked yet", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse sets/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Search for a card/ })).toBeVisible();
  });

  test("neither action is a dead end", async ({ page }) => {
    // An empty dashboard whose only two exits go nowhere is worse than no
    // dashboard, so both are followed rather than merely counted.
    const shell = await openV2(page, "/", { seed: "empty" });
    await page.getByRole("link", { name: /Browse sets/ }).click();
    expect(page.url()).toContain("#/sets");
    // Sets and Collection are one screen in v2, so this is the entry that lights.
    await expect(shell.current).toHaveText("Collection");

    await page.goBack();
    await page.getByRole("link", { name: /Search for a card/ }).click();
    expect(page.url()).toContain("#/search");
    await expect(shell.current).toHaveText("Search");
  });

  test("shows no value panel at all, rather than a panel full of dashes", async ({ page }) => {
    await openV2(page, "/", { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Collection value" })).toHaveCount(0);
  });
});

test.describe("a collection", () => {
  test("says how big it is", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Your collection", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("5 cards");
    await expect(page.getByRole("main")).toContainText("5 printings");
    await expect(page.getByRole("main")).toContainText("5 sets");
  });

  test("never renders a bare total, and never renders $0.00", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { name: "Collection value" })).toBeVisible();

    // Nothing here can be priced, so the total is absent — not zero. A free card
    // and an unpriced card are not the same card.
    await expect(main).toContainText("Unavailable");
    await expect(main).not.toContainText("$0.00");

    // And the denominator is always there, whatever the numerator turned out to be.
    await expect(main).toContainText(/of your 5 printings|of 5 printings priced|All 5 printings priced/);
  });

  test("names the sets nothing could price, and offers a retry", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    // The five sets the mock catalog has never heard of, named rather than
    // silently folded into a total that would look complete.
    await expect(page.getByRole("main")).toContainText("base2");
    await expect(page.getByRole("button", { name: "Try pricing again" })).toBeVisible();
  });

  test("draws the growth chart, with a range that can be changed", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    await expect(page.getByRole("img", { name: /printings owned/ })).toBeVisible();

    const ranges = page.getByRole("group", { name: "Time range" });
    await expect(ranges.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
    await ranges.getByRole("button", { name: "30 days" }).click();
    await expect(ranges.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("img", { name: /printings owned/ })).toBeVisible();
  });

  test("resumes into the set you were last in", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    const resume = page.getByRole("link", { name: /Pick up where you left off/ });
    await expect(resume).toBeVisible();
    await resume.click();
    expect(page.url()).toContain("#/set/");
  });

  test("does not repeat the sync status the shell already shows", async ({ page }) => {
    // Sync is healthy here, so it needs nothing from the reader. Home spends its
    // space on the two states that stay broken until someone acts, and on
    // nothing else — the header's compact label covers the rest.
    await openV2(page, "/", { seed: "collection" });
    await expect(page.getByRole("main")).not.toContainText("Sync:");
    await expect(page.locator('[data-snapshot="volatile"]').first()).toContainText("Sync:");
  });

  test("does not restate the navigation as a row of tiles", async ({ page }) => {
    /*
     * The judgement recorded in HomeScreen.tsx. Every destination in the spec's
     * parity list is in the shell's nav on this very screen; a second copy down
     * the page would be a worse version of a control the reader already has, and
     * would go stale the moment the nav gains an entry. So Home's links are the
     * ones carrying state the nav cannot — and this asserts the absence, because
     * an absence nobody checks comes back.
     */
    await openV2(page, "/", { seed: "collection" });
    const main = page.getByRole("main");
    for (const label of ["Scan", "Sealed", "Target"]) {
      await expect(main.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });
});

test.describe("the request budget", () => {
  /**
   * Home prices the WHOLE collection in one `/api/catalog/prices` call. It got
   * there from nineteen per-set calls at 4.5-6.7s each, several of which failed
   * and left the screen reporting "480 of 973 printings priced".
   *
   * Under `VITE_USE_MOCKS` that endpoint is switched off — `useCatalogPrices`
   * will not reach a real URL from a mocked catalog — so what this can observe
   * is the CEILING: Home never issues more than one of them, and never fans a
   * price request out per set. The static half of the guarantee, that nothing in
   * `src/v2/screens/home/` opens a query at all, is asserted in that directory's
   * unit tests.
   */
  test("issues at most one catalog pricing request, and none per set", async ({ page }) => {
    const urls = recordRequests(page);
    await openV2(page, "/", { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Collection value" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const pricing = urls.filter((u) => u.includes("/api/catalog/prices"));
    expect(pricing.length).toBeLessThanOrEqual(1);

    // Five sets held. One printings request each is the measured, deliberate
    // cost; anything above that is a fan-out this screen introduced.
    const printings = urls.filter((u) => u.includes("/api/printings/"));
    expect(printings.length).toBeLessThanOrEqual(5);
  });
});

test.describe("home @visual", () => {
  /**
   * The whole page, not the `main` element.
   *
   * The shell's header is `position: sticky`, so an element screenshot of a
   * `main` taller than the viewport scrolls it up until the header is sitting
   * on top of the screen's own `<h1>` — the baseline came out with the title
   * half-covered. `fullPage` starts at the top of the document, where the
   * sticky header is where it belongs; the sync label inside it is hidden by
   * `stabiliseForSnapshot` because its text counts real minutes.
   */
  test("looks like itself", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    await expect(page.getByRole("heading", { name: "Your collection", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("home.png", { fullPage: true });
  });
});

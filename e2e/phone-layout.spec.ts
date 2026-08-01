import { test, expect } from "@playwright/test";

/**
 * These assertions are about layout physics, not appearance: nothing may
 * overflow horizontally, and every control a finger is meant to hit must be
 * large enough to hit. Both were tuned against a 600x600 square and have never
 * been checked at 390x844.
 *
 * The sets list (src/features/sets/SetsScreen.tsx) is shared with the glasses
 * and renders role="option" rows, not buttons — see e2e/sets.spec.ts for the
 * established pattern. "Obsidian Flames" is the newest set in the mock
 * fixtures (src/integrations/pokemon/fixtures.ts); "Pitch Black" does not
 * exist there.
 */

test.describe("web shell at phone size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("the set grid does not scroll sideways", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();
    await expect(page.getByRole("list")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("every filter chip is a 44px touch target", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();

    // WebSetCardsScreen is lazy-loaded (see ScreenRouter.tsx); wait for it to
    // mount before counting chips, since .count() does not auto-retry like
    // expect(...).toBeVisible() does.
    const chipGroup = page.getByRole("group", { name: "Filter by rarity" });
    await expect(chipGroup).toBeVisible();

    const chips = chipGroup.getByRole("button");
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box, `chip ${i} has no box`).not.toBeNull();
      expect(box!.height, `chip ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the card sheet fits on screen and its printing rows are tappable", async ({ page }) => {
    // Neither mock card in Obsidian Flames has more than one finish (sv3-223
    // is a Special Illustration Rare, which really only prints one way), so a
    // real card can never stress the sheet's height bound. useSetPrintings
    // (src/hooks/useSetPrintings.ts) hits `${companionBase()}/printings/:setId`
    // regardless of VITE_USE_MOCKS, and knownFinishesFor prefers that real
    // printings index over the mock's variants fallback the moment it answers
    // — so a routed response controls what the sheet renders without touching
    // any card fixture. 12 finishes (5 plain + 6 reverse foils + 1 holo foil)
    // at the sheet's 56px row minimum is ~750px of list alone, comfortably
    // past both the 85dvh sheet cap and the 844px Pixel 7 viewport, so the
    // sheet is guaranteed to need internal scrolling either way this resolves.
    const manyFinishes = [
      { type: "normal" },
      { type: "reverse" },
      { type: "holo" },
      { type: "firstEdition" },
      { type: "shadowless" },
      { type: "reverse", foil: "pokeball" },
      { type: "reverse", foil: "masterball" },
      { type: "reverse", foil: "energy" },
      { type: "reverse", foil: "friendball" },
      { type: "reverse", foil: "loveball" },
      { type: "reverse", foil: "quickball" },
      { type: "holo", foil: "tinsel" },
    ];
    await page.route("**/api/printings/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          tcgdexSetId: "sv3",
          // Both mock collector numbers in Obsidian Flames, so this does not
          // depend on which tile the grid happens to render first.
          byNumber: { "125": manyFinishes, "223": manyFinishes },
        }),
      });
    });

    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();
    await page
      .getByRole("button", { name: /printings owned/ })
      .first()
      .click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.height).toBeLessThanOrEqual(viewport.height);

    // The sheet being height-bounded and the Done button being reachable
    // without scrolling are different properties: a sheet can legitimately
    // clip its content at 85dvh while still burying its own close affordance
    // inside the clipped, scrolling region. Assert both.
    const closeButton = sheet.getByRole("button", { name: "Done" });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox, "Done button has no box").not.toBeNull();
    expect(
      closeBox!.y + closeBox!.height,
      "Done button must be reachable without scrolling the sheet",
    ).toBeLessThanOrEqual(box!.y + box!.height + 1);

    const rows = sheet.getByRole("button", { pressed: false });
    const rowCount = await rows.count();
    expect(rowCount, "no printing rows found").toBeGreaterThan(0);
    for (let i = 0; i < rowCount; i++) {
      const rowBox = await rows.nth(i).boundingBox();
      if (!rowBox) continue;
      expect(rowBox.height, `printing row ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });
});

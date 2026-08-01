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

    const rows = sheet.getByRole("button", { pressed: false });
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const rowBox = await rows.nth(i).boundingBox();
      if (!rowBox) continue;
      expect(rowBox.height, `printing row ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });
});

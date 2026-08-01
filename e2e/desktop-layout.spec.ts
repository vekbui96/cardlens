import { test, expect } from "@playwright/test";

/**
 * Desktop is a real target, not a wide phone.
 *
 * These assertions are about using the space, not about appearance: a 1440px
 * window must show a multi-column grid rather than a 760px letterbox, and the
 * card sheet must be a side panel rather than a short strip pinned to the
 * furthest point from the cursor.
 *
 * Follows the phone project's conventions — see e2e/phone-layout.spec.ts for
 * why the sets list renders role="option" rows and why the printings route is
 * stubbed to stress the sheet.
 */

test.describe("web shell at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("a large window is not letterboxed into a phone column", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    const shell = page.locator("#root > div");
    await expect(shell).toBeVisible();

    const box = await shell.boundingBox();
    // The old default capped every viewport at 760px. Anything at or below that
    // means desktop is still being treated as a phone.
    expect(box!.width, "shell width at 1440px").toBeGreaterThan(900);
  });

  test("the set grid uses the width with more than one column", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();

    const tiles = page.getByRole("button", { name: /printings owned/ });
    await expect(tiles.first()).toBeVisible();

    const count = await tiles.count();
    expect(count, "no card tiles rendered").toBeGreaterThan(1);

    // Same row => same y. A single-column grid would stack them instead.
    const first = await tiles.nth(0).boundingBox();
    const second = await tiles.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y), "tiles should sit side by side").toBeLessThan(4);
    expect(second!.x, "second tile should be to the right of the first").toBeGreaterThan(first!.x);
  });

  test("a card tile keeps its shape when the art fails to load", async ({ page }) => {
    // Found by screenshot: a 404 left the tile as a floating number and tick
    // with no box, because the placeholder has no intrinsic height. Two cells
    // of a nine-card page collapsed and the row lost its shape.
    await page.route("**/images.pokemontcg.io/**", (r) => r.abort());

    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();

    const tile = page.getByRole("button", { name: /printings owned/ }).first();
    await expect(tile).toBeVisible();

    const box = await tile.boundingBox();
    expect(box!.height, "tile collapsed when its image failed").toBeGreaterThan(100);
  });

  test("no horizontal overflow at desktop width", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();
    await expect(page.getByRole("list")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the card sheet is a full-height side panel, and Done stays reachable", async ({ page }) => {
    // The mock fixtures give each card one printing, so a real card cannot
    // stress the panel's height. See phone-layout.spec.ts for why routing
    // /api/printings controls what the sheet renders.
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

    // Anchored right, using the full height — not a short strip along the bottom.
    expect(box!.x + box!.width, "panel should meet the right edge").toBeGreaterThanOrEqual(
      viewport.width - 2,
    );
    expect(box!.height, "panel should use the full height").toBeGreaterThan(viewport.height * 0.9);
    expect(box!.width, "panel should not swallow the page").toBeLessThan(viewport.width / 2);

    // Height-bounded and Done-reachable are different properties; assert both.
    const closeBox = await sheet.getByRole("button", { name: "Done" }).boundingBox();
    expect(closeBox, "Done button has no box").not.toBeNull();
    expect(
      closeBox!.y + closeBox!.height,
      "Done must be reachable without scrolling the panel",
    ).toBeLessThanOrEqual(box!.y + box!.height + 1);
  });
});

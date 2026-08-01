import { test, expect } from "@playwright/test";

/**
 * The web app bar and its fold-out menu.
 *
 * Global navigation is shell-level on web because a browser can afford
 * persistent chrome and the glasses cannot — there, every row of chrome costs
 * roughly two rows of list, so destinations live behind a fixed Home menu. The
 * assertions here are about reachability, not appearance: every destination is
 * one tap from every screen, and the menu can always be closed.
 */

test.describe("web app bar", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  test("reaches every destination from a screen deep in the app", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("button", { name: "Open menu" }).click();

    const menu = page.getByRole("menu", { name: "Go to" });
    await expect(menu).toBeVisible();
    for (const label of ["Search", "Sets", "Collection", "Favorites", "Recent", "Popular"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
  });

  test("navigates, and the URL follows", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: /^Collection/ }).click();

    // Web navigation is URL-backed, so a menu jump must be a real history entry
    // rather than a state change the back gesture cannot undo.
    await expect(page).toHaveURL(/#\/collection$/);
    await expect(page.getByRole("menu")).toBeHidden();
  });

  test("marks where you already are", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("button", { name: "Open menu" }).click();

    await expect(page.getByRole("menuitem", { name: /^Sets/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("menuitem", { name: /^Recent/ })).not.toHaveAttribute("aria-current", "page");
  });

  test("closes on Escape and on the scrim", async ({ page }) => {
    await page.goto("/?ui=web#/sets");

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();

    await page.getByRole("button", { name: "Open menu" }).click();
    // Click the scrim well below the panel.
    await page.mouse.click(10, (page.viewportSize()?.height ?? 600) - 20);
    await expect(page.getByRole("menu")).toBeHidden();
  });

  test("does not push the screen below the fold", async ({ page }) => {
    // The shell sizes its screen child to the viewport. Adding a bar above it
    // without accounting for the bar's height would overflow by exactly that.
    await page.goto("/?ui=web#/sets");
    await expect(page.getByRole("banner")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow, "page scrolls by the height of the app bar").toBeLessThan(60);
  });
});

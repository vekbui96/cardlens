import { test, expect } from "@playwright/test";

/** The browser tab names the screen on the web shell; the glasses keep plain CardLens. */
test.describe("document title", () => {
  test("web shell: the title follows the screen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");

    await page.goto("/?ui=web#/sets");
    await expect(page).toHaveTitle("Sets · CardLens");

    await page.evaluate(() => {
      window.location.hash = "#/binders";
    });
    await expect(page).toHaveTitle("Binders · CardLens");
  });

  test("glasses layout: the title stays CardLens", async ({ page }) => {
    await page.goto("/?ui=glasses#/sets");
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page).toHaveTitle("CardLens");
  });
});

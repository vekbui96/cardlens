import { test, expect } from "@playwright/test";

import { openFromHome, select, swipeUp } from "./helpers.ts";

// Back must work WITHOUT the middle-finger pinch (the glasses OS reserves it):
// a visible Back control reachable by swipe-up + index pinch (SELECT).
test.describe("reliable back navigation", () => {
  test("swipe up to Back, then pinch, returns to the previous screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // Home -> Popular.
    await openFromHome(page, "Popular");
    await expect(page.getByRole("heading", { name: "Popular" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();

    // Swipe up onto Back, then select (index pinch) — no Escape used.
    await swipeUp(page);
    await select(page);
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
  });

  test("Back is clickable too (pointer parity)", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Favorites", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

import { openFromHome, select, swipeLeft, swipeRight } from "./helpers.ts";

test.describe("rarity filter on results", () => {
  test("swipe right/left cycles rarity and filters with price", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // Reach Charizard results via Popular (no typing).
    await openFromHome(page, "Popular");
    await expect(page.getByRole("heading", { name: "Popular" })).toBeVisible();
    await select(page); // Charizard
    await expect(page.getByRole("heading", { name: "Search Cards" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Swipe right twice: All -> IR -> SIR.
    await swipeRight(page);
    await expect(page.getByRole("tab", { name: "IR", exact: true })).toHaveAttribute("aria-selected", "true");
    await swipeRight(page);
    await expect(page.getByRole("tab", { name: "SIR", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The SIR Charizard (Obsidian Flames 223) is shown; a market price is visible.
    await expect(page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first()).toBeVisible();
    await expect(page.getByText(/\$\d/).first()).toBeVisible();

    // Swipe left returns to IR.
    await swipeLeft(page);
    await expect(page.getByRole("tab", { name: "IR", exact: true })).toHaveAttribute("aria-selected", "true");
  });
});

import { test, expect, type Page } from "@playwright/test";

const swipeDown = (p: Page) => p.locator("body").press("ArrowDown");
const swipeRight = (p: Page) => p.locator("body").press("ArrowRight");
const swipeLeft = (p: Page) => p.locator("body").press("ArrowLeft");
const select = (p: Page) => p.locator("body").press("Enter");

test.describe("rarity filter on results", () => {
  test("swipe right/left cycles rarity and filters with price", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // Reach Charizard results via Popular (no typing).
    await swipeDown(page);
    await swipeDown(page);
    await swipeDown(page); // Popular
    await select(page);
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

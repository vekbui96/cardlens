import { test, expect } from "@playwright/test";

// ?input=glasses forces the on-screen letter picker (as on the real glasses).
test.describe("on-glasses letter picker", () => {
  test("spell a couple letters, pick a suggestion, and see results", async ({ page }) => {
    await page.goto("/?input=glasses");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // Open Search -> the on-screen picker appears (no keyboard needed).
    await page.getByText("Search", { exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Search cards" });
    await expect(picker).toBeVisible();

    // Spell "cha" by activating letter keys.
    await picker.getByRole("gridcell", { name: "C", exact: true }).click();
    await picker.getByRole("gridcell", { name: "H", exact: true }).click();
    await picker.getByRole("gridcell", { name: "A", exact: true }).click();
    await expect(picker.getByText("cha", { exact: true })).toBeVisible();

    // Suggestions appear; pick Charizard to search instantly.
    await expect(picker.getByRole("option").first()).toBeVisible();
    await picker.getByRole("option", { name: "Charizard", exact: true }).click();

    // Results for Charizard.
    await expect(page.getByRole("heading", { name: "Search Cards" })).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("supports backspace and cancel", async ({ page }) => {
    await page.goto("/?input=glasses");
    await page.getByText("Search", { exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Search cards" });
    await picker.getByRole("gridcell", { name: "A", exact: true }).click();
    await picker.getByRole("gridcell", { name: "B", exact: true }).click();
    await expect(picker.getByText("ab", { exact: true })).toBeVisible();
    await picker.getByRole("gridcell", { name: "⌫" }).click();
    await expect(picker.getByText("a", { exact: true })).toBeVisible();
    // Cancel returns to home.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
  });
});

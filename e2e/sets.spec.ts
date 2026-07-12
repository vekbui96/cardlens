import { test, expect } from "@playwright/test";

test.describe("set browser", () => {
  test("browse to a set, see cards by value, filter rarity", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    await page.getByText("Sets", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sets" })).toBeVisible();

    // Newest set first (Obsidian Flames in the fixtures).
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();
    await expect(page.getByRole("heading", { name: "Obsidian Flames" })).toBeVisible();

    // Most valuable first: the SIR ($58.42) leads.
    const first = page.getByRole("option").first();
    await expect(first).toContainText("Charizard ex");
    await expect(page.getByText(/\$\d/).first()).toBeVisible();

    // Rarity filter works here too: All -> IR -> SIR.
    await page.locator("body").press("ArrowRight");
    await page.locator("body").press("ArrowRight");
    await expect(page.getByRole("tab", { name: "SIR", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("option").filter({ hasText: "Special Illustration Rare" }).first(),
    ).toBeVisible();
  });
});

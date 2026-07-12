import { test, expect } from "@playwright/test";

test.describe("full-screen card image", () => {
  test("open the card image full screen and close it", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Popular", { exact: true }).click();
    await page.getByRole("option").first().click(); // Charizard search
    await page.getByRole("option").first().click(); // open first card
    await expect(page.getByRole("heading", { name: /charizard/i })).toBeVisible();

    // Select the card image -> full-screen viewer.
    await page.getByRole("button", { name: /full screen/i }).click();
    const viewer = page.getByRole("dialog", { name: /full screen/i });
    await expect(viewer).toBeVisible();

    // Click to close; back on details.
    await viewer.click();
    await expect(viewer).toBeHidden();
    await expect(page.getByText("Market", { exact: true })).toBeVisible();
  });
});

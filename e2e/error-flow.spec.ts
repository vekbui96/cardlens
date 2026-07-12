import { test, expect } from "@playwright/test";

test.describe("failure handling", () => {
  test("shows an error state with retry when a request fails", async ({ page }) => {
    // ?sim=fail makes the data provider reject every request.
    await page.goto("/?sim=fail");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
    await page.locator("body").press("Enter"); // Search
    const input = page.getByRole("textbox");
    await input.fill("Charizard");
    await input.press("Enter");

    await expect(page.getByText(/Couldn’t load cards/i)).toBeVisible();
    await expect(page.getByText(/Try again/i)).toBeVisible();

    // The retry control is focused; activating it re-attempts the request.
    await page.locator("body").press("Enter");
    await expect(page.getByText(/Couldn’t load cards/i)).toBeVisible();
  });

  test("empty results show a helpful message", async ({ page }) => {
    await page.goto("/?sim=empty");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
    await page.locator("body").press("Enter");
    const input = page.getByRole("textbox");
    await input.fill("Charizard");
    await input.press("Enter");
    await expect(page.getByText(/No cards found/i)).toBeVisible();
  });
});

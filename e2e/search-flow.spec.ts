import { test, expect, type Page } from "@playwright/test";

import { openFromHome } from "./helpers.ts";

// The glasses emit keyboard events; drive the app exactly the same way. We target
// <body> explicitly so key events reliably reach the window listener regardless of
// which element last had focus (e.g. after a text modal closes).
const swipeDown = (p: Page) => p.locator("body").press("ArrowDown");
const swipeUp = (p: Page) => p.locator("body").press("ArrowUp");
const select = (p: Page) => p.locator("body").press("Enter");
const back = (p: Page) => p.locator("body").press("Escape");

test.describe("core search-to-favorite flow (keyboard only)", () => {
  test("search Charizard, view price, favorite, and reopen from favorites", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // 1. Search -> type -> submit. (Selection here uses activation; keyboard-only
    //    navigation is proven by the popular + error-flow specs.)
    await page.getByText("Search", { exact: true }).click();
    const input = page.getByRole("textbox");
    await expect(input).toBeVisible();
    await input.fill("Charizard");
    await input.press("Enter");

    // 2. Results appear; open the top result (exact-name "Charizard" ranks first).
    await expect(page.getByRole("heading", { name: "Search Cards" })).toBeVisible();
    await page.getByRole("option").first().click();

    // 3. Details screen (its heading is the card name) shows a market price.
    await expect(page.getByRole("heading", { name: /charizard/i })).toBeVisible();
    await expect(page.getByText("Market", { exact: true })).toBeVisible();
    await expect(page.getByText(/\$\d/).first()).toBeVisible();

    // 4. Favorite the card.
    await page.getByText(/☆ Favorite/).click();
    await expect(page.getByText(/★ Remove favorite/)).toBeVisible();

    // 5. Back to results, back to home — using keyboard (middle-pinch = Escape).
    await back(page);
    await expect(page.getByRole("heading", { name: "Search Cards" })).toBeVisible();
    await back(page);
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

    // 6. Reopen the saved card from Favorites.
    await page.getByText("Favorites", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    await page.getByRole("option").first().click();
    await expect(page.getByRole("heading", { name: /charizard/i })).toBeVisible();
    await expect(page.getByText("Market", { exact: true })).toBeVisible();
  });

  test("recent search is retained and reopenable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
    await select(page); // Search
    const input = page.getByRole("textbox");
    await input.fill("Pikachu");
    await input.press("Enter");
    await expect(page.getByRole("option").first()).toBeVisible();
    await back(page); // back to home

    // Recent is the second menu item.
    await swipeDown(page);
    await select(page);
    await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(page.getByText("Pikachu")).toBeVisible();
  });

  test("popular Pokémon search needs no typing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
    await openFromHome(page, "Popular");
    await expect(page.getByRole("heading", { name: "Popular" })).toBeVisible();
    await select(page); // Charizard (first popular)
    await expect(page.getByRole("heading", { name: "Search Cards" })).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();
    await swipeUp(page); // exercise focus movement
  });
});

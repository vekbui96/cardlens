import { expect, type Page } from "@playwright/test";

export const swipeUp = (p: Page) => p.locator("body").press("ArrowUp");
export const swipeDown = (p: Page) => p.locator("body").press("ArrowDown");
export const swipeLeft = (p: Page) => p.locator("body").press("ArrowLeft");
export const swipeRight = (p: Page) => p.locator("body").press("ArrowRight");
export const select = (p: Page) => p.locator("body").press("Enter");

/**
 * Swipe down until the named home row is focused, then select it.
 *
 * Counting swipes ("3 down to Popular") looks simpler but couples every test to
 * the menu's exact length — adding one entry broke three specs at once. Seeking
 * by name keeps these keyboard-only, which is the whole point of them: the
 * glasses have no pointer.
 */
export async function openFromHome(page: Page, label: string): Promise<void> {
  const row = page.getByRole("option").filter({ hasText: label });

  // Bounded so a typo fails with a clear message instead of hanging.
  const maxSwipes = 12;
  for (let i = 0; i < maxSwipes; i++) {
    if ((await row.getAttribute("aria-selected")) === "true") {
      await select(page);
      return;
    }
    await swipeDown(page);
  }

  throw new Error(`never focused the "${label}" row on the home menu after ${maxSwipes} swipes`);
}

/** Assert a screen is showing by its heading. */
export async function expectScreen(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

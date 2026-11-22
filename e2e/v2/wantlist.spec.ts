import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * The Want list (#146, spec #142): every card missing from the sets you have
 * started, grouped by set and priced.
 *
 * The collection is three cards from sets the mock catalog knows, and the
 * stubbed `/api/printings` gives each set a few more numbers: Obsidian Flames is
 * missing a priced card the catalog names and an unpriced one it does not,
 * Base is missing one priced card, Evolving Skies is complete (so it is left
 * out). Runs at 390 and 1440 (the `v2-phone` and `v2-desktop` projects).
 */

/** The collection's storage key — `cardlens:v{STORAGE_VERSION}:collection`. */
const COLLECTION_KEY = "cardlens:v1:collection";

const OWNED: Array<[string, string, string, string]> = [
  ["sv3-125", "sv3", "125", "holo"],
  ["base1-58", "base1", "58", "normal"],
  ["swsh7-215", "swsh7", "215", "holo"],
];

/** Printings per set: number -> [finish, USD price or none]. */
const PRINTINGS: Record<string, Record<string, Array<[string, number | null]>>> = {
  sv3: {
    "125": [["holo", 8.11]],
    "201": [["normal", null]],
    "223": [
      ["holo", 58.42],
      ["normal", 61],
    ],
  },
  base1: {
    "4": [["holo", 300]],
    "58": [["normal", 1.5]],
  },
  swsh7: { "215": [["holo", 80]] },
};

async function seedWantList(page: Page): Promise<void> {
  const rows = OWNED.map(([cardId, setId, number, finish], i) => ({
    cardId,
    setId,
    finish,
    number,
    at: 1_700_000_000_000 + i * 1000,
  }));
  await page.addInitScript(([key, owned]) => localStorage.setItem(key as string, JSON.stringify(owned)), [
    COLLECTION_KEY,
    rows,
  ] as const);
  await page.route("**/api/printings/**", (route) => {
    const setId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const byNumber: Record<string, unknown[]> = {};
    for (const [number, printings] of Object.entries(PRINTINGS[setId] ?? {})) {
      byNumber[number] = printings.map(([type, price]) => ({ type, ...(price === null ? {} : { price }) }));
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tcgdexSetId: setId, byNumber }),
    });
  });
}

const HEADLINE = "To finish: 3 cards missing across 2 sets, 2 priced, about $358.42, 1 unpriced";

test.describe("want list", () => {
  test("opens from Home's progress panel", async ({ page }) => {
    await seedWantList(page);
    const shell = await openV2(page, "/");
    await page.getByRole("link", { name: /^Want list/ }).click();
    expect(page.url()).toContain("#/wantlist");
    await expect(page.getByRole("heading", { name: "Want list", level: 1 })).toBeVisible();
    await expect(shell.current).toHaveText("Home");
  });

  test("adds up every started set, grouped by set, unpriced cards stated", async ({ page }) => {
    await seedWantList(page);
    await openV2(page, "/wantlist");
    const main = page.getByRole("main");
    await expect(page.getByTestId("want-headline")).toHaveText(HEADLINE);
    await expect(main.getByRole("heading", { name: "Obsidian Flames", level: 2 })).toBeVisible();
    await expect(main).toContainText("2 missing, about $58.42, 1 unpriced");
    await expect(main).toContainText("1 missing, about $300.00");
    await expect(main).toContainText("Unpriced");
    await expect(main).not.toContainText("$0.00");
    // A finished set is not on a want list.
    await expect(main.getByRole("heading", { name: "Evolving Skies" })).toHaveCount(0);
  });

  test("a set filter and a sort narrow the list, add up what is shown and survive a reload", async ({
    page,
  }) => {
    await seedWantList(page);
    await openV2(page, "/wantlist");
    const main = page.getByRole("main");
    await expect(page.getByTestId("want-headline")).toHaveText(HEADLINE);
    await main.getByRole("button", { name: "Most expensive first" }).click();
    await main.getByLabel("Set").selectOption("base1");
    await expect(page.getByTestId("want-headline")).toHaveText("Showing 1 card, about $300.00");
    await expect(main.getByRole("heading", { name: "Obsidian Flames" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("want-headline")).toHaveText("Showing 1 card, about $300.00");
    await expect(main.getByLabel("Set")).toHaveValue("base1");
    await expect(main.getByRole("button", { name: "Most expensive first" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await main.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("want-headline")).toHaveText(HEADLINE);
  });

  test("a row opens the card", async ({ page }) => {
    await seedWantList(page);
    await openV2(page, "/wantlist");
    await page.getByRole("link", { name: /^Charizard ex, #223/ }).click();
    expect(page.url()).toContain("#/card/sv3-223");
  });
});

test.describe("want list @visual", () => {
  test("missing cards across started sets", async ({ page }) => {
    await seedWantList(page);
    await openV2(page, "/wantlist");
    await expect(page.getByTestId("want-headline")).toHaveText(HEADLINE);
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("wantlist.png", { fullPage: true });
  });
});

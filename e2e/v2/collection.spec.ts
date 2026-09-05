import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Collection & sets — `docs/v2/specs/02-collection.md`.
 *
 * One screen, three routes. Everything here selects by role and accessible
 * name, so a control these tests can find is a control a screen reader can
 * find.
 *
 * ## Two kinds of setup, and why
 *
 * `?seed=collection` is the shared fixture and is used for what it can answer:
 * that the routes resolve, that the value panel keeps every set it holds, and
 * that the empty state says how to start. It CANNOT answer anything about
 * completion, because the five printings it seeds (`base2`, `ecard3`, `ex2`,
 * `ex10`, `pop3`) belong to sets the mock catalog does not contain — so under
 * e2e no set it owns ever appears in the set list at all. See the report; this
 * is a property of the fixture, not of the screen.
 *
 * So the progress and showcase tests seed storage directly, the way
 * `e2e/owned-cards.spec.ts` already does, with printings from sets the mock
 * catalog DOES have. That is the only way to exercise a real base/master split
 * here, and `sv3` (230 cards, 197 printed) is the case the whole feature exists
 * for: 223 is a secret rare and 125 is not, so the two figures differ.
 */

/** The collection's storage key — `cardlens:v{STORAGE_VERSION}:collection`. */
const COLLECTION_KEY = "cardlens:v1:collection";

/**
 * Eight cards from the mock catalog, each held in three printings.
 *
 * Printings, not cards: 24 rows over 8 cards over 6 sets. Six sets is one more
 * than the value panel folds at, which is what makes the expander appear.
 */
const CARDS: Array<[cardId: string, setId: string, number: string]> = [
  ["sv3-223", "sv3", "223"],
  ["sv3-125", "sv3", "125"],
  ["base1-4", "base1", "4"],
  ["base1-58", "base1", "58"],
  ["swsh1-25", "swsh1", "25"],
  ["swsh3-20", "swsh3", "20"],
  ["swsh7-215", "swsh7", "215"],
  ["sv2-106", "sv2", "106"],
];

const OWNED = CARDS.flatMap(([cardId, setId, number], i) =>
  ["normal", "holo", "reverse"].map((finish, f) => ({
    cardId,
    setId,
    finish,
    number,
    at: 1_700_000_000_000 + i * 1000 + f,
  })),
);

/** Seed before any page script runs, or LibraryProvider reads an empty store. */
async function seedOwned(page: Page): Promise<void> {
  await page.addInitScript(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)), [
    COLLECTION_KEY,
    OWNED,
  ] as const);
}

/**
 * Answer the TCGdex-backed printings endpoint locally.
 *
 * The e2e server proxies it to a third party that takes 120-295 requests to
 * answer for one set, so without this the value total is a race and the
 * "pricing N sets…" caption never settles. Stubbed empty on purpose: prices
 * then come from the mock catalog through `useCatalogPrices`, which is the
 * fallback oracle and is deterministic.
 */
async function stubPrintings(page: Page): Promise<void> {
  await page.route("**/api/printings/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tcgdexSetId: "", byNumber: {} }),
    }),
  );
}

/* --- The routes ----------------------------------------------------------- */

test.describe("collection & sets", () => {
  test("#/collection opens the screen", async ({ page }) => {
    const shell = await openV2(page, "/collection", { seed: "collection" });

    await expect(page.getByRole("heading", { name: "Collection", level: 1 })).toBeVisible();
    await expect(shell.current).toHaveText("Collection");
  });

  test("#/sets opens the SAME screen, because they always answered one question", async ({ page }) => {
    const shell = await openV2(page, "/sets", { seed: "collection" });

    await expect(page.getByRole("heading", { name: "Collection", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Value", level: 2 })).toBeVisible();
    await expect(shell.current).toHaveText("Collection");
  });

  test("the value panel keeps every set it holds, named even when the catalog cannot name it", async ({
    page,
  }) => {
    await stubPrintings(page);
    await openV2(page, "/collection", { seed: "collection" });

    // The fixture's sets are not in the mock catalog, so these fall back to the
    // set id — which is a real answer, and better than dropping the row.
    await expect(page.getByRole("heading", { name: "Value", level: 2 })).toBeVisible();
    await expect(page.getByTestId("collection-summary")).toContainText("5 printings");
  });

  test("an empty collection says how to start rather than showing an empty page", async ({ page }) => {
    await openV2(page, "/collection", { seed: "empty" });

    await expect(page.getByTestId("collection-summary")).toHaveText("Nothing tracked yet");
    await expect(page.getByText(/Nothing marked owned yet/).first()).toBeVisible();
    // Every set is still listed — an empty collection is not an empty catalog.
    await expect(page.getByRole("heading", { name: "Sets", level: 2 })).toBeVisible();
    await expect(page.getByTestId("set-grid").locator("> li")).not.toHaveCount(0);
  });

  test("says which filter emptied the list, and offers to clear it", async ({ page }) => {
    await openV2(page, "/collection", { seed: "empty" });

    await page.getByRole("searchbox", { name: "Filter sets" }).fill("zzzz");
    await expect(page.getByRole("heading", { name: "No set matches that" })).toBeVisible();
    await expect(page.getByText("zzzz")).toBeVisible();

    await page.getByRole("button", { name: "Clear the filter" }).click();
    await expect(page.getByTestId("set-grid").first().locator("> li")).not.toHaveCount(0);
  });

  test("a catalog that cannot be reached says so and offers a retry", async ({ page }) => {
    await openV2(page, "/collection", { seed: "empty", sim: "fail" });

    await expect(page.getByRole("heading", { name: "Sets could not be loaded" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("offers a way to connect sync from the screen itself", async ({ page }) => {
    await openV2(page, "/collection", { seed: "empty" });
    await expect(page.getByRole("button", { name: /^Sync/ })).toBeVisible();
  });
});

/* --- Completion ----------------------------------------------------------- */

test.describe("progress through a set", () => {
  test.beforeEach(async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
  });

  test("shows BASE and MASTER as two DIFFERENT figures, each with its word", async ({ page }) => {
    await openV2(page, "/collection");

    const row = page.getByRole("link", { name: /^Obsidian Flames/ });
    await expect(row).toBeVisible();

    // 125 is inside the printed run of 197; 223 is a secret rare and is not.
    // One bar could only ever have been telling you about one of the two.
    // `exact` throughout: Playwright's default text match is a case-insensitive
    // SUBSTRING, so a bare "BASE" also matches the set named "Base".
    await expect(row.getByText("BASE", { exact: true })).toBeVisible();
    await expect(row.getByText("MASTER", { exact: true })).toBeVisible();
    await expect(row.getByText("1/197", { exact: true })).toBeVisible();
    await expect(row.getByText("2/230", { exact: true })).toBeVisible();

    // And the same two figures reach a screen reader, spelled out.
    await expect(row).toHaveAttribute(
      "aria-label",
      "Obsidian Flames, base set 1 of 197, master set 2 of 230",
    );
  });

  test("offers no base tier for a set with no secrets to be short of", async ({ page }) => {
    await openV2(page, "/collection");

    // Base is 102/102 — base and master are the same achievement there.
    const row = page.getByRole("link", { name: /^Base,/ });
    await expect(row.getByText("MASTER", { exact: true })).toBeVisible();
    await expect(row.getByText("BASE", { exact: true })).toHaveCount(0);
  });

  test("started sets come first, under their own heading", async ({ page }) => {
    await openV2(page, "/collection");

    await expect(page.getByRole("heading", { name: "In progress", level: 2 })).toBeVisible();
    const first = page.getByTestId("set-grid").first();
    await expect(first.locator("> li")).toHaveCount(6);
  });

  test("a row opens its set", async ({ page }) => {
    await openV2(page, "/collection");

    await page.getByRole("link", { name: /^Obsidian Flames/ }).click();
    await expect(page).toHaveURL(/#\/set\/sv3\//);
  });
});

/* --- The value panel ------------------------------------------------------ */

test.describe("value", () => {
  test.beforeEach(async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
  });

  test("folds to five sets and NAMES and PRICES the one it folded away", async ({ page }) => {
    await openV2(page, "/collection");

    await expect(page.getByTestId("pricing-progress")).toHaveText("9 of 24 printings priced");

    const list = page.getByRole("heading", { name: "Value" }).locator("xpath=../..").getByRole("listitem");
    await expect(list).toHaveCount(5);

    // The reader can decide whether to open it WITHOUT opening it.
    const expander = page.getByRole("button", { expanded: false }).filter({ hasText: "1 more set" });
    await expect(expander).toContainText("$3.75");
    await expect(expander).toContainText("Paldea Evolved");

    await expander.click();
    await expect(list).toHaveCount(6);
    await expect(page.getByRole("button", { name: /Show the top 5 only/ })).toBeVisible();
  });

  test("the expander is a button, not a hover", async ({ page }) => {
    await openV2(page, "/collection");

    const expander = page.getByRole("button").filter({ hasText: "1 more set" });
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    // Reachable and operable from the keyboard, which a hover never is.
    await expander.focus();
    await page.keyboard.press("Enter");
    await expect(expander).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Show the top 5 only/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

/* --- Everything owned ----------------------------------------------------- */

test.describe("everything owned", () => {
  test.beforeEach(async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
  });

  test("#/owned is the same screen, in its other mode", async ({ page }) => {
    const shell = await openV2(page, "/owned");

    await expect(page.getByRole("heading", { name: "Collection", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Everything owned" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The shell agrees: owned is part of Collection, not a seventh destination.
    await expect(shell.current).toHaveText("Collection");
  });

  test("the two views are one link apart", async ({ page }) => {
    await openV2(page, "/collection");
    await page.getByRole("link", { name: "Everything owned" }).click();

    await expect(page).toHaveURL(/#\/owned$/);
    await expect(page.getByRole("listbox", { name: "Cards you own" })).toBeVisible();
  });

  test("rows are printings, not cards", async ({ page }) => {
    await openV2(page, "/owned");

    // Eight cards, three printings each. A card held in normal and reverse is
    // two rows, because they are two things with two prices and you own both.
    await expect(page.getByRole("listbox", { name: "Cards you own" }).getByRole("option")).toHaveCount(24);
    await expect(page.getByTestId("owned-summary")).toContainText("24 printings");
  });

  test("the stage does NOT move when the filmstrip scrolls", async ({ page }) => {
    await openV2(page, "/owned");

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    const stage = page.getByTestId("showcase-stage");
    await strip.getByRole("option").first().click();
    const before = await stage.boundingBox();

    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await expect(stage.getByText("9 of 24", { exact: true })).toBeVisible();

    // The strip really did scroll…
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft), { timeout: 5000 }).toBeGreaterThan(0);
    // …and the card being chosen did not go anywhere.
    const after = await stage.boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(after?.x).toBe(before?.x);
  });

  test("the arrow keys stop at the ends rather than wrapping", async ({ page }) => {
    await openV2(page, "/owned");

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    const stage = page.getByTestId("showcase-stage");
    await strip.getByRole("option").first().click();
    await expect(stage.getByText("1 of 24", { exact: true })).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(stage.getByText("1 of 24", { exact: true })).toBeVisible();
    await page.keyboard.press("End");
    await expect(stage.getByText("24 of 24", { exact: true })).toBeVisible();
  });

  test("changing the sort keeps every row", async ({ page }) => {
    await openV2(page, "/owned");

    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
    const rows = page.getByRole("list").getByRole("button");
    await expect(rows).toHaveCount(24);

    const sorts = page.getByRole("group", { name: "Sort by" });
    await expect(sorts.getByRole("button", { name: "Price" })).toHaveAttribute("aria-pressed", "true");
    await sorts.getByRole("button", { name: "Set & number" }).click();
    await expect(sorts.getByRole("button", { name: "Set & number" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(24);
  });

  test("an empty collection offers the action that fixes it", async ({ page }) => {
    // Overrides the seeding above: nothing owned at all.
    await page.addInitScript((key) => localStorage.setItem(key, "[]"), COLLECTION_KEY);
    await openV2(page, "/owned");

    await expect(page.getByRole("link", { name: "Browse the sets" })).toBeVisible();
  });
});

/* --- Layout --------------------------------------------------------------- */

test.describe("layout", () => {
  test.beforeEach(async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
  });

  test("puts the width into COLUMNS, not into a gap inside a row", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "v2-desktop", "a 1440px window");
    await openV2(page, "/collection");

    const boxes = await page
      .getByTestId("set-grid")
      .first()
      .locator("> li")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height };
        }),
      );
    expect(boxes.length).toBeGreaterThan(2);

    const topRow = boxes.filter((b) => b.y === boxes[0]!.y);
    expect(topRow.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) {
      expect(b.w).toBeLessThanOrEqual(500);
      // 44px is a thumb, which a pointer does not need; 72 is where a row stops
      // being a row and starts being a card.
      expect(b.h).toBeGreaterThanOrEqual(44);
      expect(b.h).toBeLessThanOrEqual(72);
    }
  });

  test("is one column of rows on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "v2-phone", "a 390px window");
    await openV2(page, "/collection");

    const xs = await page
      .getByTestId("set-grid")
      .first()
      .locator("> li")
      .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().x)))]);
    expect(xs).toHaveLength(1);
  });
});

/* --- Visual --------------------------------------------------------------- */

test.describe("collection @visual", () => {
  test("the set list, with progress", async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
    await openV2(page, "/collection");
    await expect(page.getByTestId("pricing-progress")).toHaveText("9 of 24 printings priced");
    await stabiliseForSnapshot(page);
    // A generous stability window: the set logos come from a third-party CDN
    // over the real network here, and a phone-width page is tall enough that
    // the last of them is still settling when the default 5s runs out.
    await expect(page.getByRole("main")).toHaveScreenshot("collection-sets.png", { timeout: 20000 });
  });

  test("everything owned, on the showcase", async ({ page }) => {
    await stubPrintings(page);
    await seedOwned(page);
    await openV2(page, "/owned");
    await expect(page.getByTestId("showcase-stage").getByText("1 of 24", { exact: true })).toBeVisible();
    await stabiliseForSnapshot(page);
    // A generous stability window: the set logos come from a third-party CDN
    // over the real network here, and a phone-width page is tall enough that
    // the last of them is still settling when the default 5s runs out.
    await expect(page.getByRole("main")).toHaveScreenshot("collection-owned.png", { timeout: 20000 });
  });

  test("an empty collection", async ({ page }) => {
    await openV2(page, "/collection", { seed: "empty" });
    await expect(page.getByTestId("collection-summary")).toHaveText("Nothing tracked yet");
    await stabiliseForSnapshot(page);
    // A generous stability window: the set logos come from a third-party CDN
    // over the real network here, and a phone-width page is tall enough that
    // the last of them is still settling when the default 5s runs out.
    await expect(page.getByRole("main")).toHaveScreenshot("collection-empty.png", { timeout: 20000 });
  });
});

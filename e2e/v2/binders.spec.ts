import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * The binder shelf, from `docs/v2/specs/04-binders.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * `?seed=binders` gives three deliberately different binders: `fx-full`
 * (9-pocket, three pages, every pocket filled, with a chosen cover),
 * `fx-sparse` (12-pocket, one card on page 3) and `fx-empty` (9-pocket, nothing
 * in it). Between them they cover chosen cover, page mosaic, a page that is not
 * page 1, and a genuinely empty binder.
 */

/** The width of a binder's cover, which is the only claim here made in pixels. */
async function coverWidth(page: Page, format: "4" | "9" | "12"): Promise<number> {
  const box = await page.locator(`[data-cover-format="${format}"]`).first().boundingBox();
  if (!box) throw new Error(`no ${format}-pocket cover on screen`);
  return box.width;
}

test.describe("an empty shelf", () => {
  test("is the create tile, and nothing else", async ({ page }) => {
    // No "No binders yet" notice: it would sit underneath the form that
    // answers it. The empty slot on the shelf IS the empty state.
    await openV2(page, "/binders", { seed: "empty" });
    await expect(page.getByRole("heading", { name: "Binders", level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Binder name" })).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("main")).not.toContainText("No binders");
  });

  test("will not create a binder with no name", async ({ page }) => {
    // A binder is found on this shelf by sight and by name; one called
    // "Untitled" is findable by neither.
    await openV2(page, "/binders", { seed: "empty" });
    await expect(page.getByRole("button", { name: "Create binder" })).toBeDisabled();
    await page.getByRole("textbox", { name: "Binder name" }).fill("   ");
    await expect(page.getByRole("button", { name: "Create binder" })).toBeDisabled();
  });

  test("creates a binder in the chosen format and opens it", async ({ page }) => {
    await openV2(page, "/binders", { seed: "empty" });
    await page.getByRole("textbox", { name: "Binder name" }).fill("Jolteon");
    await page
      .getByRole("group", { name: "Binder format" })
      .getByRole("button", { name: "12-pocket" })
      .click();
    await page.getByRole("button", { name: "Create binder" }).click();

    // Straight into it: a binder is created in order to be laid out.
    expect(page.url()).toContain("#/binder/");

    // And it survives the trip back — the create wrote through the real
    // repository, not component state.
    await page.goBack();
    await expect(page.getByRole("link", { name: /Jolteon/ })).toBeVisible();
  });
});

test.describe("a shelf of binders", () => {
  test("shows every binder, and one more slot to fill", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    for (const name of ["Jolteon", "Showcase", "Destined rivals"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
    // Three binders plus the create tile.
    await expect(page.getByRole("listitem")).toHaveCount(4);
  });

  test("says how full each binder is, in a bar and in a number", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    const main = page.getByRole("main");
    // fx-full: three 9-pocket pages, every pocket placed.
    await expect(main).toContainText("27 / 27");
    await expect(main).toContainText("complete");
    // fx-empty: nothing in it, and honest about it.
    await expect(main).toContainText("0 / 9");
    await expect(page.getByRole("progressbar", { name: /Jolteon filled/ })).toBeVisible();
  });

  test("summarises the shelf in cards, not just binders", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await expect(page.getByRole("main")).toContainText("3 binders · 28 cards");
  });

  test("names the format and the page count", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    const main = page.getByRole("main");
    await expect(main).toContainText("9-pocket · 3 pages");
    await expect(main).toContainText("12-pocket · 3 pages");
  });

  test("the whole tile opens the binder", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await page.getByRole("link", { name: /Jolteon/ }).click();
    expect(page.url()).toContain("#/binder/fx-full");
  });

  /**
   * The art is texture, not content. The tile's link already carries the name,
   * the format and the fill in words, so twelve unlabelled thumbnails would add
   * a screen reader nothing but twelve stops.
   */
  test("exposes no images to assistive technology at all", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await expect(page.getByRole("img")).toHaveCount(0);
  });

  test("a 12-pocket cover is visibly wider than a 9-pocket one", async ({ page }) => {
    // Four cards across against three. Covers are one fixed HEIGHT — like real
    // binders on a real shelf — so width is the only honest way to show it.
    await openV2(page, "/binders", { seed: "binders" });
    const nine = await coverWidth(page, "9");
    const twelve = await coverWidth(page, "12");
    expect(twelve).toBeGreaterThan(nine);
  });

  test("every tile in a row is the same height", async ({ page }) => {
    // While the cover took its height from the column width, the shelf jumped a
    // row taller mid-resize. A fixed cover height is what makes auto-fill safe.
    await openV2(page, "/binders", { seed: "binders" });
    const boxes = await page.getByRole("listitem").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      }),
    );
    const rows = new Map<number, number[]>();
    for (const b of boxes) rows.set(b.top, [...(rows.get(b.top) ?? []), b.height]);
    for (const [, heights] of rows) {
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("deleting", () => {
  test("one press never deletes", async ({ page }) => {
    /*
     * A binder is an evening's arrangement and there is no undo — the delete
     * writes a tombstone precisely so it SURVIVES a sync, which means a
     * misclick reaches every device.
     */
    await openV2(page, "/binders", { seed: "binders" });
    await page.getByRole("button", { name: "Delete Jolteon" }).click();
    await expect(page.getByRole("group", { name: "Delete Jolteon?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Jolteon/ })).toBeVisible();
  });

  test("changing your mind puts it back", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await page.getByRole("button", { name: "Delete Jolteon" }).click();
    await page.getByRole("button", { name: "Keep Jolteon" }).click();
    await expect(page.getByRole("group", { name: "Delete Jolteon?" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Jolteon/ })).toBeVisible();
  });

  test("the second press, on the other button, deletes it", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await page.getByRole("button", { name: "Delete Jolteon" }).click();
    await page.getByRole("button", { name: "Confirm delete Jolteon" }).click();
    await expect(page.getByRole("link", { name: /Jolteon/ })).toHaveCount(0);
    // The others are untouched.
    await expect(page.getByRole("link", { name: /Showcase/ })).toBeVisible();
  });
});

test.describe("a binder that asked to be priced", () => {
  test("shows a total with its unpriced count, and never $0.00", async ({ page }) => {
    // `?seed=trade` is the only fixture with `showValue`. Under mocks nothing in
    // it can be priced, which is exactly the "Unavailable" state — the one where
    // a lesser screen renders a confident $0.00.
    await openV2(page, "/binders", { seed: "trade" });
    const main = page.getByRole("main");
    await expect(main).toContainText("For trade");
    await expect(main).not.toContainText("$0.00");
    await expect(main).toContainText(/Pricing…|Unavailable|\$/);
  });

  test("counts stacked copies in the shelf summary, but not in the fill", async ({ page }) => {
    // fx-trade is 4-pocket with four cards, the first stacked three deep.
    await openV2(page, "/binders", { seed: "trade" });
    const main = page.getByRole("main");
    await expect(main).toContainText("1 binder · 6 cards");
    await expect(main).toContainText("4 / 4");
  });
});

test.describe("the request budget", () => {
  /**
   * The shelf costs nothing. Covers come from `imageSmall`, denormalised into
   * the binder itself, and prices are asked for ONLY the binders that opted in
   * via `showValue` — because pricing one is a request per set it spans, and
   * the Riolu binder alone spans thirty.
   */
  test("prices nothing when no binder asked to be priced", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openV2(page, "/binders", { seed: "binders" });
    await expect(page.getByRole("link", { name: /Jolteon/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => u.includes("/api/printings/"))).toEqual([]);
  });
});

test.describe("binders @visual", () => {
  test("looks like itself", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Binders", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("binders.png", { fullPage: true });
  });
});
